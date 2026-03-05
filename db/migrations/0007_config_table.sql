CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO config(key, value, updated_at) VALUES ('normal_n', '6', datetime('now'));
INSERT OR IGNORE INTO config(key, value, updated_at) VALUES ('active_m', '4', datetime('now'));
