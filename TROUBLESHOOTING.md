# Troubleshooting Guide — Active Labeling System

---

## 1. 401 Unauthorized

### 症状
- 浏览器访问 `/admin/dashboard` 显示登录页
- API 返回 `{"error":"unauthorized"}`

### 原因与修复

**A. Admin Token 未配置**
```bash
# 检查
wrangler secret list
# 应显示 ADMIN_TOKEN

# 设置
wrangler secret put ADMIN_TOKEN
# 输入强密码后回车
```

**B. Token 输入错误**
- Admin 登录页：确保 token 粘贴时无多余空格
- API 调用：Header 格式必须是 `Authorization: Bearer YOUR_TOKEN`（注意大小写 Bearer）

**C. SSE 与 Export 鉴权（仅 Bearer，禁止 query token）**
- SSE：`/api/stream/stats` 仅接受 `Authorization: Bearer YOUR_ADMIN_TOKEN`（前端用 fetch 带 header 消费 SSE）。
- Export：`/api/admin/export?format=csv` 仅接受 `Authorization: Bearer YOUR_ADMIN_TOKEN`；前端导出按钮使用 fetch + header，不再支持 URL 中的 token。

---

## 2. 429 Too Many Requests

### 症状
- LLM 调用返回 429
- Custom prompt 显示"已达上限"

### A. Qwen API 速率限制

**原因**：Qwen DashScope 对 QPS 有限制（通常 5-10 QPS）。  
**修复**：系统已内置指数退避重试（800ms → 1600ms → 3200ms → 6400ms → 8000ms，最多 5 次）。  
全局 Qwen 限流（Durable Object）将并发控制在 1~2，避免 429 雪崩。  
若研讨会并发高：
- 减少 AL run 的 `candidate_k` 和 `sample_n`，或触发前确认预计调用量（>300 会二次确认）
- 在 Admin → 运维观测 查看 `qwen_429_total`、`retries_total`；必要时调大 DO 内 `MAX_CONCURRENT` 或等待限流排队

### B. Custom Prompt 5 次限制（预期行为）

```
错误信息：custom_attempt_limit_reached
HTTP：429
```

这是**正常的业务限制**（非 Qwen 限流），每 (session, unit, phase) 最多 5 次 custom 调用。  
用户应改用 Prompt1 或 Prompt2 继续。

**验证当前计数：**
```bash
curl "https://your-worker/api/llm/custom/count?session_id=SID&unit_id=UID&phase=normal"
# {"count":5,"max":5,"exhausted":true}
```

---

## 3. SSE 实时同步问题

### 症状
- Admin 图表不更新
- 用户提交后 Admin 端无变化

### 诊断步骤

**A. 检查 SSE 连接**
```bash
# 验证 SSE 端点响应
curl -N "https://your-worker/api/stream/stats?token=YOUR_TOKEN" --max-time 10
# 应看到 SSE 格式数据流：data: {...}
```

**B. 检查 Durable Object 配置**

`wrangler.toml` 必须包含：
```toml
[[durable_objects.bindings]]
name = "STATS_HUB"
class_name = "StatsHub"

[[migrations]]
tag = "v1"
new_classes = ["StatsHub"]
```

**C. 浏览器控制台检查**
```javascript
// 在 Admin 页面打开 DevTools → Console，查找：
// "EventSource" 连接状态
// "stats_update" 事件接收
```

**D. 冻结状态**  
Admin 点击了"冻结展示"后 SSE 事件不会更新 UI（后端仍正常工作）。  
点击"点击恢复"解除冻结。

**E. 断线重连与纠偏**  
- Admin 使用 fetch 消费 SSE（带 `Authorization: Bearer`），断线后会自动重连（2s 后重试）。
- 重连成功后立即调用 `/api/admin/stats/sync` 做**全量纠偏**，保证图表与 DB 一致。
- 若收到的 `stats_update` 中 `revision` 跳号（last+1 ≠ current），前端会强制拉取 `/api/admin/stats/sync` 再渲染。
- 验证脚本：`bash scripts/sse_resync_check.sh`

---

## 4. 统计回滚问题（数字不减少）

### 症状
- 用户撤回标注，Admin 图表数字没有减少
- 看起来像 append-only 计数

### 原因

统计查询使用 `GROUP BY` 当前状态，**不是** append-only 计数器。如果数字不减少：

**A. 确认 undo 成功**
```bash
curl -X POST "https://your-worker/api/labels/undo" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"SID","unit_id":"UID","phase":"normal"}'
# 期望：{"ok":true}
```

**B. 检查 assignment 状态**
```bash
wrangler d1 execute labeling_db --remote --command=\
  "SELECT status FROM assignments WHERE session_id='SID' AND unit_id='UID' AND phase='normal' AND task='manual'"
# undo 后应显示 status='todo'
```

**C. 广播是否触发**  
undo 路由最后调用 `broadcastStats(c.env)`，若 DO 连接异常可能广播失败。  
此时 Admin 刷新页面重新拉取数据即可看到最新值。

---

## 5. 主动学习（AL）问题

### AL run 卡在 running 状态

**原因**：Qwen API 连接超时或频繁 429。

**检查：**
```bash
# 查询状态
curl "https://your-worker/api/admin/al/status?run_id=RUN_ID" \
  -H "Authorization: Bearer TOKEN"
# {"status":"running"|"done"|"error"}

# 若 status=error，detail_json 含错误原因
```

**修复**：
- 缩小 `candidate_k`（如从 80 减到 30）
- 增大 `sample_n` 间隔（源码 `setTimeout(600ms)` 可调大）
- 重新触发 AL run（幂等，ON CONFLICT 覆盖）

### Active units 为 0

**原因**：AL run 未成功完成，或 al_scores 未写入。

**验证：**
```bash
wrangler d1 execute labeling_db --remote --command=\
  "SELECT COUNT(*) FROM al_scores"
```

若为 0：重新触发 AL run。

### Session 中 active units 为空

**原因**：Session 创建时 active_m=0，或 AL 未跑完就创建了 session。

**建议**：会前先跑 AL → 再发 QR 让用户创建 session。  
若 session 已创建：`POST /api/session/reset` 重置 → 重新 start session。

---

## 6. 其他常见问题

### Qwen 返回 UNKNOWN 标签

**原因**：
1. Prompt 格式不对，模型无法输出 JSON
2. taxonomy 标签与 Prompt 中的标签不一致

**修复**：
- 检查 Admin Config 的 taxonomy 和 prompt 是否匹配
- Prompt 中的标签名必须与 taxonomy 中的 label 字段**完全一致**（大小写敏感）
- 确保 Prompt 要求输出 `{"label": "LABEL_NAME"}`

### 用户 Page 2 gate 无法开启

**症状**：用户明明做完了 Page 1，但 Page 2 还是跳回 Page 1。

**诊断：**
```bash
curl "https://your-worker/api/session/status?session_id=SID" | jq .
# 检查 gates.can_enter_normal_llm 和 normal_manual.done/total
```

**原因**：
- `done < total`：部分 units 未标注完
- `total = 0`：session 创建时 `normal_n=0`

### 前端 build 后路由 404

Cloudflare Pages 需要配置 SPA 路由：

```
# _redirects 文件（放在 apps/web/dist/）
/* /index.html 200
```

或在 Cloudflare Pages 设置 → Functions → 404 处理设置为 index.html。

---

## 日志与诊断

```bash
# 查看 Worker 实时日志
wrangler tail --format pretty

# 运行本地冒烟测试
BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/e2e_smoke.sh

# 验证 SSE 实时同步
BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/sse_check.sh

# 检查 D1 数据
wrangler d1 execute labeling_db --remote --command="SELECT COUNT(*) FROM units"
wrangler d1 execute labeling_db --remote --command="SELECT COUNT(*) FROM sessions"
wrangler d1 execute labeling_db --remote --command="SELECT COUNT(*) FROM manual_labels"
wrangler d1 execute labeling_db --remote --command="SELECT COUNT(*) FROM al_scores"
```
