# E2E 验收 Checklist

## 0. 初始化

- [ ] `workers/api/.dev.vars` 已配置 HKU/Qwen/Admin token
- [ ] 执行本地迁移：`cd workers/api && npm run d1:migrate:local`
- [ ] 启动 Worker：`cd workers/api && npm run dev`
- [ ] 启动 Web：`cd apps/web && npm run dev`

## 1. 导入 units

- [ ] 执行 `node scripts/seed-units.mjs data/seed_units.jsonl http://127.0.0.1:8787 dev-admin-token`
- [ ] 返回 imported 数量 > 0

## 2. User 正常流程

- [ ] 打开 `/user/start` 创建 session
- [ ] 完成 U1 `/user/normal/manual` 全部条目
- [ ] 自动可进入 U2 `/user/normal/llm`
- [ ] U2 每条执行 `run -> accept/override` 并完成

## 3. Admin 实时图

- [ ] 登录 `/admin/login`（填 ADMIN_TOKEN）
- [ ] 在 `/admin/dashboard/normal` 看到 manual/llm 两图
- [ ] 用户每提交 1 条，图表实时更新（无需刷新）

## 4. Active Learning

- [ ] 在 `/admin/dashboard/overall` 点击“触发 AL Run”
- [ ] 运行后 `active_llm` 分布增长

## 5. User Active Manual

- [ ] 用户进入 `/user/active/manual` 并完成全部 active units
- [ ] Admin overall 看见 `active_manual` 增长

## 6. Share

- [ ] Admin 生成 share token
- [ ] 打开 `/share/:token` 可看到只读实时图

## 7. LLM fallback 检查（可选）

- [ ] 人为使 HKU 调用失败（错误 key 或 mock 网络失败）
- [ ] `/api/llm/run` 返回 `provider: "qwen"`
