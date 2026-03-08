/**
 * E2E Test: Simulate N users concurrently going through the full labeling flow.
 *
 * Usage:
 *   node scripts/e2e_20users.mjs [API_BASE] [ADMIN_TOKEN] [NUM_USERS]
 *   node scripts/e2e_20users.mjs https://sentence-labeling-api.xmeng19.workers.dev YOUR_ADMIN_TOKEN
 *   node scripts/e2e_20users.mjs http://127.0.0.1:8787 dev-admin-token 30
 *
 * Each user: start → manual 15 (with ranking after each essay) → LLM accept 15 → status/viz checks.
 * All N users run in parallel to surface concurrency/race bugs.
 */

const API = process.argv[2] || "http://localhost:8787";
const ADMIN_TOKEN = process.argv[3] || "dev-admin-token";
const NUM_USERS = parseInt(process.env.NUM_USERS || process.argv[4] || "20", 10);

const LABELS = ["EXPLANATION", "EVALUATION", "RESPONSIBILITY", "APPLICATION", "IMPLICATION"];

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    errors.push(msg);
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

function randomLabel() {
  return LABELS[Math.floor(Math.random() * LABELS.length)];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeAttempt(extra = 0) {
  const now = Date.now();
  const activeMs = 1200 + Math.floor(Math.random() * 3000) + extra;
  return {
    shown_at_epoch_ms: now - activeMs,
    answered_at_epoch_ms: now,
    active_ms: activeMs,
    hidden_ms: 0,
    idle_ms: 0,
    hidden_count: 0,
    blur_count: 0,
    had_background: 0,
    events: []
  };
}

async function req(path, init, retries = 15) {
  const isLabel = path.includes("labels/manual") || path.includes("llm/accept");
  const isRanking = path.includes("ranking/");
  const maxRetries = isLabel || isRanking ? retries : Math.min(retries, 5);
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const r = await fetch(`${API}${path}`, init);
    if (r.status === 429 && attempt < maxRetries) {
      const backoff = (attempt + 1) * 5000 + Math.random() * 4000;
      await sleep(backoff);
      continue;
    }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${r.status} ${path}: ${JSON.stringify(body)}`);
    return body;
  }
}

async function adminReq(path) {
  return req(path, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
}

async function simulateUser(userId) {
  const tag = `[U${userId}]`;
  const userLabels = { manual: {}, llm: {} };

  // 1. Start session
  const session = await req("/api/session/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: `test_user_${userId}` })
  });
  assert(!!session.session_id, `${tag} session created`);
  const sid = session.session_id;

  // 2. Get taxonomy
  const tax = await req("/api/taxonomy");
  assert(tax.labels?.length >= 5, `${tag} taxonomy has ${tax.labels?.length} labels`);

  // 3. Check initial status
  const s0 = await req(`/api/session/status?session_id=${sid}`);
  assert(s0.normal_manual?.total === 15, `${tag} manual total=15`);
  assert(s0.normal_manual?.done === 0, `${tag} manual done=0 initially`);

  // 4. Manual labeling — 15 sentences, with ranking after each essay
  let manualDone = 0;
  const essaySentences = {};
  for (let i = 0; i < 15; i++) {
    const next = await req(`/api/units/next?session_id=${sid}&phase=normal&task=manual`);
    if (!next.unit) break;
    const label = randomLabel();
    userLabels.manual[next.unit.unit_id] = label;

    const essayMatch = next.unit.unit_id.match(/essay0*(\d+)/);
    if (essayMatch) {
      const eidx = parseInt(essayMatch[1], 10);
      if (!essaySentences[eidx]) essaySentences[eidx] = [];
      essaySentences[eidx].push(next.unit.unit_id);
    }

    await req("/api/labels/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sid,
        unit_id: next.unit.unit_id,
        phase: "normal",
        label,
        attempt: makeAttempt(i * 200)
      })
    });
    manualDone++;

    if ((i + 1) % 5 === 0) {
      const essayIdx = (i + 1) / 5;
      const sentenceIds = essaySentences[essayIdx] || [];
      const shuffled = [...sentenceIds].sort(() => Math.random() - 0.5);
      await req("/api/ranking/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, essay_index: essayIdx, ordering: shuffled })
      });
      await sleep(50);
    }
  }
  assert(manualDone === 15, `${tag} manual labeled ${manualDone}/15`);

  // 4b. Verify ranking submissions
  const rankStatus = await req(`/api/ranking/status?session_id=${sid}`);
  assert(rankStatus.ranked_essays?.length === 3, `${tag} ranked 3 essays (got ${rankStatus.ranked_essays?.length})`);

  // 4c. Verify labeled-essays endpoint
  const labeledEssays = await req(`/api/session/labeled-essays?session_id=${sid}&phase=normal`);
  assert(labeledEssays.fully_labeled_essays?.length === 3, `${tag} fully labeled 3 essays (got ${labeledEssays.fully_labeled_essays?.length})`);

  // 5. Verify manual complete → can enter LLM
  const s1 = await req(`/api/session/status?session_id=${sid}`);
  assert(s1.gates?.can_enter_normal_llm === true, `${tag} gate: can_enter_llm`);
  assert(s1.normal_manual?.done === 15, `${tag} manual done=15 after`);

  // 6. LLM flow — run + accept for 15 sentences
  let llmDone = 0;
  for (let i = 0; i < 15; i++) {
    const next = await req(`/api/units/next?session_id=${sid}&phase=normal&task=llm`);
    if (!next.unit) break;
    const label = randomLabel();
    userLabels.llm[next.unit.unit_id] = label;

    let predicted = null;
    try {
      const lr = await req("/api/llm/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, unit_id: next.unit.unit_id, phase: "normal", mode: "prompt1" })
      });
      predicted = lr.predicted_label;
    } catch {
      /* expected without real key */
    }

    await req("/api/llm/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sid,
        unit_id: next.unit.unit_id,
        phase: "normal",
        mode: "prompt1",
        accepted_label: predicted || label,
        attempt: makeAttempt(i * 150)
      })
    });
    llmDone++;
    if (i % 5 === 4) await sleep(50);
  }
  assert(llmDone === 15, `${tag} LLM labeled ${llmDone}/15`);

  // 7. Verify LLM complete
  const s2 = await req(`/api/session/status?session_id=${sid}`);
  assert(s2.normal_llm?.done === 15, `${tag} llm done=15 after`);

  // 8. No more manual units
  const noMore = await req(`/api/units/next?session_id=${sid}&phase=normal&task=manual`);
  assert(!noMore.unit, `${tag} no more manual units`);

  console.log(`  ✓ ${tag} complete: manual=${manualDone} llm=${llmDone}`);
  return { userId, sid, manualDone, llmDone, userLabels };
}

async function runTests() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  E2E TEST — ${NUM_USERS} users CONCURRENT (full flow)`);
  console.log(`  API: ${API}`);
  console.log(`${"═".repeat(60)}\n`);

  // Pre-flight
  console.log("▸ Pre-flight checks");
  const health = await req("/api/health");
  assert(health.status === "ok", "API health OK");
  const tax = await req("/api/taxonomy");
  assert(tax.labels?.length >= 5, `Taxonomy: ${tax.labels?.length} labels`);

  // Run all 20 users in parallel
  console.log(`\n▸ Running ${NUM_USERS} users concurrently...`);
  const startMs = Date.now();
  const batch = await Promise.allSettled(
    Array.from({ length: NUM_USERS }, (_, i) => simulateUser(i + 1))
  );
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`  Finished in ${elapsed}s\n`);

  const allResults = [];
  for (let i = 0; i < batch.length; i++) {
    if (batch[i].status === "fulfilled") {
      allResults.push(batch[i].value);
    } else {
      failed++;
      const msg = `User ${i + 1} crashed: ${batch[i].reason?.message}`;
      errors.push(msg);
      console.error(`  ✗ ${msg}`);
    }
  }
  assert(allResults.length === NUM_USERS, `All ${NUM_USERS} users completed (got ${allResults.length})`);

  // ─── Admin data verification ───
  console.log("\n▸ Admin data verification");
  const sessions = await adminReq("/api/admin/sessions");
  assert(sessions.sessions?.length >= NUM_USERS, `Sessions: ${sessions.sessions?.length} (≥${NUM_USERS})`);

  const overall = await adminReq("/api/admin/stats/overall");
  const mTotal = Object.values(overall.breakdown?.normal_manual || {}).reduce((a, b) => a + b, 0);
  const lTotal = Object.values(overall.breakdown?.normal_llm || {}).reduce((a, b) => a + b, 0);
  const expectM = allResults.reduce((s, u) => s + u.manualDone, 0);
  const expectL = allResults.reduce((s, u) => s + u.llmDone, 0);
  assert(mTotal >= expectM, `Manual labels: ${mTotal} (expected ≥${expectM})`);
  assert(lTotal >= expectL, `LLM labels: ${lTotal} (expected ≥${expectL})`);

  // ─── Visualization endpoint ───
  console.log("\n▸ Visualization endpoint");
  const viz = await req("/api/stats/visualization");
  assert(!!viz.label_distribution, "Viz: label_distribution present");
  const vizM = Object.values(viz.label_distribution?.normal_manual || {}).reduce((a, b) => a + b, 0);
  const vizL = Object.values(viz.label_distribution?.normal_llm || {}).reduce((a, b) => a + b, 0);
  assert(vizM >= expectM, `Viz manual: ${vizM} (expected ≥${expectM})`);
  assert(vizL >= expectL, `Viz LLM: ${vizL} (expected ≥${expectL})`);

  // ─── Per-session integrity (spot-check 5) ───
  console.log("\n▸ Per-session integrity (spot-check 5 users)");
  for (const u of allResults.slice(0, 5)) {
    const st = await req(`/api/session/status?session_id=${u.sid}`);
    assert(st.normal_manual?.done === 15, `U${u.userId} manual done=${st.normal_manual?.done}`);
    assert(st.normal_llm?.done === 15, `U${u.userId} llm done=${st.normal_llm?.done}`);
  }

  // ─── Summary ───
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  if (errors.length > 0) {
    console.log(`\n  FAILURES:`);
    for (const e of errors) console.log(`    ✗ ${e}`);
  } else {
    console.log(`\n  ✓ ALL TESTS PASSED`);
  }
  console.log(`${"═".repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error("Fatal:", e);
  process.exit(2);
});
