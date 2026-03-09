# 第 10 条意见：Can we add the symbol（待澄清）

**来源**：Xianghui Meeting Note（2026-03-12 向晖定期检查会议）

**用户原话**：Can we add the symbol

**状态**：✅ 已实现（在语言切换下拉旁增加 🌐 符号）

**原需澄清内容**（已通过截图确认）：

1. **要添加的 symbol 是什么？**  
   例如：图标（如拖拽手柄 ⋮⋮、难度图标、步骤序号）、某种指示符号、或其它图形/字符。

2. **加在哪个页面/哪个元素？**  
   例如：
   - 难度排序页标题「Sentence difficulty ranking」旁
   - 拖拽说明「Drag the hardest to easiest」旁
   - Back 按钮上（如 ← 已有，是否再增加其它符号）
   - 其它页面或组件

**实现**：在 [apps/web/src/components/LanguageSwitcher.tsx](apps/web/src/components/LanguageSwitcher.tsx) 中于语言下拉左侧增加 🌐 符号（`.lang-switcher-symbol`），样式见 [apps/web/src/index.css](apps/web/src/index.css)。
