#!/usr/bin/env bash
# Backend API smoke tests against production Worker.
# Usage: BASE_URL=https://sentence-labeling-api.xmeng19.workers.dev ./scripts/e2e_api_smoke.sh

set -e
API="${BASE_URL:-https://sentence-labeling-api.xmeng19.workers.dev}"
FAIL=0

check() {
  local name="$1"
  local method="$2"
  local path="$3"
  local data="$4"
  local expect_status="${5:-200}"
  echo -n "[$name] ... "
  if [ "$method" = "GET" ]; then
    res=$(curl -s -w "\n%{http_code}" --max-time 15 "$API$path")
  else
    res=$(curl -s -w "\n%{http_code}" --max-time 15 -X "$method" -H "Content-Type: application/json" -d "$data" "$API$path")
  fi
  status=$(echo "$res" | tail -n1)
  body=$(echo "$res" | sed '$d')
  if [ "$status" = "$expect_status" ]; then
    echo "OK ($status)"
  else
    echo "FAIL (got $status, expected $expect_status)"
    echo "$body" | head -c 200
    echo ""
    FAIL=1
  fi
}

echo "=== API Smoke Tests ==="
echo "BASE: $API"
echo ""

# 1. Health
check "health" "GET" "/api/health" "" "200"

# 2. Session start
START_BODY=$(curl -s --max-time 15 -X POST -H "Content-Type: application/json" -d '{}' "$API/api/session/start")
if echo "$START_BODY" | grep -q session_id; then
  echo "[session/start] ... OK (200, has session_id)"
  SESSION_ID=$(echo "$START_BODY" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
else
  echo "[session/start] ... FAIL (no session_id)"
  echo "$START_BODY" | head -c 300
  FAIL=1
  SESSION_ID=""
fi

if [ -z "$SESSION_ID" ]; then
  echo "No session_id, skipping session-dependent tests."
  exit $FAIL
fi

# 3. Session status
check "session/status" "GET" "/api/session/status?session_id=$SESSION_ID" "" "200"

# 4. Next unit (manual)
check "units/next manual" "GET" "/api/units/next?session_id=$SESSION_ID&phase=normal&task=manual" "" "200"

# 5. Labeled essays
check "labeled-essays" "GET" "/api/session/labeled-essays?session_id=$SESSION_ID&phase=normal" "" "200"

# 6. Ranking status
check "ranking/status" "GET" "/api/ranking/status?session_id=$SESSION_ID" "" "200"

# 7. Visualization (no session)
check "stats/visualization" "GET" "/api/stats/visualization" "" "200"

# 8. Ranking submit (valid body; may have no full essay yet, but endpoint should accept or return 400)
RANK_BODY=$(curl -s -w "\n%{http_code}" --max-time 15 -X POST -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\",\"essay_index\":1,\"ordering\":[\"essay0001_sentence01\",\"essay0001_sentence02\"]}" \
  "$API/api/ranking/submit")
RANK_STATUS=$(echo "$RANK_BODY" | tail -n1)
if [ "$RANK_STATUS" = "200" ] || [ "$RANK_STATUS" = "400" ]; then
  echo "[ranking/submit] ... OK ($RANK_STATUS)"
else
  echo "[ranking/submit] ... FAIL (got $RANK_STATUS)"
  FAIL=1
fi

# 9. Ranking reopen (revert essay 1 so we can re-label)
REOPEN_BODY=$(curl -s -w "\n%{http_code}" --max-time 15 -X POST -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\",\"essay_index\":1}" \
  "$API/api/ranking/reopen")
REOPEN_STATUS=$(echo "$REOPEN_BODY" | tail -n1)
if [ "$REOPEN_STATUS" = "200" ]; then
  echo "[ranking/reopen] ... OK (200)"
else
  echo "[ranking/reopen] ... got $REOPEN_STATUS (may be OK if no ranking existed)"
fi

echo ""
if [ $FAIL -eq 0 ]; then
  echo "All smoke tests passed."
else
  echo "Some tests failed."
fi
exit $FAIL
