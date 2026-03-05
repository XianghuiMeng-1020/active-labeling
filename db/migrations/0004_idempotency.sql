-- Idempotency keys for manual/undo/accept to prevent double-counting on duplicate submit.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  response_status INTEGER NOT NULL DEFAULT 200,
  created_at TEXT NOT NULL
);
