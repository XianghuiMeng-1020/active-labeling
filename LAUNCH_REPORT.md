# 上线执行汇报（30 人同时访问 + 行为记录）

执行时间：按「全部完成然后汇报」所完成的自动化步骤与需你手动完成的事项汇总。

---

## 一、已自动完成项

### 1. D1 远程迁移

- **命令**：`wrangler d1 migrations apply labeling_db --remote`
- **结果**：已执行，输出为 **No migrations to apply**，表示生产 D1 已是最新 schema，表结构完整（sessions、label_attempts、interaction_events 等均存在）。

### 2. 前端生产构建

- **操作**：在 `apps/web` 下使用 `VITE_API_BASE=https://sentence-labeling-api.xmeng19.workers.dev` 执行 `npm run build`。
- **结果**：构建成功，产物在 **`apps/web/dist/`**，已包含生产 API 地址，可直接用于 Pages 上传或后续 CI 部署。
- **顺带修复**：修复了 `AdminDashboardNormalPage.tsx` 的 TypeScript 报错（未使用变量、`overallStats` 的 `breakdown` 类型与 API 返回一致化），保证构建通过。

### 3. 文档与脚本准备

- **`docs/LAUNCH_30_USERS.md`**：30 人上线差距清单（必做项、验证步骤、可选压测）。
- **`docs/PAGES_DEPLOY.md`**：Cloudflare Pages 部署步骤（创建项目、环境变量、本地上传 dist、wrangler 部署命令）。

---

## 二、需你在 Cloudflare / 本机手动完成项

以下无法由脚本代你完成，需要你在 Dashboard 或本机执行一次。

### 1. 生产环境 Secrets（若尚未配置）

在 **workers/api** 目录下执行（按提示输入真实值）：

```bash
cd workers/api
npx wrangler secret put QWEN_API_KEY   # 阿里云 DashScope API Key
npx wrangler secret put QWEN_BASE_URL  # 如 https://dashscope.aliyuncs.com/compatible-mode/v1
npx wrangler secret put ADMIN_TOKEN    # 管理端 /admin 及 API 鉴权用，请自设强密码
```

验证：访问 `https://sentence-labeling-api.xmeng19.workers.dev/api/health`，确认返回中 `qwen.key_present: true`。

### 2. 创建 Cloudflare Pages 项目并部署前端

- 在 **Cloudflare Dashboard** → **Workers & Pages** → **Create** → **Pages** → 选 **Upload assets**，创建项目（例如名称：`sentence-labeling-web`）。
- 在项目 **Settings → Environment variables** 中添加：  
  `VITE_API_BASE` = `https://sentence-labeling-api.xmeng19.workers.dev`（Production）。
- 在 **Deployments** 中 **Create deployment**，上传本地 **`apps/web/dist/`** 目录下的全部文件（或使用 `docs/PAGES_DEPLOY.md` 中的 wrangler 命令上传）。
- 部署完成后得到前端链接：`https://<项目名>.pages.dev`，该链接即可发给 30 人使用。

详细步骤见 **`docs/PAGES_DEPLOY.md`**。

### 3. 导入 Units（标注题目）

生产环境需有足够题目，建议至少约 100+ 条。在**项目根目录**执行（将 `你的ADMIN_TOKEN` 替换为上面设置的 `ADMIN_TOKEN`）：

```bash
node scripts/seed-units.mjs data/ai_literacy_sentence_units.jsonl https://sentence-labeling-api.xmeng19.workers.dev 你的ADMIN_TOKEN
```

如需少量测试数据，可改用：

```bash
node scripts/seed-units.mjs data/seed_units.jsonl https://sentence-labeling-api.xmeng19.workers.dev 你的ADMIN_TOKEN
```

导入后可通过 Admin 单元管理或 API 确认 units 数量。

### 4. （可选）再次部署 Worker

若你修改过 `wrangler.toml` 或代码，可重新部署 Worker：

```bash
cd workers/api
npx wrangler deploy --config ../../wrangler.toml
```

当前配置已包含 `QWEN_MAX_CONCURRENT = "6"`，适合约 30 人同时使用 LLM 阶段。

---

## 三、现场验证建议

1. **健康检查**：  
   `https://sentence-labeling-api.xmeng19.workers.dev/api/health` 返回 200，且 `qwen.key_present: true`。
2. **前端**：用浏览器打开你的 Pages 链接，进入 `/user/start`，能正常创建会话并看到题目。
3. **管理端**：打开 `/admin`，用 `ADMIN_TOKEN` 登录，能看到统计与会话列表。
4. **行为记录**：完成几条标注后，在 Admin 导出或查库，确认 `label_attempts` / `interaction_events` 有新数据。

---

## 四、总结

| 项目 | 状态 |
|------|------|
| D1 远程迁移 | ✅ 已执行，无需再跑 |
| 前端生产构建 | ✅ 已完成，`apps/web/dist/` 可直接用于部署 |
| Pages 项目创建与上传 | ⏳ 需你在 Dashboard 创建项目并上传 dist 或按 PAGES_DEPLOY 用 wrangler 部署 |
| Worker Secrets | ⏳ 需你本机执行 `wrangler secret put` 并填入真实值 |
| Units 导入 | ⏳ 需你执行上述 `node scripts/seed-units.mjs ...` 并填入你的 ADMIN_TOKEN |

完成「Secrets + Pages 部署 + Units 导入」后，即可把 **前端 Pages 链接** 发给 30 人同时访问，后端会为每人维护会话并记录行为到 D1。
