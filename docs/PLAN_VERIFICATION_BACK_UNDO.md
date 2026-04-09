# 标注流程与标签展示改进 — 计划对照与回退/边界验证

本文档对照 [标注流程与标签展示改进计划](.cursor/plans/标注流程与标签展示改进_c5e8caa5.plan.md)，逐条确认是否已实现，并列出「模拟真人反复回退、边界操作」的验证方式。

---

## 一、计划中的 6 类需求 — 实现状态

| # | 需求 | 状态 | 代码/行为证据 |
|---|------|------|----------------|
| **1** | 排序后撤回：想 undo 回到排序结果，不要跳到句子重新 label | ✅ 已实现 | 见下 § 1.1、§ 1.2 |
| **2** | S1 后记录并展示 label（贴标时本篇已标句子显示标签） | ✅ 已实现 | EssayDisplay 接收 `labelsByUnitId`，显示「Sx · 评估」等 |
| **3** | 排序界面显示 label（拖拽列表里 S1/S2 旁显示已贴标签） | ✅ 已实现 | DifficultyRanking 接收 `labelsByUnitId`，列表项显示「S1 · 评估」 |
| **4** | 标签对比页：标题「标签对比」、LLM 列显示、三列表格 | ✅ 已实现 | viz.title；label-difference 用 COALESCE(prompt2,prompt1,custom)；三列已存在 |
| **5** | 剩余 0 次尝试改为红色 | ✅ 已实现 | UserNormalLlmPage 中 `attemptsLeft` 当 n===0 时 `color: var(--color-error)` |
| **6** | 主动学习阶段「上一步」/ 与第 1 点一致 | ✅ 已实现 | 与需求 1 共用「撤回上一步」与「返回上一篇文章的排序」逻辑 |

---

## 二、回退相关实现核对（需求 1、6）

### 2.1 从「当前篇排序」回到「上一篇排序」（不 reopen、不删上一篇 ranking）

- **方案**：排序页增加「返回上一篇文章的排序」按钮（仅当 `rankingEssayIndex > 1`）。
- **实现**：
  - [UserPhaseManualPage](apps/web/src/pages/user/UserPhaseManualPage.tsx)：传 `onBackToPreviousRanking`、`backToPreviousRankingLabel` 给 DifficultyRanking；回调为 `() => setRankingEssayIndex(rankingEssayIndex - 1)`，不调 API、不调 load()。
  - [DifficultyRanking](apps/web/src/components/DifficultyRanking.tsx)：渲染「返回上一篇文章的排序」按钮，点击调用 `onBackToPreviousRanking`。
- **结论**：✅ 已实现；反复点「返回上一篇」可在多篇排序之间来回切换，不会进入句子贴标。

### 2.2 从 normal/llm 完成页「撤回上一步」回到最后一篇排序

- **方案**：后端 `POST /api/ranking/undo` 只删 ranking 记录；进入 LLM 时带 `lastRankedEssayIndex`；LLM 完成页显示「撤回上一步」并带 `showRankingForEssay` 回 manual。
- **实现**：
  - 后端 [workers/api/src/index.ts](workers/api/src/index.ts)：`POST /api/ranking/undo` 仅 `DELETE FROM ranking_submissions WHERE session_id=? AND essay_index=?`。
  - [UserPhaseManualPage](apps/web/src/pages/user/UserPhaseManualPage.tsx)：`load()` 后若无 next.unit 且 phase 为 normal，则 `nav("/user/normal/llm", { state: { lastRankedEssayIndex } })`（取 `rankedEssays` 中最大 essay_index）。接收 `location.state.showRankingForEssay`，在 load 完成后若存在且有效则 `setRankingEssayIndex(showRankingForEssay)`、`setShowRanking(true)` 并 replace 清 state，且用 `appliedShowRankingRef` 只应用一次。
  - [UserNormalLlmPage](apps/web/src/pages/user/UserNormalLlmPage.tsx)：读 `location.state.lastRankedEssayIndex`；完成页展示「撤回上一步（返回难度排序）」；点击后调 `api.undoRanking`，再 `nav("/user/normal/manual", { state: { showRankingForEssay: lastRankedEssayIndex } })`。
- **结论**：✅ 已实现；从 LLM 完成页撤回会回到该篇排序视图，而不会跳到句子贴标。

### 2.3 区分「返回编辑本篇标签」与「仅返回排序」

- **方案**：保留「返回编辑本篇标签」并明确文案；新增「返回上一篇文章的排序」和 LLM 完成页「撤回上一步」。
- **实现**：排序页两个按钮并存；i18n 有 `ranking.backToEditLabels` 与 `ranking.backToPreviousRanking`、`flow.undoBackToRanking`。
- **结论**：✅ 已实现；用户不会误把「返回」当成「只回到排序」却进了贴标。

---

## 三、模拟真人回退与边界操作 — 检查清单

以下场景在**本地启动 Worker + 前端**后可用于手测或 E2E，确认计划中的问题均被覆盖。

### 3.1 回退动线

| 操作路径 | 预期 | 对应计划问题 |
|----------|------|--------------|
| 完成第 1 篇 5 句 → 进入第 1 篇排序 → 提交 → 进入第 2 篇排序 → 点「返回上一篇文章的排序」 | 回到第 1 篇排序视图，可再次提交或继续点「返回」 | 需求 1：不跳到句子 label |
| 同上，在第 2 篇排序点「返回编辑本篇标签」 | 进入第 2 篇的句子贴标（label-grid），不是排序 | 需求 1：区分两种返回 |
| 完成 3 篇排序 → 进入 normal/llm → 完成 15 条 LLM → 在完成页点「撤回上一步（返回难度排序）」 | 回到 manual 并显示第 3 篇排序视图 | 需求 1、6：回到排序而非贴标 |
| 在第 1 篇排序页（无「返回上一篇」） | 不显示「返回上一篇文章的排序」按钮 | 边界：第一篇不误展示 |

### 3.2 边界与异常

| 场景 | 预期 | 说明 |
|------|------|------|
| 直接打开 `/user/normal/manual`（无 state）且存在未排序文章 | load() 后自动进入第一篇未排序的排序视图 | 不依赖 state |
| 从 LLM 撤回后 manual 页带 `showRankingForEssay` | 应用后显示该篇排序并 replace 清 state，避免重复应用 | appliedShowRankingRef |
| API 先 undo 某篇 ranking，再打开 manual | 该篇变为「未排序」，load() 会进入该篇排序 | 与后端一致 |
| 排序页快速多次点「返回上一篇文章的排序」 | 仅 setState，顺序递减，无重复请求 | 纯前端状态 |

### 3.3 E2E 自动化（需本地 API + 前端）

[tests/back_undo_edge_cases.spec.ts](tests/back_undo_edge_cases.spec.ts) 覆盖：

- 2 篇标完、第 1 篇已排序 → 打开 manual 应看到第 2 篇排序。
- 在第 2 篇排序点「返回上一篇文章的排序」→ 回到第 1 篇排序视图。
- 从 LLM 完成页点「撤回上一步」→ 回到 manual 并显示排序视图。
- 在排序页点「返回编辑本篇标签」→ 进入句子贴标（label-grid）。
- 先排完 3 篇 → API 调用 undo 第 3 篇 → 再打开 manual 应出现第 3 篇排序。
- **边界**：第 2 篇排序 → 点「返回上一篇文章的排序」→ 再点「确认排序」→ 应进入下一篇排序或 LLM，不报错。
- **边界**：无 session 直接打开 `/user/normal/manual` → 应跳到 start 或显示开始按钮，不报错。

说明：E2E 通过 API 造数据后会在浏览器中注入 `labeling_session_id`（`injectSession`），再访问 manual/llm 页，否则前端会因无 session 重定向到 start。

运行方式（需先启动 Worker 8787 + 前端 5173）：

```bash
# 方式一：npm 脚本（会使用默认 localhost）
npm run test:back-undo:ci

# 方式二：直接指定环境
BASE_URL=http://localhost:5173 API_BASE=http://localhost:8787 npx playwright test tests/back_undo_edge_cases.spec.ts --project=chromium
```

若未启动 API，用例会**自动跳过**（`skipIfApiUnavailable` 检测 `/api/health`），不会报错，便于在未起服务时也能跑全量 Playwright。

---

## 四、其他计划项（需求 2–5）简要对照

- **S1 后展示 label**：EssayDisplay 使用 `labelsByUnitId`，已标句子显示「Sx · 标签」；UserPhaseManualPage 请求 `getEssayLabels` 写入 `essayLabelsMap` 并传入。
- **排序列表展示 label**：DifficultyRanking 使用 `labelsByUnitId`，列表项显示「S1 · 评估」等；数据来源同上。
- **标签对比页**：viz.title 为「标签对比」；label-difference 使用 `COALESCE(l2, l1, lc)`，LLM 列有 prompt1/custom 时也会显示；三列（文本 | 人工 | LLM）已存在。
- **剩余 0 次尝试红色**：UserNormalLlmPage 中「剩余 {n} 次尝试」在 `n === 0` 时使用 `var(--color-error)`。

---

## 五、结论

- 计划中的 **6 类需求** 在代码层面均已实现。
- **回退与边界**：  
  - 「排序后撤回」和「从 LLM 撤回」都会回到**排序视图**，不会误入句子重新 label。  
  - 「返回编辑本篇标签」与「返回上一篇文章的排序」已区分，且第一篇排序不显示「返回上一篇」。  
- 建议在本地启动服务后按 §3 做一次手测，并跑通 `tests/back_undo_edge_cases.spec.ts` 以回归验证。
