# 生产环境验证：老师需求 + 用户/Admin 入口

**站点**：https://sentence-labeling-web.pages.dev  
**验证时间**：按本清单在浏览器中自测或跑 E2E。

---

## 一、老师提到的需求是否都已落实

| 需求 | 状态 | 说明 |
|------|------|------|
| 记录每个 page 用户所用时间 | ✅ | `page_views` 表 + `/api/page-view/enter`、`/api/page-view/leave`；App 内路由切换时自动上报（仅当有 sessionId 时） |
| 记录每个 page 里每道题用户所用时间 | ✅ | 沿用现有 `label_attempts`（每道题有 `shown_at_epoch_ms`、`answered_at_epoch_ms`、`active_ms` 等） |
| LLM 标注时把 LLM 生成的 label 存下来 | ✅ | 已有：`/api/llm/run` 返回后调用 `saveLlmPrediction()` 写入 `llm_labels.predicted_label` |
| 标注差异对比（人 vs LLM，在效率对比之前） | ✅ | 可视化页顶部「标注差异对比」：三篇文章、每篇两栏（人工 / LLM）、差异高亮；接口 `GET /api/stats/label-difference?session_id=xxx` |
| 三个 chunk 对应三篇文章，一栏 human 一栏 LLM，颜色 highlight 不同 | ✅ | 同上，黄色背景高亮 `diff === true` 的单元格 |
| 主动学习版本只选一篇 | ✅ | `assignUnits` 已改：active 阶段按三篇信息量总和选**一篇**（信息量最高的），只从该篇取 unit 分配 |
| 用户看到三篇文章的 informativeness 对比 | ✅ | 可视化页「三篇文章信息量对比」卡片，数据来自 `GET /api/stats/informativeness` |
| 按难易程度排序，把最难标注的句子排到最上面 | ✅ | `ranking.hint` / `ranking.dragInstruction` 已改为「按难易程度排序，最难排到最上面」 |
| 撤回放到选项最下面 | ✅ | 撤回横幅在标注卡片内、标签按钮下方（`UserPhaseManualPage`） |
| 撤回 pop/按钮文案改为「撤回上一步」 | ✅ | 按钮使用 `flow.undoLastStep`（撤回上一步 / Undo last step） |
| 最后一个 survey 提交后显示 Complete | ✅ | 问卷提交成功页展示「完成」+ 感谢语（`survey.complete`） |

---

## 二、用户入口（真实用户操作路径）

- **首页**：https://sentence-labeling-web.pages.dev/ → 重定向到 `/welcome`
- **Welcome**：https://sentence-labeling-web.pages.dev/welcome → 点击「Let's Go」→ `/user/start`
- **开始标注**：https://sentence-labeling-web.pages.dev/user/start → 点击开始 → `/user/normal/manual`
- **人工标注**：标签按钮在页上，**撤回在卡片最下方**，按钮文案为「↩ 撤回上一步」
- **难度排序**：完成一篇后出现，文案为「按难易程度排序，把最难标注的句子排到最上面」
- **LLM 标注**：`/user/normal/llm` → 完成后可进可视化
- **可视化**：`/user/visualization` → 先「标注差异对比」+「三篇文章信息量对比」，再标签分布与耗时对比
- **问卷**：`/user/survey` → 提交后显示「完成」+ 感谢

---

## 三、Admin 入口（同一域名）

- **Admin 登录**：https://sentence-labeling-web.pages.dev/admin 或 https://sentence-labeling-web.pages.dev/admin/login  
- **Dashboard**：https://sentence-labeling-web.pages.dev/admin/dashboard 或 `/admin/dashboard/normal`
- **Overall**：https://sentence-labeling-web.pages.dev/admin/dashboard/overall
- **配置**：https://sentence-labeling-web.pages.dev/admin/config
- **Units**：https://sentence-labeling-web.pages.dev/admin/units
- **运维/日志**：https://sentence-labeling-web.pages.dev/admin/ops

Admin 需在登录页输入正确的 Admin Token（与后端配置一致），通过后即可访问上述页面。

---

## 四、E2E 模拟真实用户（已跑通过）

在项目根目录执行：

```bash
BASE_URL=https://sentence-labeling-web.pages.dev npx playwright test tests/production_full_e2e.spec.ts --project=chromium
```

覆盖：首页/welcome/start、开始标注进 manual、manual 标签与难度排序、LLM 页、可视化页、Active 页、语言切换等。  
**注意**：新加的「标注差异」「信息量对比」「问卷 Complete」「撤回上一步」等尚未单独写进 E2E，需人工在线上点一轮确认。

---

## 五、潜在问题与注意点

1. **Page view 接口**：若后端未执行迁移 `0010_page_views.sql`，`/api/page-view/enter`、`/api/page-view/leave` 会报错；前端已 `catch` 忽略，不影响页面展示，但不会记到 `page_views`。部署 Worker 后请执行：  
   `npx wrangler d1 migrations apply labeling_db --remote`（或你们实际 DB 名）。

2. **标注差异 / 信息量接口**：依赖同一 Worker 部署；若 Worker 未更新，可视化页「标注差异对比」或「信息量对比」可能为空或请求失败。

3. **Admin Token**：Admin 站与用户站同源，Token 需在后端配置（如 Cloudflare Secrets 或 env）中设置，否则无法登录。

4. **仅选一篇（主动学习）**：当前未改 assignment 生成逻辑，若老师要求「主动学习只做其中一篇文章」，需再改后端分配逻辑并可能改前端说明。

---

## 六、建议人工自测清单

- [ ] Welcome → Start → 开始 → Manual：能看到标签按钮，提交一条后**最下方**出现「↩ 撤回上一步」
- [ ] 难度排序页：提示为「按难易程度排序，最难排到最上面」
- [ ] 完成 Normal LLM 后进入可视化：先看到「标注差异对比」（三篇、两栏、有高亮）和「三篇文章信息量对比」，再看到标签分布与耗时
- [ ] 进入问卷并提交：提交后出现「完成」+ 感谢语
- [ ] 打开 https://sentence-labeling-web.pages.dev/admin/login 输入 Admin Token，能进 Dashboard / Config / Units / Ops
