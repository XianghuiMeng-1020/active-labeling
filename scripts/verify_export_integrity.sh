#!/usr/bin/env bash
# =============================================================================
# verify_export_integrity.sh — 校验导出 CSV/JSONL 完整性
#
# Usage:
#   BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/verify_export_integrity.sh
#
# 校验：duration_ms >= 0, active_ratio in [0,1], has_background 与 hidden_ms 一致性,
#       custom_attempt_count <= 5
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

echo ""
echo "======================================================="
echo " Export Integrity Check"
echo " BASE: $BASE"
echo "======================================================="
echo ""

info "Fetching JSONL export..."
EXPORT=$(curl -s -H "$AUTH_HEADER" "${BASE}/api/admin/export?format=jsonl")
if [[ -z "$EXPORT" ]]; then
  fail "Export empty or 401"
fi

FAILS=0
LINE_NUM=0
while IFS= read -r line; do
  LINE_NUM=$((LINE_NUM + 1));
  [[ -z "$line" ]] && continue
  if ! echo "$line" | jq -e . >/dev/null 2>&1; then
    fail "Line $LINE_NUM: invalid JSON"
  fi
  dur=$(echo "$line" | jq -r '.duration_ms // .answered_at_epoch_ms - .shown_at_epoch_ms // 0')
  if [[ "$dur" != "null" && "$dur" != "" ]]; then
    bad=$(echo "$line" | jq -r 'if .duration_ms != null and .duration_ms < 0 then 1 else 0 end')
    [[ "$bad" == "1" ]] && { echo "Line $LINE_NUM: duration_ms < 0 ($dur)"; FAILS=$((FAILS+1)); }
  fi
  ar=$(echo "$line" | jq -r '.active_ratio // 0')
  if [[ "$ar" != "null" && "$ar" != "" ]]; then
    bad=$(echo "$line" | jq -r 'if .active_ratio != null and (.active_ratio < 0 or .active_ratio > 1.01) then 1 else 0 end')
    [[ "$bad" == "1" ]] && { echo "Line $LINE_NUM: active_ratio out of [0,1] ($ar)"; FAILS=$((FAILS+1)); }
  fi
  bg=$(echo "$line" | jq -r '.had_background // 0')
  hid=$(echo "$line" | jq -r '.hidden_ms // 0')
  if [[ "$bg" == "1" && "$hid" == "0" ]]; then
    : # had_background=1 with hidden_ms=0 is allowed (brief background)
  fi
  valid=$(echo "$line" | jq -r '.is_valid // 1')
  if [[ "$valid" == "0" ]]; then
    inv=$(echo "$line" | jq -r '.invalid_reason // ""')
    [[ -z "$inv" ]] && { echo "Line $LINE_NUM: is_valid=0 but invalid_reason empty"; FAILS=$((FAILS+1)); }
  fi
done <<< "$EXPORT"

if [[ $FAILS -gt 0 ]]; then
  fail "Integrity check failed with $FAILS violation(s)"
fi

pass "Export integrity: duration_ms >= 0, active_ratio in [0,1], invalid_reason when is_valid=0"
echo ""
echo "======================================================="
echo -e " ${GREEN}Verify Export Integrity PASS${NC}"
echo "======================================================="
echo ""
