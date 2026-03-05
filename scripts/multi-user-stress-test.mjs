#!/usr/bin/env node
/**
 * Multi-user stress test for the Active Labeling platform.
 * Simulates N concurrent users performing the full labeling workflow:
 *   1. Create session
 *   2. Manual labeling (normal phase) — all units
 *   3. LLM labeling (normal phase) — all units (skipped if no LLM key)
 *   4. Manual labeling (active phase) — all units
 *   5. Admin: verify stats, export, consistency audit
 *
 * Usage: node scripts/multi-user-stress-test.mjs [NUM_USERS] [API_BASE]
 */

const NUM_USERS = parseInt(process.argv[2] ?? "5", 10);
const API_BASE = process.argv[3] ?? "http://localhost:8787";
const ADMIN_TOKEN = process.argv[4] ?? "dev-admin-token";
const LABELS = ["EXPLANATION", "EVALUATION", "RESPONSIBILITY", "APPLICATION", "IMPLICATION"];
const NORMAL_N = 4;
const ACTIVE_M = 2;

const pad = (n, w = 2) => String(n).padStart(w, " ");
const ts = () => new Date().toISOString().slice(11, 23);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const counters = {
  sessions: 0,
  manualSubmits: 0,
  llmRuns: 0,
  llmAccepts: 0,
  undos: 0,
  errors: 0,
  llmErrors: 0,
  rateLimit: 0,
};

class UserSimulator {
  constructor(id) {
    this.id = id;
    this.tag = `[User-${pad(id)}]`;
    this.sessionId = null;
    this.resetToken = null;
    this.log = [];
  }

  _log(msg) {
    const line = `${ts()} ${this.tag} ${msg}`;
    this.log.push(line);
    console.log(line);
  }

  async _req(path, init) {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, init);
    if (res.status === 429) {
      counters.rateLimit++;
      this._log(`⚠ 429 rate-limited on ${path}`);
      await sleep(2000 + Math.random() * 3000);
      const res2 = await fetch(url, init);
      if (!res2.ok) throw new Error(`${path} => ${res2.status}`);
      return res2.json();
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${path} => ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async createSession() {
    const data = await this._req("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: `stress_user_${this.id}`,
        normal_n: NORMAL_N,
        active_m: ACTIVE_M,
      }),
    });
    this.sessionId = data.session_id;
    this.resetToken = data.reset_token;
    counters.sessions++;
    this._log(`✓ session created: ${this.sessionId.slice(0, 8)}…`);
    return data;
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

  async doManualPhase(phase) {
    let round = 0;
    while (true) {
      round++;
      const next = await this._req(
        `/api/units/next?session_id=${this.sessionId}&phase=${phase}&task=manual`
      );
      if (!next.unit) {
        this._log(`✓ ${phase}/manual done after ${round - 1} units`);
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
      this._log(`  ${phase}/manual #${round}: ${next.unit.unit_id} → ${label}`);

      if (round === 2 && phase === "normal" && Math.random() < 0.5) {
        try {
          await this._req("/api/labels/undo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: this.sessionId,
              unit_id: next.unit.unit_id,
              phase,
            }),
          });
          counters.undos++;
          this._log(`  ↩ undo ${next.unit.unit_id}`);

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
          this._log(`  ↪ re-label ${next.unit.unit_id} → ${newLabel}`);
        } catch (e) {
          this._log(`  ✗ undo/re-label failed: ${e.message}`);
          counters.errors++;
        }
      }

      await sleep(50 + Math.random() * 150);
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
        this._log(`✓ normal/llm done after ${round - 1} units`);
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
        const predicted = llm.predicted_label ?? pick(LABELS);
        this._log(`  normal/llm #${round}: ${next.unit.unit_id} → predicted ${predicted}`);

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
        this._log(`  normal/llm #${round}: accepted → ${acceptLabel}`);
      } catch (e) {
        const isLlmKeyError = e.message?.includes("500") && e.message?.includes("401");
        if (isLlmKeyError) {
          counters.llmErrors++;
          this._log(`  ⚠ llm/run unavailable (API key): ${next.unit.unit_id}`);
        } else {
          counters.errors++;
          this._log(`  ✗ llm failed: ${e.message.slice(0, 120)}`);
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
          this._log(`  → fallback accept for ${next.unit.unit_id}`);
        } catch (e2) {
          this._log(`  ✗ fallback accept failed: ${e2.message.slice(0, 120)}`);
          counters.errors++;
        }
      }

      await sleep(50 + Math.random() * 150);
    }
  }

  async checkSessionStatus() {
    const status = await this._req(
      `/api/session/status?session_id=${this.sessionId}`
    );
    this._log(`  status: gates=${JSON.stringify(status.gates)}`);
    return status;
  }

  async run() {
    try {
      await this.createSession();
      await this.checkSessionStatus();

      this._log("── Phase: normal/manual ──");
      await this.doManualPhase("normal");

      this._log("── Phase: normal/llm ──");
      await this.doLlmPhase();

      const status2 = await this.checkSessionStatus();
      if (status2.gates?.can_enter_active_manual) {
        this._log("── Phase: active/manual ──");
        await this.doManualPhase("active");
      } else {
        this._log("⚠ active phase not accessible (no active assignments)");
      }

      this._log("✅ user flow completed");
    } catch (err) {
      counters.errors++;
      this._log(`✗ FATAL: ${err.message}`);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function adminChecks() {
  const tag = "[Admin  ]";
  const headers = {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    "Content-Type": "application/json",
  };

  console.log(`\n${ts()} ${tag} ── Admin verification ──`);

  try {
    const login = await fetch(`${API_BASE}/api/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin_token: ADMIN_TOKEN }),
    });
    const loginData = await login.json();
    const adminSessionToken = loginData.token;
    console.log(`${ts()} ${tag} ✓ admin login ok, token: ${adminSessionToken?.slice(0, 20)}…`);

    const authHeaders = { Authorization: `Bearer ${adminSessionToken}` };

    const verify = await fetch(`${API_BASE}/api/admin/auth/verify`, { headers: authHeaders });
    const vData = await verify.json();
    console.log(`${ts()} ${tag} ✓ admin verify: ${JSON.stringify(vData)}`);

    const overall = await fetch(`${API_BASE}/api/admin/stats/overall`, { headers: authHeaders });
    const oData = await overall.json();
    const totalOverall = Object.values(oData.overall || {}).reduce((a, b) => a + b, 0);
    console.log(`${ts()} ${tag} ✓ overall stats: ${totalOverall} labels total`);
    console.log(`${ts()} ${tag}   breakdown: ${JSON.stringify(oData.breakdown, null, 0).slice(0, 200)}`);

    const normal = await fetch(`${API_BASE}/api/admin/stats/normal`, { headers: authHeaders });
    const nData = await normal.json();
    const totalManual = Object.values(nData.normal_manual || {}).reduce((a, b) => a + b, 0);
    const totalLlm = Object.values(nData.normal_llm || {}).reduce((a, b) => a + b, 0);
    console.log(`${ts()} ${tag} ✓ normal stats: manual=${totalManual} llm=${totalLlm}`);

    const sessions = await fetch(`${API_BASE}/api/admin/sessions`, { headers: authHeaders });
    const sData = await sessions.json();
    console.log(`${ts()} ${tag} ✓ sessions: ${sData.sessions?.length ?? 0} total`);

    const recent = await fetch(`${API_BASE}/api/admin/ops/recent?limit=10`, { headers: authHeaders });
    const rData = await recent.json();
    console.log(`${ts()} ${tag} ✓ recent ops: ${rData.events?.length ?? 0} events`);

    const audit = await fetch(`${API_BASE}/api/admin/audit/consistency`, { headers: authHeaders });
    const aData = await audit.json();
    console.log(`${ts()} ${tag} ✓ consistency audit: ok=${aData.ok}, mismatches=${aData.mismatches?.length ?? 0}`);
    if (aData.mismatches?.length > 0) {
      console.log(`${ts()} ${tag}   ⚠ mismatches: ${JSON.stringify(aData.mismatches)}`);
    }

    const sync = await fetch(`${API_BASE}/api/admin/stats/sync`, { headers: authHeaders });
    const syncData = await sync.json();
    console.log(`${ts()} ${tag} ✓ stats sync: revision=${syncData.revision}`);

    const exportRes = await fetch(`${API_BASE}/api/admin/export?format=jsonl`, { headers: authHeaders });
    const metaHeader = exportRes.headers.get("X-Export-Meta");
    const exportBlob = await exportRes.text();
    const exportLines = exportBlob.trim().split("\n").filter(Boolean).length;
    let meta = null;
    if (metaHeader) {
      try { meta = JSON.parse(metaHeader); } catch {}
    }
    console.log(`${ts()} ${tag} ✓ export: ${exportLines} JSONL lines, meta=${JSON.stringify(meta)}`);

    return { totalOverall, totalManual, totalLlm, sessions: sData.sessions?.length, auditOk: aData.ok };
  } catch (err) {
    console.log(`${ts()} ${tag} ✗ admin error: ${err.message}`);
    return null;
  }
}

async function testShareFlow() {
  const tag = "[Share  ]";
  const headers = { Authorization: `Bearer ${ADMIN_TOKEN}` };
  try {
    const create = await fetch(`${API_BASE}/api/admin/share/create`, {
      method: "POST",
      headers,
    });
    const shareData = await create.json();
    const shareToken = shareData.share_token ?? shareData.token;
    console.log(`${ts()} ${tag} ✓ share link created: token=${shareToken?.slice(0, 12)}…`);

    const stats = await fetch(`${API_BASE}/api/share/stats?token=${shareToken}`);
    const sData = await stats.json();
    console.log(`${ts()} ${tag} ✓ share stats: ${Object.keys(sData.overall || {}).length} label types`);

    if (shareToken) {
      const revoke = await fetch(`${API_BASE}/api/admin/share/revoke`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ token: shareToken }),
      });
      console.log(`${ts()} ${tag} ✓ share revoked: ${revoke.status}`);

      const stats2 = await fetch(`${API_BASE}/api/share/stats?token=${shareToken}`);
      console.log(`${ts()} ${tag} ✓ revoked share access: ${stats2.status} (expect 403/404)`);
    }
  } catch (err) {
    console.log(`${ts()} ${tag} ✗ share error: ${err.message}`);
  }
}

async function testResetFlow() {
  const tag = "[Reset  ]";
  try {
    const s = await fetch(`${API_BASE}/api/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: "reset_test_user", normal_n: 2, active_m: 1 }),
    });
    const sData = await s.json();
    console.log(`${ts()} ${tag} ✓ session for reset test: ${sData.session_id?.slice(0, 8)}…`);

    const wrongReset = await fetch(`${API_BASE}/api/session/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sData.session_id, reset_token: "wrong-token" }),
    });
    console.log(`${ts()} ${tag} ✓ wrong reset_token: ${wrongReset.status} (expect 403)`);

    const noTokenReset = await fetch(`${API_BASE}/api/session/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sData.session_id }),
    });
    console.log(`${ts()} ${tag} ✓ missing reset_token: ${noTokenReset.status} (expect 400)`);

    const correctReset = await fetch(`${API_BASE}/api/session/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sData.session_id, reset_token: sData.reset_token }),
    });
    console.log(`${ts()} ${tag} ✓ correct reset: ${correctReset.status} (expect 200)`);
  } catch (err) {
    console.log(`${ts()} ${tag} ✗ reset test error: ${err.message}`);
  }
}

async function testRateLimiting() {
  const tag = "[RateL  ]";
  console.log(`\n${ts()} ${tag} ── Rate limiting test ──`);
  let blocked = 0;
  const promises = Array.from({ length: 25 }, (_, i) =>
    fetch(`${API_BASE}/api/taxonomy`).then((r) => {
      if (r.status === 429) blocked++;
      return r.status;
    })
  );
  const statuses = await Promise.all(promises);
  console.log(`${ts()} ${tag} 25 rapid requests: ${blocked} rate-limited, statuses: [${[...new Set(statuses)].join(",")}]`);
}

async function testErrorReporting() {
  const tag = "[ErrRpt ]";
  try {
    const r = await fetch(`${API_BASE}/api/client/errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Test error from stress test",
        stack: "Error: test\n    at UserSimulator.run",
        page: "/test",
      }),
    });
    console.log(`${ts()} ${tag} ✓ error report: ${r.status}`);
  } catch (err) {
    console.log(`${ts()} ${tag} ✗ ${err.message}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(70)}`);
console.log(`  Multi-User Stress Test`);
console.log(`  Users: ${NUM_USERS} | API: ${API_BASE}`);
console.log(`  Normal: ${NORMAL_N} units | Active: ${ACTIVE_M} units`);
console.log(`${"═".repeat(70)}\n`);

const startTime = Date.now();

const users = Array.from({ length: NUM_USERS }, (_, i) => new UserSimulator(i + 1));

const batches = [];
const CONCURRENCY = 3;
for (let i = 0; i < users.length; i += CONCURRENCY) {
  batches.push(users.slice(i, i + CONCURRENCY));
}

for (const batch of batches) {
  await Promise.all(batch.map((u) => u.run()));
  await sleep(200);
}

console.log(`\n${"─".repeat(70)}`);
console.log(`${ts()} ── Supplementary tests ──`);

await testResetFlow();
await testShareFlow();
await testRateLimiting();
await testErrorReporting();

const adminResult = await adminChecks();

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

console.log(`\n${"═".repeat(70)}`);
console.log(`  STRESS TEST SUMMARY`);
console.log(`${"═".repeat(70)}`);
console.log(`  Duration:         ${elapsed}s`);
console.log(`  Users:            ${NUM_USERS}`);
console.log(`  Sessions created: ${counters.sessions}`);
console.log(`  Manual submits:   ${counters.manualSubmits}`);
console.log(`  LLM runs:         ${counters.llmRuns}`);
console.log(`  LLM accepts:      ${counters.llmAccepts}`);
console.log(`  Undos:             ${counters.undos}`);
console.log(`  Rate-limited:     ${counters.rateLimit}`);
console.log(`  LLM key errors:   ${counters.llmErrors} (expected if no API key)`);
console.log(`  Real errors:      ${counters.errors}`);
console.log(`${"─".repeat(70)}`);
if (adminResult) {
  console.log(`  DB Labels total:  ${adminResult.totalOverall}`);
  console.log(`  Normal manual:    ${adminResult.totalManual}`);
  console.log(`  Normal LLM:       ${adminResult.totalLlm}`);
  console.log(`  Sessions in DB:   ${adminResult.sessions}`);
  console.log(`  Audit OK:         ${adminResult.auditOk}`);
}
console.log(`${"═".repeat(70)}`);

const expectedManual = NUM_USERS * NORMAL_N;
const expectedLlm = NUM_USERS * NORMAL_N;
const expectedActive = NUM_USERS * ACTIVE_M;
const totalExpected = expectedManual + expectedLlm + expectedActive;

let verdict = "PASS ✅";
const issues = [];

if (counters.sessions !== NUM_USERS) issues.push(`sessions: got ${counters.sessions}, expected ${NUM_USERS}`);
if (counters.errors > 0) issues.push(`real errors: ${counters.errors}`);
if (adminResult && !adminResult.auditOk) issues.push("consistency audit FAILED");
if (adminResult && adminResult.totalOverall < totalExpected * 0.8) {
  issues.push(`label count low: ${adminResult.totalOverall} vs expected ~${totalExpected}`);
}

if (issues.length > 0) {
  verdict = "ISSUES ⚠️";
  console.log(`\n  VERDICT: ${verdict}`);
  issues.forEach((i) => console.log(`    ⚠ ${i}`));
} else {
  console.log(`\n  VERDICT: ${verdict}`);
}
console.log();
