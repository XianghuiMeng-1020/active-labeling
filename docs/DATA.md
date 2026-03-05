# 数据与导入说明

## Unit 数据格式

系统单位为 sentence-level，每条记录一个 `unit`。

JSONL 每行格式：

```json
{"unit_id":"u001","text":"I really enjoyed today's lecture.","meta_json":"{\"speaker\":\"student\"}"}
```

字段：

- `unit_id`：唯一主键
- `text`：待标注文本
- `meta_json`：可选元信息（字符串化 JSON）

## 示例数据

- 文件：`data/seed_units.jsonl`
- 包含 20 条初始数据，可用于本地验收

## 导入方式

### 方式 A：脚本导入（推荐）

```bash
node "scripts/seed-units.mjs" "data/seed_units.jsonl" "http://127.0.0.1:8787" "dev-admin-token"
```

### 方式 B：Admin UI 导入

- 打开 `/admin/units`
- 粘贴 JSONL 文本
- 点击导入

## D1 表结构

迁移文件在 `db/migrations`：

- `0001_init.sql`：核心表、attempts/events、AL、share、taxonomy/prompts
- `0002_seed_defaults.sql`：默认 taxonomy 与 prompt1/prompt2
