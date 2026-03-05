#!/bin/bash
# 清空现有 units，导入 3 篇 × 5 句 = 15 条 sentence-level essay 数据
set -e
API_BASE="${1:-http://127.0.0.1:8787}"
ADMIN_TOKEN="${2:-dev-admin-token}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_FILE="$PROJECT_ROOT/data/essays_3x5.jsonl"

echo "API: $API_BASE"
echo "1. 清空 units..."
curl -s -X POST "$API_BASE/api/admin/units/clear" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json"

echo ""
echo "2. 导入 3×5 = 15 条 essay sentence 数据..."
node "$SCRIPT_DIR/seed-units.mjs" "$DATA_FILE" "$API_BASE" "$ADMIN_TOKEN"

echo ""
echo "3. 设置 normal_n=15, active_m=15..."
curl -s -X POST "$API_BASE/api/admin/config/session" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"normal_n": 15, "active_m": 15}'

echo ""
echo "完成! 打开 http://localhost:5173/welcome 开始标注"
echo "配置: 3 essays × 5 sentences = 15 units, normal_n=15, active_m=15"
