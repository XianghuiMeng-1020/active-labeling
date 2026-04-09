# 30 用户模拟 + 后端与 Admin 监控

## 1. 前置条件

- 本机可访问生产 API：`https://sentence-labeling-api.xmeng19.workers.dev`
- 已配置 Admin Token（与 Cloudflare Worker Secrets 中一致）

## 2. 一键运行（推荐）

```bash
# 设置 Admin Token 后执行
export ADMIN_TOKEN=你的AdminToken
./scripts/run_30users_and_monitor.sh
```

或直接传参：

```bash
./scripts/run_30users_and_monitor.sh 你的AdminToken
```

脚本会依次：

1. **后端健康检查**：`GET /api/health`
2. **模拟 30 用户**：`node scripts/e2e_20users.mjs <API> <ADMIN_TOKEN> 30`  
   - 每用户：start → manual 15 句 + 3 次 ranking → LLM accept 15 句 → 校验 status / viz
   - 并发执行，遇 429 会退避重试
3. **Admin 侧检查**：`GET /api/admin/sessions`、`GET /api/admin/stats/overall`

## 3. 仅跑 30 用户（不跑监控脚本）

```bash
node scripts/e2e_20users.mjs https://sentence-labeling-api.xmeng19.workers.dev YOUR_ADMIN_TOKEN 30
```

脚本内已包含：

- 30 用户完整流程（session start → manual → ranking → LLM accept）
- 结束后用 Admin Token 拉取 sessions、stats/overall、viz，并做断言（session 数、manual/llm 标签总数、抽查 5 个 session 的 done 数）

## 4. 手动监控后端

```bash
API="https://sentence-labeling-api.xmeng19.workers.dev"

# 健康
curl -s "$API/api/health"

# 公开统计（可视化用）
curl -s "$API/api/stats/visualization" | head -c 300
```

## 5. 手动监控 Admin

```bash
API="https://sentence-labeling-api.xmeng19.workers.dev"
TOKEN="你的AdminToken"

# 会话列表
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/admin/sessions"

# 整体统计
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/admin/stats/overall"

# 行为统计（若有）
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/admin/behavior"
```

## 6. 主动学习「只选一篇」校验

- 新 session 在 **active** 阶段的 assignment 应只来自**一篇**文章（信息量最高的那篇）。
- 校验方式：  
  - 用 Admin 或 DB 查看某 session 的 `assignments`（`phase='active'`, `task='manual'`），  
  - 所有 `unit_id` 的 `essay0*(\d+)_sentence` 应属于同一篇（同一 essay index）。
