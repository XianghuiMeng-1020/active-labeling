# 质量与 30 人并发验证说明

## 1. Bug 与稳定性（Bug-free & Stability）

### 已做检查与修正
- **U4 主动学习结果**：进入 U4 时自动调用 `POST /api/active/llm/ensure` 按需生成缺失的 LLM 结果，并轮询最多约 2 分钟，避免“等两分钟无结果”。
- **同意条款**：未勾选同意也可点击「开始标注」，方便体验；同意文案仍保留供伦理/合规记录。
- **网络与重试**：`startSession` 在遇到 `NETWORK_ERROR` 或 `REQUEST_TIMEOUT` 时自动重试一次，减少偶发网络报错。
- **限流与 30 人**：API 限流已按约 30 人同时使用调高：
  - `session_start`: 45/分钟
  - `labels` / `llm_accept`: 各 420/分钟
  - `llm_run`: 120/分钟
  - `read`（含 session/status、units/next、active/llm/results 等）: 500/分钟
  - `active/llm/ensure`: 12/分钟/IP
- **前端**：错误/成功提示框（`.error-box` / `.success-box`）对比度与字重已加强，信息更清晰。

### 建议上线前自测
- 在**生产/预发**跑一遍 E2E：  
  `BASE_URL=<前端地址> npx playwright test tests/production_full_e2e.spec.ts`
- 使用 `scripts/e2e_20users.mjs` 或 `scripts/multi-user-stress-test.mjs` 做多用户压测（可调至 30 用户）。
- 确认环境变量：前端 `VITE_API_BASE` 指向正确 API；后端 `QWEN_MAX_CONCURRENT` 视 Qwen 配额设置（默认 2，队列串行，质量稳定）。

---

## 2. 30 用户同时使用（High quality output）

- **输出质量**：标注结果由 D1 持久化；LLM 调用经 Qwen 限流（Durable Object）控制并发，避免超限导致失败或降质。
- **稳定性**：限流按 30 人设计；`startSession` 重试、U4 ensure + 轮询 可提高成功率与结果完整性。
- **可扩展**：若实际并发 >30，可再调高 `workers/api/src/index.ts` 中各 `limit`，并视 Qwen 配额调整 `QWEN_MAX_CONCURRENT`。

---

## 3. 前端是否美化、清晰（Clear & High quality UI）

- **设计**：`index.css` 采用渐变玻璃风（Indigo → Blue → Cyan）、毛玻璃卡片、统一圆角与阴影、移动优先布局。
- **结构**：页面有 hero banner、进度环、分段控制、标签网格、Toast、骨架屏、错误/成功框等，层次清晰。
- **可读性**：错误/成功框已加强对比度与字重；多语言（含简体/繁体中文）与无障碍（tap、focus）已考虑。
- **动效**：页面入场、卡片入场、Toast、骨架屏 shimmer 等有适度动效，不干扰操作。

若需进一步“美化”，可在不改变逻辑前提下：微调 `--grad-hero` / `--color-primary`、加大卡片圆角或间距、或为关键按钮增加轻微 hover 动效。
