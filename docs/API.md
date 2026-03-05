# API 说明

Base URL：`/api`

## Session

- `POST /api/session/start`
  - body: `{ user_id?, normal_n, active_m }`
  - resp: `{ session_id }`

- `GET /api/session/status?session_id=...`
  - resp:
  - `normal_manual: {done,total}`
  - `normal_llm: {done,total}`
  - `active_manual: {done,total}`
  - `gates: { can_enter_normal_llm, can_enter_active_manual }`

- `GET /api/units/next?session_id=...&phase=normal|active&task=manual|llm`
  - resp: `{ unit: { unit_id, text } | null }`

## Taxonomy / Prompts

- `GET /api/taxonomy`
- `GET /api/prompts`

## User Label Submit

- `POST /api/labels/manual`
  - body:
  - `{ session_id, unit_id, phase, label, attempt }`

- `POST /api/llm/run`
  - body:
  - `{ session_id, unit_id, phase:"normal", mode:"prompt1"|"prompt2"|"custom", custom_prompt_text? }`
  - resp:
  - `{ predicted_label, raw_text, provider:"hku"|"qwen" }`

- `POST /api/llm/accept`
  - body:
  - `{ session_id, unit_id, phase:"normal", mode, accepted_label, attempt }`

`attempt` 结构：

```json
{
  "shown_at_epoch_ms": 0,
  "answered_at_epoch_ms": 0,
  "active_ms": 0,
  "hidden_ms": 0,
  "idle_ms": 0,
  "hidden_count": 0,
  "blur_count": 0,
  "had_background": 0,
  "events": []
}
```

## Admin（全部需要 Bearer Token）

Header: `Authorization: Bearer <ADMIN_TOKEN>`

- `GET /api/admin/stats/normal`
- `GET /api/admin/stats/overall`
- `GET /api/admin/sessions`
- `POST /api/admin/units/import`
  - body: `{ units: [{ unit_id, text, meta_json? }] }`
- `POST /api/admin/taxonomy/set`
  - body: `{ labels: [{ label, description? }] }`
- `POST /api/admin/prompts/set`
  - body: `{ prompt1, prompt2 }`
- `POST /api/admin/al/run`
  - body: `{ candidate_k?, active_llm_n? }`
- `POST /api/admin/share/create`
  - resp: `{ share_token }`

## Share（只读）

- `GET /api/share/stats?token=...`

## 实时 SSE

- `GET /api/stream/stats`（Admin）
- `GET /api/share/stream/stats?token=...`（Share）

事件：`stats_update`
数据结构：

```json
{
  "normal": {
    "normal_manual": {},
    "normal_llm": {}
  },
  "overall": {
    "overall": {},
    "breakdown": {
      "normal_manual": {},
      "normal_llm": {},
      "active_manual": {},
      "active_llm": {}
    }
  }
}
```
