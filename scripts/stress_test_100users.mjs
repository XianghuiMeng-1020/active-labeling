#!/usr/bin/env node
/**
 * 100-user concurrent stress test for the Active Labeling platform.
 *
 * Simulates 100 users performing the full labeling workflow in parallel,
 * with configurable concurrency batching to prevent socket exhaustion.
 *
 * Usage:
 *   node scripts/stress_test_100users.mjs [NUM_USERS] [API_BASE] [ADMIN_TOKEN] [CONCURRENCY]
 *
 * Examples:
 *   node scripts/stress_test_100users.mjs 100 http://localhost:8787 dev-admin-token 20
 *   node scripts/stress_test_100users.mjs 100 https://sentence-labeling-api.<account>.workers.dev <token> 25
 *
 * Proxy: set HTTPS_PROXY or HTTP_PROXY env var for remote targets behind a firewall.
 */

// Auto-configure proxy for Node.js fetch (undici)
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
if (proxyUrl) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    console.log(`[Proxy] Using ${proxyUrl}`);
  } catch {
    console.warn("[Proxy] undici not available, proxy env vars ignored. Run: npm i undici");
  }
}

const NUM_USERS = parseInt(process.argv[2] ?? "100", 10);
const API_BASE = process.argv[3] ?? "http://localhost:8787";
const ADMIN_TOKEN = process.argv[4] ?? "dev-admin-token";
const CONCURRENCY = parseInt(process.argv[5] ?? "20", 10);
const LABELS = ["EXPLANATION", "EVALUATION", "RESPONSIBILITY", "APPLICATION", "IMPLICATION"];
const NORMAL_N = 4;
const ACTIVE_M = 2;

const pad = (n, w = 3) => String(n).padStart(w, " ");
const ts = () => new Date().toISOString().slice(11, 23);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const counters = {
  sessions: 0,
  manualSubmits: 0,
  llmRuns: 0,
  llmAccepts: 0,
  undos: 0,
  errors: 0,
  llmErrors: 0,
  rateLimit: 0,
  providerQwen: 0,
  providerOpenai: 0,
  latencies: [],
};

class UserSimulator {
  constructor(id) {
    this.id = id;
    this.tag = `[User-${pad(id)}]`;
    this.sessionId = null;
    this.startTime = 0;
  }

  _log(msg) {
    console.log(`${ts()} ${this.tag} ${msg}`);
  }

  async _req(path, init, retries = 3) {
    const url = `${API_BASE}${path}`;
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, init);
        if (res.status === 429) {
          counters.rateLimit++;
          this._log(`⚠ 429 on ${path} (attempt ${i + 1}/${retries})`);
          await sleep(2000 + Math.random() * 4000);
          continue;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          if (i < retries - 1 && (res.status >= 500 || res.status === 0)) {
            await sleep(1000 + Math.random() * 2000);
            continue;
          }
          throw new Error(`${path} => ${res.status}: ${text.slice(0, 200)}`);
        }
        return res.json();
      } catch (err) {
        if (err.message?.includes("=>")) throw err;
        if (i < retries - 1) {
          await sleep(1000 + Math.random() * 2000);
          continue;
        }
        throw err;
      }
    }
    throw new Error(`${path} => exhausted ${retries} retries`);
  }

  makeAttempt() {
    const now = Date.now();
    const shownAt = now - 3000 - Math.floor(Math.random() * 5000);
    return {
      shown_at_epoch_ms: shownAt,
      answered_at_epoch_ms: now,
      active_ms: 1500 + Math.floor(Math.random() * 3000),
      hidden_ms: 0,
      idle_ms: Math.floor(Math.random() * 500),
      hidden_count: 0,
      blur_count: 0,
      had_background: 0,
      events: [
        { t_perf_ms: 100, t_epoch_ms: shownAt + 100, type: "focus" },
        { t_perf_ms: now - shownAt, t_epoch_ms: now, type: "click" },
      ],
    };
  }

  async createSession() {
    const data = await this._req("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: `stress100_user_${this.id}`,
        normal_n: NORMAL_N,
        active_m: ACTIVE_M,
      }),
    });
    this.sessionId = data.session_id;
    counters.sessions++;
    this._log(`✓ session: ${this.sessionId.slice(0, 8)}…`);
    return data;
  }

  async doManualPhase(phase) {
    let round = 0;
    while (true) {
      round++;
      const next = await this._req(
        `/api/units/next?session_id=${this.sessionId}&phase=${phase}&task=manual`
      );
      if (!next.unit) {
        this._log(`✓ ${phase}/manual done (${round - 1} units)`);
        break;
      }
      const label = pick(LABELS);
      await this._req("/api/labels/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: this.sessionId,
          unit_id: next.unit.unit_id,
          phase,
          label,
          attempt: this.makeAttempt(),
        }),
      });
      counters.manualSubmits++;

      if (round === 2 && phase === "normal" && Math.random() < 0.3) {
        try {
          await this._req("/api/labels/undo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: this.sessionId, unit_id: next.unit.unit_id, phase }),
          });
          counters.undos++;
          const newLabel = pick(LABELS);
          await this._req("/api/labels/manual", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: this.sessionId,
              unit_id: next.unit.unit_id,
              phase,
              label: newLabel,
              attempt: this.makeAttempt(),
            }),
          });
          counters.manualSubmits++;
        } catch (e) {
          counters.errors++;
          this._log(`✗ undo failed: ${e.message.slice(0, 80)}`);
        }
      }

      await sleep(30 + Math.random() * 100);
    }
  }

  async doLlmPhase() {
    let round = 0;
    while (true) {
      round++;
      const next = await this._req(
        `/api/units/next?session_id=${this.sessionId}&phase=normal&task=llm`
      );
      if (!next.unit) {
        this._log(`✓ normal/llm done (${round - 1} units)`);
        break;
      }

      try {
        const llm = await this._req("/api/llm/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: this.sessionId,
            unit_id: next.unit.unit_id,
            phase: "normal",
            mode: pick(["prompt1", "prompt2"]),
          }),
        });
        counters.llmRuns++;
        if (llm.provider === "openai") counters.providerOpenai++;
        else counters.providerQwen++;

        const predicted = llm.predicted_label ?? pick(LABELS);
        const acceptLabel = Math.random() < 0.7 ? predicted : pick(LABELS);
        await this._req("/api/llm/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: this.sessionId,
            unit_id: next.unit.unit_id,
            phase: "normal",
            mode: "prompt1",
            accepted_label: acceptLabel,
            attempt: this.makeAttempt(),
          }),
        });
        counters.llmAccepts++;
      } catch (e) {
        const isKeyErr = e.message?.includes("401") || e.message?.includes("403");
        if (isKeyErr) {
          counters.llmErrors++;
          this._log(`⚠ LLM key error: ${next.unit.unit_id}`);
        } else {
          counters.errors++;
          this._log(`✗ LLM failed: ${e.message.slice(0, 100)}`);
        }
        try {
          await this._req("/api/llm/accept", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: this.sessionId,
              unit_id: next.unit.unit_id,
              phase: "normal",
              mode: "prompt1",
              accepted_label: pick(LABELS),
              attempt: this.makeAttempt(),
            }),
          });
          counters.llmAccepts++;
        } catch (e2) {
          counters.errors++;
        }
      }
      await sleep(30 + Math.random() * 100);
    }
  }

  async run() {
    this.startTime = Date.now();
    try {
      await this.createSession();
      this._log("── manual ──");
      await this.doManualPhase("normal");
      this._log("── llm ──");
      await this.doLlmPhase();

      const status = await this._req(`/api/session/status?session_id=${this.sessionId}`);
      if (status.gates?.can_enter_active_manual) {
        this._log("── active ──");
        await this.doManualPhase("active");
      }
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      counters.latencies.push(Date.now() - this.startTime);
      this._log(`✅ done in ${elapsed}s`);
    } catch (err) {
      counters.errors++;
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      counters.latencies.push(Date.now() - this.startTime);
      this._log(`✗ FATAL after ${elapsed}s: ${err.message.slice(0, 120)}`);
    }
  }
}

async function seedEnvironment() {
  console.log(`${ts()} [Setup] Checking seed data…`);

  try {
    const healthRes = await fetch(`${API_BASE}/api/health`);
    const health = await healthRes.json();
    console.log(`${ts()} [Setup] Health: ${JSON.stringify(health)}`);
  } catch (e) {
    console.error(`${ts()} [Setup] ✗ Cannot reach API: ${e.message}`);
    process.exit(1);
  }

  let adminSessionToken = null;
  try {
    const adminLogin = await fetch(`${API_BASE}/api/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin_token: ADMIN_TOKEN }),
    });
    if (adminLogin.ok) {
      const data = await adminLogin.json();
      adminSessionToken = data.token;
      console.log(`${ts()} [Setup] ✓ Admin login ok`);
    } else {
      console.log(`${ts()} [Setup] ⚠ Admin login failed (${adminLogin.status}), skipping seed & verification — user APIs still testable`);
    }
  } catch (e) {
    console.log(`${ts()} [Setup] ⚠ Admin unreachable, skipping seed & verification`);
  }

  if (adminSessionToken) {
    const authHeaders = { Authorization: `Bearer ${adminSessionToken}`, "Content-Type": "application/json" };
    const unitsRes = await fetch(`${API_BASE}/api/admin/stats/overall`, {
      headers: { Authorization: `Bearer ${adminSessionToken}` },
    });
    const unitsData = await unitsRes.json();
    if (unitsData.error) {
      console.log(`${ts()} [Setup] Seeding units + taxonomy…`);
      const units = [];
      for (let i = 1; i <= 20; i++) {
        units.push({
          unit_id: `stress_u${String(i).padStart(3, "0")}`,
          text: `AI test sentence ${i}: ${[
            "AI literacy is essential for education.",
            "Governance requires accountability.",
            "Overreliance may reduce critical thinking.",
            "AI can personalize learning experiences.",
            "Organizations must document AI decisions.",
            "AI adoption may reshape job roles.",
            "People need informed decisions in daily life.",
            "AI speeds up repetitive tasks.",
            "Governance ensures responsible deployment.",
            "Critical thinking could weaken over time.",
            "Machine learning enables pattern recognition.",
            "Data privacy must be maintained.",
            "Automation increases operational efficiency.",
            "Ethical AI requires transparency.",
            "Human oversight remains crucial.",
            "AI assists in medical diagnostics.",
            "Bias in training data leads to unfair outcomes.",
            "Education systems need to adapt to AI.",
            "AI-powered analytics improve decision making.",
            "Collaborative human-AI teams outperform either alone.",
          ][i - 1]}`,
        });
      }
      await fetch(`${API_BASE}/api/admin/units/import`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ units }),
      });
      await fetch(`${API_BASE}/api/admin/taxonomy/set`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          labels: LABELS.map((l) => ({ label: l })),
        }),
      });
      await fetch(`${API_BASE}/api/admin/prompts/set`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          prompt1: "Classify into EXPLANATION EVALUATION RESPONSIBILITY APPLICATION IMPLICATION. Return JSON: {\"label\":\"ONE\"}",
          prompt2: "Same task. Return JSON: {\"label\":\"ONE\"}",
        }),
      });
      console.log(`${ts()} [Setup] ✓ Seed complete (20 units, 5 labels, 2 prompts)`);
    } else {
      console.log(`${ts()} [Setup] ✓ Data already exists`);
    }
  }

  return adminSessionToken;
}

async function adminVerification(adminSessionToken) {
  const tag = "[Verify]";
  const authHeaders = { Authorization: `Bearer ${adminSessionToken}` };
  console.log(`\n${ts()} ${tag} ── Post-test verification ──`);
  try {
    const overall = await fetch(`${API_BASE}/api/admin/stats/overall`, { headers: authHeaders });
    const oData = await overall.json();
    const totalLabels = Object.values(oData.overall || {}).reduce((a, b) => a + b, 0);
    console.log(`${ts()} ${tag} Total labels in DB: ${totalLabels}`);

    const sessions = await fetch(`${API_BASE}/api/admin/sessions`, { headers: authHeaders });
    const sData = await sessions.json();
    console.log(`${ts()} ${tag} Sessions in DB: ${sData.sessions?.length ?? 0}`);

    const audit = await fetch(`${API_BASE}/api/admin/audit/consistency`, { headers: authHeaders });
    const aData = await audit.json();
    console.log(`${ts()} ${tag} Consistency audit: ok=${aData.ok}, mismatches=${aData.mismatches?.length ?? 0}`);
    if (aData.mismatches?.length > 0) {
      console.log(`${ts()} ${tag} ⚠ ${JSON.stringify(aData.mismatches.slice(0, 5))}`);
    }

    return { totalLabels, sessions: sData.sessions?.length ?? 0, auditOk: aData.ok };
  } catch (e) {
    console.log(`${ts()} ${tag} ✗ verification error: ${e.message}`);
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(72)}`);
console.log(`  100-User Stress Test`);
console.log(`  Users: ${NUM_USERS} | Concurrency: ${CONCURRENCY} | API: ${API_BASE}`);
console.log(`  Normal: ${NORMAL_N} units | Active: ${ACTIVE_M} units`);
console.log(`${"═".repeat(72)}\n`);

const startTime = Date.now();
const adminToken = await seedEnvironment();

const users = Array.from({ length: NUM_USERS }, (_, i) => new UserSimulator(i + 1));
const batches = [];
for (let i = 0; i < users.length; i += CONCURRENCY) {
  batches.push(users.slice(i, i + CONCURRENCY));
}

console.log(`\n${ts()} [Run  ] Starting ${NUM_USERS} users in ${batches.length} batches of ${CONCURRENCY}\n`);

for (let bi = 0; bi < batches.length; bi++) {
  const batch = batches[bi];
  console.log(`${ts()} [Batch] ── Batch ${bi + 1}/${batches.length} (${batch.length} users) ──`);
  await Promise.all(batch.map((u) => u.run()));
  if (bi < batches.length - 1) {
    await sleep(500);
  }
}

const verifyResult = adminToken ? await adminVerification(adminToken) : null;
if (!adminToken) console.log(`\n${ts()} [Verify] ⚠ Skipped (no admin token)`);

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
const p50 = counters.latencies.sort((a, b) => a - b)[Math.floor(counters.latencies.length * 0.5)] ?? 0;
const p95 = counters.latencies.sort((a, b) => a - b)[Math.floor(counters.latencies.length * 0.95)] ?? 0;

console.log(`\n${"═".repeat(72)}`);
console.log(`  STRESS TEST RESULTS`);
console.log(`${"═".repeat(72)}`);
console.log(`  Total time:         ${elapsed}s`);
console.log(`  Users:              ${NUM_USERS}`);
console.log(`  Concurrency:        ${CONCURRENCY}`);
console.log(`  Sessions created:   ${counters.sessions}`);
console.log(`  Manual submits:     ${counters.manualSubmits}`);
console.log(`  LLM runs:           ${counters.llmRuns}`);
console.log(`    ├─ Qwen:          ${counters.providerQwen}`);
console.log(`    └─ OpenAI:        ${counters.providerOpenai}`);
console.log(`  LLM accepts:        ${counters.llmAccepts}`);
console.log(`  Undos:              ${counters.undos}`);
console.log(`  Rate-limited (429): ${counters.rateLimit}`);
console.log(`  LLM key errors:     ${counters.llmErrors}`);
console.log(`  Real errors:        ${counters.errors}`);
console.log(`  User latency p50:   ${(p50 / 1000).toFixed(1)}s`);
console.log(`  User latency p95:   ${(p95 / 1000).toFixed(1)}s`);
if (verifyResult) {
  console.log(`${"─".repeat(72)}`);
  console.log(`  DB Labels total:    ${verifyResult.totalLabels}`);
  console.log(`  Sessions in DB:     ${verifyResult.sessions}`);
  console.log(`  Audit OK:           ${verifyResult.auditOk}`);
}
console.log(`${"═".repeat(72)}`);

const issues = [];
if (counters.sessions < NUM_USERS) issues.push(`sessions: ${counters.sessions}/${NUM_USERS}`);
if (counters.errors > NUM_USERS * 0.1) issues.push(`too many errors: ${counters.errors}`);
if (verifyResult && !verifyResult.auditOk) issues.push("consistency audit FAILED");

if (issues.length > 0) {
  console.log(`\n  VERDICT: ⚠️ ISSUES`);
  issues.forEach((i) => console.log(`    ⚠ ${i}`));
} else {
  console.log(`\n  VERDICT: ✅ PASS`);
}
console.log();
process.exit(issues.length > 0 ? 1 : 0);
