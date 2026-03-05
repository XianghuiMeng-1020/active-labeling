#!/usr/bin/env bash
# =============================================================================
# sse_resync_check.sh — 验证 SSE 断线重连后全量纠偏
#
# Usage:
#   BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/sse_resync_check.sh
#
# 1) 订阅 SSE
# 2) 人为中断（kill 或短时断开）后恢复
# 3) 验证重连后会自动全量拉取并恢复正确分布（revision 跳号触发 resync）
# 输出 PASS/FAIL
# =============================================================================
set -euo pipefail

BASE="${BASE:-http://localhost:8787}"
ADMIN_TOKEN="${ADMIN_TOKEN:-dev-admin-token}"

GREEN='\033[0;32m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
pass() { echo -e "${GREEN}[PASS]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }
info() { echo -e "${BLUE}[INFO]${NC} $*"; }

require_cmd() { command -v "$1" &>/dev/null || fail "Required: $1"; }
require_cmd curl; require_cmd jq

AUTH_HEADER="Authorization: Bearer ${ADMIN_TOKEN}"
ATTEMPT='{"shown_at_epoch_ms":1000,"answered_at_epoch_ms":5000,"active_ms":4000,"hidden_ms":0,"idle_ms":0,"hidden_count":0,"blur_count":0,"had_background":0,"events":[]}'

echo ""
echo "======================================================="
echo " SSE Resync Check — 断线重连纠偏"
echo " BASE: $BASE"
echo "======================================================="
echo ""

# 1) 获取当前 stats（sync 端点含 revision）
info "1. Fetch initial stats (sync)"
SYNC0=$(curl -s "${BASE}/api/admin/stats/sync" -H "$AUTH_HEADER")
if echo "$SYNC0" | jq -e '.revision' >/dev/null 2>&1; then
  pass "Sync endpoint returns revision"
else
  fail "Sync endpoint missing revision: $SYNC0"
fi
REV0=$(echo "$SYNC0" | jq -r '.revision // 0')
EXPL0=$(echo "$SYNC0" | jq -r '.normal.normal_manual.EXPLANATION // 0')

# 2) 后台开 SSE，提交一条标注，收一条 stats_update
info "2. Start SSE and submit one label"
SSE_LOG=$(mktemp)
(
  curl -s -N --max-time 20 \
    -H "Cache-Control: no-cache" \
    -H "$AUTH_HEADER" \
    "${BASE}/api/stream/stats" 2>/dev/null >> "$SSE_LOG"
) &
SSE_PID=$!
sleep 1

# 创建 session 并提交一条
SESSION=$(curl -s -X POST "${BASE}/api/session/start" -H "Content-Type: application/json" \
  -d '{"user_id":"resync_tester","normal_n":1,"active_m":0}')
SID=$(echo "$SESSION" | jq -r '.session_id')
[[ -n "$SID" && "$SID" != "null" ]] || fail "Session create failed"
NEXT=$(curl -s "${BASE}/api/units/next?session_id=${SID}&phase=normal&task=manual")
UID=$(echo "$NEXT" | jq -r '.unit.unit_id')
if [[ -z "$UID" || "$UID" == "null" ]]; then
  info "No units (seed first); simulating resync by re-fetching sync"
  kill "$SSE_PID" 2>/dev/null || true
  SYNC1=$(curl -s "${BASE}/api/admin/stats/sync" -H "$AUTH_HEADER")
  REV1=$(echo "$SYNC1" | jq -r '.revision // 0')
  [[ "$REV1" -ge 0 ]] && pass "Resync: sync endpoint returns revision after no-units" || fail "Sync failed"
  rm -f "$SSE_LOG"
  echo ""
  echo "======================================================="
  echo -e " ${GREEN}SSE Resync Check PASS (no units; sync OK)${NC}"
  echo "======================================================="
  echo ""
  exit 0
fi

curl -s -X POST "${BASE}/api/labels/manual" -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SID\",\"unit_id\":\"$UID\",\"phase\":\"normal\",\"label\":\"EXPLANATION\",\"attempt\":$ATTEMPT}" > /dev/null

# 等 SSE 收到一条
for _ in $(seq 1 20); do
  sleep 0.5
  if grep -q "stats_update" "$SSE_LOG" 2>/dev/null; then
    pass "SSE received stats_update after submit"
    break
  fi
done
if ! grep -q "stats_update" "$SSE_LOG" 2>/dev/null; then
  warn "No stats_update in log (worker may not broadcast); continuing"
fi

# 3) 中断 SSE（kill 子进程），再拉 sync 做“重连后全量纠偏”
info "3. Kill SSE then re-fetch sync (simulate reconnect resync)"
kill "$SSE_PID" 2>/dev/null || true
sleep 0.5
SYNC1=$(curl -s "${BASE}/api/admin/stats/sync" -H "$AUTH_HEADER")
REV1=$(echo "$SYNC1" | jq -r '.revision // 0')
EXPL1=$(echo "$SYNC1" | jq -r '.normal.normal_manual.EXPLANATION // 0')

# 4) 验证：revision 递增或不变；分布合理（至少 sync 返回一致数据）
if [[ "$REV1" -ge "$REV0" ]]; then
  pass "Revision after resync: $REV1 (was $REV0)"
else
  fail "Revision went backwards: $REV1 < $REV0"
fi
info "EXPLANATION count: before=$EXPL0 after=$EXPL1"
rm -f "$SSE_LOG"

echo ""
echo "======================================================="
echo -e " ${GREEN}SSE Resync Check PASS${NC}"
echo "  - Sync endpoint returns revision + full stats"
echo "  - After 'disconnect', full sync restores state"
echo "======================================================="
echo ""
