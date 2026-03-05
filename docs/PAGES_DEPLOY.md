# Cloudflare Pages 前端部署步骤

## 1. 在 Cloudflare Dashboard 创建 Pages 项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages**。
2. 选择 **Upload assets**（直接上传构建产物）。
3. 项目名称建议：`sentence-labeling-web`（或任意名称，记住用于下面命令）。
4. 创建后先跳过上传，进入项目 **Settings**。

## 2. 配置环境变量（构建时注入 API 地址）

在 **Settings → Environment variables** 中新增：

| 变量名 | 值 | 环境 |
|--------|-----|------|
| `VITE_API_BASE` | `https://sentence-labeling-api.xmeng19.workers.dev` | Production（及 Preview 如需要） |

**注意**：若使用 **Git 连接** 自动构建，该变量会在每次 build 时注入；若使用 **直接上传**，需在本地构建时已设置该变量（见下），再上传 `dist/`。

## 3. 本地构建并上传（当前推荐）

已在本地用生产 API 地址构建好：

```bash
cd apps/web
VITE_API_BASE=https://sentence-labeling-api.xmeng19.workers.dev npm run build
```

构建产物在 `apps/web/dist/`。在 Pages 项目 **Deployments** 页点击 **Create deployment** → 上传 `dist` 目录下**全部内容**（或拖拽整个 `dist` 文件夹）。

## 4. 使用 Wrangler 上传（需先创建好 Pages 项目）

若已在 Dashboard 创建了项目（例如名为 `sentence-labeling-web`），可在项目根目录执行：

```bash
cd apps/web
npx wrangler pages deploy dist --project-name=sentence-labeling-web
```

若项目名不同，将 `sentence-labeling-web` 改为你的项目名。

## 5. 得到前端链接

部署完成后，前端地址为：

- `https://<你的项目名>.pages.dev`

将此链接发给 30 人即可同时访问，前端会请求 `https://sentence-labeling-api.xmeng19.workers.dev` 作为 API。
