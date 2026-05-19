/**
 * 50-user concurrent stress test against the live production API.
 * Simulates the full seminar annotation flow:
 *   1. startSession  (with idempotency_key, includes a double-start replay)
 *   2. label all normal/manual units
 *   3. submit ranking for first fully-labeled essay
 *   4. submit survey
 *   5. logout+relogin (session resume via getSessionStatus)
 *   6. rapid-navigate: re-check units/next twice quickly (StrictMode-style race)
 *
 * Each "user" is fully independent and runs in parallel via Promise.all.
 *
 * Usage:
 *   node tests/stress_50users.mjs
 *   BASE_URL=https://mnotation.pages.dev node tests/stress_50users.mjs
 *   USERS=10 node tests/stress_50users.mjs   # smaller run for debugging
 */

const BASE = process.env.BASE_URL ?? "https://mnotation.pages.dev";
const USERS = Number(process.env.USERS ?? "50");
const LABELS = ["CODE", "EXPLANATION", "EVALUATION", "RESPONSIBILITY", "APPLICATION", "IMPLICATION"];
const MAX_LABEL_ROUNDS = 40; // safety cap per user

// ─── tiny HTTP helpers ──────────────────────────────────────────────────────

async function post(path, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function uuid() {
  // Use crypto.randomUUID if available (Node ≥ 19), else fall back
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function pick(arr, idx) {
  return arr[idx % arr.length];
}

// ─── single-user simulation ─────────────────────────────────────────────────

async function runUser(idx) {
  const t0 = Date.now();
  const log = [];   // step-by-step log for post-mortem
  const errors = [];
  const timing = {};

  const note = (msg) => log.push(`[${Date.now() - t0}ms] ${msg}`);

  try {
    // ── 1. Start session (first attempt) ────────────────────────────────────
    const idemKey = `stress-${idx}-${uuid()}`;
    const r1 = await post("/api/session/start", {
      user_id: `stress_test_${idx}`,
      has_consent: true,
      idempotency_key: idemKey,
    });
    if (!r1.data.session_id) {
      errors.push(`startSession failed: ${JSON.stringify(r1.data)}`);
      return { idx, success: false, errors, log, timing, totalMs: Date.now() - t0 };
    }
    const sid = r1.data.session_id;
    note(`startSession OK  sid=${sid.slice(0, 8)}`);
    timing.startSession = Date.now() - t0;

    // ── 2. Idempotency replay — SAME key must return SAME session_id ─────────
    const r1b = await post("/api/session/start", {
      user_id: `stress_test_${idx}`,
      has_consent: true,
      idempotency_key: idemKey,
    });
    if (r1b.data.session_id !== sid) {
      errors.push(`IDEMPOTENCY VIOLATION: first=${sid} replay=${r1b.data.session_id}`);
    } else {
      note("idempotency replay ✓");
    }

    // ── 3. "Double-click" race — two simultaneous startSession with SAME key ──
    // The server uses claimIdempotency: one request "wins" the claim and creates
    // the session; the other hits a 409 "request_in_progress" immediately (because
    // the key is CLAIMED but not yet resolved). After the first request finishes,
    // any retry with the same key gets the cached response.
    // Acceptable outcomes:
    //   a) Both return the same session_id (first resolved before second hit)
    //   b) One returns session_id, the other returns 409 "request_in_progress"
    //      (normal in-flight contention — client retries would get the cached session)
    // Unacceptable:
    //   c) Two DIFFERENT session_ids (server created duplicates despite same key)
    const doubleKey = `stress-dbl-${idx}-${uuid()}`;
    const [dc1, dc2] = await Promise.all([
      post("/api/session/start", { user_id: `stress_test_${idx}_dbl`, has_consent: true, idempotency_key: doubleKey }),
      post("/api/session/start", { user_id: `stress_test_${idx}_dbl`, has_consent: true, idempotency_key: doubleKey }),
    ]);
    const dc1sid = dc1.data.session_id;
    const dc2sid = dc2.data.session_id;
    const dc1conflict = dc1.status === 409 || dc1.data.error === "request_in_progress";
    const dc2conflict = dc2.status === 409 || dc2.data.error === "request_in_progress";
    if (dc1sid && dc2sid && dc1sid !== dc2sid) {
      // Both succeeded but with DIFFERENT IDs — server created duplicates despite same key
      errors.push(`DOUBLE-START VIOLATION: dc1=${dc1sid} dc2=${dc2sid} (different sessions!)`);
    } else if (!dc1sid && !dc2sid) {
      // Both failed — something is wrong
      errors.push(`double-start both failed: dc1=${JSON.stringify(dc1.data)} dc2=${JSON.stringify(dc2.data)}`);
    } else {
      // Either same session_id from both, or one got 409 (in-flight contention) — both correct
      note(`double-start same-key ✓ (dc1_conflict=${dc1conflict} dc2_conflict=${dc2conflict})`);
    }
    timing.doubleStart = Date.now() - t0;

    // ── 4. Label all normal/manual units ────────────────────────────────────
    let labelCount = 0;
    let rounds = 0;
    while (rounds < MAX_LABEL_ROUNDS) {
      rounds++;
      const nr = await get(`/api/units/next?session_id=${sid}&phase=normal&task=manual`);
      if (!nr.data.unit) break;
      const unit = nr.data.unit;
      const label = pick(LABELS, idx + rounds);
      const idem = `stress-lbl-${sid}-${unit.unit_id}`;

      const lr = await post("/api/labels/manual", {
        session_id: sid,
        unit_id: unit.unit_id,
        label,
        phase: "normal",
        idempotency_key: idem,
      });

      if (lr.data?.ok || lr.data?.already_done) {
        labelCount++;
      } else if (lr.data?.error === "request_in_progress") {
        // The idempotency key is being processed by a concurrent inflight request.
        // This should now release after the original request finishes (BUG #2 catch fix).
        // Treat as a warning, not a hard error — the label will be written by the other request.
        note(`label ${unit.unit_id.slice(-8)} in-flight (409 — idempotency contention)`);
      } else {
        errors.push(`label ${unit.unit_id}: ${JSON.stringify(lr.data)}`);
      }

      // Simulate rapid back-nav: re-fetch units/next immediately (StrictMode-like)
      if (rounds % 3 === 0) {
        await get(`/api/units/next?session_id=${sid}&phase=normal&task=manual`);
      }

      // Simulate occasional undo (every 5 units)
      if (rounds % 5 === 0 && labelCount > 0) {
        const undoIdem = `stress-undo-${sid}-${unit.unit_id}-${rounds}`;
        const ur = await post("/api/labels/undo", {
          session_id: sid,
          unit_id: unit.unit_id,
          phase: "normal",
          idempotency_key: undoIdem,
        });
        if (ur.data?.ok) {
          labelCount--;
          note(`undo unit ${unit.unit_id.slice(-6)} ✓`);
          // Re-label it
          const relabel = await post("/api/labels/manual", {
            session_id: sid,
            unit_id: unit.unit_id,
            label: pick(LABELS, idx + rounds + 1),
            phase: "normal",
            idempotency_key: `${undoIdem}-relabel`,
          });
          if (relabel.data?.ok) labelCount++;
        }
      }
    }
    note(`labeled ${labelCount} units in ${rounds} rounds`);
    timing.labeling = Date.now() - t0;

    // ── 5. Simulate logout + relogin (session resume) ────────────────────────
    const statusR = await get(`/api/session/status?session_id=${sid}`);
    if (!statusR.data?.normal_manual) {
      errors.push(`getSessionStatus unexpected: ${JSON.stringify(statusR.data).slice(0, 100)}`);
    } else {
      note(`resume check: normal_manual.done=${statusR.data.normal_manual?.done ?? "?"}`);
    }
    timing.resumeCheck = Date.now() - t0;

    // ── 6. Submit ranking ────────────────────────────────────────────────────
    const ordering = ["sentence01", "sentence02", "sentence03", "sentence04", "sentence05"]
      .sort(() => Math.random() - 0.5); // random order
    const rr = await post("/api/ranking/submit", {
      session_id: sid,
      essay_index: 1,
      ordering,
    });
    if (!rr.data?.ok) {
      errors.push(`ranking: ${JSON.stringify(rr.data)}`);
    } else {
      note("ranking ✓");
    }
    timing.ranking = Date.now() - t0;

    // Re-submit ranking (simulates user changing mind — should upsert, not duplicate)
    const rr2 = await post("/api/ranking/submit", {
      session_id: sid,
      essay_index: 1,
      ordering: ordering.slice().reverse(),
    });
    if (!rr2.data?.ok) errors.push(`ranking re-submit: ${JSON.stringify(rr2.data)}`);
    else note("ranking re-submit (upsert) ✓");

    // ── 7. Submit survey (and re-submit — should upsert, not duplicate) ──────
    const sr = await post("/api/survey/submit", {
      session_id: sid,
      likert: { q1: (idx % 5) + 1, q2: 3, q3: 4 },
      mc_q11: ["A", "B", "C", "D"][idx % 4],
      open_q12: `stress_test_${idx} answer`,
    });
    if (!sr.data?.ok) {
      errors.push(`survey: ${JSON.stringify(sr.data)}`);
    } else {
      note("survey ✓");
    }

    // Re-submit survey (user editing answers)
    const sr2 = await post("/api/survey/submit", {
      session_id: sid,
      likert: { q1: 5, q2: 5, q3: 5 },
      mc_q11: "D",
      open_q12: `stress_test_${idx} revised answer`,
    });
    if (!sr2.data?.ok) errors.push(`survey re-submit: ${JSON.stringify(sr2.data)}`);
    else note("survey re-submit (upsert) ✓");
    timing.survey = Date.now() - t0;

    // ── 8. Page-view leave beacon test ───────────────────────────────────────
    const pvLeave = await post("/api/page-view/leave", {
      session_id: sid,
      page_path: "/user/normal/manual",
      left_at_epoch_ms: Date.now(),
    });
    if (!pvLeave.data?.ok) errors.push(`page-view/leave: ${JSON.stringify(pvLeave.data)}`);
    else note("page-view/leave ✓");

    return {
      idx,
      success: true,
      session_id: sid,
      labelCount,
      errors,
      log,
      timing,
      totalMs: Date.now() - t0,
    };
  } catch (err) {
    errors.push(String(err));
    return { idx, success: false, errors, log, timing, totalMs: Date.now() - t0 };
  }
}

// ─── runner ─────────────────────────────────────────────────────────────────

console.log(`\n🚀 Starting stress test: ${USERS} concurrent users → ${BASE}\n`);
const globalT0 = Date.now();

const results = await Promise.all(
  Array.from({ length: USERS }, (_, i) => runUser(i))
);

const totalWallMs = Date.now() - globalT0;

// ─── analysis ───────────────────────────────────────────────────────────────

const succeeded = results.filter((r) => r.success);
const failed = results.filter((r) => !r.success);
const sessionIds = results.map((r) => r.session_id).filter(Boolean);
const uniqueSessions = new Set(sessionIds);

const allErrors = results.flatMap((r) => r.errors.map((e) => `[user${r.idx}] ${e}`));

const timings = succeeded.map((r) => r.totalMs).sort((a, b) => a - b);
const avg = timings.length ? (timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(0) : "N/A";
const p50 = timings[Math.floor(timings.length * 0.5)] ?? "N/A";
const p90 = timings[Math.floor(timings.length * 0.9)] ?? "N/A";
const p99 = timings[Math.floor(timings.length * 0.99)] ?? "N/A";
const maxMs = timings[timings.length - 1] ?? "N/A";

const totalLabels = succeeded.reduce((a, r) => a + (r.labelCount ?? 0), 0);

console.log("═".repeat(60));
console.log("  STRESS TEST RESULTS");
console.log("═".repeat(60));
console.log(`  Users:             ${USERS}`);
console.log(`  Wall-clock time:   ${totalWallMs}ms (${(totalWallMs / 1000).toFixed(1)}s)`);
console.log(`  Succeeded:         ${succeeded.length}/${USERS}  ${succeeded.length === USERS ? "✓ ALL" : "⚠"}`);
console.log(`  Failed:            ${failed.length}/${USERS}`);
console.log(`  Unique sessions:   ${uniqueSessions.size}  (expect ${succeeded.length})${uniqueSessions.size < succeeded.length ? "  ⚠ DUPLICATES!" : "  ✓"}`);
console.log(`  Total labels:      ${totalLabels}`);
console.log(`  Latency (p50):     ${p50}ms`);
console.log(`  Latency (p90):     ${p90}ms`);
console.log(`  Latency (p99):     ${p99}ms`);
console.log(`  Latency (max):     ${maxMs}ms`);
console.log(`  Latency (avg):     ${avg}ms`);

if (allErrors.length > 0) {
  console.log(`\n  Errors (${allErrors.length} total):`);
  const shown = allErrors.slice(0, 30);
  for (const e of shown) console.log(`    ✗ ${e}`);
  if (allErrors.length > 30) console.log(`    ... and ${allErrors.length - 30} more`);
} else {
  console.log("\n  ✓ Zero errors across all users.");
}

if (failed.length > 0) {
  console.log("\n  Failed user logs:");
  for (const r of failed.slice(0, 5)) {
    console.log(`\n  [user${r.idx}] errors: ${r.errors.join(" | ")}`);
    console.log(`  [user${r.idx}] log: ${r.log.slice(-5).join(" → ")}`);
  }
}

console.log("═".repeat(60));

// ─── idempotency spot-check ─────────────────────────────────────────────────

console.log("\n  Idempotency spot-checks (from first 5 users):");
for (const r of succeeded.slice(0, 5)) {
  const hasViol = r.errors.some((e) => e.includes("IDEMPOTENCY VIOLATION"));
  console.log(`    user${r.idx}: ${hasViol ? "✗ VIOLATION" : "✓ ok"}`);
}

console.log("\n  Double-start same-key spot-checks (409 in-flight is acceptable):");
for (const r of succeeded.slice(0, 5)) {
  const hasViol = r.errors.some((e) => e.includes("DOUBLE-START VIOLATION") || e.includes("double-start both failed"));
  console.log(`    user${r.idx}: ${hasViol ? "✗ " + r.errors.find(e=>e.includes("double-start")) : "✓ ok"}`);
}

// Exit non-zero if any critical failures
if (failed.length > 0 || uniqueSessions.size < succeeded.length) {
  process.exit(1);
}
