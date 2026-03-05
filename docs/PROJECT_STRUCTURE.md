# 项目结构总览

```
active-labeling/
├── 📁 apps/
│   └── 📁 web/                      # React 前端（Vite + TypeScript）
│       ├── src/
│       │   ├── components/          # 可复用组件
│       │   │   ├── AdminGuard.tsx   # Admin 路由保护
│       │   │   ├── AdminNav.tsx     # Admin 导航栏
│       │   │   ├── BarChart.tsx     # Chart.js 封装
│       │   │   └── EnvDebugPanel.tsx # 🔍 环境调试面板
│       │   ├── hooks/
│       │   │   └── useAttemptTracker.ts # 交互质量追踪
│       │   ├── lib/
│       │   │   ├── api.ts           # 统一 API 客户端
│       │   │   └── storage.ts       # localStorage 工具
│       │   ├── pages/
│       │   │   ├── user/            # U1/U2/U3 用户界面
│       │   │   ├── admin/           # Admin 管理界面
│       │   │   └── share/           # 只读分享页面
│       │   ├── App.tsx              # 主路由
│       │   └── main.tsx             # React 入口
│       ├── .env.example             # 前端环境变量示例
│       ├── vite.config.ts           # Vite 配置（含 /api proxy）
│       └── package.json
│
├── 📁 workers/
│   └── 📁 api/                      # Cloudflare Worker（Hono + TypeScript）
│       ├── src/
│       │   ├── db.ts                # D1 数据库操作
│       │   ├── llm.ts               # 🚀 LLM 调用 + Fallback 策略
│       │   ├── stats.ts             # 统计聚合函数
│       │   ├── statsHub.ts          # Durable Objects (SSE)
│       │   ├── utils.ts             # 工具函数（验证、JSON、时间）
│       │   ├── types.ts             # TypeScript 类型定义
│       │   └── index.ts             # 主路由 + 诊断接口
│       ├── .dev.vars.example        # Worker 环境变量示例
│       └── package.json
│
├── 📁 db/
│   └── 📁 migrations/               # D1 迁移脚本
│       ├── 0001_init.sql            # 初始 schema（12 张表）
│       └── 0002_seed_defaults.sql   # 默认 taxonomy + prompts
│
├── 📁 data/
│   └── seed_units.jsonl             # 示例标注数据（20 条）
│
├── 📁 scripts/                      # 🛠️ 自动化脚本
│   ├── seed-units.mjs               # 导入 units（Node.js）
│   ├── dev_setup.sh                 # 本地环境检查
│   ├── diagnose_local.sh            # 本地诊断（自动检测端口）
│   ├── diagnose_prod.sh             # 生产/Preview 诊断
│   └── e2e_smoke.sh                 # 端到端冒烟测试
│
├── 📁 docs/                         # 📚 文档中心
│   ├── README.md                    # 项目总览 + 部署指南
│   ├── QUICKSTART.md                # 快速入门（copy-paste 命令）
│   ├── RUN_MANUAL.md                # 运行手册（最短路径）
│   ├── API.md                       # 完整 API 接口文档
│   ├── SECURITY.md                  # 安全最佳实践
│   ├── DATA.md                      # 数据格式说明
│   ├── TROUBLESHOOTING.md           # 故障排查指南
│   ├── ACCEPTANCE_TEST.md           # 详细验收测试
│   ├── E2E_CHECKLIST.md             # 手动验收清单
│   ├── FINAL_DELIVERY_REPORT.md     # 最终交付报告
│   └── PROJECT_STRUCTURE.md         # 本文件
│
├── wrangler.toml                    # Cloudflare Worker 配置
├── .dev.vars                        # 本地环境变量（gitignore）
├── .gitignore                       # Git 忽略规则
└── package.json                     # 根 workspace 配置（可选）
```

## 🎯 核心文件说明

### 前端关键文件

| 文件 | 作用 |
|------|------|
| `apps/web/src/components/EnvDebugPanel.tsx` | 可折叠调试面板，显示环境、API 连接、LLM 状态 |
| `apps/web/src/hooks/useAttemptTracker.ts` | 追踪用户交互（active_ms, hidden_ms, blur_count） |
| `apps/web/src/lib/api.ts` | 统一封装所有后端 API 调用（含 request_id） |
| `apps/web/src/pages/user/UserPhaseManualPage.tsx` | U1/U3 手动标注（两阶段流程） |
| `apps/web/src/pages/user/UserNormalLlmPage.tsx` | U2 LLM 标注（Prompt 选择 + Accept/Override） |
| `apps/web/src/pages/admin/AdminDashboardNormalPage.tsx` | Normal Dashboard（实时图表 + Session 表） |
| `apps/web/src/pages/admin/AdminDashboardOverallPage.tsx` | Overall Dashboard + AL 触发 |

### 后端关键文件

| 文件 | 作用 |
|------|------|
| `workers/api/src/index.ts` | 主路由（Hono）+ `/api/health` + `/api/llm/ping` |
| `workers/api/src/llm.ts` | LLM 调用核心逻辑（HKU + Qwen fallback + 重试策略） |
| `workers/api/src/db.ts` | 所有 D1 数据库操作（CRUD + 统计查询） |
| `workers/api/src/statsHub.ts` | Durable Objects（SSE 实时推送） |
| `workers/api/src/utils.ts` | 服务器端验证（`validateAttempt`） + 工具函数 |

### 自动化脚本

| 脚本 | 使用场景 | 命令示例 |
|------|----------|----------|
| `scripts/dev_setup.sh` | 首次运行前检查环境 | `bash scripts/dev_setup.sh` |
| `scripts/diagnose_local.sh` | 本地开发时诊断 API | `bash scripts/diagnose_local.sh` |
| `scripts/diagnose_prod.sh` | 部署后验证生产环境 | `bash scripts/diagnose_prod.sh https://your-url.pages.dev` |
| `scripts/e2e_smoke.sh` | 端到端功能测试 | `bash scripts/e2e_smoke.sh` |
| `scripts/seed-units.mjs` | 导入标注数据 | `node scripts/seed-units.mjs data/seed_units.jsonl <API_BASE> <ADMIN_TOKEN>` |

### 文档阅读顺序

**新用户**: `RUN_MANUAL.md` → `QUICKSTART.md` → `TROUBLESHOOTING.md`  
**开发者**: `README.md` → `API.md` → `DATA.md` → `SECURITY.md`  
**测试人员**: `ACCEPTANCE_TEST.md` → `E2E_CHECKLIST.md`  
**运维人员**: `README.md` → `SECURITY.md` → `TROUBLESHOOTING.md`

## 🔧 配置文件优先级

### 本地开发
1. `.dev.vars` (Worker 环境变量，根目录)
2. `apps/web/.env` (前端环境变量，可选，默认用 Vite proxy)

### 生产/Preview
1. `wrangler secret put` (Worker secrets，推荐)
2. Cloudflare Pages 环境变量设置（前端 `VITE_API_BASE`）

## 📦 依赖管理

- **前端**: `apps/web/package.json`
  - React 19, React Router DOM 7, Chart.js, UUID
- **后端**: `workers/api/package.json`
  - Hono 4, @cloudflare/workers-types
- **脚本**: Node.js 18+ 内置模块（无额外依赖）

## 🚀 快速启动路径

```bash
# 1️⃣  环境检查
bash scripts/dev_setup.sh

# 2️⃣  启动服务（两个独立终端，分别执行）
# 终端 1:
cd workers/api && npm run dev
# 终端 2（另开终端，从项目根目录）:
cd apps/web && npm run dev

# 3️⃣  导入数据
node scripts/seed-units.mjs data/seed_units.jsonl http://127.0.0.1:8787 dev-admin-token

# 4️⃣  诊断验证
bash scripts/diagnose_local.sh

# 5️⃣  浏览器访问
# User:  http://localhost:5173
# Admin: http://localhost:5173/admin (token: dev-admin-token)
```

---

**完整技术栈**: Cloudflare Pages + Workers + D1 + Durable Objects | React 19 + TypeScript + Vite | Hono + Chart.js
