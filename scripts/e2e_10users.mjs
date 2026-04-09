/**
 * E2E Test: Simulate 10 users going through the full labeling flow.
 *
 * Runs users in 2 batches of 5 to stay within rate limits (120 labels/min/IP).
 * Each user: start → manual label 15 → LLM accept 15 → verify status → check viz.
 */

const API = process.argv[2] || "http://localhost:8787";
const ADMIN_TOKEN = process.argv[3] || "dev-admin-token";
const NUM_USERS = 10;
const BATCH_SIZE = 3;

const LABELS = ["EXPLANATION", "EVALUATION", "RESPONSIBILITY", "APPLICATION", "IMPLICATION"];

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; errors.push(msg); console.error(`  ✗ FAIL: ${msg}`); }
}

function randomLabel() { return LABELS[Math.floor(Math.random() * LABELS.length)]; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeAttempt(extra = 0) {
  const now = Date.now();
  const activeMs = 1200 + Math.floor(Math.random() * 3000) + extra;
  return {
    shown_at_epoch_ms: now - activeMs,
    answered_at_epoch_ms: now,
    active_ms: activeMs,
    hidden_ms: 0, idle_ms: 0,
    hidden_count: 0, blur_count: 0,
    had_background: 0, events: []
  };
}

async function req(path, init, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = await fetch(`${API}${path}`, init);
    if (r.status === 429 && attempt < retries) {
      await sleep(2000 + Math.random() * 2000);
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
        session_id: sid, unit_id: next.unit.unit_id, phase: "normal",
        label, attempt: makeAttempt(i * 200)
      })
    });
    manualDone++;

    if ((i + 1) % 5 === 0) {
      const essayIdx = Math.ceil((i + 1) / 5);
      const sentenceIds = essaySentences[essayIdx] || [];
      const shuffled = [...sentenceIds].sort(() => Math.random() - 0.5);
      await req("/api/ranking/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, essay_index: essayIdx, ordering: shuffled })
      });
      await sleep(100);
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

    // Try LLM run (will fail without real Qwen key, that's OK)
    let predicted = null;
    try {
      const lr = await req("/api/llm/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, unit_id: next.unit.unit_id, phase: "normal", mode: "prompt1" })
      });
      predicted = lr.predicted_label;
    } catch { /* expected without real key */ }

    // Accept
    await req("/api/llm/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sid, unit_id: next.unit.unit_id, phase: "normal",
        mode: "prompt1", accepted_label: predicted || label,
        attempt: makeAttempt(i * 150)
      })
    });
    llmDone++;
    if (i % 5 === 4) await sleep(100);
  }
  assert(llmDone === 15, `${tag} LLM labeled ${llmDone}/15`);

  // 7. Verify LLM complete
  const s2 = await req(`/api/session/status?session_id=${sid}`);
  assert(s2.normal_llm?.done === 15, `${tag} llm done=15 after`);

  // 8. Check that next manual unit is null (all done)
  const noMore = await req(`/api/units/next?session_id=${sid}&phase=normal&task=manual`);
  assert(!noMore.unit, `${tag} no more manual units`);

  console.log(`  ✓ ${tag} complete: manual=${manualDone} llm=${llmDone}`);
  return { userId, sid, manualDone, llmDone, userLabels };
}

async function runTests() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  E2E TEST — ${NUM_USERS} users, ${BATCH_SIZE} concurrent`);
  console.log(`  API: ${API}`);
  console.log(`${"═".repeat(60)}\n`);

  // Pre-flight
  console.log("▸ Pre-flight checks");
  const health = await req("/api/health");
  assert(health.status === "ok", "API health OK");
  const tax = await req("/api/taxonomy");
  assert(tax.labels?.length >= 5, `Taxonomy: ${tax.labels?.length} labels`);

  // Run users in batches
  const allResults = [];
  for (let b = 0; b < Math.ceil(NUM_USERS / BATCH_SIZE); b++) {
    const start = b * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, NUM_USERS);
    console.log(`\n▸ Batch ${b + 1}: Users ${start + 1}–${end}`);

    const batch = await Promise.allSettled(
      Array.from({ length: end - start }, (_, i) => simulateUser(start + i + 1))
    );

    for (let i = 0; i < batch.length; i++) {
      if (batch[i].status === "fulfilled") {
        allResults.push(batch[i].value);
      } else {
        failed++;
        const msg = `User ${start + i + 1} crashed: ${batch[i].reason?.message}`;
        errors.push(msg);
        console.error(`  ✗ ${msg}`);
      }
    }

    if (b < Math.ceil(NUM_USERS / BATCH_SIZE) - 1) {
      console.log("  (waiting 62s for rate limit window reset...)");
      await sleep(62000);
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

  assert(mTotal === expectM, `Manual labels: ${mTotal} (expected ${expectM})`);
  assert(lTotal === expectL, `LLM labels: ${lTotal} (expected ${expectL})`);

  // Label distribution should have entries
  const mLabels = Object.keys(overall.breakdown?.normal_manual || {});
  assert(mLabels.length > 0, `Manual label types: ${mLabels.join(", ")}`);
  const lLabels = Object.keys(overall.breakdown?.normal_llm || {});
  assert(lLabels.length > 0, `LLM label types: ${lLabels.join(", ")}`);

  // Behavior analytics
  const beh = await adminReq("/api/admin/behavior");
  assert(beh.overall?.total_attempts > 0, `Behavior attempts: ${beh.overall?.total_attempts}`);
  assert(beh.overall?.avg_active_ms > 800, `Avg active_ms: ${beh.overall?.avg_active_ms}ms (>800)`);
  assert(beh.by_task?.manual, "Behavior: has manual task data");
  assert(beh.by_task?.llm, "Behavior: has llm task data");
  assert(beh.by_session?.length > 0, `Behavior: ${beh.by_session?.length} session entries`);

  // ─── Visualization endpoint ───
  console.log("\n▸ Visualization endpoint");
  const viz = await req("/api/stats/visualization");

  assert(!!viz.label_distribution, "Viz: label_distribution present");
  assert(!!viz.time_comparison, "Viz: time_comparison present");
  assert(!!viz.meta, "Viz: meta present");

  const vizM = Object.values(viz.label_distribution?.normal_manual || {}).reduce((a, b) => a + b, 0);
  const vizL = Object.values(viz.label_distribution?.normal_llm || {}).reduce((a, b) => a + b, 0);
  assert(vizM === expectM, `Viz manual dist: ${vizM} (expected ${expectM})`);
  assert(vizL === expectL, `Viz LLM dist: ${vizL} (expected ${expectL})`);

  const tc = viz.time_comparison;
  assert(tc.sentence_avg?.manual_ms > 0, `Viz sentence_avg manual: ${tc.sentence_avg?.manual_ms}ms`);
  assert(tc.sentence_avg?.llm_ms >= 0, `Viz sentence_avg llm: ${tc.sentence_avg?.llm_ms}ms`);
  assert(tc.essay_avg?.manual_ms > 0, `Viz essay_avg manual: ${tc.essay_avg?.manual_ms}ms`);
  assert(tc.total_avg?.manual_ms > 0, `Viz total_avg manual: ${tc.total_avg?.manual_ms}ms`);

  // Essay avg ≈ 5 × sentence avg
  const sMs = tc.sentence_avg.manual_ms;
  const eMs = tc.essay_avg.manual_ms;
  assert(eMs === sMs * 5, `Viz: essay(${eMs}) = sentence(${sMs}) × 5 = ${sMs * 5}`);

  assert(viz.meta?.sessions > 0, `Viz sessions: ${viz.meta?.sessions}`);
  assert(viz.meta?.sentences_per_essay === 5, `Viz sentences_per_essay: ${viz.meta?.sentences_per_essay}`);
  assert(viz.meta?.total_essays === 3, `Viz total_essays: ${viz.meta?.total_essays}`);

  // ─── Per-session integrity ───
  console.log("\n▸ Per-session data integrity (spot-check 3 users)");
  for (const u of allResults.slice(0, 3)) {
    const st = await req(`/api/session/status?session_id=${u.sid}`);
    assert(st.normal_manual?.done === 15, `U${u.userId} manual done=${st.normal_manual?.done}`);
    assert(st.normal_llm?.done === 15, `U${u.userId} llm done=${st.normal_llm?.done}`);

    // Verify essay assignments — each essay should have 5 labeled sentences
    const manualUnits = Object.keys(u.userLabels.manual);
    const byEssay = {};
    for (const uid of manualUnits) {
      const m = uid.match(/essay0*(\d+)/);
      if (m) { byEssay[m[1]] = (byEssay[m[1]] || 0) + 1; }
    }
    assert(Object.keys(byEssay).length === 3, `U${u.userId} labeled 3 essays: ${JSON.stringify(byEssay)}`);
    for (const [eid, cnt] of Object.entries(byEssay)) {
      assert(cnt === 5, `U${u.userId} essay ${eid}: ${cnt} sentences`);
    }
  }

  // ─── Cross-check: admin export format ───
  console.log("\n▸ Export data check");
  try {
    const r = await fetch(`${API}/api/admin/export?format=csv`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    assert(r.ok, `Export CSV: status ${r.status}`);
    const csv = await r.text();
    const lines = csv.trim().split("\n");
    assert(lines.length > 1, `Export CSV: ${lines.length} lines (header + data)`);
    const header = lines[0];
    assert(header.includes("unit_id"), "Export CSV has unit_id column");
    assert(header.includes("manual_label") || header.includes("label"), "Export CSV has label column");
    assert(header.includes("ranking_ordering"), "Export CSV has ranking_ordering column");
  } catch (e) {
    failed++;
    errors.push(`Export check: ${e.message}`);
  }

  // ─── Ranking export ───
  console.log("\n▸ Ranking export check");
  try {
    const r = await fetch(`${API}/api/admin/export/rankings?format=csv`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    assert(r.ok, `Ranking export CSV: status ${r.status}`);
    const csv = await r.text();
    const lines = csv.trim().split("\n");
    assert(lines.length > 1, `Ranking export CSV: ${lines.length} lines`);
    const dataRows = lines.length - 1;
    assert(dataRows >= NUM_USERS * 3, `Ranking rows: ${dataRows} (expected ≥${NUM_USERS * 3})`);
  } catch (e) {
    failed++;
    errors.push(`Ranking export check: ${e.message}`);
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

runTests().catch((e) => { console.error("Fatal:", e); process.exit(2); });
