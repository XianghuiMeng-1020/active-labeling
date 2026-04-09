#!/usr/bin/env bash
# 模拟 30 用户 + 监控后端与 Admin
# 在能访问生产 API 的机器上执行，需传入 ADMIN_TOKEN（Cloudflare Secrets 中配置的 Admin Token）
#
# 用法:
#   ADMIN_TOKEN=你的AdminToken ./scripts/run_30users_and_monitor.sh
#  或
#   ./scripts/run_30users_and_monitor.sh 你的AdminToken

set -e
API_BASE="${API_BASE:-https://sentence-labeling-api.xmeng19.workers.dev}"
ADMIN_TOKEN="${ADMIN_TOKEN:-$1}"
NUM_USERS="${NUM_USERS:-30}"

if [ -z "$ADMIN_TOKEN" ]; then
  echo "请设置 ADMIN_TOKEN 或传入参数: ./scripts/run_30users_and_monitor.sh YOUR_ADMIN_TOKEN"
  exit 1
fi

echo "=============================================="
echo "  后端健康检查"
echo "=============================================="
curl -s "${API_BASE}/api/health" | head -3
echo ""

echo "=============================================="
echo "  模拟 ${NUM_USERS} 用户（并发）"
echo "=============================================="
node scripts/e2e_20users.mjs "$API_BASE" "$ADMIN_TOKEN" "$NUM_USERS" || true

echo ""
echo "=============================================="
echo "  Admin 侧检查（sessions / stats）"
echo "=============================================="
echo "Sessions:"
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "${API_BASE}/api/admin/sessions" | head -c 500
echo ""
echo "Stats overall:"
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "${API_BASE}/api/admin/stats/overall" | head -c 500
echo ""
