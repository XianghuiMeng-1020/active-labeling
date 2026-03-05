# D1 数据库迁移说明

## 迁移顺序（重要）

部署或升级时请**先执行迁移，再部署/更新 Worker 代码**：

1. **先执行** `0005_rate_limits_sessions_share.sql`（若尚未执行）  
   - 新增 `rate_limits` 表、`sessions.reset_token`、`share_tokens.expires_at` / `revoked` 等。  
   - 若未执行 0005 就部署带 `reset_token` 的 session/start 代码，会报错。

2. **再执行** `0006_indexes.sql`  
   - 为 `label_attempts`、`interaction_events`、`rate_limits`、`idempotency_keys` 添加索引，提升查询与清理性能。

3. **最后** 部署/发布 Worker 与前端。

## 执行迁移

在项目根目录（含 `wrangler.toml`）执行。

**远程（生产/预览）环境：**

```bash
# 若 0005 未执行，先执行 0005
wrangler d1 execute labeling_db --remote --file=db/migrations/0005_rate_limits_sessions_share.sql

# 执行 0006 索引
wrangler d1 execute labeling_db --remote --file=db/migrations/0006_indexes.sql
```

**本地开发：**

```bash
wrangler d1 execute labeling_db --local --file=db/migrations/0005_rate_limits_sessions_share.sql
wrangler d1 execute labeling_db --local --file=db/migrations/0006_indexes.sql
```

`labeling_db` 为 `wrangler.toml` 中配置的 D1 数据库名称；使用自定义数据库名时请替换。

若执行 0006 时报错 `no such table: main.rate_limits`，说明尚未执行 0005，请先执行 0005 再执行 0006。
