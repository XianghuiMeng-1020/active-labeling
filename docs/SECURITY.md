# 安全说明

## Key 管理原则

- 前端不持有任何 HKU / Qwen key。
- `HKU_API_KEY`、`QWEN_API_KEY`、`ADMIN_TOKEN` 仅存在于 Worker 环境变量。
- 所有 LLM 调用都由 Worker 发起，用户只调用业务 API。

## Admin 鉴权

- 所有 `/api/admin/*` 端点强制 `Authorization: Bearer <ADMIN_TOKEN>`。
- `ADMIN_TOKEN` 仅在管理员登录页输入并存于浏览器本地（开发最小方案）。
- 生产建议：
  - 用 Cloudflare Access / Zero Trust 保护 Admin 页面
  - 把 token 改为短期 JWT + 刷新机制

## Share 链接

- Share 只读端点使用 `share_token`。
- `share_token` 仅可访问统计接口，不可触发管理操作。

## 交互质量

- `label_attempts.is_valid` 由服务端二次判定，不盲信前端。
- 规则包含最小有效时长、时间顺序检查、后台停留比例检查。

## 生产建议

- 将所有 secrets 放入 Cloudflare Secrets，不写入 Git。
- 对 `/api/llm/run` 与 `/api/admin/al/run` 增加 rate-limit。
- 建议为审计开启 Worker Logpush，并限制原始 LLM 输出中敏感文本存储策略。
