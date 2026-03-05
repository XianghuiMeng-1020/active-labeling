# 运行手册（最短路径）

## 📋 前置条件

- Node.js 18+
- npm
- Cloudflare 账号（用于生产部署）

## 🚀 本地运行（3 分钟）

```bash
# 1. 安装依赖
cd apps/web && npm install && cd ../..
cd workers/api && npm install && cd ../..

# 2. 初始化本地数据库
cd workers/api && npx wrangler d1 migrations apply sentence-labeling --local && cd ../..

# 3. 配置环境变量（复制示例文件）
cp workers/api/.dev.vars.example .dev.vars

# 4. 编辑 .dev.vars，填入真实的 HKU_API_KEY
# HKU_API_KEY=sk-proj-xxx...  (必需)
# QWEN_API_KEY=sk-xxx...      (可选，fallback用)

# 5. 检查环境
bash scripts/dev_setup.sh
bash scripts/diagnose_local.sh

# 6. 启动 Worker（新终端窗口）
cd workers/api && npm run dev

# 7. 启动 Web（新终端窗口）
cd apps/web && npm run dev

# 8. 导入测试数据
node scripts/seed-units.mjs data/seed_units.jsonl http://127.0.0.1:8787 dev-admin-token

# 9. 打开浏览器
# User: http://localhost:5173
# Admin: http://localhost:5173/admin (token: dev-admin-token)
```

## ☁️ 生产部署（5 分钟）

```bash
# 1. 登录 Cloudflare
npx wrangler login

# 2. 创建生产 D1 数据库（如已有则跳过）
npx wrangler d1 create sentence-labeling

# 3. 复制 database_id 到 wrangler.toml
# [[d1_databases]]
# database_id = "your-database-id-here"

# 4. 运行数据库迁移
cd workers/api && npx wrangler d1 migrations apply sentence-labeling --remote && cd ../..

# 5. 配置生产 secrets
npx wrangler secret put HKU_API_KEY         # 输入真实的 HKU key
npx wrangler secret put HKU_DEPLOYMENT_ID   # 输入真实的 deployment ID
npx wrangler secret put QWEN_API_KEY        # 输入真实的 Qwen key（可选）
npx wrangler secret put ADMIN_BEARER_TOKEN  # 输入自定义的 admin token

# 6. 部署 Worker
cd workers/api && npm run deploy && cd ../..

# 7. 构建并部署 Frontend
cd apps/web
npm run build
npx wrangler pages deploy dist --project-name sentence-labeling

# 8. 获取生产 URL（示例）
# Worker: https://api-sentence-labeling.yourusername.workers.dev
# Pages:  https://sentence-labeling.pages.dev

# 9. 配置前端环境变量
# 在 Cloudflare Pages 控制台设置环境变量:
# VITE_API_BASE=https://api-sentence-labeling.yourusername.workers.dev

# 10. 重新部署前端（应用环境变量）
npx wrangler pages deploy dist --project-name sentence-labeling

# 11. 诊断生产环境
bash scripts/diagnose_prod.sh https://sentence-labeling.pages.dev

# 12. 导入生产数据
node scripts/seed-units.mjs \
  data/seed_units.jsonl \
  https://api-sentence-labeling.yourusername.workers.dev \
  YOUR_ADMIN_TOKEN
```

## 🔍 快速验收

```bash
# 本地环境
bash scripts/diagnose_local.sh   # 检查 /api/health 和 /api/llm/ping
bash scripts/e2e_smoke.sh         # 端到端冒烟测试

# 生产环境
bash scripts/diagnose_prod.sh https://your-pages-url.pages.dev
```

## 🐛 常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| `/api/health` 显示 `hku.key_present: false` | 未配置 HKU_API_KEY | 编辑 `.dev.vars`（本地）或 `wrangler secret put`（生产） |
| `/api/llm/ping` 返回 `401` | HKU key 错误或过期 | 从 HKU 控制台重新获取 key |
| Preview 环境 LLM 不可用 | Preview 未配置 secrets | 使用 production URL 或单独配置 preview secrets |
| 前端调试面板显示"❌ 未就绪" | LLM 连接失败 | 点击"检查连接"查看详细错误，参考 TROUBLESHOOTING.md |

## 📚 进一步阅读

- **完整文档**: [README.md](./README.md)
- **API 文档**: [API.md](./API.md)
- **详细验收**: [ACCEPTANCE_TEST.md](./ACCEPTANCE_TEST.md)
- **快速入门**: [QUICKSTART.md](./QUICKSTART.md)
- **故障排查**: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

## ✅ 验收清单

- [ ] `bash scripts/dev_setup.sh` 全部 ✅
- [ ] `bash scripts/diagnose_local.sh` 显示 "dev" + "hku" + "200"
- [ ] User 可完成 U1 -> U2 -> U3 流程
- [ ] Admin Dashboard 实时显示统计图表
- [ ] Admin 可触发 AL run，`system_active` session 自动增长
- [ ] Admin 可生成 share token，/share/:token 可访问
- [ ] 生产环境 `diagnose_prod.sh` 显示 "production" + "hku" + "200"
- [ ] 前端调试面板显示"✅ 就绪"（production only）

---

**系统现已完成实际落地运行所需的全部功能、诊断工具、自动化脚本和文档。**
