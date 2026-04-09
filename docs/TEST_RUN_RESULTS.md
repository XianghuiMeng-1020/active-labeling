# 线上环境全功能测试执行结果

本文档记录按《线上环境前后端全功能测试计划》实施的测试及结果。

## 环境

- 前端: https://sentence-labeling-web.pages.dev
- 后端 API: https://sentence-labeling-api.xmeng19.workers.dev

---

## 一、后端 API 冒烟测试

**脚本**: `scripts/e2e_api_smoke.sh`  
**用法**: `BASE_URL=https://sentence-labeling-api.xmeng19.workers.dev ./scripts/e2e_api_smoke.sh`

**执行说明**:  
从当前 CI/本机环境对生产 Worker 发起 curl 时，请求在 15–25s 内超时（HTTP_CODE:000），可能因网络策略或 Worker 冷启动。脚本已实现并加入 `--max-time 15`，建议在可访问生产 API 的环境（如本地或 VPN）手动执行：

```bash
cd /path/to/active-labeling
BASE_URL=https://sentence-labeling-api.xmeng19.workers.dev ./scripts/e2e_api_smoke.sh
```

**覆盖接口**: health, session/start, session/status, units/next, labeled-essays, ranking/status, ranking/submit, ranking/reopen, stats/visualization。

---

## 二、20 用户并发全流程模拟（API）

**脚本**: `scripts/e2e_20users.mjs`  
**用法**（本地 Worker + 种子数据）:

```bash
# 1) 启动 Worker：workers/api 下 npm run dev
# 2) 种子数据与配置（仅首次或清库后）：
node scripts/seed-units.mjs data/essays_3x5.jsonl http://127.0.0.1:8787 dev-admin-token
curl -s -X POST http://127.0.0.1:8787/api/admin/config/session -H "Content-Type: application/json" -H "Authorization: Bearer dev-admin-token" -d '{"normal_n":15,"active_m":0}'
# 3) 运行 20 用户并发
node scripts/e2e_20users.mjs http://localhost:8787 dev-admin-token
```

**说明**: 20 个用户同时注册并走完：manual 15 句 + ranking 3 篇 + LLM accept 15 句；校验 session 状态、admin 汇总与 viz。后端限流已调整为支持约 20 人并发（labels/llm_accept 240/min，viz 独立 key 120/min），脚本对 429 增加重试与退避。

---

## 三、用户端前端 E2E（Playwright）

**用例**: `tests/production_full_e2e.spec.ts`  
**运行**: `BASE_URL=https://sentence-labeling-web.pages.dev npx playwright test tests/production_full_e2e.spec.ts --project=chromium`

**已执行结果**（摘要）:

| 用例 | 结果 | 说明 |
|------|------|------|
| 访问 / 或 /welcome 正常，无白屏 | 通过 | 首页与欢迎页可访问 |
| Welcome 点击开始进入 start 或 manual | 通过 | 导航正确 |
| Start 页点击开始标注进入 manual | 超时/失败 | 依赖 session/start、units/next，API 不可达或较慢时超时 |
| Manual 页有文章/句子与标签按钮 | 超时/失败 | 同上，需先进入 manual |
| 难度排序标题下黑色/拖拽说明 | 有条件通过 | 仅当当前为排序卡时校验 |
| 排序页 Back to edit labels 按钮 | 有条件通过 | 仅当出现排序卡时校验 |
| LLM 尝试次数或 Run 按钮 | 有条件通过 | 依赖是否进入 LLM 页 |
| 完成页 Back to ranking | 有条件通过 | 依赖是否处于完成页 |
| Visualization 图表/轴标签 | 有条件通过 | 可能被重定向到 start/manual |
| Active manual AL 样式/徽章 | 有条件通过 | 可能被 gate 重定向 |
| Active LLM AL hero/徽章 | 有条件通过 | 同上 |
| Admin 登录页可打开 | 通过 | 不依赖会话 |
| 未登录访问 dashboard 重定向登录 | 通过 | 鉴权正确 |
| Share 无效 token 可打开 | 通过 | 不依赖会话 |

**结论**:  
- 不依赖后端会话的用例（入口、Admin、Share）通过。  
- 依赖会话的用例在「API 从执行环境不可达或很慢」时会超时；在能正常访问生产 API 的环境（如本地或内网）重新跑同一套用例可验证完整流程。

---

## 四、管理端与分享页

- 管理端：已包含在上述 Playwright 中（Admin 登录、未登录重定向）。  
- 分享页：已包含（无效 token 打开 share 页）。  
- 更完整的 Admin（dashboard 图表、config、units、ops）与有效 share token 的展示，建议在本地或可访问生产 API 的环境手动执行计划中第三、四节。

---

## 五、回归与边界

- 计划第五节（ranking reopen 边界、LLM 尝试次数、新会话隔离）未单独写成自动化用例；建议手动按计划执行并记录。  
- 若需自动化，可在 `tests/production_full_e2e.spec.ts` 中增加对应 describe/test。

---

## 六、建议后续操作

1. 在可访问 `https://sentence-labeling-api.xmeng19.workers.dev` 的机器上运行：  
   `./scripts/e2e_api_smoke.sh`（并设置 `BASE_URL`）确认全部通过。  
2. 在同一环境下再次运行：  
   `BASE_URL=https://sentence-labeling-web.pages.dev npx playwright test tests/production_full_e2e.spec.ts`  
   以验证依赖会话的 E2E。  
3. 按计划第三、四、五节做一次手动验收并更新本结果文档。
