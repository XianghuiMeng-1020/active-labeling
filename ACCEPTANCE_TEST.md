# Acceptance Test — Active Labeling System
**版本：** 2026-03-02-v3 (ED-AL v1)

---

## 研讨会 Runbook（完整操作手册）

### 概览

```
研讨会场景：
  · 20-30 人扫二维码，手机打开用户页面标注
  · 一台管理员电脑投屏展示 Admin Dashboard
  · 3 个用户阶段（P1 普通人工 → P2 普通 LLM → P3 主动学习人工）
  · Admin 阶段 1 看 Normal 两图，阶段 2 看 Active 两图
  · 所有 LLM 调用仅 Qwen（QWEN_API_KEY 只在 Worker env）
```

---

## 会前准备（活动前 30 分钟以上）

### Step 1: 配置环境变量

在 Cloudflare Dashboard 或 `wrangler secret put` 设置：

```bash
# 必须设置
wrangler secret put QWEN_API_KEY          # 阿里云 DashScope 密钥
wrangler secret put ADMIN_TOKEN           # 自定义强密码（建议 32 位随机）
wrangler secret put QWEN_BASE_URL         # https://dashscope.aliyuncs.com/compatible-mode/v1
```

### Step 2: 部署并迁移数据库

```bash
# 部署 Worker
cd workers/api
npm install
wrangler deploy

# 运行数据库迁移
wrangler d1 migrations apply labeling_db --remote
```

验证健康：
```bash
curl https://your-worker.workers.dev/api/health | jq .
# 期望输出：{"build":"...","qwen":{"key_present":true},"time":"..."}
# 注意：不应有 hku 字段
```

### Step 3: 导入标注单元

```bash
# 方式一：使用脚本
cd scripts
node seed-units.mjs --file ../data/ai_literacy_6.jsonl \
  --base https://your-worker.workers.dev \
  --token YOUR_ADMIN_TOKEN

# 方式二：Admin 页面上传 JSONL
# 访问 https://your-app.pages.dev/admin/units
```

### Step 4: 配置 Taxonomy 和 Prompt

访问 `https://your-app.pages.dev/admin/config`，配置：

**Taxonomy（每行一个标签，格式：`label|描述`）：**
```
EXPLANATION|解释 AI 如何运作
EVALUATION|评估 AI 的能力或局限
RESPONSIBILITY|讨论 AI 的责任或治理
APPLICATION|描述 AI 的应用场景
IMPLICATION|探讨 AI 对社会的影响
```

**Prompt 1（zero-shot）：**
```
请将以下句子分类到以下主题之一：EXPLANATION, EVALUATION, RESPONSIBILITY, APPLICATION, IMPLICATION。
只输出 JSON 格式：{"label": "标签名"}
```

**Prompt 2（few-shot）：**
```
以下是 AI 素养相关句子的分类示例：
- "AI 系统通过训练数据学习模式" → {"label": "EXPLANATION"}
- "我们需要对 AI 决策负责" → {"label": "RESPONSIBILITY"}

请将以下句子分类（EXPLANATION/EVALUATION/RESPONSIBILITY/APPLICATION/IMPLICATION）：
只输出 JSON：{"label": "标签名"}
```

### Step 5: 触发 ED-AL v1 主动学习选取（⚠️ 耗时操作）

访问 Admin Dashboard → **阶段 2 — 主动学习** 标签页 → 触发 ED-AL v1

或 API 调用：
```bash
curl -X POST https://your-worker.workers.dev/api/admin/al/run \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "candidate_k": 80,
    "top_h": 40,
    "sample_n": 3,
    "active_m": 20,
    "temperature": 0.7
  }'

# 返回 run_id，用于查询进度
# 查询进度
curl "https://your-worker.workers.dev/api/admin/al/status?run_id=RUN_ID" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

**预计耗时**：`candidate_k × sample_n × 0.7s ≈ 80 × 3 × 0.7 = 168s`（约 3 分钟）。

> ⚠️ 此步骤同时完成：
> 1. 对候选池计算 Entropy（不确定性）
> 2. k-center greedy 选出多样性最高的 active units
> 3. 对 active units 分别用 Prompt1 + Prompt2 预跑（存为 session_id='system_active'）

---

## 会中操作

### 阶段 1：普通标注（Page 1 + Page 2）

**1. 发布用户二维码**

用户链接：`https://your-app.pages.dev/user/start`

生成二维码（推荐工具：qr.io 或 `qrencode`）：
```bash
qrencode -t PNG -o qr_user.png "https://your-app.pages.dev/user/start"
```

**2. 用户操作流程**

```
手机扫码 → 填入昵称（可选）→ 设置 normal_n 和 active_m → 开始标注

Page 1（普通人工）：
  - 逐条看句子，点击标签按钮
  - 顶部进度环显示 k/N
  - 提交后 Toast 提示"已保存"
  - 底部 Undo 按钮可撤回上一条

Page 2（普通 LLM）：
  - 选择 Prompt1 / Prompt2 / Custom
  - 点击"运行"→ 等待模型结果
  - Accept（接受）或 改选（弹出底部面板）
  - Custom 最多 5 次，超出后禁用
```

**3. Admin 投屏操作**

```
打开：https://your-app.pages.dev/admin/dashboard
输入 Admin Token 登录

阶段 1 Tab（默认）：
  - 实时显示 Normal Manual / Normal LLM 两张 bar chart
  - 顶部: 在线会话数 · 近30s新增标注数 · Live 实时指示
  - 图表数字随用户提交自动增减（SSE实时更新）
  - 如需暂停讲解：点击"⏸ 冻结展示"（仅冻结前端渲染）
```

### 阶段 2：主动学习（Page 3）

**切换 Admin 到阶段 2：**

点击 Admin Dashboard 顶部 **"⚡ 阶段 2 — 主动学习"** 标签。

显示：
- **Active Manual**：用户在 Page 3 的人工标注（实时增减）
- **Active LLM**：会前预跑的系统标注结果（静态，会前已完成）

**用户自动进入 Page 3：**

当 Page 2 全部完成后，用户点击"前往主动学习人工标注"进入 Page 3。

Page 3 与 Page 1 视觉相同，但：
- 标注单元是 ED-AL v1 选出的高信息量且多样化样本
- 单元卡片显示 **⚡ 主动学习** 标识
- 如果 al_scores.reason 含 entropy 信息，显示"不确定性 X%"提示

---

## 会后数据导出

```bash
# 导出完整数据集（仅 Bearer，禁止 query token）
curl "https://your-worker.workers.dev/api/admin/export?format=csv" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -o labeling_export_$(date +%Y%m%d).csv

curl "https://your-worker.workers.dev/api/admin/export?format=jsonl" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -o labeling_export_$(date +%Y%m%d).jsonl

# 或在 Admin Dashboard → 参与者进度 → 导出按钮（前端使用 Bearer 请求）
```

**导出字段说明：**

| 字段 | 说明 |
|------|------|
| `session_id` | 用户会话 ID |
| `user_id` | 用户昵称 |
| `unit_id` | 标注单元 ID |
| `text` | 待标注文本 |
| `manual_label` | 人工标注最终结果 |
| `llm_p1_accepted` | Prompt1 被接受/改选的标签 |
| `llm_p2_accepted` | Prompt2 被接受/改选的标签 |
| `llm_custom_accepted` | Custom 被接受/改选的标签 |
| `active_ms` | 有效作答时长（ms） |
| `hidden_ms` | 后台停留时长（ms） |
| `idle_ms` | 空闲时长（ms） |
| `hidden_count` | 切屏次数 |
| `had_background` | 是否切屏（0/1） |
| `is_valid` | 是否为有效答题（0/1） |
| `invalid_reason` | 无效原因（如 active_ms_too_low） |

---

## 接受标准

| 项目 | 标准 | 验证方式 |
|------|------|---------|
| 实时同步 | 用户提交 → Admin 图表在 3 秒内更新 | sse_check.sh |
| 撤回回滚 | Undo 后 Admin 数字减少 | e2e_smoke.sh 第4节 |
| 5 次限制 | 第 6 次 Custom 返回 429 | e2e_smoke.sh 第5节 |
| Gate 保护 | Page2 在 Page1 未完成时无法访问 | e2e_smoke.sh 第3节 |
| Admin 安全 | 无 token 返回 401 | e2e_smoke.sh 第9节 |
| 导出完整 | CSV 含 active_ms/is_valid 等字段 | e2e_smoke.sh 第10节 |
| Qwen-only | Health 无 HKU 字段 | e2e_smoke.sh 第0节 |

---

## 参数推荐表

### 会前 AL 参数（按数据集大小）

| 数据集规模 | candidate_k | top_h | sample_n | active_m | 预计耗时 |
|-----------|-------------|-------|----------|----------|---------|
| 50-100 units | 50 | 25 | 3 | 15 | 约 2 min |
| 100-300 units | 80 | 40 | 3 | 20 | 约 3 min |
| 300-500 units | 120 | 60 | 3 | 30 | 约 5 min |

### 用户标注量（按研讨会时间）

| 研讨会时间 | normal_n | active_m | 说明 |
|-----------|----------|----------|------|
| 20 分钟 | 3 | 2 | 快速体验 |
| 30 分钟 | 5 | 3 | 推荐 |
| 45 分钟 | 8 | 5 | 深度标注 |

---

## 常见问题快速解答

**Q: 有人的 Page 2 卡着进不去？**  
A: 检查 Page 1 是否真的全部完成（进度环满）。可在 Admin 看 Sessions 表确认该用户进度。

**Q: Custom 按钮灰了，提示已达上限？**  
A: 正常。该用户在这条 unit 已用满 5 次。切换用 Prompt1 或 Prompt2 继续。

**Q: Admin 图表没有实时更新？**  
A: 检查浏览器控制台 EventSource 连接。刷新页面重连。确保 WIFI 稳定。

**Q: 导出的 is_valid=0 比例很高？**  
A: 说明参与者切屏较多或答题太快（< 800ms）。属于正常现象，数据仍保留，invalid 记录仅影响质量分析。

**Q: Active 阶段 units 很少（或为0）？**  
A: 确保会前已成功触发 AL run（状态 status=done）。admin 可重新触发一次（幂等操作）。

---

## Final Rehearsal（最终演练）

### 1. 并发负载测试

```bash
# 本地
BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/load_test_local.sh

# 可选：指定并发数（默认 25）
CONCURRENCY=10 BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/load_test_local.sh
```

**预期输出**：成功率 100%、429 次数汇总、平均延迟；失败时提示用 `wrangler tail` 查 request_id。

### 2. SSE 断线重连纠偏

```bash
BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/sse_resync_check.sh
```

**预期输出**：`SSE Resync Check PASS`；验证 sync 端点返回 revision，断线后全量拉取恢复状态。

### 3. AL run 预算与限流

- Admin Dashboard → 阶段 2 → 配置 ED-AL 参数后，会显示**预计 Qwen 调用量**（ED-AL 采样 + Active LLM）。
- 若预计调用量 > 300，点击「触发 ED-AL v1」会弹出**二次确认**。
- 运维观测 `/admin/ops` 可查看 `qwen_calls_total`、`qwen_429_total`、`retries_total`、`avg_latency_ms`。

### 4. 一条命令汇总

| 操作 | 命令 |
|------|------|
| Load test | `BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/load_test_local.sh` |
| SSE 断线重连 | `BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/sse_resync_check.sh` |
| 对账 | `curl -s -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8787/api/admin/audit/consistency \| jq` |
| 导出完整性 | `BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/verify_export_integrity.sh` |
| Playwright 演练 | `BASE_URL=http://localhost:5173 API_BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token npx playwright test tests/realistic_seminar.spec.ts` |
