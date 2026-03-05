# 故障排查指南

本文档列出常见错误码及处理方法。

## 诊断步骤

1. **检查环境**
   - 打开任意页面，点击顶部"环境调试面板"
   - 查看 `env` 字段：`production` / `preview` / `dev`
   - 点击"检查连接"查看 Health Check 和 LLM Ping 结果

2. **查看日志**
   - 本地 dev：查看 `wrangler dev` 控制台输出
   - Production：在 Cloudflare Dashboard > Workers > Logs 查看
   - 每个 LLM 请求都有 `request_id`，用于追踪

## 常见问题

### 1. Preview 环境报错 "Preview environment does not support LLM calls"

**原因**: Preview 环境默认没有配置 secrets（HKU_API_KEY / QWEN_API_KEY）

**解决方案**:
- **方案 A（推荐）**: 只在 production 使用 LLM 功能，preview 用于 UI 测试
- **方案 B**: 为 preview 单独配置 secrets：
  ```bash
  wrangler secret put HKU_API_KEY --env preview
  wrangler secret put QWEN_API_KEY --env preview
  ```

### 2. 401/403 Unauthorized

**原因**: API Key 错误、过期或在当前环境未配置

**排查**:
1. 打开环境调试面板 → Health Check
2. 查看 `hku.key_present` 和 `qwen.key_present`
3. 如果为 `false`，说明 secrets 未设置

**解决方案**:
```bash
# 设置 Production secrets
wrangler secret put HKU_API_KEY
wrangler secret put QWEN_API_KEY
wrangler secret put ADMIN_TOKEN

# 验证
curl https://your-worker.workers.dev/api/health
```

### 3. 404 Not Found（HKU）

**原因**: `HKU_DEPLOYMENT_ID` 错误或部署不存在

**排查**:
1. Health Check 查看 `hku.deployment_id`
2. 确认该 deployment 在 HKU 平台存在

**解决方案**:
```bash
# 更新 deployment_id（通过 wrangler.toml 或环境变量）
# wrangler.toml:
[vars]
HKU_DEPLOYMENT_ID = "gpt-4.1-mini"
```

### 4. 429 Too Many Requests

**原因**: HKU 限流（约 5 req/min）

**系统行为**:
- ✅ 自动指数退避重试（1s → 2s → 4s → 8s → 16s，最多 5 次）
- ❌ **不会** fallback 到 Qwen（设计决策）
- 最终仍失败时返回 429 + 明确提示

**为什么不 fallback**:
- 429 是临时限流，不是服务不可用
- Fallback 到 Qwen 会导致结果不一致（不同模型）
- 用户应该等待/重试，而不是默默换 provider

**用户操作**:
1. 等待 1-2 分钟后重试
2. 或使用 batch 模式减少请求频率
3. 或联系管理员提高 HKU 配额

**日志示例**:
```
[LLM] abc123 hku provider=hku status=429 retry=0
[LLM] abc123 hku_rate_limit_retry provider=hku status=429 retry=1
[LLM] abc123 hku_rate_limit_retry provider=hku status=429 retry=2
[LLM] abc123 hku_rate_limit_exhausted provider=hku status=429 retry=5
```

**Admin Debug 测试**（可选）:
```bash
# 需要 ADMIN_TOKEN
curl -X POST "http://localhost:8787/api/llm/ping?debug_force_error=429" \
  -H "Authorization: Bearer dev-admin-token"
  
# 预期: 显示重试日志，最终返回 429 但不 fallback
```

### 5. 500/502/503/504（HKU 服务不可用）

**原因**: HKU 后端临时故障、维护或超时

**系统行为**:
- 自动 fallback 到 Qwen
- 返回 `provider: "qwen"`, `fallback_used: true`, `fallback_reason: "hku_5xx_503"`

**日志示例**:
```
[LLM] def456 hku_availability_error provider=hku status=503 retry=0
[LLM] def456 fallback_to_qwen provider=qwen status=attempting fallback=true reason=hku_5xx_503
[LLM] def456 qwen provider=qwen status=200
```

### 6. Timeout（网络超时）

**原因**: HKU 响应时间 > 20 秒

**系统行为**:
- 自动 fallback 到 Qwen
- `fallback_reason: "hku_timeout"`

**排查**:
- 检查网络连接
- 查看 Worker 所在区域与 HKU 之间延迟

### 7. "Fallback failed: invalid_api_key"（Qwen）

**原因**: HKU 不可用且 Qwen key 也无效

**完整错误信息**:
```json
{
  "error": "LLM call failed",
  "detail": "HKU unavailable (hku_timeout) and Qwen fallback also failed (status 401): invalid_api_key",
  "request_id": "xyz789"
}
```

**解决方案**:
1. 检查 Qwen key 是否正确：
   ```bash
   curl -X POST "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" \
     -H "Authorization: Bearer YOUR_QWEN_KEY" \
     -d '{"model":"qwen-plus","messages":[{"role":"user","content":"test"}]}'
   ```
2. 更新 QWEN_API_KEY：
   ```bash
   wrangler secret put QWEN_API_KEY
   ```

### 8. "换设备后用不了"（重点专题）

**症状**:
- 在旧设备/电脑上系统正常
- 换到新设备/手机后无法完成 LLM 标注
- 报错 `Internal Server Error` 或 `invalid_api_key`

**最可能原因**（按频率排序）:

#### 8.1 新设备访问了 Preview 环境

**判断方法**:
- 查看浏览器地址栏 URL：
  - Preview: `https://abc123-branch.your-project.pages.dev`
  - Production: `https://your-project.pages.dev`（无分支前缀）
- 或点击"环境调试面板" → 查看 `env` 字段

**解决方案**:
- 改用 Production URL（正确的域名）
- 或为 Preview 配置 secrets（见 README.md）

#### 8.2 Production Secrets 未配置

**判断方法**:
```bash
bash scripts/diagnose_prod.sh https://your-worker.workers.dev
```

输出显示 `key_present: false`

**解决方案**:
```bash
cd workers/api
wrangler secret put HKU_API_KEY
wrangler secret put QWEN_API_KEY
wrangler secret put ADMIN_TOKEN
wrangler deploy
```

#### 8.3 DNS/缓存问题

**症状**: URL 正确，但诊断显示 `connection_failed`

**解决方案**:
- 清除浏览器缓存
- 尝试无痕模式
- 检查 DNS 解析：`nslookup your-project.pages.dev`
- 等待 DNS 传播（新部署后最多 5 分钟）

#### 8.4 旧设备用的是本地 dev

**判断方法**:
- 旧设备 URL: `http://localhost:5173`
- 新设备 URL: 线上域名

**说明**:
- 这不是问题，只是环境不同
- 新设备需要访问已部署的 production URL

**快速诊断命令**:
```bash
# 本地
bash scripts/diagnose_local.sh

# 线上
bash scripts/diagnose_prod.sh https://your-project.pages.dev
```

### 9. 日志中看到 request_id 但前端无响应

**原因**: 错误被吞了或前端未正确处理错误响应

**排查**:
1. 打开浏览器 DevTools > Network
2. 找到 `/api/llm/run` 请求
3. 查看 Response Body 和 Status Code
4. 对比 request_id 与 Worker 日志

### 10. Admin Token 无效

**症状**: `/api/admin/*` 返回 401

**解决方案**:
```bash
wrangler secret put ADMIN_TOKEN

# 本地 dev：编辑 .dev.vars
ADMIN_TOKEN=your-secure-token-here
```

## 环境对比表

| 环境 | 域名特征 | Secrets | LLM 可用 |
|------|----------|---------|----------|
| dev | localhost:* | `.dev.vars` | ✅（如已配置）|
| preview | `*-xxx.pages.dev` | 需单独配置 | ⚠️（默认禁用）|
| production | `your-project.pages.dev` 或自定义域名 | wrangler secrets | ✅ |

## 最佳实践

1. **不要在 Git 提交 secrets**
   - `.dev.vars` 已在 `.gitignore`
   - 生产 secrets 只通过 `wrangler secret put` 设置

2. **Request ID 追踪**
   - 前端错误时记录 `request_id`
   - 在 Worker 日志搜索该 ID 查看完整调用链

3. **定期检查配额**
   - HKU 限流 5 req/min
   - 高频使用建议缓存或批处理

4. **监控 fallback 率**
   - 如果 Qwen fallback 频繁，说明 HKU 稳定性问题
   - 可考虑主备切换或联系 HKU 支持

## 联系支持

- Worker 日志：Cloudflare Dashboard > Workers > your-worker > Logs
- Pages 部署：Cloudflare Dashboard > Pages > your-project > Deployments
- 本项目 Issue：[GitHub Issues](your-repo-url)
