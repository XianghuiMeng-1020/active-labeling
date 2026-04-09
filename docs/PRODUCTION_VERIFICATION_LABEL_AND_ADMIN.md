# 生产环境验证：标签对比与 Admin 站点

**验证时间**: 2026-03-10  
**站点**: https://sentence-labeling-web.pages.dev

---

## 一、真实用户操作模拟结果

### 1. 用户端流程（已跑通部分）

| 步骤 | URL/页面 | 结果 |
|------|----------|------|
| 欢迎页 | `/welcome` | ✅ 正常：标题、三步说明、「Let's Go」按钮、语言切换 |
| 开始页 | `/user/start` | ✅ 正常：昵称、同意勾选、「Start Labeling」/「Resume」/「Reset」 |
| 开始标注 | 点击 Start Labeling | ✅ 正常：跳转到 `/user/normal/manual` |
| 人工标注 | `/user/normal/manual` | ✅ 正常：5 个标签按钮（Explanation, Evaluation, Responsibility, Application, Implication）、提交后出现「Undo last step」 |
| 直接访问可视化 | `/user/visualization` | ✅ 符合预期：未完成前置流程时被重定向回 `/user/normal/manual`（权限控制正常） |

### 2. 未在浏览器内完整跑通的原因

- 进入**可视化页**需要：完成全部「普通人工」+「普通 LLM」标注。
- 进入**主动学习完成页**（含「上一步」按钮）需要：再完成「主动学习人工」且 Admin 已触发过 ED-AL。
- 上述流程较长，未在本次自动化中跑满整条链路，但各环节路由与权限逻辑正常。

---

## 二、老师提到的问题 — 是否已落实（代码与逻辑）

| 老师反馈 | 是否已处理 | 实现位置说明 |
|----------|------------|-----------------------------|
| **Title 改成「标签对比」，不是「效率对比」** | ✅ 已处理 | `i18n`: `viz.title` 改为「标签对比」/「標籤對比」/「Label Comparison」；`UserVisualizationPage` 使用 `t("viz.title")` 作为主标题 |
| **LLM 标签无显示** | ✅ 已处理 | 表结构改为三列后，第三列专门展示 `s.llm_label`（有则 `labelText(s.llm_label)`，无则「—」）；后端 `GET /api/stats/label-difference` 已返回 `llm_label` |
| **人工/LLM 列里都有文章文字，重复 → 改为三列：文本 \| 人工标签 \| LLM 标签** | ✅ 已处理 | `UserVisualizationPage`: 表格为 `gridTemplateColumns: "1fr auto auto"`，列头为 `viz.textColumn` / `viz.manualLabelColumn` / `viz.llmLabelColumn`；第一列仅 `s.text`，第二列仅 `labelText(s.human_label)`，第三列仅 LLM 标签 |
| **主动学习贴标时显示 AI 难易，并按难易顺序贴标** | ✅ 已处理 | 后端 ED-AL 中对选中单元调用 `getDifficultyFromLlm`，结果写入 `reason.difficulty_llm`；`assignUnits` 按 `difficulty_llm`（Hard 优先）再按 score 排序；前端 `getDifficultyFromReason` 优先用 `difficulty_llm`，卡片展示 Easy/Medium/Hard 芯片 |
| **主动学习做完后无法上一步** | ✅ 已处理 | 主动学习完成页增加「← 上一步（返回标签对比）」按钮，`onClick` 为 `nav("/user/visualization")`，与「填写问卷」并列 |

---

## 三、Admin 站点

| 项目 | 说明 |
|------|------|
| **入口** | https://sentence-labeling-web.pages.dev/admin → 会跳转到 **/admin/login** |
| **登录** | 需要输入 **Admin Token**（`ADMIN_TOKEN` 环境变量），输入后「Login Admin」可点击 |
| **页面内容** | 标题：「Admin Login」「Sentence Labeling Admin Console」；有语言切换、Token 输入框、登录按钮 |
| **结论** | Admin 站点已部署且受 Token 保护；未在验证中输入真实 Token，故未进入 Dashboard（统计、ED-AL 触发等） |

---

## 四、建议的后续自测（可选）

1. **完整用户流**：用同一 session 完成 15 条普通人工 + 15 条普通 LLM → 进入可视化页，确认：  
   - 主标题为「标签对比」；  
   - 表格为三列「文本 | 人工标签 | LLM 标签」，且 LLM 列有内容或「—」。
2. **主动学习完成页**：在 Admin 触发 ED-AL 后，完成主动学习人工 → 确认出现「上一步」与「填写问卷」两个按钮，点击「上一步」回到标签对比页。
3. **Admin**：使用正确 `ADMIN_TOKEN` 登录后，检查 Dashboard、配置、ED-AL 触发等是否正常。

---

## 五、小结

- **用户端**：欢迎 → 开始 → 人工标注 流程在 https://sentence-labeling-web.pages.dev 上行为正常；未完成前置步骤时无法进入可视化，符合设计。
- **老师提出的 5 点**：均在代码与逻辑上完成修改并已合入；生产环境需走完完整流程或直接访问已满足条件的 session 才能在实际页面上看到「标签对比」三列表和「上一步」按钮。
- **Admin**：已上线，入口为 `/admin`，需配置并持有 `ADMIN_TOKEN` 方可登录使用。
