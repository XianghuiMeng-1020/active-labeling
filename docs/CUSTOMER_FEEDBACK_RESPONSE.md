# 用户反馈逐条回应

本文档对用户提出的需求逐条说明当前实现状态与处理方式。

---

## 1. 标题下方文字改为黑色

**用户原话：**  
Use black color for the words below the title "sentence difficulty ranking"

**回应：**  
已实现。  
「句子难度排序」标题下方的说明文字（`ranking.hint` 与拖拽说明 `ranking.dragInstruction`）的样式已改为黑色（`#000`），对应样式在 `index.css` 的 `.ranking-hint` 与 `.ranking-subtitle` 中。

---

## 2. 措辞确认为 “drag the hardest to easiest”

**用户原话：**  
About wording, do you mean, "drag the hardest to easiest" ?

**回应：**  
已按此措辞更新。  
- 英文：`"Drag the hardest to easiest"`  
- 简体中文：`"拖拽排序：从最难到最容易（drag the hardest to easiest）"`  
- 繁体中文：`"拖曳排序：從最難到最容易（drag the hardest to easiest）"`  

上述文案已写入 i18n 的 `ranking.dragInstruction`，并在难度排序卡片上展示。

---

## 3. 排名完成后能回到排名/标注流程

**用户原话：**  
After finishing ranking, the system direct me to here, but I would like to get back to the ranking page, seems that there is no previous page button?

**回应：**  
已实现。  
在「普通阶段已完成」页（完成 Normal LLM 后看到的页面）增加了 **「← Back to ranking / 返回难度排序」** 按钮，点击后会跳转到 `/user/normal/manual`，可重新进入手动标注与难度排序相关流程。

---

## 4. 在排名页返回并修改上一步（本篇）的标签

**用户原话：**  
Also, at ranking page, if I would like to change the label in the previous step, i could not get back

**回应：**  
已实现。  
- 在**难度排序页**增加了 **「← Back to edit labels (this essay) / 返回编辑本篇标签」** 按钮。  
- 点击后调用后端接口 `POST /api/ranking/reopen`，会：  
  - 删除当前这篇的排名提交记录；  
  - 将该篇所有句子的标注与尝试记录回滚为「未完成」；  
  - 使该篇重新进入待标注状态。  
- 随后页面会重新加载，并展示**同一篇文章**的第一句，用户可从头重新标注并修改任意句子的标签，完成后会再次进入难度排序。

---

## 5. 在同一句上试 Prompt 1 和 Prompt 2，且不自动跳下一句

**用户原话：**  
I use prompt 1 annotated the first sentence (S1), but i'm also curious about the prompt 2 on the first sentence (S1). The current feature seems automatically moving to the next sentence.

**回应：**  
已实现。  
- 点击「接受」后**不再自动**跳转到下一句。  
- 会先显示「已接受。可换提示词再试或进入下一句。」并出现两个按钮：  
  - **「用提示词 2 再试 / Try Prompt 2」**：对**同一句**（如 S1）再跑 Prompt 2，可对比两个提示词的结果；  
  - **「下一句 / Next sentence」**：此时才提交并进入下一句。  
因此可以在同一句上先试 Prompt 1、再试 Prompt 2，再决定是否点「下一句」。

---

## 6. 尝试次数提示与节省 token

**用户原话：**  
To save the token, we can indicate "you have 2 attempts left", every time user run the prompt, the remained number of attempts gets reduce

**回应：**  
已实现。  
- 每句默认 **2 次**运行机会（Prompt 1 / Prompt 2 各算一次）。  
- 在「选择提示词模式」下方显示：**「剩余 X 次尝试」**（英文："You have X attempts left"），每次点击「运行」后剩余次数减 1。  
- 用完 2 次后需先「接受」再点「下一句」；若点「用提示词 2 再试」，会重置该句的尝试次数以便再跑。  
这样既控制 token 使用，又保留在同一句上试不同提示词的能力。

---

## 7. 图表增加 X、Y 轴标签（Y 轴示例：frequency）

**用户原话：**  
Add x and y labels. E.g. Y label, "frequency"

**回应：**  
已实现。  
- 用户端可视化页的**标签分布图**已为 X、Y 轴配置标题：  
  - **X 轴**：`Label`（标签）；  
  - **Y 轴**：`Frequency`（英文）/ `频次`（中文）。  
- 通用 `BarChart` 组件支持可选 `xAxisLabel`、`yAxisLabel`，其他使用该组件的图表也可按需设置轴标签。

---

## 8. 主动学习与普通标注在 UI/UX 上区分

**用户原话：**  
The active learning version seems showing no difference from the manual and LLM annotation (in terms of UI/UX)

**回应：**  
已实现。  
- **U3 主动学习人工标注页**：进度条区域使用紫色系 `active-learning` 样式（紫色渐变背景、进度环与标题），卡片保留紫色左边框与「⚡ Active Learning」徽章。  
- **U4 主动学习模型结果页**：顶部 hero 使用紫色渐变 `hero-banner active-learning`，并显示「⚡ Active Learning」徽章。  
主动学习流程在视觉上与普通 Manual / LLM 标注已明确区分。

---

## 9. 基于熵的 Easy/Medium/Hard 标签

**用户原话：**  
We can indicate label Easy/Medium/Hard? Based on Entropy or other measures, the labels can be prepared?

**回应：**  
已实现。  
- 从接口返回的 `al_reason` 中的 **entropy** 计算难度：  
  - 熵 &lt; 0.35 → **Easy / 容易**  
  - 0.35 ≤ 熵 &lt; 0.65 → **Medium / 中等**  
  - 熵 ≥ 0.65 → **Hard / 较难**  
- 在 **U3 主动学习人工标注**的单元卡片上，在「⚡ 主动学习」旁显示对应难度芯片（绿/黄/红样式）。  
标签完全基于后端已有的 entropy 指标，无需额外接口。

---

## 汇总表

| # | 需求摘要 | 状态 | 说明 |
|---|----------|------|------|
| 1 | 标题下文字黑色 | ✅ 已实现 | `.ranking-hint` / `.ranking-subtitle` 设为黑色 |
| 2 | 措辞 "drag the hardest to easiest" | ✅ 已实现 | i18n `ranking.dragInstruction` 已更新 |
| 3 | 排名完成后能回到排名/标注 | ✅ 已实现 | 完成页增加「Back to ranking」按钮 |
| 4 | 排名页返回并修改本篇标签 | ✅ 已实现 | 「Back to edit labels」+ 后端 `/api/ranking/reopen` |
| 5 | 同一句试 Prompt 1/2，不自动下一句 | ✅ 已实现 | 接受后显示 Try Prompt 2 / Next sentence |
| 6 | “You have 2 attempts left” 且随运行减少 | ✅ 已实现 | 每句 2 次，文案 + 次数递减 |
| 7 | 图表 X/Y 轴标签，Y 为 frequency | ✅ 已实现 | 可视化页 Y=Frequency，X=Label |
| 8 | 主动学习 UI 与普通标注区分 | ✅ 已实现 | 紫色 active-learning 样式与徽章 |
| 9 | Easy/Medium/Hard 基于 Entropy | ✅ 已实现 | `getDifficultyFromReason(al_reason)` + 芯片展示 |

以上需求均已落地；若后续有新的文案或阈值（如尝试次数、熵区间）需要调整，可在此基础上微调即可。
