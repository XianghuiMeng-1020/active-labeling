# 🚀 下一步操作指南

本文档是你开始使用系统的**最短路径**。所有功能已实现并验证完毕。

---

## ⚡ 立即开始（5 分钟）

### 1. 配置环境变量

```bash
# 编辑 .dev.vars（已存在根目录）
vim .dev.vars

# 必须填入以下真实 keys：
# HKU_API_KEY=sk-proj-xxx...         # 从 HKU Azure OpenAI Gateway 获取
# QWEN_API_KEY=sk-xxx...             # 从阿里云 Qwen 控制台获取
# ADMIN_TOKEN=your-secure-token      # 自定义（如 dev-admin-token）
```

### 2. 启动服务

**需要打开两个独立的终端窗口**，分别执行下面两条命令（每条命令单独复制，不要包含「终端 1」「终端 2」等文字）：

**第一个终端**（Worker）：
```bash
cd workers/api && npm run dev
```

**第二个终端**（Web）：
```bash
cd apps/web && npm run dev
```

> ⚠️ 注意：请从项目根目录执行，每条命令需在**单独终端**中运行。若当前已在 `workers/api` 目录，第二个命令需先 `cd ../..` 回到根目录再执行。

### 3. 验证环境

```bash
# 自动检查配置
bash scripts/diagnose_local.sh

# 预期输出：
# ✅ env: dev
# ✅ HKU Key: ✅ 已配置
# ✅ LLM Provider: hku
# ✅ LLM Status: 200
# 🎉 SUCCESS: Local environment ready
```

### 4. 导入测试数据

```bash
node scripts/seed-units.mjs data/seed_units.jsonl http://127.0.0.1:8787 dev-admin-token
```

### 5. 打开浏览器测试

- **User 界面**: http://localhost:5173/user/start
- **Admin 界面**: http://localhost:5173/admin/login（密码: `dev-admin-token`）

---

## ✅ 快速验收清单

在浏览器中完成以下操作：

### User 流程
- [ ] 点击页面顶部"环境调试面板" → "检查连接"，确认显示"✅ 就绪"
- [ ] 创建 session（输入姓名）
- [ ] U1: 完成一个手动标注（选标签 → 输理由）
- [ ] U2: 运行 LLM 标注（选 Prompt1 → Run LLM → Accept）
- [ ] U3: 完成一个 Active Learning 标注（需先在 Admin 触发 AL）

### Admin 流程
- [ ] 登录 Admin（token: `dev-admin-token`）
- [ ] 查看 Normal Dashboard 实时图表更新
- [ ] 查看 Overall Dashboard
- [ ] 触发一次 AL run，观察状态变化（Queued → Running → Completed）
- [ ] Config 页面：查看 taxonomy 标签和 prompts
- [ ] 生成一个 share token，访问 `/share/:token` 查看只读统计

---

## 🌐 生产部署（10 分钟）

详细步骤见 [`docs/RUN_MANUAL.md`](./docs/RUN_MANUAL.md) 的"生产部署"章节。

**快速命令**:

```bash
# 1. 登录 Cloudflare
npx wrangler login

# 2. 创建 D1 数据库
npx wrangler d1 create sentence-labeling
# 复制 database_id 到 wrangler.toml

# 3. 运行远程迁移
cd workers/api && npx wrangler d1 migrations apply sentence-labeling --remote

# 4. 配置 secrets
npx wrangler secret put HKU_API_KEY
npx wrangler secret put HKU_DEPLOYMENT_ID
npx wrangler secret put QWEN_API_KEY
npx wrangler secret put ADMIN_TOKEN

# 5. 部署 Worker
npm run deploy

# 6. 构建并部署 Pages
cd ../apps/web
echo "VITE_API_BASE=https://your-worker-url.workers.dev" > .env.production
npm run build
npx wrangler pages deploy dist --project-name sentence-labeling

# 7. 验证生产环境
bash scripts/diagnose_prod.sh https://your-pages-url.pages.dev
```

---

## 🐛 遇到问题？

### 常见问题速查

| 现象 | 原因 | 解决方案 |
|------|------|---------|
| `diagnose_local.sh` 显示 `hku.key_present: false` | 未配置 HKU_API_KEY | 编辑 `.dev.vars`，填入真实 key，重启 Worker |
| `/api/llm/ping` 返回 `401` | HKU key 错误或过期 | 从 HKU 控制台重新获取 key |
| 前端调试面板显示"❌ 未就绪" | LLM 连接失败 | 点击"检查连接"查看详细错误 |
| Preview 环境 LLM 不可用 | Preview 未配置 secrets（正常） | 使用 production URL 或配置 preview secrets |
| Worker 启动失败 | 依赖未安装 | `cd workers/api && npm install` |
| 数据库为空 | 未运行迁移 | `cd workers/api && npm run d1:migrate:local` |

### 详细故障排查

查看 [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) 获取完整的分层诊断指南。

---

## 📚 进一步学习

### 按角色推荐

**产品经理/标注人员**:
1. [`docs/RUN_MANUAL.md`](./docs/RUN_MANUAL.md) - 运行手册
2. [`docs/E2E_CHECKLIST.md`](./docs/E2E_CHECKLIST.md) - 功能验收清单

**开发工程师**:
1. [`README.md`](./README.md) - 完整技术文档
2. [`docs/API.md`](./docs/API.md) - 接口定义
3. [`docs/PROJECT_STRUCTURE.md`](./docs/PROJECT_STRUCTURE.md) - 代码结构

**运维/DevOps**:
1. [`docs/SECURITY.md`](./docs/SECURITY.md) - 安全最佳实践
2. [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) - 故障排查
3. 自动化脚本（`scripts/` 文件夹）

---

## 🎉 系统能力总览

### 已实现功能
- ✅ 三种标注模式（U1 手动、U2 LLM、U3 Active Learning）
- ✅ 实时统计图表（Chart.js + SSE）
- ✅ Admin 管理界面（Dashboard、Config、Units）
- ✅ LLM 双路由（HKU primary + Qwen fallback）
- ✅ 健壮的 fallback 策略（区分配置错误、限流、服务故障）
- ✅ 完整的诊断工具（/api/health、/api/llm/ping、前端调试面板）
- ✅ 环境检测（dev/preview/production）
- ✅ Active Learning 异步执行 + 状态轮询
- ✅ 交互质量追踪（active_ms、blur_count、hadBackground 等）
- ✅ 只读分享链接
- ✅ 自动化脚本（环境检查、诊断、E2E 测试）

### 技术栈
- **前端**: React 19 + TypeScript + Vite + Chart.js
- **后端**: Cloudflare Workers + Hono + D1 + Durable Objects
- **LLM**: HKU Azure OpenAI Gateway + Qwen（阿里云）
- **部署**: Cloudflare Pages + Workers（Serverless）

---

## 💡 重要提示

1. **API Keys 必需**: 系统需要真实的 HKU_API_KEY 和 QWEN_API_KEY 才能完整运行
2. **本地优先**: 建议先在本地完成验收，再部署到生产
3. **Preview 保护**: Preview 环境默认禁用 LLM（避免测试消耗配额）
4. **诊断优先**: 遇到问题先运行 `diagnose_local.sh` 或 `diagnose_prod.sh`
5. **文档齐全**: 所有功能都有对应的文档和测试指南

---

## 📞 获取帮助

1. **查看文档**: `docs/` 文件夹包含 13 份完整文档
2. **运行诊断**: `bash scripts/diagnose_local.sh`
3. **检查面板**: 浏览器中点击"环境调试面板" → "检查连接"
4. **查看日志**: 
   - 本地: Worker 终端输出
   - 生产: `npx wrangler tail` 或 Cloudflare Dashboard

---

**准备好了吗？现在就开始第 1 步：配置 `.dev.vars` 文件！** 🚀
