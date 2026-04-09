# 20 用户并发 E2E 验证说明

本文档说明 20 用户并发全流程模拟的潜在问题与已采取的保障措施。

## 已修复/已规避的问题

| 问题 | 处理 |
|------|------|
| **标签/接受 429** | 限流从 120/min 提升至 240/min（约 20 人×15）；脚本对 labels、llm/accept 增加 429 重试（最多 12 次、退避递增） |
| **可视化 429** | `/api/stats/visualization` 使用独立限流 key `viz`（120/min），不再与 status/units/next 等共用 `read` 桶 |
| **Ranking 429** | 20 人×3 篇 = 60 次/分钟，原 limit 30 会超限；已提升至 90/min，脚本对 ranking 请求同样做 429 重试 |
| **重复跑断言失败** | 本地 DB 有历史数据时总标签数 > 300；汇总与 viz 断言改为「≥ 本轮 20 人贡献」 |
| **默认 API 端口** | e2e_10users 默认端口已从 64401 改为 8787 |

## 潜在限制与说明（非 bug）

1. **限流按 IP**  
   当前限流 key 含 IP（`CF-Connecting-IP` / `X-Forwarded-For`）。20 个“用户”从同一台机器跑脚本时共享同一 IP，因此 240/min 等限制是整机共享。真实 20 人来自不同 IP 时压力更分散。

2. **无 idempotency_key**  
   脚本未传 `idempotency_key`。429 重试时可能对同一 (session, unit) 重复提交；后端 `manual_labels` / `llm_labels` 为 UPSERT，不会重复行，但可能多出一条 `label_attempts` 记录。对 E2E 通过/失败判断无影响。

3. **依赖种子与配置**  
   脚本假定：已导入 15 个 unit（如 `data/essays_3x5.jsonl`）、`normal_n=15`、taxonomy 来自迁移 0002。若未做种子或 config，会断言失败。

4. **生产环境限流**  
   240/min 适用于约 20 人并发。若生产为更大规模研讨会，可再调高或改为按 session/user 限流。

5. **Export / 行为分析未在 20 人脚本中测**  
   `e2e_10users.mjs` 中有 export CSV、ranking export、behavior 等检查；`e2e_20users.mjs` 未包含，仅做 session 状态、admin 汇总与 viz。需要时可从 10 人脚本移植。

## 数据正确性

- 每 session 的 `normal_manual.done`、`normal_llm.done` 在 spot-check 中校验为 15。
- Admin 汇总与 viz 的 manual/llm 总数 ≥ 20×15（支持多轮运行或已有数据）。
- 所有 20 个用户均走完：start → manual 15 → ranking 3 → LLM accept 15；无并发导致的错误计数或漏标。

## 结论

在以下条件下可认为**无已知潜在问题**：

- 使用当前限流与重试配置（labels/llm_accept 240，ranking 90，viz 独立 120）。
- 运行前已做种子数据与 session config（`normal_n=15`）。
- 重复运行时可接受「≥」型断言（DB 中可有历史数据）。

若需对生产 API 做 20 人压测，请传入生产 base URL 与有效 `ADMIN_TOKEN`，并确认生产 Worker 已部署上述限流与 viz 改动。
