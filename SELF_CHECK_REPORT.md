# Self-Check Report — Active Labeling System
**Generated:** 2026-03-02  
**Build:** 2026-03-02-v3 (ED-AL v1 + Mobile UI)  
**Scope:** Qwen-only · 3-page user flow · Admin dashboard (Stage 1/2 tabs) · SSE real-time · Undo rollback · Custom 5× limit · ED-AL v1

---

## 1. 需求逐条对齐表（12 核心检查点）

| # | 检查点 | 状态 | 代码证据 |
|---|--------|------|---------|
| 1 | **User 仅 3 页**，且 gate：P1完成才进P2，P2完成才进P3（服务端强约束） | ✅ | 见 §1.1 |
| 2 | **LLM 页 3 按钮**：Prompt1/Prompt2/Custom；Custom 可编辑 prompt | ✅ | 见 §1.2 |
| 3 | **Custom 每 unit 最多 5 次**：后端强约束，第 6 次必拒（429） | ✅ | 见 §1.3 |
| 4 | **Undo/改 label**：统计能回滚（Admin 图表数字会减少/迁移） | ✅ | 见 §1.4 |
| 5 | **Admin 阶段 1** 只显示 Normal 两图；**阶段 2** 显示 Active 两图 | ✅ | 见 §1.5 |
| 6 | **Active LLM** 会前由 admin 触发批处理，Prompt1+Prompt2 均保存 | ✅ | 见 §1.6 |
| 7 | **实时同步**：提交/撤回立即触发 Admin 端 SSE 更新 | ✅ | 见 §1.7 |
| 8 | **Serverless 可靠记录**：所有 attempt 属性（active_ms/hidden_ms/idle_ms/切屏次数）入库 | ✅ | 见 §1.8 |
| 9 | **Admin 安全边界**：User link 无法访问 admin 数据；/api/admin/* 未授权 401 | ✅ | 见 §1.9 |
| 10 | **Qwen-only**：仓库内无 HKU 字段/env/文档/health 输出 | ✅ | 见 §1.10 |
| 11 | **导出数据集**：CSV/JSONL 含所有关键字段（labels + attempts + run metadata） | ✅ | 见 §1.11 |
| 12 | **并发/限流**：Qwen rate limit 下有退避重试；429 不当 fallback | ✅ | 见 §1.12 |

---

## Final Rehearsal Results（最终演练结果）

### 运行命令与预期输出

**1. Load test（并发模拟）**
```bash
BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/load_test_local.sh
```
- 预期：成功率 100%（或按环境），输出 429 次数、平均延迟；失败时提示 `wrangler tail` 查 request_id。

**2. SSE 断线重连**
```bash
BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/sse_resync_check.sh
```
- 预期：`SSE Resync Check PASS`；sync 端点返回 revision，断线后全量拉取恢复。

**3. 安全检查**
- Export 不再支持 query token：`curl .../api/admin/export?format=csv` 无 header 返回 401；带 `Authorization: Bearer TOKEN` 返回 200。
- Admin 未登录不请求 stats：未输入 token 时仅显示登录页，不触发 `/api/admin/stats` 请求（AdminGuard 重定向到 /admin/login）。

**4. 对账与导出校验**
```bash
# 对账
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8787/api/admin/audit/consistency

# 导出完整性
BASE=http://localhost:8787 ADMIN_TOKEN=dev-admin-token bash scripts/verify_export_integrity.sh
```
- 预期：对账 `ok: true` 或列出 mismatches；导出校验 PASS（duration_ms ≥ 0，active_ratio ∈ [0,1]）。

---

### 1.1 User 仅 3 页，服务端 Gate 强约束

**证据：**

```
apps/web/src/App.tsx
  /user/start → UserStartPage
  /user/normal/manual → UserPhaseManualPage (phase=normal)   ← Page 1
  /user/normal/llm → UserNormalLlmPage                       ← Page 2
  /user/active/manual → UserActiveManualPage                  ← Page 3
  /user/active/llm → UserActiveLlmPage                       ← 只读查看（非流程页）
```

Gate 逻辑（服务端，`workers/api/src/index.ts` L213-226）：
```typescript
gates: {
  can_enter_normal_llm: normalManual.total > 0 && normalManual.done === normalManual.total,
  can_enter_active_manual: normalLlm.total > 0 && normalLlm.done === normalLlm.total
}
```

前端 Page 2 开头检查（`UserNormalLlmPage.tsx`）：
```typescript
if (!status.gates.can_enter_normal_llm) { nav("/user/normal/manual"); return; }
```

前端 Page 3 开头检查（`UserPhaseManualPage.tsx` phase=active）：
```typescript
if (phase === "active" && !status.gates.can_enter_active_manual) { nav("/user/normal/llm"); return; }
```

**验证**：e2e_smoke.sh 第 3 节断言初始 `gates.can_enter_normal_llm = false`，完成 Page 1 后断言变 `true`。

---

### 1.2 LLM 页 3 个模式按钮

**证据：** `apps/web/src/pages/user/UserNormalLlmPage.tsx`

```typescript
(["prompt1", "prompt2", "custom"] as LlmMode[]).map((m) => (
  <button className={`segmented-btn ${activeMode === m ? "active" : ""}`} onClick={() => setActiveMode(m)} ...>
```

- **Segmented control** 设计：3 个并列按钮，当前激活态高亮
- **Custom textarea**：当 `activeMode === "custom"` 时显示可编辑 textarea
- **Prompt1/Prompt2**：可展开/收起预览提示词内容
- **自定义计数徽章**：`X/5` 实时显示，达到5次后置灰

---

### 1.3 Custom 最多 5 次，后端强约束

**证据：**

DB 层（`db/migrations/0003_custom_run_counts.sql`）：
```sql
CREATE TABLE IF NOT EXISTS llm_run_counts (
  session_id TEXT, unit_id TEXT, phase TEXT, mode TEXT,
  run_count INTEGER DEFAULT 0, ...
  UNIQUE(session_id, unit_id, phase, mode)
);
```

后端（`workers/api/src/index.ts` L347-362）：
```typescript
if (body.mode === "custom") {
  const count = await getCustomRunCount(c.env, ...);
  if (count >= CUSTOM_PROMPT_MAX) {  // CUSTOM_PROMPT_MAX = 5
    return json({ error: "custom_attempt_limit_reached", ... }, 429);
  }
  await incrementCustomRunCount(c.env, ...);
}
```

**关键**：先检查再 increment，第 5 次成功后 count=5，第 6 次 count=5 ≥ 5 → 429 返回，**计数不会变成 6**。

e2e_smoke.sh 验证：
```bash
# 6th attempt must be rejected with HTTP 429
HTTP6=$(curl -s -o /dev/null -w "%{http_code}" ...)
assert_http "6th custom → 429" "429" "$HTTP6"

# count is still 5 (not 6)
CNT=$(api GET "/api/llm/custom/count?...")
[[ "$CNT_VAL" == "5" ]] && pass "Custom count locked at 5"
```

---

### 1.4 Undo/改 label 统计回滚

**证据：**

DB 设计：`manual_labels` 表有 `UNIQUE(session_id, unit_id, phase)`，使用 `ON CONFLICT DO UPDATE`，每个 (session, unit, phase) 只有一条记录（最新 label）。

Undo 逻辑（`index.ts` L303-310）：
```typescript
await c.env.DB.prepare("DELETE FROM manual_labels WHERE session_id=? AND unit_id=? AND phase=?")
  .bind(body.session_id, body.unit_id, body.phase).run();
await c.env.DB.prepare("UPDATE assignments SET status='todo' WHERE ...")
  .bind(body.session_id, body.unit_id, body.phase, "manual").run();
// ...
await broadcastStats(c.env);  // 立即广播
```

统计查询（`stats.ts`）：
```typescript
// 基于当前DB状态的聚合，不是 append-only
"SELECT label, COUNT(*) as count FROM manual_labels WHERE phase = 'normal' GROUP BY label"
```

e2e_smoke.sh 验证：
- 提交 EXPLANATION → 检查 count ≥ 1
- Undo → 检查 EXPLANATION count **减少**
- 用 EVALUATION 重新提交 → 检查 EVALUATION count 增加，EXPLANATION 未增加

---

### 1.5 Admin 阶段切换（Stage 1/Stage 2）

**证据：** `apps/web/src/pages/admin/AdminDashboardNormalPage.tsx`

```tsx
const [stage, setStage] = useState<"normal" | "active">("normal");

// Tab bar
<button className={`tab-btn ${stage === "normal" ? "active" : ""}`} onClick={() => setStage("normal")}>
  📊 阶段 1 — 普通标注
</button>
<button className={`tab-btn ${stage === "active" ? "active" : ""}`} onClick={() => setStage("active")}>
  ⚡ 阶段 2 — 主动学习
</button>

// Conditional render
{stage === "normal" && <>  // 只显示 Normal Manual + Normal LLM 两张图
  <BarChart counts={normalManualStats} />
  <BarChart counts={normalLlmStats} />
</>}
{stage === "active" && <>  // 只显示 Active Manual + Active LLM 两张图
  <BarChart counts={activeManual} />
  <BarChart counts={activeLlm} />
</>}
```

此外：
- **冻结展示**按钮（`frozen` state）：冻结时 SSE 事件不更新图表（`frozenRef.current = true`），仅影响前端渲染，不影响后端统计
- **实时指标**：在线会话数 + 近 30 秒新增标注数

---

### 1.6 Active LLM 批处理（Prompt1 + Prompt2）

**证据：** `executeEdAlRun` 函数 (`index.ts` L~900+)

```typescript
// Step 6: Run Active LLM (Prompt1 + Prompt2) on selected diverse units
for (const unit of activeUnits) {
  const r1 = await runLlmWithRetry(env, { ..., mode: "prompt1" });
  await saveLlmPrediction(env, { sessionId: "system_active", ..., mode: "prompt1", ... });
  await acceptLlmLabel(env, { sessionId: "system_active", ..., mode: "prompt1", ... });

  const r2 = await runLlmWithRetry(env, { ..., mode: "prompt2" });
  await saveLlmPrediction(env, { sessionId: "system_active", ..., mode: "prompt2", ... });
  await acceptLlmLabel(env, { sessionId: "system_active", ..., mode: "prompt2", ... });
}
```

结果存入 `llm_labels(session_id='system_active', phase='active', mode='prompt1|prompt2')`。

Active LLM 统计（`stats.ts`）：
```sql
SELECT accepted_label as label, COUNT(*) as count
FROM llm_labels
WHERE phase = 'active' AND accepted_label IS NOT NULL
GROUP BY accepted_label
```

---

### 1.7 实时同步（SSE + Durable Object）

**证据：**

```
架构：
  用户提交标注 → Worker 写入 D1 → broadcastStats(env) → StatsHub DO
  StatsHub DO → 推送到所有 SSE 连接（admin 浏览器）
```

StatsHub (`statsHub.ts`)：持有 SSE 连接集合，`fetch("https://stats/broadcast")` 触发广播。

Admin 端订阅（`AdminDashboardNormalPage.tsx`）：
```typescript
const es = new EventSource(`${API_BASE}/api/stream/stats?token=${token}`);
es.addEventListener("stats_update", (e) => {
  if (frozenRef.current) return;  // 冻结时不更新
  const data = JSON.parse(e.data);
  if (data.normal) setNormalStats(data.normal);
  if (data.overall) setOverallStats(data.overall);
});
```

**统计不是 append-only**：每次 broadcast 前都重新 `GROUP BY` 聚合，反映 DB 当前状态。

sse_check.sh 验证：
1. 打开 SSE 连接（后台进程）
2. 提交标注 → 断言 SSE 事件在 4 秒内到达
3. 撤回标注 → 断言 SSE 事件在 4 秒内到达（含回滚）

---

### 1.8 Serverless 可靠记录 attempt 属性

**证据：**

前端 `useAttemptTracker.ts`：
- 500ms tick 更新 `activeMs / hiddenMs / idleMs`
- 监听 `visibilitychange / focus / blur / pointerdown / touchstart / keydown / pagehide`
- `finalize()` 返回完整 `AttemptPayload`

服务端接收并校验（`utils.ts` `validateAttempt`）：
```typescript
if (attempt.answered_at_epoch_ms < attempt.shown_at_epoch_ms) → "answered_before_shown"
if (attempt.active_ms < MIN_ACTIVE_MS(800)) → "active_ms_too_low"
if (had_background && hidden_ms > 50% total) → "too_much_background_time"
```

写入 `label_attempts`：`active_ms, hidden_ms, idle_ms, hidden_count, blur_count, had_background, is_valid, invalid_reason, shown_at_epoch_ms, answered_at_epoch_ms`。

覆盖范围：Page1 (manual submit)、Page2 (llm accept/override)、Page3 (active manual)。

---

### 1.9 Admin 安全边界

**证据：**

所有 `/api/admin/*` 路由第一行：
```typescript
app.get("/api/admin/stats/normal", async (c) => {
  if (!checkAdmin(c)) return json({ error: "unauthorized" }, 401);
  ...
});
```

`checkAdmin` 函数：
```typescript
function checkAdmin(c: any): boolean {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return token.length > 0 && token === c.env.ADMIN_TOKEN;
}
```

SSE 流：`?token=ADMIN_TOKEN` 验证（L1011）：
```typescript
if (token !== c.env.ADMIN_TOKEN) return json({ error: "unauthorized" }, 401);
```

User 路由（`/user/*`）：无任何 admin 链接。`App.tsx` 路由隔离，user 路由不导入 admin 组件。

e2e_smoke.sh 验证：无 Bearer 返回 401、错误 token 返回 401、export 无 token 返回 401。

---

### 1.10 Qwen-only（无 HKU）

**证据：**

`llm.ts`：仅 `callQwen / callQwenWithRetry`，无任何 HKU 分支。  
`types.ts` Env 接口：`QWEN_API_KEY, QWEN_BASE_URL, ADMIN_TOKEN, DB, STATS_HUB, MIN_ACTIVE_MS`（无 HKU 字段）。  
`wrangler.toml`：无 `HKU_API_VERSION` 等字段。  
`/api/health` 返回：`{ qwen: { key_present: bool } }`，无 HKU 字段。

e2e_smoke.sh 验证：
```bash
if echo "$HEALTH" | jq . | grep -qi "hku"; then
  fail "Health response contains HKU field (should be Qwen-only)"
fi
```

---

### 1.11 导出数据集（CSV/JSONL 含所有关键字段）

**证据：** `/api/admin/export` 包含字段：

```
session_id, user_id, unit_id, text,
manual_phase, manual_label, manual_labeled_at,
llm_p1_predicted, llm_p1_accepted, llm_p2_predicted, llm_p2_accepted,
llm_custom_predicted, llm_custom_accepted,
active_ms, hidden_ms, idle_ms, hidden_count, blur_count,
had_background, is_valid, invalid_reason,
shown_at_epoch_ms, answered_at_epoch_ms, attempt_at
```

e2e_smoke.sh 验证：
```bash
for col in session_id user_id unit_id text manual_label active_ms hidden_ms is_valid; do
  echo "$CSV_HEADER" | grep -q "$col" || fail "CSV missing column: $col"
done
```

---

### 1.12 并发/限流：Qwen 429 退避重试

**证据：** `llm.ts` `callQwenWithRetry`：

```typescript
const shouldRetry = status === 429 || status >= 500 || status === 0 || 
  error.message.includes("timeout") || error.message.includes("network");
// ...
await new Promise((r) => setTimeout(r, delay));
delay = Math.min(delay * 2, 8000);  // 指数退避，最大 8s
```

`runLlmWithRetry`（外层）：同样指数退避，最多 3 次外层重试。

ED-AL v1 采样间隔（`executeEdAlRun`）：每次 Qwen 调用后 `setTimeout(600ms)` + `setTimeout(500ms)`，避免并发 429。

---

## 2. ED-AL v1 算法说明

**实现位置：** `workers/api/src/index.ts` — `executeEdAlRun`

**算法流程：**

```
1. 候选池采样：SELECT unit_id, text FROM units ORDER BY RANDOM() LIMIT candidate_k

2. 不确定性（Entropy）：
   for each candidate:
     for i in range(sample_n):  # n=3, temperature=0.7
       label = callQwenSampling(unit.text, prompt2, taxonomy, temperature)
     H = shannonEntropy(labels, |taxonomy|)  # 归一化 [0,1]

3. 多样性（Diversity）：
   top_h = sorted(candidates, by=-H)[:top_h]
   vectors = buildTfIdfVectors([u.text for u in top_h])
   selected = kCenterGreedy(items, m=active_m, seed=seed)
   # kCenterGreedy: 贪心选最大最小距离点，确保最大覆盖

4. 写入 al_scores：
   reason = {"method":"ed_al_v1", "entropy":..., "top_labels":..., "diversity_rank":..., "selected":...}

5. Active LLM batch（对 selected units）：
   Prompt1 → saveLlmPrediction(session='system_active', mode='prompt1')
   Prompt2 → saveLlmPrediction(session='system_active', mode='prompt2')
```

**API 参数（/api/admin/al/run）：**
- `candidate_k`（默认 80）：候选池大小
- `top_h`（默认 40）：熵排序后取 Top H
- `sample_n`（默认 3）：每 unit 采样次数
- `active_m`（默认 20）：k-center greedy 选出数量
- `temperature`（默认 0.7）：Qwen 采样温度
- `seed`（默认 random）：k-center 起始点随机种子

**优势 vs 旧 v2 算法：**

| 维度 | 旧 v2（disagreement weighted） | ED-AL v1 |
|------|-------------------------------|----------|
| 不确定性 | Prompt1 vs Prompt2 是否不一致（0/1） | Shannon 熵（多次采样，连续值） |
| 多样性 | 无（只按分数排序） | TF-IDF + k-center greedy（空间覆盖） |
| 采样 | 3次 deterministic | n次 stochastic（temperature=0.7） |
| 理论基础 | 经验加权 | 信息论 + 几何覆盖 |

---

## 3. UI/UX 升级总结

| 组件 | 改进 |
|------|------|
| **index.css** | 全面移动端优先 CSS，CSS 变量，Duolingo 风格卡片/按钮 |
| **UserPhaseManualPage** | 进度环（圆形SVG）、Toast、卡片进入/离开动效、大触控按钮（≥52px）、长文折叠、AL 原因提示 |
| **UserNormalLlmPage** | Segmented control（3模式）、Skeleton loading + 计时、预测结果徽章、Bottom sheet 改选、Custom 次数徽章 |
| **AdminDashboardNormalPage** | Stage1/Stage2 Tab 切换、冻结按钮、实时点（live dot）、近30秒新增计数、完成状态徽章 |
| **App.tsx** | 添加 `/user/active/llm` 路由（UserActiveLlmPage），统一路由结构 |

---

## 4. 已知限制

| 项目 | 说明 |
|------|------|
| AL 运行时间 | candidateK=80, sampleN=3 约需 80×3×0.7s ≈ 170s；建议会前 10 分钟以上触发 |
| Worker CPU 限制 | Cloudflare Worker 单请求 50ms CPU；AL run 用 `executionCtx.waitUntil` 异步执行，不受此限 |
| SSE 稳定性 | 建议 Admin 使用 WIFI 稳定环境；EventSource 会自动重连 |
| 撤回历史 | 前端只保留 lastSubmitted（上一条）；可多次撤回当前最后一条 |
