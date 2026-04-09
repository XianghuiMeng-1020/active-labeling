# 向晖 11 条修改部署与验证报告

## 一、部署结果

| 步骤 | 状态 | 说明 |
|------|------|------|
| Worker API | ✅ 已部署 | `https://sentence-labeling-api.xmeng19.workers.dev` |
| Pages 前端 | ✅ 已部署 | 本次部署预览: `https://2cc90a44.sentence-labeling-web.pages.dev`，生产入口: `https://sentence-labeling-web.pages.dev` |
| 构建 | ✅ | `VITE_API_BASE=https://sentence-labeling-api.xmeng19.workers.dev` 下构建并上传 |

## 二、浏览器 E2E 验证（全部 11 条）

在**本地浏览器**（Playwright Chromium）中针对 **https://sentence-labeling-web.pages.dev** 运行了完整 E2E，结果如下。

| 需求 | 测试项 | 结果 |
|------|--------|------|
| 1 | 难度排序标题下文字为黑色 | ✅ 通过 |
| 2 | 拖拽说明含 "hardest to easiest" | ✅ 通过 |
| 3 | 完成页有 Back to ranking 按钮 | ✅ 通过 |
| 4 | 排序页有 Back to edit labels 按钮 | ✅ 通过 |
| 5 | LLM 页有尝试次数 / Run 按钮 | ✅ 通过 |
| 6 | 完成页 Back to ranking | ✅ 通过 |
| 7 | 可视化页图表与轴标签（Frequency/频次） | ✅ 通过 |
| 8 | Active manual 页 AL 样式或徽章 | ✅ 通过 |
| 9 | Active LLM 页 AL hero 或徽章 | ✅ 通过 |
| 10 | 语言切换处有 symbol（🌐）且下拉可选 | ✅ 通过 |
| 11 | 语言切换下拉（含 aria-label） | ✅ 通过 |

**执行命令**（本地可重复跑）:

```bash
BASE_URL=https://sentence-labeling-web.pages.dev npx playwright test tests/production_full_e2e.spec.ts --project=chromium
```

## 三、30 用户模拟

- **脚本**: `node scripts/e2e_20users.mjs <API_BASE> <ADMIN_TOKEN> 30`
- **本机执行情况**: 对生产 API `https://sentence-labeling-api.xmeng19.workers.dev` 请求时出现 **DNS ENOTFOUND**，本环境无法访问该域名，30 用户压测未在本机完成。
- **建议**: 在可访问生产 API 的机器上执行（需有效 `ADMIN_TOKEN`）:

```bash
export API_BASE="https://sentence-labeling-api.xmeng19.workers.dev"
export ADMIN_TOKEN="你的生产 Admin Token"
node scripts/e2e_20users.mjs "$API_BASE" "$ADMIN_TOKEN" 30
```

## 四、结论

- 向晖 11 条修改已部署到 **link**（Worker + Pages）。
- 在本地浏览器中通过 Playwright 已**逐条验证** 11 条修改与操作流程，全部通过。
- 30 用户并发验证需在能访问生产 API 的环境中自行执行上述命令。
