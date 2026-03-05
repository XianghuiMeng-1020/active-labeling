# 验收测试步骤

按以下步骤验证修复效果。

---

## 前置条件

- Worker 和 Web 已启动
- 本地 `.dev.vars` 已配置（即使 keys 是占位符也可以验证诊断功能）

---

## 测试 1: 健康检查端点

### 本地 dev

```bash
curl http://localhost:<worker-port>/api/health | jq
```

**预期输出**:
```json
{
  "env": "dev",
  "build": "2026-02-27-v1",
  "hku": {
    "key_present": false,
    "deployment_id": "gpt-4.1-mini",
    "api_version": "2025-01-01-preview"
  },
  "qwen": {
    "key_present": true,
    "base_url_present": true
  },
  "time": "2026-02-27T..."
}
```

✅ **验证点**:
- `env` 为 `dev`
- `hku.key_present` 和 `qwen.key_present` 根据实际配置显示
- 不泄露 key 内容

---

## 测试 2: LLM Ping 端点

### 场景 A: HKU key 无效/缺失

```bash
curl -X POST http://localhost:<worker-port>/api/llm/ping | jq
```

**预期输出**:
```json
{
  "request_id": "...",
  "provider": "none",
  "status": "auth_error",
  "latency_ms": 50,
  "fallback_used": false,
  "fallback_reason": null,
  "error_detail": "HKU auth/config error (status 401): likely missing/wrong secrets",
  "env": "dev"
}
```

✅ **验证点**:
- `provider` 为 `none`（不是 `qwen`）
- `fallback_used` 为 `false`
- `error_detail` 明确说明配置错误

### 场景 B: HKU key 有效

```bash
# 在 .dev.vars 配置真实 HKU key 后
curl -X POST http://localhost:<worker-port>/api/llm/ping | jq
```

**预期输出**:
```json
{
  "request_id": "...",
  "provider": "hku",
  "status": 200,
  "latency_ms": 1200,
  "fallback_used": false,
  "fallback_reason": null,
  "env": "dev"
}
```

✅ **验证点**:
- `provider` 为 `hku`
- `status` 为 `200`
- `fallback_used` 为 `false`

---

## 测试 3: 前端环境调试面板

### 步骤

1. 打开 http://localhost:5173/user/start
2. 点击顶部"▶ 环境调试面板"展开
3. 查看信息：
   - **当前页面**: `http://localhost:5173/user/start`
   - **API Base**: `(使用 Vite proxy)` 或实际 URL
4. 点击"检查连接"按钮
5. 等待 1-2 秒

### 预期结果

**Health Check** 区块显示：
```json
{
  "env": "dev",
  "build": "2026-02-27-v1",
  "hku": { "key_present": false, ... },
  "qwen": { "key_present": true, ... }
}
```

**LLM Ping** 区块显示：
```json
{
  "provider": "none",
  "status": "auth_error",
  "error_detail": "HKU auth/config error...",
  "env": "dev"
}
```

✅ **验证点**:
- 两个区块都正确渲染
- LLM Ping 显示红色背景（因为不可用）
- 错误信息清晰易懂

---

## 测试 4: 实际 LLM 调用（需真实 key）

### 前置：配置真实 keys

编辑 `.dev.vars`:
```bash
HKU_API_KEY=sk-xxxxxxxxxxxxxxxx
QWEN_API_KEY=sk-yyyyyyyyyyyyyyyy
```

重启 Worker。

### 步骤 A: 成功调用

```bash
# 创建 session
SESSION_ID=$(curl -s -X POST http://localhost:<port>/api/session/start \
  -H "Content-Type: application/json" \
  -d '{"normal_n":1,"active_m":1}' | jq -r .session_id)

# 获取第一个 unit
UNIT=$(curl -s "http://localhost:<port>/api/units/next?session_id=$SESSION_ID&phase=normal&task=manual" | jq -r '.unit')
UNIT_ID=$(echo $UNIT | jq -r .unit_id)

# 调用 LLM
curl -s -X POST http://localhost:<port>/api/llm/run \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\": \"$SESSION_ID\",
    \"unit_id\": \"$UNIT_ID\",
    \"phase\": \"normal\",
    \"mode\": \"prompt1\"
  }" | jq
```

**预期输出**:
```json
{
  "predicted_label": "POSITIVE",
  "raw_text": "{\"label\": \"POSITIVE\"}",
  "provider": "hku",
  "request_id": "...",
  "fallback_used": false,
  "fallback_reason": null
}
```

✅ **验证点**:
- `provider` 为 `hku`
- `predicted_label` 是有效的 taxonomy label
- `fallback_used` 为 `false`

### 步骤 B: HKU 不可用时 fallback

模拟 HKU 不可用（可以临时注释掉 HKU key 或用错误的 deployment_id）：

**预期输出**:
```json
{
  "predicted_label": "...",
  "provider": "qwen",
  "request_id": "...",
  "fallback_used": true,
  "fallback_reason": "hku_5xx_503"
}
```

✅ **验证点**:
- `provider` 为 `qwen`
- `fallback_used` 为 `true`
- `fallback_reason` 明确说明原因

---

## 测试 5: 查看 Worker 日志

在 Worker 控制台查看日志输出：

```
[LLM] abc-123 hku provider=hku status=200 retry=0
[LLM] abc-123 hku_success provider=hku status=200 retry=0
```

或错误情况：

```
[LLM] def-456 hku provider=hku status=401 retry=0
[LLM] def-456 hku_config_error provider=hku status=401 retry=0
```

✅ **验证点**:
- 每个请求有唯一 request_id
- 记录了 provider、status、retry
- 不泄露 API keys 或完整 prompt

---

## 测试 6: Preview 环境行为（可选）

如果已部署到 Cloudflare Pages：

### 访问 Preview 环境

```bash
# Preview URL 示例：https://abc123.your-project.pages.dev
curl https://abc123.your-project.pages.dev/api/health | jq
```

**预期输出**:
```json
{
  "env": "preview",
  "hku": { "key_present": false },
  "qwen": { "key_present": false }
}
```

### 尝试调用 LLM

```bash
curl -X POST https://abc123.your-project.pages.dev/api/llm/ping | jq
```

**预期输出**:
```json
{
  "request_id": "...",
  "provider": "none",
  "status": 503,
  "fallback_used": false,
  "fallback_reason": "Preview environment does not support LLM calls...",
  "env": "preview"
}
```

✅ **验证点**:
- `env` 为 `preview`
- 明确提示 preview 不支持 LLM
- 没有尝试调用 HKU 或 Qwen

---

## 测试 7: Production 环境（最终验收）

### 前置：配置 Production Secrets

```bash
cd workers/api

wrangler secret put HKU_API_KEY
# 输入真实 HKU key

wrangler secret put QWEN_API_KEY
# 输入真实 Qwen key

wrangler secret put ADMIN_TOKEN
# 输入管理员 token
```

### 部署

```bash
wrangler deploy --config ../../wrangler.toml
```

### 验证

```bash
# Production URL
curl https://your-worker.workers.dev/api/health | jq
```

**预期输出**:
```json
{
  "env": "production",
  "hku": { "key_present": true },
  "qwen": { "key_present": true }
}
```

```bash
curl -X POST https://your-worker.workers.dev/api/llm/ping | jq
```

**预期输出**:
```json
{
  "provider": "hku",
  "status": 200,
  "fallback_used": false,
  "env": "production"
}
```

✅ **验证点**:
- `env` 为 `production`
- `hku.key_present` 和 `qwen.key_present` 都为 `true`
- LLM Ping 成功（`provider: "hku"`, `status: 200`）

---

## 故障排查

如果任何测试失败，参考：

1. **`TROUBLESHOOTING.md`** - 常见问题及解决方案
2. **Worker 日志** - `wrangler tail` 或 Cloudflare Dashboard > Workers > Logs
3. **前端环境调试面板** - 查看 Health Check 和 LLM Ping 详情

---

## 验收标准总结

| 测试项 | 状态 |
|--------|------|
| `/api/health` 返回正确的 `env` 和 `key_present` | ✅ |
| `/api/llm/ping` 在 HKU 401 时不 fallback | ✅ |
| 前端环境调试面板可展开并调用诊断端点 | ✅ |
| HKU key 有效时 LLM 调用成功 | ⏸️（需真实 key）|
| HKU 不可用时正确 fallback 到 Qwen | ⏸️（需真实 key）|
| Preview 环境禁用 LLM 并返回 503 | ⏸️（需部署）|
| Production 环境配置 secrets 后 LLM 可用 | ⏸️（需部署）|

**当前状态**: 诊断功能已验证 ✅，LLM 实际调用需真实 keys 验证。
