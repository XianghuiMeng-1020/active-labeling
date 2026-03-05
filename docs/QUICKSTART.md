# 最短操作序列

本文档提供从零到可用的最短命令序列。

---

## 本地开发：从 Git Clone 到 Ping=200

### 前置条件
- 已安装 Node.js 18+
- 已有真实的 HKU API key 和 Qwen API key

### 命令序列（复制粘贴）

```bash
# 1. Clone（如果需要）
# git clone <repo-url>
cd "active labeling"

# 2. 安装依赖
cd workers/api && npm install && cd ../..
cd apps/web && npm install && cd ../..

# 3. 配置环境变量
cp workers/api/.dev.vars.example .dev.vars

# 📝 编辑 .dev.vars 填入真实 keys：
#    HKU_API_KEY=sk-your-real-hku-key
#    QWEN_API_KEY=sk-your-real-qwen-key
#    ADMIN_TOKEN=your-secure-admin-token

# 4. 初始化数据库
cd workers/api && npm run d1:migrate:local && cd ../..

# 5. 检查环境
bash scripts/dev_setup.sh

# 6. 启动服务（需两个终端）
# 终端 1:
cd workers/api && npm run dev

# 终端 2（另开一个终端）:
cd apps/web && npm run dev

# 7. 导入数据（在第三个终端）
node scripts/seed-units.mjs data/seed_units.jsonl http://127.0.0.1:8787 dev-admin-token

# 8. 诊断验证
bash scripts/diagnose_local.sh
# 预期输出: 🎉 SUCCESS: Local environment ready for LLM calls

# 9. 浏览器验收
# 打开 http://localhost:5173/user/start
# 点击"环境调试面板" → "检查连接"
# 验证 provider=hku, status=200
```

### 预期时长
- **有 keys**: 3-5 分钟
- **需要获取 keys**: +10 分钟（去 HKU/Qwen 平台申请）

---

## 生产部署：从配置 Secrets 到新设备成功

### 前置条件
- 已有 Cloudflare 账号
- 已完成本地开发验证
- 已有真实的 API keys

### 命令序列（复制粘贴）

```bash
cd workers/api

# 1. 创建 D1 数据库（只需一次）
wrangler d1 create labeling_db
# 复制输出的 database_id 并更新 wrangler.toml

# 2. 执行远程迁移
npm run d1:migrate:remote

# 3. 配置 Production Secrets（只需一次）
wrangler secret put HKU_API_KEY
# 输入你的 HKU key，按回车

wrangler secret put HKU_DEPLOYMENT_ID
# 输入: gpt-4.1-mini

wrangler secret put QWEN_API_KEY
# 输入你的 Qwen key

wrangler secret put QWEN_BASE_URL
# 输入: https://dashscope.aliyuncs.com/compatible-mode/v1

wrangler secret put ADMIN_TOKEN
# 输入一个强 token（如: openssl rand -hex 32）

# 4. 部署 Worker
npm run deploy
# 记录输出的 Worker URL，例如:
# https://sentence-labeling-api.your-subdomain.workers.dev

# 5. 诊断验证 Worker
cd ../..
bash scripts/diagnose_prod.sh https://sentence-labeling-api.your-subdomain.workers.dev
# 预期输出: 🎉 SUCCESS: Production environment ready

# 6. 导入生产数据
node scripts/seed-units.mjs data/seed_units.jsonl \
  https://sentence-labeling-api.your-subdomain.workers.dev \
  <your-admin-token>

# 7. 部署 Pages（通过 Dashboard）
# 或使用 CLI:
cd apps/web
echo "VITE_API_BASE=https://sentence-labeling-api.your-subdomain.workers.dev" > .env.production
npm run build
npx wrangler pages deploy dist --project-name sentence-labeling

# 8. 新设备验收（任何设备/手机）
# 打开: https://sentence-labeling.pages.dev/user/start
# 点击"环境调试面板" → "检查连接"
# 验证: env=production, provider=hku, status=200
# 创建 session → 完成 U1 → U2 → U3
```

### 预期时长
- 首次部署：10-15 分钟（含创建数据库）
- 更新部署：2-3 分钟（只需 `npm run deploy`）

---

## 故障排查快速入口

| 症状 | 命令 |
|------|------|
| 本地不知道配置对不对 | `bash scripts/dev_setup.sh` |
| 本地 LLM 调用失败 | `bash scripts/diagnose_local.sh` |
| 线上新设备打不开 | `bash scripts/diagnose_prod.sh <URL>` |
| 不确定哪里出错 | 打开页面 → 环境调试面板 → 检查连接 |
| 看到 401/403 | 参考 `TROUBLESHOOTING.md` 问题 #2/#3 |
| 看到 429 | 参考 `TROUBLESHOOTING.md` 问题 #4 |
| Fallback 频繁 | 检查 Worker 日志，搜索 `fallback_to_qwen` |

---

## 验收 Checklist

### 本地 Dev

- [ ] `bash scripts/dev_setup.sh` 显示 "🎉 Environment ready!"
- [ ] `bash scripts/diagnose_local.sh` 显示 "🎉 SUCCESS"
- [ ] `bash scripts/e2e_smoke.sh` 显示 "🎉 E2E Smoke Test PASSED"
- [ ] 浏览器打开 localhost:5173，环境调试面板显示 `env: dev`, `provider: hku`, `status: 200`

### Production

- [ ] `bash scripts/diagnose_prod.sh <worker-url>` 显示 "🎉 SUCCESS"
- [ ] `bash scripts/diagnose_prod.sh <pages-url>` 显示 "🎉 SUCCESS"
- [ ] 新设备打开 Pages URL，调试面板显示 `env: production`, `key_present: true`
- [ ] 完成 User U1 → U2 → U3 流程
- [ ] Admin 登录看到实时图表增长

### 新设备验收（关键）

在**从未访问过本系统的设备**上（手机/朋友电脑）：

1. 打开 `https://your-project.pages.dev/user/start`
2. 顶部显示"环境调试面板"
3. 点击"检查连接" → 看到绿色 LLM Ping 结果
4. 创建 session → 完成至少 1 条 U1 manual label
5. 进入 U2 → 点击 Prompt1 → 看到预测结果 → Accept
6. 验证通过！

---

## 一键命令（适合CI/自动化）

### 本地验收

```bash
bash scripts/dev_setup.sh && \
bash scripts/diagnose_local.sh && \
bash scripts/e2e_smoke.sh
```

全部通过则本地环境 OK。

### 生产验收

```bash
bash scripts/diagnose_prod.sh https://your-worker.workers.dev && \
bash scripts/diagnose_prod.sh https://your-pages.pages.dev
```

全部通过则生产环境 OK，可分享给新设备。

---

**重点**: 所有脚本输出都不会泄露 keys，只显示存在性和调用结果。
