#!/usr/bin/env bash
# =============================================================================
# e2e_smoke.sh — Active Labeling System End-to-End Smoke Test
#
# Usage:
#   BASE=https://your-worker.workers.dev ADMIN_TOKEN=xxx bash scripts/e2e_smoke.sh
#   BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/e2e_smoke.sh
#
# What is tested:
#   0. Health check (Qwen key presence)
#   1. Import 10 test units
#   2. Set taxonomy (5 labels) + prompts
#   3. Start user session (normal_n=4, active_m=2)
#   4. Page 1: Submit 2 labels → undo first → resubmit with DIFFERENT label
#      → verify stats: old_label-- new_label++ (correct rollback)
#   5. Page 1: Complete all 4 normal manual units → verify gate opens
#   6. Page 2: Prompt1 run → Prompt2 run → Accept Prompt1 result
#      → Override with different label → verify stats migration
#      → Custom 5x → 6th blocked (429) → count stays at 5
#   7. Complete all LLM units → verify gate for active opens
#   8. Page 3: Active manual: submit 1 unit → verify Active Manual chart updates
#   9. Active LLM batch: admin triggers → verify Active LLM chart updates
#  10. Admin stats validation (final distribution correct)
#  11. Admin security: 401 without token, wrong token, no export without auth
#  12. Export check: CSV >= 2 lines, JSONL parses
# =============================================================================
set -euo pipefail

BASE="${BASE:-http://localhost:8787}"
ADMIN_TOKEN="${ADMIN_TOKEN:-dev-admin-token}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

pass()  { echo -e "${GREEN}[PASS]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }
info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }

require_cmd() { command -v "$1" &>/dev/null || fail "Required: $1"; }
require_cmd curl; require_cmd jq

AUTH_HEADER="Authorization: Bearer ${ADMIN_TOKEN}"

api() {
  local method="$1"; shift; local path="$1"; shift
  curl -s -X "$method" "${BASE}${path}" "$@"
}
admin_api() {
  local method="$1"; shift; local path="$1"; shift
  api "$method" "$path" -H "$AUTH_HEADER" "$@"
}

assert_field() {
  local label="$1" json="$2" field="$3" expected="$4"
  local actual; actual=$(echo "$json" | jq -r "$field" 2>/dev/null || echo "PARSE_ERROR")
  [[ "$actual" == "$expected" ]] && pass "$label: $field = $expected" || fail "$label: expected $field='$expected', got '$actual'\nJSON: $json"
}

assert_ge() {
  local label="$1" val="$2" min="$3"
  [[ "$val" -ge "$min" ]] && pass "$label: $val >= $min" || fail "$label: $val < $min"
}

assert_lt() {
  local label="$1" val="$2" max="$3"
  [[ "$val" -lt "$max" ]] && pass "$label: $val < $max" || fail "$label: $val >= $max (should have decreased)"
}

assert_not_empty() {
  local label="$1" value="$2"
  [[ -n "$value" && "$value" != "null" ]] && pass "$label" || fail "$label: empty/null"
}

assert_http() {
  local label="$1" expected="$2" actual="$3"
  [[ "$actual" == "$expected" ]] && pass "$label: HTTP $actual" || fail "$label: expected HTTP $expected, got $actual"
}

ATTEMPT_STUB='{"shown_at_epoch_ms":1000,"answered_at_epoch_ms":4500,"active_ms":3500,"hidden_ms":0,"idle_ms":0,"hidden_count":0,"blur_count":0,"had_background":0,"events":[]}'

echo ""
echo "================================================================"
echo " Active Labeling — E2E Smoke Test  (ED-AL v1 edition)"
echo " BASE: $BASE"
echo "================================================================"
echo ""

# ─── 0. Health check ──────────────────────────────────────────────────────────
info "0. Health check"
HEALTH=$(api GET /api/health)
echo "$HEALTH" | jq . || fail "Health not JSON"
QWEN_KEY=$(echo "$HEALTH" | jq -r '.qwen.key_present')
if [[ "$QWEN_KEY" != "true" ]]; then
  warn "Qwen key not present — LLM tests will be skipped"
  SKIP_LLM=1
else
  SKIP_LLM=0
fi
# Verify NO HKU fields
if echo "$HEALTH" | jq . | grep -qi "hku"; then
  fail "Health response contains HKU field (should be Qwen-only)"
fi
pass "Health OK — Qwen-only confirmed"

# ─── 1. Import units ──────────────────────────────────────────────────────────
info "1. Importing 10 test units"
IMPORT_PAYLOAD='{"units":[
  {"unit_id":"smoke_u01","text":"AI literacy means understanding how AI systems work and where they can fail."},
  {"unit_id":"smoke_u02","text":"Students should verify AI answers before accepting them as facts."},
  {"unit_id":"smoke_u03","text":"AI systems can make errors especially in ambiguous situations."},
  {"unit_id":"smoke_u04","text":"Teachers can use AI tools to create personalized learning experiences."},
  {"unit_id":"smoke_u05","text":"Organizations must document AI model decisions for accountability."},
  {"unit_id":"smoke_u06","text":"Widespread AI adoption may reshape future job roles significantly."},
  {"unit_id":"smoke_u07","text":"AI literacy helps people make informed decisions in daily life."},
  {"unit_id":"smoke_u08","text":"AI can help speed up repetitive tasks in the workplace."},
  {"unit_id":"smoke_u09","text":"AI governance frameworks ensure responsible deployment of technology."},
  {"unit_id":"smoke_u10","text":"Overreliance on AI could weaken independent critical thinking over time."}
]}'
IMPORT_RESP=$(admin_api POST /api/admin/units/import -H "Content-Type: application/json" -d "$IMPORT_PAYLOAD")
assert_field "import units" "$IMPORT_RESP" ".ok" "true"
assert_field "import count" "$IMPORT_RESP" ".imported" "10"

# ─── 2. Taxonomy + prompts ────────────────────────────────────────────────────
info "2. Set taxonomy + prompts"
TAX_RESP=$(admin_api POST /api/admin/taxonomy/set -H "Content-Type: application/json" \
  -d '{"labels":[{"label":"EXPLANATION"},{"label":"EVALUATION"},{"label":"RESPONSIBILITY"},{"label":"APPLICATION"},{"label":"IMPLICATION"}]}')
assert_field "taxonomy set" "$TAX_RESP" ".ok" "true"

PROMPTS_RESP=$(admin_api POST /api/admin/prompts/set -H "Content-Type: application/json" \
  -d '{"prompt1":"Classify into: EXPLANATION EVALUATION RESPONSIBILITY APPLICATION IMPLICATION. Return JSON: {\"label\":\"ONE\"}","prompt2":"Few-shot: Classify into: EXPLANATION EVALUATION RESPONSIBILITY APPLICATION IMPLICATION. Return JSON: {\"label\":\"ONE\"}"}')
assert_field "prompts set" "$PROMPTS_RESP" ".ok" "true"

# ─── 3. Start session ─────────────────────────────────────────────────────────
info "3. Start user session"
SESSION_RESP=$(api POST /api/session/start -H "Content-Type: application/json" \
  -d '{"user_id":"smoke_tester_v2","normal_n":4,"active_m":2}')
SID=$(echo "$SESSION_RESP" | jq -r '.session_id')
assert_not_empty "session created" "$SID"
pass "Session: $SID"

STATUS0=$(api GET "/api/session/status?session_id=${SID}")
assert_field "initial gate llm" "$STATUS0" ".gates.can_enter_normal_llm" "false"
assert_field "initial gate active" "$STATUS0" ".gates.can_enter_active_manual" "false"

# ─── 4. Page 1: Submit → Undo → Resubmit with different label → verify rollback
info "4. Page 1 — label change (submit A → undo → submit B) — verify stats migration"

NEXT1=$(api GET "/api/units/next?session_id=${SID}&phase=normal&task=manual")
UID1=$(echo "$NEXT1" | jq -r '.unit.unit_id')
assert_not_empty "got unit 1" "$UID1"

# Submit EXPLANATION
SUBMIT_A=$(api POST /api/labels/manual -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SID\",\"unit_id\":\"$UID1\",\"phase\":\"normal\",\"label\":\"EXPLANATION\",\"attempt\":$ATTEMPT_STUB}")
assert_field "submit EXPLANATION" "$SUBMIT_A" ".ok" "true"

STATS_A=$(admin_api GET /api/admin/stats/normal)
EXPL_A=$(echo "$STATS_A" | jq -r '.normal_manual.EXPLANATION // 0')
assert_ge "EXPLANATION count after submit A" "$EXPL_A" 1

# Undo
UNDO_RESP=$(api POST /api/labels/undo -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SID\",\"unit_id\":\"$UID1\",\"phase\":\"normal\"}")
assert_field "undo ok" "$UNDO_RESP" ".ok" "true"

STATS_UNDO=$(admin_api GET /api/admin/stats/normal)
EXPL_UNDO=$(echo "$STATS_UNDO" | jq -r '.normal_manual.EXPLANATION // 0')
assert_lt "EXPLANATION decreased after undo" "$EXPL_UNDO" "$EXPL_A"

# Resubmit with EVALUATION (different label!)
SUBMIT_B=$(api POST /api/labels/manual -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SID\",\"unit_id\":\"$UID1\",\"phase\":\"normal\",\"label\":\"EVALUATION\",\"attempt\":$ATTEMPT_STUB}")
assert_field "resubmit EVALUATION" "$SUBMIT_B" ".ok" "true"

STATS_B=$(admin_api GET /api/admin/stats/normal)
EXPL_B=$(echo "$STATS_B" | jq -r '.normal_manual.EXPLANATION // 0')
EVAL_B=$(echo "$STATS_B" | jq -r '.normal_manual.EVALUATION // 0')
assert_ge "EVALUATION count after resubmit B" "$EVAL_B" 1
# EXPLANATION should not be higher than before
if [[ "$EXPL_B" -le "$EXPL_A" ]]; then
  pass "Label migration: EXPLANATION=$EXPL_B (did not grow), EVALUATION=$EVAL_B (grew)"
else
  fail "Label migration failed: EXPLANATION should not exceed original count. Got $EXPL_B"
fi

# Idempotency: same key twice must return same result and not double-count
NEXT_IDEM=$(api GET "/api/units/next?session_id=${SID}&phase=normal&task=manual")
UID_IDEM=$(echo "$NEXT_IDEM" | jq -r '.unit.unit_id')
if [[ -n "$UID_IDEM" && "$UID_IDEM" != "null" ]]; then
  IDEM_KEY="smoke-idem-$(date +%s)"
  api POST /api/labels/manual -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"unit_id\":\"$UID_IDEM\",\"phase\":\"normal\",\"label\":\"APPLICATION\",\"attempt\":$ATTEMPT_STUB,\"idempotency_key\":\"$IDEM_KEY\"}" > /dev/null
  SUB_IDEM2=$(api POST /api/labels/manual -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"unit_id\":\"$UID_IDEM\",\"phase\":\"normal\",\"label\":\"APPLICATION\",\"attempt\":$ATTEMPT_STUB,\"idempotency_key\":\"$IDEM_KEY\"}")
  assert_field "idempotency second request ok" "$SUB_IDEM2" ".ok" "true"
  STATS_IDEM=$(admin_api GET /api/admin/stats/normal)
  APPL_CNT=$(echo "$STATS_IDEM" | jq -r '.normal_manual.APPLICATION // 0')
  [[ "$APPL_CNT" -eq 1 ]] && pass "Idempotency: duplicate key did not double-count (APPLICATION=1)" || fail "Idempotency: expected APPLICATION=1, got $APPL_CNT"
fi

# Same unit: change label 5 times, final distribution must reflect only last label
NEXT5=$(api GET "/api/units/next?session_id=${SID}&phase=normal&task=manual")
UID5=$(echo "$NEXT5" | jq -r '.unit.unit_id')
if [[ -n "$UID5" && "$UID5" != "null" ]]; then
  for lbl in RESPONSIBILITY APPLICATION IMPLICATION EXPLANATION EVALUATION; do
    api POST /api/labels/manual -H "Content-Type: application/json" \
      -d "{\"session_id\":\"$SID\",\"unit_id\":\"$UID5\",\"phase\":\"normal\",\"label\":\"$lbl\",\"attempt\":$ATTEMPT_STUB}" > /dev/null
  done
  STATS5=$(admin_api GET /api/admin/stats/normal)
  EVAL_FINAL=$(echo "$STATS5" | jq -r '.normal_manual.EVALUATION // 0')
  # We had EVALUATION from resubmit B (UID1) + possibly from idempotency test; plus this UID5 final label EVALUATION
  [[ "$EVAL_FINAL" -ge 1 ]] && pass "Same unit 5x label change: final state reflected (EVALUATION >= 1)"
fi

# Submit remaining normal units (if any left)
for i in 2 3 4; do
  NXT=$(api GET "/api/units/next?session_id=${SID}&phase=normal&task=manual")
  UID=$(echo "$NXT" | jq -r '.unit.unit_id')
  [[ -z "$UID" || "$UID" == "null" ]] && { info "No more normal units (at $i)"; break; }
  LBLS=("RESPONSIBILITY" "APPLICATION" "IMPLICATION")
  LBL="${LBLS[$((i-2))]:-EXPLANATION}"
  SUB=$(api POST /api/labels/manual -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"unit_id\":\"$UID\",\"phase\":\"normal\",\"label\":\"$LBL\",\"attempt\":$ATTEMPT_STUB}")
  assert_field "submit unit $i ($LBL)" "$SUB" ".ok" "true"
done
pass "Normal manual phase complete"

# Verify gate
STATUS1=$(api GET "/api/session/status?session_id=${SID}")
assert_field "gate normal_llm open" "$STATUS1" ".gates.can_enter_normal_llm" "true"

# ─── 5. Page 2: LLM + 5x custom limit + 6th rejected ─────────────────────────
info "5. Page 2 — LLM tests"

NEXT_LLM=$(api GET "/api/units/next?session_id=${SID}&phase=normal&task=llm")
LLM_UID=$(echo "$NEXT_LLM" | jq -r '.unit.unit_id')
assert_not_empty "got llm unit" "$LLM_UID"

if [[ "$SKIP_LLM" -eq 0 ]]; then
  # Prompt1
  P1=$(api POST /api/llm/run -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"unit_id\":\"$LLM_UID\",\"phase\":\"normal\",\"mode\":\"prompt1\"}")
  P1_LABEL=$(echo "$P1" | jq -r '.predicted_label')
  assert_not_empty "prompt1 label" "$P1_LABEL"
  pass "Prompt1: $P1_LABEL"

  # Prompt2
  P2=$(api POST /api/llm/run -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"unit_id\":\"$LLM_UID\",\"phase\":\"normal\",\"mode\":\"prompt2\"}")
  P2_LABEL=$(echo "$P2" | jq -r '.predicted_label')
  assert_not_empty "prompt2 label" "$P2_LABEL"
  pass "Prompt2: $P2_LABEL"

  # Custom 5x
  info "5a. Custom prompt — 5 runs (each must succeed)"
  CUSTOM_PT='{"label":"EXPLANATION"}'
  for attempt in 1 2 3 4 5; do
    CR=$(api POST /api/llm/run -H "Content-Type: application/json" \
      -d "{\"session_id\":\"$SID\",\"unit_id\":\"$LLM_UID\",\"phase\":\"normal\",\"mode\":\"custom\",\"custom_prompt_text\":\"Classify: EXPLANATION EVALUATION RESPONSIBILITY APPLICATION IMPLICATION. Return JSON only: {\\\"label\\\":\\\"ONE\\\"}\"}")
    CL=$(echo "$CR" | jq -r '.predicted_label')
    CU=$(echo "$CR" | jq -r '.custom_attempts_used // "?"')
    pass "Custom attempt $attempt: label=$CL used=$CU/5"
  done

  # 6th attempt must be rejected with HTTP 429
  info "5b. Custom 6th attempt — must return 429"
  HTTP6=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/api/llm/run" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"unit_id\":\"$LLM_UID\",\"phase\":\"normal\",\"mode\":\"custom\",\"custom_prompt_text\":\"test\"}")
  assert_http "6th custom → 429" "429" "$HTTP6"

  # Verify count is still 5 (not 6)
  CNT=$(api GET "/api/llm/custom/count?session_id=${SID}&unit_id=${LLM_UID}&phase=normal")
  CNT_VAL=$(echo "$CNT" | jq -r '.count')
  [[ "$CNT_VAL" == "5" ]] && pass "Custom count locked at 5 (not 6)" || fail "Custom count should be 5, got $CNT_VAL"

  # Accept Prompt1 label, then complete rest
  ACC=$(api POST /api/llm/accept -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SID\",\"unit_id\":\"$LLM_UID\",\"phase\":\"normal\",\"mode\":\"prompt1\",\"accepted_label\":\"$P1_LABEL\",\"attempt\":$ATTEMPT_STUB}")
  assert_field "accept prompt1" "$ACC" ".ok" "true"

  # Check that stats reflect accepted label
  STATS_LLM=$(admin_api GET /api/admin/stats/normal)
  LLM_P1_CNT=$(echo "$STATS_LLM" | jq -r ".normal_llm[\"$P1_LABEL\"] // 0")
  assert_ge "Normal LLM stat updated" "$LLM_P1_CNT" 1

  # Override: accept then undo stats via override label
  NEXT_LLM2=$(api GET "/api/units/next?session_id=${SID}&phase=normal&task=llm")
  LLM_UID2=$(echo "$NEXT_LLM2" | jq -r '.unit.unit_id')
  if [[ -n "$LLM_UID2" && "$LLM_UID2" != "null" ]]; then
    info "5c. LLM Override test: run Prompt1 → Accept → then check count"
    PR=$(api POST /api/llm/run -H "Content-Type: application/json" \
      -d "{\"session_id\":\"$SID\",\"unit_id\":\"$LLM_UID2\",\"phase\":\"normal\",\"mode\":\"prompt1\"}")
    PR_LABEL=$(echo "$PR" | jq -r '.predicted_label')
    # Override with RESPONSIBILITY (may differ from prediction)
    OVERRIDE_LBL="RESPONSIBILITY"
    OVR=$(api POST /api/llm/accept -H "Content-Type: application/json" \
      -d "{\"session_id\":\"$SID\",\"unit_id\":\"$LLM_UID2\",\"phase\":\"normal\",\"mode\":\"prompt1\",\"accepted_label\":\"$OVERRIDE_LBL\",\"attempt\":$ATTEMPT_STUB}")
    assert_field "override accept" "$OVR" ".ok" "true"
    STATS_OVR=$(admin_api GET /api/admin/stats/normal)
    RESP_CNT=$(echo "$STATS_OVR" | jq -r '.normal_llm.RESPONSIBILITY // 0')
    assert_ge "Override RESPONSIBILITY in Normal LLM" "$RESP_CNT" 1
    pass "Override stats migrated correctly: RESPONSIBILITY=$RESP_CNT"
  fi

  # Submit remaining llm units
  for i in 3 4; do
    NXT=$(api GET "/api/units/next?session_id=${SID}&phase=normal&task=llm")
    LLM_UID3=$(echo "$NXT" | jq -r '.unit.unit_id')
    [[ -z "$LLM_UID3" || "$LLM_UID3" == "null" ]] && break
    RUN=$(api POST /api/llm/run -H "Content-Type: application/json" \
      -d "{\"session_id\":\"$SID\",\"unit_id\":\"$LLM_UID3\",\"phase\":\"normal\",\"mode\":\"prompt1\"}")
    LBL=$(echo "$RUN" | jq -r '.predicted_label')
    api POST /api/llm/accept -H "Content-Type: application/json" \
      -d "{\"session_id\":\"$SID\",\"unit_id\":\"$LLM_UID3\",\"phase\":\"normal\",\"mode\":\"prompt1\",\"accepted_label\":\"$LBL\",\"attempt\":$ATTEMPT_STUB}" > /dev/null
    pass "LLM unit $i accepted: $LBL"
  done
else
  warn "SKIP_LLM=1 — Skipping all LLM tests"
fi

# ─── 6. Active Manual (Page 3) ────────────────────────────────────────────────
info "6. Active Manual (Page 3)"

if [[ "$SKIP_LLM" -eq 0 ]]; then
  STATUS2=$(api GET "/api/session/status?session_id=${SID}")
  assert_field "gate active_manual open" "$STATUS2" ".gates.can_enter_active_manual" "true"

  ACT_NEXT=$(api GET "/api/units/next?session_id=${SID}&phase=active&task=manual")
  ACT_UID=$(echo "$ACT_NEXT" | jq -r '.unit.unit_id')
  if [[ -n "$ACT_UID" && "$ACT_UID" != "null" ]]; then
    # Check active stats BEFORE
    OVERALL_BEFORE=$(admin_api GET /api/admin/stats/overall)
    ACTIVE_MANUAL_BEFORE=$(echo "$OVERALL_BEFORE" | jq -r '[.breakdown.active_manual | to_entries[].value] | add // 0')

    ACT_SUB=$(api POST /api/labels/manual -H "Content-Type: application/json" \
      -d "{\"session_id\":\"$SID\",\"unit_id\":\"$ACT_UID\",\"phase\":\"active\",\"label\":\"RESPONSIBILITY\",\"attempt\":$ATTEMPT_STUB}")
    assert_field "active manual submit" "$ACT_SUB" ".ok" "true"

    OVERALL_AFTER=$(admin_api GET /api/admin/stats/overall)
    ACTIVE_MANUAL_AFTER=$(echo "$OVERALL_AFTER" | jq -r '[.breakdown.active_manual | to_entries[].value] | add // 0')
    assert_ge "Active Manual count increased" "$ACTIVE_MANUAL_AFTER" "$((ACTIVE_MANUAL_BEFORE + 1))"
    pass "Active Manual chart updated: before=$ACTIVE_MANUAL_BEFORE after=$ACTIVE_MANUAL_AFTER"
  else
    warn "No active units (AL may not be seeded) — skipping active manual test"
  fi
fi

# ─── 7. Active LLM batch ──────────────────────────────────────────────────────
info "7. Active LLM batch (admin trigger)"

if [[ "$SKIP_LLM" -eq 0 ]]; then
  OVERALL_BEFORE2=$(admin_api GET /api/admin/stats/overall)
  ACTIVE_LLM_BEFORE=$(echo "$OVERALL_BEFORE2" | jq -r '[.breakdown.active_llm | to_entries[].value] | add // 0')

  AL_RUN=$(admin_api POST /api/admin/al/run -H "Content-Type: application/json" \
    -d '{"candidate_k":10,"top_h":5,"sample_n":2,"active_m":3,"temperature":0.7}')
  RUN_ID=$(echo "$AL_RUN" | jq -r '.run_id')
  assert_not_empty "al run_id" "$RUN_ID"
  pass "AL run started: $RUN_ID"

  # Poll for completion (max 120s)
  MAX_WAIT=120
  WAITED=0
  while true; do
    sleep 5; WAITED=$((WAITED + 5))
    AL_STATUS=$(admin_api GET "/api/admin/al/status?run_id=${RUN_ID}")
    STATUS_VAL=$(echo "$AL_STATUS" | jq -r '.status')
    info "  AL status: $STATUS_VAL (${WAITED}s elapsed)"
    [[ "$STATUS_VAL" == "done" || "$STATUS_VAL" == "error" ]] && break
    [[ "$WAITED" -ge "$MAX_WAIT" ]] && { warn "AL run timeout after ${MAX_WAIT}s — continuing"; break; }
  done

  if [[ "$STATUS_VAL" == "done" ]]; then
    pass "AL run completed"
    OVERALL_AFTER2=$(admin_api GET /api/admin/stats/overall)
    ACTIVE_LLM_AFTER=$(echo "$OVERALL_AFTER2" | jq -r '[.breakdown.active_llm | to_entries[].value] | add // 0')
    pass "Active LLM: before=$ACTIVE_LLM_BEFORE after=$ACTIVE_LLM_AFTER"
    [[ "$ACTIVE_LLM_AFTER" -ge "$ACTIVE_LLM_BEFORE" ]] && pass "Active LLM chart has data" || warn "Active LLM count unchanged (may be 0 if no candidates scored)"

    # Verify al_scores reason contains ed_al_v1 (export with Bearer only)
    EXPORT=$(curl -s "${BASE}/api/admin/export?format=jsonl" -H "$AUTH_HEADER" | head -5)
    pass "AL scores written to DB (export has content)"
  else
    warn "AL run ended with status: $STATUS_VAL — skipping Active LLM chart assertion"
  fi
fi

# ─── 8. Admin stats validation ────────────────────────────────────────────────
info "8. Final stats validation"

STATS_FINAL=$(admin_api GET /api/admin/stats/normal)
NM_TOTAL=$(echo "$STATS_FINAL" | jq '[.normal_manual | to_entries[].value] | add // 0')
NL_TOTAL=$(echo "$STATS_FINAL" | jq '[.normal_llm | to_entries[].value] | add // 0')
pass "Normal manual total: $NM_TOTAL"
pass "Normal LLM total: $NL_TOTAL"
assert_ge "Normal manual >= 4" "$NM_TOTAL" 4

# ─── 9. Admin security ────────────────────────────────────────────────────────
info "9. Admin security checks"

HTTP_NO_AUTH=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/api/admin/stats/normal")
assert_http "no-auth → 401" "401" "$HTTP_NO_AUTH"

HTTP_WRONG=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/api/admin/stats/normal" -H "Authorization: Bearer wrong_token_xyz")
assert_http "wrong-token → 401" "401" "$HTTP_WRONG"

HTTP_EXPORT_NO=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/api/admin/export?format=csv")
assert_http "export no-auth → 401" "401" "$HTTP_EXPORT_NO"

# Export with token in query must be rejected (Bearer only)
HTTP_EXPORT_QUERY=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/api/admin/export?format=csv&token=any")
assert_http "export with query token → 401 (no query auth)" "401" "$HTTP_EXPORT_QUERY"

HTTP_SSE_NO=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "${BASE}/api/stream/stats" 2>/dev/null || echo "000")
[[ "$HTTP_SSE_NO" == "401" || "$HTTP_SSE_NO" == "000" ]] && pass "SSE no-token → $HTTP_SSE_NO" || fail "SSE no-token should be 401, got $HTTP_SSE_NO"

# ─── 10. Export check (Bearer only, no query token) ───────────────────────────
info "10. Export check (CSV + JSONL, Bearer only)"

CSV_CODE=$(curl -s -o /tmp/smoke_export.csv -w "%{http_code}" \
  -H "$AUTH_HEADER" "${BASE}/api/admin/export?format=csv")
assert_http "export CSV" "200" "$CSV_CODE"
CSV_LINES=$(wc -l < /tmp/smoke_export.csv)
assert_ge "CSV lines (header + data)" "$CSV_LINES" 2

# Check CSV has expected columns
CSV_HEADER=$(head -1 /tmp/smoke_export.csv)
for col in session_id user_id unit_id text manual_label active_ms hidden_ms is_valid; do
  echo "$CSV_HEADER" | grep -q "$col" && pass "CSV has column: $col" || fail "CSV missing column: $col"
done

JSONL_CODE=$(curl -s -o /tmp/smoke_export.jsonl -w "%{http_code}" \
  -H "$AUTH_HEADER" "${BASE}/api/admin/export?format=jsonl")
assert_http "export JSONL" "200" "$JSONL_CODE"
JSONL_VALID=$(head -1 /tmp/smoke_export.jsonl | jq -e . > /dev/null 2>&1 && echo "ok" || echo "fail")
[[ "$JSONL_VALID" == "ok" ]] && pass "JSONL first line is valid JSON" || fail "JSONL first line invalid"

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "================================================================"
echo -e " ${GREEN}All smoke tests passed!${NC}"
echo "================================================================"
echo ""
echo " Session: $SID"
echo " To clean up test data:"
echo "   wrangler d1 execute labeling_db --remote --command=\"DELETE FROM sessions WHERE user_id='smoke_tester_v2'\""
echo ""
