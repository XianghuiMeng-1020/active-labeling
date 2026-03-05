#!/bin/bash
# 清空现有 units，导入 6 条 sentence-level AI literacy 样本用于标注测试
set -e
API_BASE="${1:-http://127.0.0.1:8787}"
ADMIN_TOKEN="${2:-dev-admin-token}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_FILE="$PROJECT_ROOT/data/ai_literacy_6.jsonl"

echo "API: $API_BASE"
echo "1. 清空 units..."
curl -s -X POST "$API_BASE/api/admin/units/clear" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json"

echo ""
echo "2. 导入 6 条 sentence-level AI literacy 数据..."
node "$SCRIPT_DIR/seed-units.mjs" "$DATA_FILE" "$API_BASE" "$ADMIN_TOKEN"

echo ""
echo "完成! 打开 http://localhost:5173/user/start 开始标注"
echo "建议: normal_n=6, active_m=0 (只标注 6 条句子)"
