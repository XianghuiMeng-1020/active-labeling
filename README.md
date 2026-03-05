# Active Labeling System

研讨会场景下的交互式文本标注系统，基于 Cloudflare Pages + Workers + D1，使用 **ED-AL v1**（Entropy + Diversity 主动学习算法），LLM 仅用 **Qwen（阿里云 DashScope）**。

---

## 技术栈

| 层 | 技术 |
|---|---|
| **后端 API** | Cloudflare Worker + Hono 4.x（TypeScript） |
| **数据库** | Cloudflare D1（SQLite，托管） |
| **实时推送** | Cloudflare Durable Objects（SSE 广播） |
| **LLM** | Qwen（qwen-plus，OpenAI 兼容 API，**仅在 Worker env**） |
| **前端** | React 19 + TypeScript + Vite 7（移动端优先 UI） |
| **主动学习** | ED-AL v1（Shannon 熵 + TF-IDF k-center greedy） |

---

## 快速开始

### 1. 安装依赖

```bash
# Worker 后端
cd workers/api && npm install

# 前端
cd apps/web && npm install
```

### 2. 配置环境变量

```bash
# 本地开发（workers/api/.dev.vars）
QWEN_API_KEY=your_dashscope_api_key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
ADMIN_TOKEN=dev-admin-token
MIN_ACTIVE_MS=800
```

### 3. 本地开发

```bash
# 启动 Worker（端口 8787）
cd workers/api && wrangler dev

# 启动前端（端口 5173）
cd apps/web && npm run dev
```

前端访问：http://localhost:5173  
API：http://localhost:8787

### 4. 运行冒烟测试

```bash
# 完整 e2e 测试（需要 Qwen key）
BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/e2e_smoke.sh

# SSE 实时同步验证
BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/sse_check.sh
```

---

## 部署

### Worker

```bash
cd workers/api

# 设置 secrets（只需一次）
wrangler secret put QWEN_API_KEY
wrangler secret put QWEN_BASE_URL
wrangler secret put ADMIN_TOKEN

# 部署
wrangler deploy

# 数据库迁移（在项目根目录执行，wrangler 会读取根目录 wrangler.toml）
wrangler d1 migrations apply labeling_db --remote
```

**注意**：`wrangler.toml` 中的 D1 `database_id` 必须为你在 Cloudflare 创建的**真实 UUID**（不能是 `00000000-...` 占位符）。若今后使用 `[env.production]` 等环境段并在此段下配置了 D1，迁移时需加 `--env production`，例如：`wrangler d1 migrations apply labeling_db --remote --env production`。

### 前端（Cloudflare Pages）

1. **构建前设置环境变量**（Vite 在构建时注入，必须与 Pages 一致）  
   在 Cloudflare Pages 项目 **Settings → Environment variables** 中添加：
   - **变量名**：`VITE_API_BASE`  
   - **值**：`https://sentence-labeling-api.xmeng19.workers.dev`  
   - 作用环境：Production（及 Preview 如需要）

2. **构建并部署**：
   ```bash
   cd apps/web
   npm run build
   # 将 dist/ 部署到 Pages（或连接 Git 自动构建）
   ```

3. **现场验证**：  
   - 用户端：访问 `/user/start`，完成 1 条标注。  
   - 管理端：访问 `/admin`，确认图表与统计实时更新。

---

## 用户流程（3 页）

```
扫码 → /user/start（填昵称）
  ↓
Page 1: 普通人工标注（/user/normal/manual）
  - 逐条标注，单击标签即提交
  - 顶部进度环，提交后 Toast
  - 底部 Undo 按钮（可撤回，Admin 统计实时回滚）
  ↓ [Gate: 全部完成后解锁]
Page 2: 普通 LLM 辅助（/user/normal/llm）
  - Segmented control: Prompt1 / Prompt2 / Custom
  - 运行 Qwen → 显示预测 → Accept 或 底部面板改选
  - Custom 最多 5 次（后端强约束，第 6 次 429）
  ↓ [Gate: 全部完成后解锁]
Page 3: 主动学习人工（/user/active/manual）
  - 标注 ED-AL v1 选出的高信息量多样化样本
  - 显示不确定性原因（entropy、diversity_rank）
```

---

## Admin 功能

访问 `/admin/login` → 输入 ADMIN_TOKEN

### Dashboard（/admin/dashboard）

- **Stage 1 Tab**：普通人工 + 普通 LLM 两张实时 bar chart
- **Stage 2 Tab**：主动人工 + 主动 LLM 两张图 + ED-AL v1 触发面板
- **冻结展示**按钮：暂停前端更新，便于讲解
- **实时指标**：在线会话数、近 30 秒新增标注数、Live 指示灯
- **参与者进度表**：每人 P1/P2/P3 完成情况

### 配置（/admin/config）

- 配置 Taxonomy（标签体系）
- 配置 Prompt1（zero-shot）和 Prompt2（few-shot）

### 单元导入（/admin/units）

- 粘贴 JSONL（每行含 `unit_id` 和 `text`）

---

## ED-AL v1 主动学习算法

```
输入：candidate_k 个候选单元
算法：
  1. 不确定性（Entropy）：
     对每个候选，用 Qwen + Prompt2 采样 sample_n 次（temperature=0.7）
     计算 Shannon 熵 H（归一化到 [0,1]）
     
  2. 多样性（Diversity）：
     取熵最高的 top_h 个候选
     构建 TF-IDF 向量
     k-center greedy 选出 active_m 个最分散的单元
     
  3. Active LLM 批处理：
     对选中单元分别用 Prompt1 + Prompt2 预跑
     结果存入 llm_labels（session_id='system_active'）

API 参数（/api/admin/al/run）：
  candidate_k  候选池大小（默认 80）
  top_h        熵排序取 Top H（默认 40）
  sample_n     每单元采样次数（默认 3）
  active_m     最终选出数量（默认 20）
  temperature  采样温度（默认 0.7）
  seed         k-center 种子（默认随机）
```

---

## 安全

- 所有 `/api/admin/*` 需要 `Authorization: Bearer ADMIN_TOKEN`
- SSE 流 `/api/stream/stats` 需要 `?token=ADMIN_TOKEN`
- Qwen API Key **仅存在于 Worker 环境变量**，前端零接触
- 用户路由（`/user/*`）无任何 admin 入口

---

## 数据导出

```bash
# CSV（含所有标注 + 行为数据）
curl "https://your-worker/api/admin/export?format=csv&token=TOKEN" -o export.csv

# JSONL
curl "https://your-worker/api/admin/export?format=jsonl&token=TOKEN" -o export.jsonl
```

字段包含：`session_id, user_id, unit_id, text, manual_label, llm_p1_accepted, llm_p2_accepted, active_ms, hidden_ms, idle_ms, had_background, is_valid`

---

## 文档

- [ACCEPTANCE_TEST.md](./ACCEPTANCE_TEST.md) — 研讨会完整操作手册（Runbook）
- [SELF_CHECK_REPORT.md](./SELF_CHECK_REPORT.md) — 需求对齐验证报告（12 点）
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — 常见问题（401/429/SSE/统计回滚）
- [docs/API.md](./docs/API.md) — 完整 API 文档

---

## 研讨会操作流程（最简版）

```
会前（30分钟以上）：
  1. wrangler deploy
  2. wrangler d1 migrations apply --remote
  3. /admin/units  → 导入标注数据
  4. /admin/config → 配置 taxonomy + prompts
  5. /api/admin/al/run → 触发 ED-AL v1（等待完成）

会中：
  1. 发布 /user/start 二维码（或短链接）
  2. Admin Dashboard Stage 1 Tab 投屏
  3. 待所有人完成 P1+P2 → 切换到 Stage 2 Tab
  4. 观察 Active Manual 实时增长

会后：
  /api/admin/export?format=csv&token=TOKEN → 下载数据集
```
