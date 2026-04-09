# 线上验收：sentence-labeling-web.pages.dev

## 验证时间
在 https://sentence-labeling-web.pages.dev/ 上模仿真实用户操作，验证本次修复与需求是否已部署并生效。

---

## 0. Active Learning 跳转修复验收（2025-03-13）

**当前线上状态**：在未重新部署前，https://sentence-labeling-web.pages.dev 仍会显示旧版（例如完成页仍有「← 返回难度排序」）。需先部署前端后再验收。

### 0.1 本次修改摘要（代码已改，需部署后才生效）
| 问题 | 修改 |
|------|------|
| LLM 完成页出现「Back to ranking」且点击后从第一篇重做 | 完成页**移除**「Back to ranking」按钮，只保留「Undo last step」与「Label Comparison →」 |
| Active 结果页不应有「Change label」 | Active LLM 结果页**移除**「Change label」按钮，结果只读展示 |
| Active 完成页点「上一步」回退异常 | 回退到 visualization 时带 `state: { fromActiveDone: true }`，visualization 不再误重定向 |

### 0.2 部署后验收步骤
1. **Normal LLM 完成页**  
   - 走完普通人工 + 难度排序 + 普通 LLM 三篇文章，进入「你已完成普通阶段」页。  
   - **预期**：只有「撤销上一步（返回难度排序）」（若有）、「标签对比 →」，**没有**「← 返回难度排序」。

2. **Active LLM 结果页（U4）**  
   - 进入 `/user/active/llm` 查看结果列表。  
   - **预期**：每条结果只有预测标签与分数，**没有**「Change label / 修改标签」按钮。

3. **Active 阶段完成页回退**  
   - 在「Active phase completed」页点击「← Previous (back to label comparison)」。  
   - **预期**：进入标签对比/可视化页，且**不会**被自动重定向到其他步骤。

---

## 1. 已做过的线上检查（2025-03-12）

### 1.1 「返回主动学习标注」按钮存在且可点击
- **操作**：直接打开 `/user/active/llm`（有 5/5 条结果的会话），点击「← 返回主动学习标注」。
- **结果**：URL 会先变为 `/user/active/manual`，随后因 **gate 校验**（`can_enter_active_manual` 等）被重定向到 `/user/normal/manual`。
- **说明**：当前用「未走完普通流程」的会话测试时，会先进入 active manual 再被 gate 踢回 normal。要验证「全部完成」视图（不自动跳回 LLM 页），必须用 **已完成普通 LLM + 主动学习人工** 的会话，在「全部做完主动学习标注」后再点「返回主动学习标注」，此时应停留在主动学习人工的「全部完成」页并看到「查看 LLM 结果」等按钮。

### 1.2 线上是否已包含本次修改
- 本地修改包括：
  - **返回不跳转**：`UserPhaseManualPage` 在 active 且无下一题时不 `nav("/user/active/llm")`，只 `setUnit(null)`，从而展示「全部完成」视图。
  - **全部完成页**：新增「查看 LLM 结果」按钮（i18n: `flow.viewLlmResults`）。
  - **难度标签**：`EssayDisplay` 支持 `difficultyByUnitId`，主动学习人工时未标句子显示「S2 简单/中等/困难」，已标显示「S2 · 解释」等。
  - **提示词未配置**：后端在 prompt1/prompt2 为空时返回 400 与明确文案；前端用 `detail` 展示错误信息。
- 若线上 **未重新构建/部署**，则上述行为不会出现在 https://sentence-labeling-web.pages.dev/。需要部署后再按下面步骤验收。

---

## 2. 部署方式（确保「所有更新都到 link」）

前端（Pages）与后端（Worker + D1）需一起部署，才能完整验收。

### 2.1 前端（Cloudflare Pages）
- 若用 Git 关联：推送当前分支后，在 Cloudflare Pages 对应项目触发一次 **Build**（或等自动构建），确认构建成功并发布到 `sentence-labeling-web.pages.dev`。
- 若用 Wrangler 手动发布：
  ```bash
  cd apps/web && npm run build && npx wrangler pages deploy dist --project-name=<your-pages-project-name>
  ```

### 2.2 后端（Cloudflare Workers + D1）
- 发布 Worker（及绑定 D1）：
  ```bash
  cd workers/api && npm run deploy
  # 或从仓库根目录：npx wrangler deploy
  ```
- 确保 **API Base** 与前端一致（前端请求的 `VITE_API_BASE` 指向该 Worker）。

### 2.3 确认「所有更新都到 link」
- 部署完成后，在 https://sentence-labeling-web.pages.dev/ 按下面「真实用户流程」走一遍，重点看：
  - 返回主动学习标注后是否进入「全部完成」页且不自动跳回 LLM；
  - 主动学习人工页文章区是否出现难度标签（Sx 简单/中等/困难）及标后的内容标签（Sx · 解释 等）；
  - 未配置 Prompt 时一键标注是否出现明确错误提示。

---

## 3. 模仿真实用户操作的验收步骤

### 3.1 验收「返回主动学习标注」+「全部完成」视图
1. 打开 https://sentence-labeling-web.pages.dev/ ，选择语言，点击「开始体验」。
2. 在「用户端」页点击「开始标注」，进入普通人工标注。
3. 完成 **所有** 普通人工句子（多篇文章、每句选一个标签）。
4. 完成 **难度排序**（若有）。
5. 进入 **普通 LLM** 页，完成本阶段（可点「一键标注」并接受等），直到进入下一阶段入口。
6. 进入 **主动学习人工标注**，完成 **所有** 主动学习句子。
7. 自动或手动进入 **主动学习 LLM 结果页**（U4：主动学习模型结果）。
8. 点击「**← 返回主动学习标注**」。
9. **预期**：
   - 停留在 **主动学习人工标注** 的「全部完成」页（有祝贺、进度等）；
   - **不会** 自动跳回「主动学习 LLM 结果」页；
   - 页上有「**查看 LLM 结果**」「上一步（返回标签对比）」「填写问卷 →」等按钮；
   - 点击「查看 LLM 结果」可再次进入 `/user/active/llm`。

若未部署最新前端：点「返回主动学习标注」后可能会 **立刻** 被重定向回 `/user/active/llm`，且不会出现「查看 LLM 结果」按钮。

### 3.2 验收「难度标签 + 标后内容标签」
1. 在 **主动学习人工标注** 页，当前文章卡片上方应有一段「文章 N」的摘要，每句以 **S1、S2、…** 形式展示。
2. **未标注的句子**：应显示难度标签，例如「S1 简单」「S2 中等」「S3 困难」（具体文案以 i18n 为准）。
3. **已标注的句子**：应显示内容标签，例如「S1 · 解释」「S2 · 影响」，**不再** 显示难度。
4. 标完一句后，该句从「Sx 简单/中等/困难」变为「Sx · 解释」等，即视为通过。

若未部署最新前端或后端未支持 `phase=active` 的 essay-labels：文章区可能只有「S1」「S2」无难度，或标后无「· 标签」形式。

### 3.3 验收「提示词未配置」错误提示
1. 在 **管理后台** 将 Prompt 1 / Prompt 2 清空并保存（或使用未配置过的环境）。
2. 在 **普通 LLM** 页选择「提示词 1」或「提示词 2」，点击「一键标注本篇文章」。
3. **预期**：
   - 请求返回 400，前端 Toast（或错误区）展示明确中文提示，例如：「对应提示词策略未配置，请在管理后台配置 Prompt 1 / Prompt 2。」（或后端返回的 `detail` 文案）。
4. 选择「自定义提示词」并输入内容后一键标注：若后端限制批量仅支持 prompt1/prompt2，应看到相应错误提示（如「一键标注本篇文章不支持自定义提示词」）。

若未部署最新后端：可能只出现笼统错误或英文 message，无上述中文 `detail`。

---

## 4. 简要结论

- **返回按钮**：线上已存在且能跳转到 `/user/active/manual`；因 gate 与会话进度，用未完成会话测试时会再被重定向到 normal/manual，属预期。
- **「全部完成」不跳转 +「查看 LLM 结果」**：需 **完成整条流程** 且 **部署最新前端** 后，在「全部做完主动学习标注」→ 进入 LLM 结果页 → 点「返回主动学习标注」时验收。
- **难度/内容标签**：需 **部署最新前端 + 后端**（essay-labels 支持 `phase=active`）后，在主动学习人工页验收。
- **提示词未配置**：需 **部署最新后端** 后，在未配置 Prompt 时验收。

确保「所有更新都到 link」：在 Cloudflare 上对 **Pages（前端）** 和 **Workers（API）** 均执行一次构建与发布，再按上述步骤做一次完整真实用户流程验收。
