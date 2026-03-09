# 标注工具选择/下拉复查报告（第 11 条意见）

**来源**：Xianghui Meeting Note（2026-03-12）— “Additionally double check the drop down menu of our current annotation tool”

**复查日期**：按计划执行  
**范围**：标注工具内所有与「选择 / 下拉」相关的交互。

---

## 一、范围界定

| 序号 | 名称 | 位置 | 类型 |
|------|------|------|------|
| 1 | 语言切换 | `LanguageSwitcher.tsx` | 唯一原生 `<select>` 下拉 |
| 2 | 手动标注标签选择 | `UserPhaseManualPage.tsx` | 标签按钮网格 + 快捷键 1–9 |
| 3 | LLM 标注 Override 选标签 | `UserNormalLlmPage.tsx`（OverrideSheet） | 底部 Sheet 内标签按钮网格 |
| 4 | 提示词模式选择 | `UserNormalLlmPage.tsx` | 分段控件（Prompt 1 / Prompt 2 / Custom） |

---

## 二、检查结果

### 2.1 功能

| 项目 | 结果 | 说明 |
|------|------|------|
| 语言切换选项与 i18n 一致 | 通过 | 选项来自 `t(\`lang.${item}\`)`，zh-Hans / zh-Hant / en 齐全 |
| 标签选项与后端/配置一致 | 通过 | Manual / LLM 均使用 `api.getTaxonomy()`，过滤 CODE/UNKNOWN 后展示 |
| 选择后正确提交并刷新状态 | 通过 | Manual 提交后 load 下一 unit；LLM 接受/Override 后状态与试次逻辑正确 |
| 提示词模式与接口一致 | 通过 | prompt1 / prompt2 / custom 与后端模式一致，文案来自 i18n |

### 2.2 可访问性（a11y）

| 项目 | 结果 | 说明 |
|------|------|------|
| 语言切换 `<select>` 的关联标签 | 需改进 | 有 `<label htmlFor="lang-select">`，但 CSS 中 `.lang-switcher label { display: none }`，视觉上无标签。建议为 `<select>` 增加 `aria-label`，以便在标签不可见时仍向辅助技术提供名称 |
| 键盘可聚焦、Enter/Space 触发 | 通过 | select 与 button 均默认可聚焦、可触发 |
| 焦点顺序合理 | 通过 | 无自定义 tabIndex，顺序依 DOM 顺序 |
| 标签选择区域（Manual/Override） | 通过 | 按钮网格，每个按钮文案即选项含义，上下文有「选择标签」说明 |

### 2.3 多语言（i18n）

| 项目 | 结果 | 说明 |
|------|------|------|
| 语言切换选项 | 通过 | `lang.zh-Hans` / `lang.zh-Hant` / `lang.en` 中英繁均有 |
| 标签文案 | 通过 | `label.CODE`、`label.EXPLANATION` 等三语齐全；`labelText()` 走 i18n |
| 提示词模式文案 | 通过 | `flow.modePrompt1` / `flow.modePrompt2` / `flow.modeCustom` 三语齐全 |
| 选择相关说明文案 | 通过 | `flow.selectLabel`、`flow.overrideTitle`、`flow.selectPromptMode` 等均走 i18n，无硬编码 |

### 2.4 样式与一致性

| 项目 | 结果 | 说明 |
|------|------|------|
| 与设计规范一致 | 通过 | 使用统一 `.label-grid`、`.segmented`、`.lang-switcher select` 等 |
| 窄屏/大屏无错位、遮挡 | 通过 | 未发现明显错位或重叠 |

---

## 三、问题与修复建议

| # | 问题 | 建议修复 | 文件 |
|---|------|-----------|------|
| 1 | 语言切换下拉在视觉上无可见标签，仅依赖隐藏的 `<label>` | 为 `<select>` 增加 `aria-label={t("lang.label")}`，保证辅助技术能获得「语言」含义 | [apps/web/src/components/LanguageSwitcher.tsx](apps/web/src/components/LanguageSwitcher.tsx) |

其余项检查通过，无需修改。

---

## 四、结论

- **范围**：已覆盖语言切换、手动/LLM 标签选择、提示词模式选择。
- **结论**：功能、i18n、样式均符合要求；可访问性上建议对语言切换 `<select>` 增加 `aria-label`（见上表）。
- **后续**：完成上述 1 处修改后，第 11 条「double check the drop down menu」即视为已落实。
