#!/usr/bin/env bash
# =============================================================================
# load_test_local.sh — 并发模拟演练（25 session 并发）
#
# Usage:
#   BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/load_test_local.sh
#   CONCURRENCY=10 BASE=https://your-worker.workers.dev ADMIN_TOKEN=xxx bash scripts/load_test_local.sh
#
# 每个 session：manual 提交 3 条（含一次改 label）+ llm prompt1 跑 1 条并 accept + custom 跑到 5 次并验证第 6 次拒绝
# 输出：成功率、429 次数、平均延迟、总耗时
# =============================================================================
set -euo pipefail

BASE="${BASE:-http://localhost:8787}"
ADMIN_TOKEN="${ADMIN_TOKEN:-dev-admin-token}"
CONCURRENCY="${CONCURRENCY:-25}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
pass() { echo -e "${GREEN}[PASS]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; }
info() { echo -e "${BLUE}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }

require_cmd() { command -v "$1" &>/dev/null || fail "Required: $1"; }
require_cmd curl; require_cmd jq

AUTH_HEADER="Authorization: Bearer ${ADMIN_TOKEN}"
ATTEMPT_STUB='{"shown_at_epoch_ms":1000,"answered_at_epoch_ms":4500,"active_ms":3500,"hidden_ms":0,"idle_ms":0,"hidden_count":0,"blur_count":0,"had_background":0,"events":[]}'

# 先确保有 units 和 taxonomy
seed_env() {
  admin_api() { curl -s -X "$1" "${BASE}$2" -H "$AUTH_HEADER" -H "Content-Type: application/json" "${@:3}"; }
  n=$(curl -s "${BASE}/api/health" | jq -r '.build // "ok"')
  count=$(curl -s "${BASE}/api/admin/stats/normal" -H "$AUTH_HEADER" 2>/dev/null | jq 'if .error then 0 else 1 end' 2>/dev/null || echo 0)
  if [[ "$count" == "0" ]]; then
    info "Seeding units and taxonomy..."
    admin_api POST /api/admin/units/import -d '{"units":[
      {"unit_id":"load_u01","text":"AI literacy is essential for education."},
      {"unit_id":"load_u02","text":"Governance requires accountability."},
      {"unit_id":"load_u03","text":"Overreliance may reduce critical thinking."},
      {"unit_id":"load_u04","text":"AI can personalize learning."},
      {"unit_id":"load_u05","text":"Organizations must document AI decisions."},
      {"unit_id":"load_u06","text":"AI adoption may reshape job roles."},
      {"unit_id":"load_u07","text":"People need informed decisions in daily life."},
      {"unit_id":"load_u08","text":"AI speeds up repetitive tasks."},
      {"unit_id":"load_u09","text":"Governance ensures responsible deployment."},
      {"unit_id":"load_u10","text":"Critical thinking could weaken over time."}
    ]}' > /dev/null
    admin_api POST /api/admin/taxonomy/set -d '{"labels":[{"label":"EXPLANATION"},{"label":"EVALUATION"},{"label":"RESPONSIBILITY"},{"label":"APPLICATION"},{"label":"IMPLICATION"}]}' > /dev/null
    admin_api POST /api/admin/prompts/set -d '{"prompt1":"Classify into EXPLANATION EVALUATION RESPONSIBILITY APPLICATION IMPLICATION. Return JSON: {\"label\":\"ONE\"}","prompt2":"Same. Return JSON: {\"label\":\"ONE\"}"}' > /dev/null
    pass "Seeded"
  fi
}

run_one_session() {
  local id="$1"
  local out="$2"
  local start_ms=$(($(date +%s%3N)))
  local err=""
  local four29=0

  # start session (normal_n=3, active_m=0 to keep test short)
  local sess=$(curl -s -X POST "${BASE}/api/session/start" -H "Content-Type: application/json" \
    -d "{\"user_id\":\"load_user_${id}\",\"normal_n\":3,\"active_m\":0}")
  local sid=$(echo "$sess" | jq -r '.session_id')
  if [[ -z "$sid" || "$sid" == "null" ]]; then
    echo "{\"ok\":false,\"err\":\"start\",\"request_id\":\"-\"}" >> "$out"
    return
  fi

  # manual: 3 条，第二条改一次 label
  for i in 1 2 3; do
    local next=$(curl -s "${BASE}/api/units/next?session_id=${sid}&phase=normal&task=manual")
    local uid=$(echo "$next" | jq -r '.unit.unit_id')
    [[ -z "$uid" || "$uid" == "null" ]] && break
    local lbl="EXPLANATION"
    [[ $i -eq 2 ]] && lbl="EVALUATION"
    local resp=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/labels/manual" -H "Content-Type: application/json" \
      -d "{\"session_id\":\"$sid\",\"unit_id\":\"$uid\",\"phase\":\"normal\",\"label\":\"$lbl\",\"attempt\":$ATTEMPT_STUB}")
    local code=$(echo "$resp" | tail -1)
    if [[ "$code" == "429" ]]; then four29=$((four29+1)); fi
  done

  # llm prompt1 一条并 accept
  local next_llm=$(curl -s "${BASE}/api/units/next?session_id=${sid}&phase=normal&task=llm")
  local llm_uid=$(echo "$next_llm" | jq -r '.unit.unit_id')
  if [[ -n "$llm_uid" && "$llm_uid" != "null" ]]; then
    local run_resp=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/llm/run" -H "Content-Type: application/json" \
      -d "{\"session_id\":\"$sid\",\"unit_id\":\"$llm_uid\",\"phase\":\"normal\",\"mode\":\"prompt1\"}")
    local run_code=$(echo "$run_resp" | tail -1)
    local run_body=$(echo "$run_resp" | sed '$d')
    if [[ "$run_code" == "429" ]]; then four29=$((four29+1)); fi
    local pred=$(echo "$run_body" | jq -r '.predicted_label // .error')
    if [[ "$run_code" == "200" && "$pred" != "null" && "$pred" != "" ]]; then
      curl -s -X POST "${BASE}/api/llm/accept" -H "Content-Type: application/json" \
        -d "{\"session_id\":\"$sid\",\"unit_id\":\"$llm_uid\",\"phase\":\"normal\",\"mode\":\"prompt1\",\"accepted_label\":\"$pred\",\"attempt\":$ATTEMPT_STUB}" > /dev/null
    fi
  fi

  # custom 跑到 5 次，第 6 次应 429
  local custom_uid=$(echo "$next_llm" | jq -r '.unit.unit_id')
  if [[ -z "$custom_uid" || "$custom_uid" == "null" ]]; then
    custom_uid=$(curl -s "${BASE}/api/units/next?session_id=${sid}&phase=normal&task=llm" | jq -r '.unit.unit_id')
  fi
  if [[ -n "$custom_uid" && "$custom_uid" != "null" ]]; then
    for attempt in 1 2 3 4 5; do
      local cr=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/llm/run" -H "Content-Type: application/json" \
        -d "{\"session_id\":\"$sid\",\"unit_id\":\"$custom_uid\",\"phase\":\"normal\",\"mode\":\"custom\",\"custom_prompt_text\":\"Classify. Return JSON: {\\\"label\\\":\\\"ONE\\\"}\"}")
      local ccode=$(echo "$cr" | tail -1)
      if [[ "$ccode" == "429" ]]; then four29=$((four29+1)); fi
    done
    local sixth=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/api/llm/run" -H "Content-Type: application/json" \
      -d "{\"session_id\":\"$sid\",\"unit_id\":\"$custom_uid\",\"phase\":\"normal\",\"mode\":\"custom\",\"custom_prompt_text\":\"x\"}")
    if [[ "$sixth" != "429" ]]; then
      err="custom_6th_not_429_got_${sixth}"
    fi
    if [[ "$sixth" == "429" ]]; then four29=$((four29+1)); fi
  fi

  local end_ms=$(($(date +%s%3N)))
  local lat=$((end_ms - start_ms))
  if [[ -n "$err" ]]; then
    echo "{\"ok\":false,\"err\":\"$err\",\"latency_ms\":$lat,\"429_count\":$four29,\"session_id\":\"$sid\"}" >> "$out"
  else
    echo "{\"ok\":true,\"latency_ms\":$lat,\"429_count\":$four29,\"session_id\":\"$sid\"}" >> "$out"
  fi
}

export -f run_one_session
export BASE ATTEMPT_STUB

echo ""
echo "================================================================"
echo " Load Test — $CONCURRENCY 并发 Session"
echo " BASE: $BASE"
echo "================================================================"
echo ""

seed_env
OUT_DIR=$(mktemp -d)
for i in $(seq 1 "$CONCURRENCY"); do
  run_one_session "$i" "$OUT_DIR/out_$i.json" &
done
wait

# aggregate
total=$CONCURRENCY
ok=0
total_429=0
total_latency=0
for f in "$OUT_DIR"/out_*.json; do
  [[ -f "$f" ]] || continue
  o=$(jq -r '.ok' "$f")
  [[ "$o" == "true" ]] && ok=$((ok+1))
  total_429=$((total_429 + $(jq -r '.429_count // 0' "$f")))
  total_latency=$((total_latency + $(jq -r '.latency_ms // 0' "$f")))
done
rm -rf "$OUT_DIR"

if [[ $total -gt 0 ]]; then
  pct=$((ok * 100 / total))
  avg_lat=$((total_latency / total))
  echo -e "${BLUE}Results:${NC}"
  echo "  成功率: $ok / $total ($pct%)"
  echo "  429 次数: $total_429"
  echo "  平均延迟: ${avg_lat} ms"
  echo "  总耗时: 见上方各 session 并行执行时间"
fi

if [[ $ok -lt $total ]]; then
  warn "部分 session 失败，建议: wrangler tail --format pretty 查看 request_id 与日志"
  echo ""
  exit 1
fi
pass "Load test completed: $ok/$total passed, 429_total=$total_429, avg_latency_ms=$avg_lat"
echo ""
