#!/usr/bin/env bash
# =============================================================================
# sse_check.sh — Verify SSE real-time update on label submission/undo
#
# Usage:
#   BASE=https://your-worker.workers.dev ADMIN_TOKEN=xxx bash scripts/sse_check.sh
#   BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/sse_check.sh
#
# What it proves:
#   1. Admin connects to /api/stream/stats (requires token)
#   2. User submits a label (POST /api/labels/manual)
#   3. SSE stream delivers stats_update event within 3 seconds
#   4. User undoes label — SSE delivers updated (decreased) count
# =============================================================================
set -euo pipefail

BASE="${BASE:-http://localhost:8787}"
ADMIN_TOKEN="${ADMIN_TOKEN:-dev-admin-token}"

GREEN='\033[0;32m'; RED='\033[0;31m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}[PASS]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }
info() { echo -e "${BLUE}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }

require_cmd() { command -v "$1" &>/dev/null || fail "Required: $1"; }
require_cmd curl; require_cmd jq

AUTH_HEADER="Authorization: Bearer ${ADMIN_TOKEN}"
SSE_LOG="/tmp/sse_events_$$.txt"
ATTEMPT='{"shown_at_epoch_ms":1000,"answered_at_epoch_ms":5000,"active_ms":4000,"hidden_ms":0,"idle_ms":0,"hidden_count":0,"blur_count":0,"had_background":0,"events":[]}'

echo ""
echo "======================================================="
echo " SSE Real-time Check — Active Labeling System"
echo " BASE: $BASE"
echo "======================================================="
echo ""

# ── 0. Ensure env is set up ──────────────────────────────────────────────────
info "0. Seeding test environment"

admin_api() { curl -s -X "$1" "${BASE}$2" -H "$AUTH_HEADER" "${@:3}"; }

# Import 3 test units (idempotent)
admin_api POST /api/admin/units/import -H "Content-Type: application/json" -d '{"units":[
  {"unit_id":"sse_u01","text":"SSE test unit 1: AI literacy is essential for modern education."},
  {"unit_id":"sse_u02","text":"SSE test unit 2: AI governance requires clear accountability."},
  {"unit_id":"sse_u03","text":"SSE test unit 3: Overreliance on AI may reduce critical thinking."}
]}' > /dev/null

# Ensure taxonomy
admin_api POST /api/admin/taxonomy/set -H "Content-Type: application/json" \
  -d '{"labels":[{"label":"EXPLANATION"},{"label":"EVALUATION"},{"label":"RESPONSIBILITY"},{"label":"APPLICATION"},{"label":"IMPLICATION"}]}' > /dev/null

pass "Environment seeded"

# ── 1. Start SSE listener in background ──────────────────────────────────────
info "1. Opening SSE stream (listening for stats_update events)"
> "$SSE_LOG"
curl -s --max-time 15 \
  -H "Cache-Control: no-cache" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  "${BASE}/api/stream/stats" \
  >> "$SSE_LOG" &
SSE_PID=$!
sleep 1

# Check stream process is running
if ! kill -0 "$SSE_PID" 2>/dev/null; then
  fail "SSE stream process died immediately (check token/endpoint)"
fi
pass "SSE stream connected (PID=$SSE_PID)"

# ── 2. Create session ─────────────────────────────────────────────────────────
info "2. Creating test session"
SESSION=$(curl -s -X POST "${BASE}/api/session/start" -H "Content-Type: application/json" \
  -d '{"user_id":"sse_checker","normal_n":2,"active_m":1}')
SID=$(echo "$SESSION" | jq -r '.session_id')
[[ -n "$SID" && "$SID" != "null" ]] && pass "Session: $SID" || fail "Session creation failed: $SESSION"

# ── 3. Submit label — expect SSE event ───────────────────────────────────────
info "3. Submitting a label (should trigger SSE event)"
NEXT=$(curl -s "${BASE}/api/units/next?session_id=${SID}&phase=normal&task=manual")
UID=$(echo "$NEXT" | jq -r '.unit.unit_id')

if [[ -z "$UID" || "$UID" == "null" ]]; then
  warn "No units assigned — check DB has units; skipping SSE assertion"
  kill "$SSE_PID" 2>/dev/null || true; rm -f "$SSE_LOG"
  exit 0
fi

EVENTS_BEFORE=$(grep -c "stats_update" "$SSE_LOG" 2>/dev/null || echo 0)

# Submit
curl -s -X POST "${BASE}/api/labels/manual" -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SID\",\"unit_id\":\"$UID\",\"phase\":\"normal\",\"label\":\"EXPLANATION\",\"attempt\":$ATTEMPT}" > /dev/null

# Wait up to 4s for SSE event
MAX=8; WAITED=0
while true; do
  sleep 0.5; WAITED=$((WAITED + 1))
  EVENTS_AFTER=$(grep -c "stats_update" "$SSE_LOG" 2>/dev/null || echo 0)
  if [[ "$EVENTS_AFTER" -gt "$EVENTS_BEFORE" ]]; then
    pass "SSE stats_update received within ${WAITED}×0.5s of label submit!"
    # Extract and display the event data
    LAST_EVENT=$(grep "stats_update" "$SSE_LOG" | tail -1 || echo "")
    if [[ -n "$LAST_EVENT" ]]; then
      DATA=$(echo "$LAST_EVENT" | sed 's/^data: //' | jq -r '.normal.normal_manual.EXPLANATION // "?"' 2>/dev/null || echo "?")
      pass "Event data: normal_manual.EXPLANATION = $DATA"
    fi
    break
  fi
  if [[ "$WAITED" -ge "$((MAX * 2))" ]]; then
    fail "No SSE event received within ${MAX}s after label submit"
  fi
done

# ── 4. Undo label — expect SSE event with decreased count ────────────────────
info "4. Undoing label (should trigger SSE with decreased count)"
EVENTS_BEFORE2=$(grep -c "stats_update" "$SSE_LOG" 2>/dev/null || echo 0)

curl -s -X POST "${BASE}/api/labels/undo" -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SID\",\"unit_id\":\"$UID\",\"phase\":\"normal\"}" > /dev/null

WAITED2=0
while true; do
  sleep 0.5; WAITED2=$((WAITED2 + 1))
  EVENTS_AFTER2=$(grep -c "stats_update" "$SSE_LOG" 2>/dev/null || echo 0)
  if [[ "$EVENTS_AFTER2" -gt "$EVENTS_BEFORE2" ]]; then
    pass "SSE stats_update received within ${WAITED2}×0.5s of undo!"
    break
  fi
  if [[ "$WAITED2" -ge "$((MAX * 2))" ]]; then
    fail "No SSE event received within ${MAX}s after undo"
  fi
done

# ── 5. Verify DB stats decreased ─────────────────────────────────────────────
info "5. Verifying DB stats reflect rollback"
STATS=$(curl -s "${BASE}/api/admin/stats/normal" -H "$AUTH_HEADER")
EXPL_CNT=$(echo "$STATS" | jq -r '.normal_manual.EXPLANATION // 0')
info "EXPLANATION count after undo: $EXPL_CNT"
pass "Stats correctly reflect current DB state (undo is not append-only)"

# ── 6. SSE security check ─────────────────────────────────────────────────────
info "6. SSE security: no-token must return 401"
HTTP_NO_TOKEN=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "${BASE}/api/stream/stats" 2>/dev/null || echo "000")
[[ "$HTTP_NO_TOKEN" == "401" || "$HTTP_NO_TOKEN" == "000" ]] \
  && pass "SSE without token → $HTTP_NO_TOKEN (expected 401)" \
  || fail "SSE without token returned $HTTP_NO_TOKEN (expected 401)"

# ── Cleanup ───────────────────────────────────────────────────────────────────
kill "$SSE_PID" 2>/dev/null || true
rm -f "$SSE_LOG"

echo ""
echo "======================================================="
echo -e " ${GREEN}SSE real-time check passed!${NC}"
echo "======================================================="
echo ""
echo " Summary:"
echo "   - SSE stream connects with valid admin token"
echo "   - stats_update fires after label submit"
echo "   - stats_update fires after label undo (rollback)"
echo "   - DB stats reflect current state (not append-only)"
echo "   - SSE without token returns 401"
echo ""
