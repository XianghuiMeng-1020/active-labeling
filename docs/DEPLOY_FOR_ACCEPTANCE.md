# 客户验收：推送与部署说明

## 当前状态（截至撰写时）

- **Git**：所有客户反馈相关改动均在**本地**，尚未提交、尚未推送到远程。
- **远程仓库**：`origin` = `https://github.com/XianghuiMeng-1020/active-labeling.git`，当前与 `origin/main` 一致的是旧提交（不含本次 9 条需求修改）。

因此：**客户若打开现有线上链接，看到的仍是旧版本，无法验收新功能。**

---

## 一、把改动推到仓库（必须做）

在项目根目录执行：

```bash
# 1. 添加所有修改及新增文档
git add apps/web/src workers/api/src docs/CUSTOMER_FEEDBACK_RESPONSE.md docs/DEPLOY_FOR_ACCEPTANCE.md

# 2. 提交
git commit -m "feat: address 9 customer feedback items (ranking, LLM flow, charts, AL UI, difficulty labels, reopen essay)"

# 3. 推送到 GitHub
git push origin main
```

执行后，最新代码会出现在 GitHub 的 `main` 分支。**仅 push 不会改变线上环境**，客户打开的链接不会变，需再部署。

---

## 二、客户验收用哪个链接？

客户验收的是**已经用最新代码部署好的前端地址**，即你们当前使用的 **Cloudflare Pages 生产环境 URL**。

根据项目文档，一般为以下之一（以你们实际在 Cloudflare 创建的为准）：

| 类型 | 示例 | 说明 |
|------|------|------|
| **Pages 生产** | `https://sentence-labeling.pages.dev` 或 `https://<项目名>.pages.dev` | 无分支前缀，即「客户打开验收」的链接 |
| **Pages 预览** | `https://<commit-hash>-<项目名>.pages.dev` | 某次部署的预览，也可用于验收 |

- 若之前按 `docs/PAGES_DEPLOY.md` 或 `docs/LAUNCH_30_USERS.md` 部署过，**客户验收链接**就是当时配置的 Pages 主域名（例如 `https://sentence-labeling-web.pages.dev`，以 Dashboard 为准）。
- 前端会请求的 API 为 `VITE_API_BASE` 指向的 Worker 地址（如 `https://sentence-labeling-api.xmeng19.workers.dev`），部署时需保证该变量指向正确的生产 API。

**总结：客户打开你们发给他们的那个「用户端入口」链接即可验收；该链接必须在下面步骤中用最新代码重新部署后，才会包含本次 9 条需求。**

---

## 三、用最新代码部署，让客户能验收到新功能

push 完成后，需要**重新部署前端 + 后端**，客户打开的链接才会是新版本。

### 1. 部署后端（Worker，含新接口 `/api/ranking/reopen`）

在项目**根目录**（含 `wrangler.toml` 的目录）执行：

```bash
cd workers/api && npm run deploy
```

或（若 deploy 脚本指向根目录 wrangler）：

```bash
cd workers/api && npx wrangler deploy --config ../../wrangler.toml
```

### 2. 部署前端（Pages）

在 `apps/web` 下，用你们**生产环境**的 API 地址构建并部署：

```bash
cd apps/web
VITE_API_BASE=https://sentence-labeling-api.xmeng19.workers.dev npm run build
npx wrangler pages deploy dist --project-name=sentence-labeling-web
```

（若 Pages 项目名或 API 地址不同，请替换 `VITE_API_BASE` 和 `--project-name`。）

部署完成后，Cloudflare 会给出本次部署的 URL（生产或预览）。**把生产环境的主 URL 发给客户，即客户用于验收的链接。**

### 3. 可选：验证线上是否为新版本

- 打开客户验收链接，例如：`https://<你们的-pages-域名>.pages.dev/user/start`
- 按 `docs/` 中的验收项自测一遍（难度排序黑色字、拖拽文案、返回编辑本篇、LLM 尝试次数与 Try Prompt 2、图表轴标签、主动学习样式、Easy/Medium/Hard 等）。
- 或运行（若存在）：  
  `bash scripts/diagnose_prod.sh https://<你们的-pages-域名>.pages.dev`

---

## 四、简短回复给客户/内部

可直接使用或改写下面这段话：

- **「目前 9 条需求都已实现，代码已推送到 GitHub。我们已用最新代码重新部署了前端和后端，请您使用之前发给您的 [用户入口链接] 进行验收。若您没有保存链接，请告知，我们重新发您当前的生产环境地址。」**

若客户问「验收链接是什么」：就是你们部署后**发给用户用的那个 Pages 主链接**（例如 `https://xxx.pages.dev`），不是 GitHub 仓库链接；仓库链接只能看代码，不能直接体验功能。
