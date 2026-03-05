# 30 人同时访问 + 行为记录 — 上线差距清单

目标：给出一个 Cloudflare 链接，后端配置完毕，**30 人可同时访问并记录其行为（movement）**。

---

## 一、已具备的能力（无需改代码）

| 能力 | 状态 |
|------|------|
| **会话与分配** | 每人 `/api/session/start` 独立 session，assignments 按 session 隔离 |
| **行为记录** | 每次提交写入 `label_attempts`（active_ms、hidden_ms、idle_ms、had_background、is_valid）及 `interaction_events` |
| **并发承载** | Worker + D1 + DO 无单机连接数上限，30 人并发请求可水平扩展 |
| **LLM 限流** | QwenRateLimiter DO 控制并发，避免 DashScope 429；已支持 `QWEN_MAX_CONCURRENT` 配置（建议 5–10） |

---

## 二、上线前必做（差距）

### 1. 前端可访问链接（Cloudflare Pages）

- **现状**：后端 API 已部署在 `https://sentence-labeling-api.xmeng19.workers.dev`，用户还需要一个**前端页面链接**。
- **操作**：
  1. 将前端部署到 **Cloudflare Pages**（Git 连接或 `npm run build` 后上传 `dist/`）。
  2. 在 Pages 项目 **Settings → Environment variables** 中增加：
     - `VITE_API_BASE` = `https://sentence-labeling-api.xmeng19.workers.dev`
  3. 用 **Production 环境** 重新构建并部署。
- **结果**：得到可分享的前端链接，例如 `https://<your-project>.pages.dev`，用户访问该链接即可使用并连接当前 Worker。

### 2. 生产 D1 迁移

- **现状**：本地或其它环境可能已跑过迁移，生产 D1 需确认已应用。
- **操作**（在项目根目录执行）：
  ```bash
  wrangler d1 migrations apply labeling_db --remote
  ```
- **结果**：生产 D1 拥有全部表（sessions、label_attempts、interaction_events 等），能正确写入/查询。

### 3. 生产环境 Secrets

- **现状**：Worker 需要 Qwen 与 Admin 鉴权。
- **操作**：
  ```bash
  cd workers/api
  wrangler secret put QWEN_API_KEY    # 阿里云 DashScope
  wrangler secret put QWEN_BASE_URL   # 如 https://dashscope.aliyuncs.com/compatible-mode/v1
  wrangler secret put ADMIN_TOKEN     # 管理端 /admin 与 API 调用用
  ```
- **结果**：`/api/health` 中 `qwen.key_present` 为 true，Admin 可正常登录与调用。

### 4. 标注数据（units）与可选 taxonomy/prompts

- **现状**：每人会话会从 `units` 表随机分配 `normal_n` + `active_m` 条；若表为空，无法拉取题目。
- **操作**：
  - 通过 **Admin 界面**：登录 `/admin` → 单元管理 → 导入 JSONL/批量 units。
  - 或调用 API：`POST /api/admin/units/import`，body：`{ "units": [ { "unit_id": "...", "text": "..." }, ... ] }`。
  - 建议 **units 数量**：30 人 × 每人约 10–20 条（normal + active），建议至少 **100+ 条**，避免重复过多。
  - 若未跑过 seed：迁移 `0002_seed_defaults.sql` 已包含默认 taxonomy 与 prompts；也可在 Admin 中覆盖。
- **结果**：用户进入 `/user/start` 后能正常拿到题目并提交，行为写入 `label_attempts` / `interaction_events`。

### 5. （可选）30 人下的 Qwen 并发

- **现状**：已通过 `wrangler.toml` 的 `vars.QWEN_MAX_CONCURRENT` 控制 DO 内最大并发（当前示例为 `6`）。
- **操作**：若 30 人同时用 LLM 阶段仍遇排队久或 429，可在 `wrangler.toml` 中调大（如 `8` 或 `10`），然后重新部署 Worker。注意过大会增加 DashScope 限流风险。
- **结果**：在保证不 429 的前提下，尽量缩短 LLM 排队时间。

---

## 三、现场验证建议

1. **健康检查**  
   - `GET https://sentence-labeling-api.xmeng19.workers.dev/api/health` 返回 200，且 `qwen.key_present: true`。

2. **用户端**  
   - 用 2–3 台设备或浏览器同时打开前端链接，各开一个 session，完成至少 1 条标注；确认无 5xx、请求超时。

3. **管理端**  
   - 打开 `/admin`，用 `ADMIN_TOKEN` 鉴权，查看统计与列表；确认 session 数、attempt 数、实时统计/SSE 正常。

4. **行为是否写入**  
   - Admin 导出或查库：`label_attempts`、`interaction_events` 有新记录，且包含时间、active_ms 等字段。

5. **（可选）压测**  
   - 使用仓库内 `scripts/load_test_local.sh`，将 `BASE` 指向生产 API、`CONCURRENCY=30`，观察成功率与延迟：
     ```bash
     CONCURRENCY=30 BASE=https://sentence-labeling-api.xmeng19.workers.dev ADMIN_TOKEN=你的token bash scripts/load_test_local.sh
     ```

---

## 四、总结：还差什么才能“给链接、30 人同时访问并记录”

| # | 项目 | 状态 | 说明 |
|---|------|------|------|
| 1 | 前端 Pages 链接 | 待完成 | 部署前端并配置 `VITE_API_BASE`，得到可分享的 Pages 链接 |
| 2 | D1 远程迁移 | 待确认 | 执行一次 `wrangler d1 migrations apply labeling_db --remote` |
| 3 | Worker Secrets | 待确认 | 设置 QWEN_* 与 ADMIN_TOKEN |
| 4 | Units 数据 | 待完成 | 导入至少约 100+ 条 units（及可选 taxonomy/prompts） |
| 5 | 30 人并发 / 记录 | 已支持 | 后端已支持并发与完整行为记录；可按需调大 `QWEN_MAX_CONCURRENT` |

完成 1–4 后，即可把 **前端 Pages 链接** 发给 30 人同时使用，后端会正常记录每个人的 session 与 movement（label_attempts + interaction_events）。
