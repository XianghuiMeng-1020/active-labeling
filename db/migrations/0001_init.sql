CREATE TABLE IF NOT EXISTS units (
  unit_id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  meta_json TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  normal_manual_done_at TEXT,
  normal_llm_done_at TEXT,
  active_manual_done_at TEXT
);

CREATE TABLE IF NOT EXISTS assignments (
  session_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('normal', 'active')),
  task TEXT NOT NULL CHECK (task IN ('manual', 'llm')),
  status TEXT NOT NULL CHECK (status IN ('todo', 'done', 'skip')) DEFAULT 'todo',
  ordering INTEGER NOT NULL,
  PRIMARY KEY (session_id, unit_id, phase, task)
);

CREATE TABLE IF NOT EXISTS manual_labels (
  session_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('normal', 'active')),
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, unit_id, phase)
);

CREATE TABLE IF NOT EXISTS llm_labels (
  session_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('normal', 'active')),
  mode TEXT NOT NULL CHECK (mode IN ('prompt1', 'prompt2', 'custom')),
  predicted_label TEXT NOT NULL,
  accepted_label TEXT,
  raw_json TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, unit_id, phase, mode)
);

CREATE TABLE IF NOT EXISTS label_attempts (
  attempt_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('normal', 'active')),
  task TEXT NOT NULL CHECK (task IN ('manual', 'llm')),
  llm_mode TEXT CHECK (llm_mode IN ('prompt1', 'prompt2', 'custom')),
  selected_option TEXT NOT NULL,
  shown_at_epoch_ms INTEGER NOT NULL,
  answered_at_epoch_ms INTEGER NOT NULL,
  active_ms INTEGER NOT NULL,
  hidden_ms INTEGER NOT NULL,
  idle_ms INTEGER NOT NULL,
  hidden_count INTEGER NOT NULL DEFAULT 0,
  blur_count INTEGER NOT NULL DEFAULT 0,
  had_background INTEGER NOT NULL DEFAULT 0,
  is_valid INTEGER NOT NULL,
  invalid_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interaction_events (
  event_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  t_perf_ms REAL NOT NULL,
  t_epoch_ms INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS al_scores (
  unit_id TEXT PRIMARY KEY,
  score REAL NOT NULL,
  reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS al_runs (
  run_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'error')),
  detail_json TEXT
);

CREATE TABLE IF NOT EXISTS taxonomy_labels (
  label TEXT PRIMARY KEY,
  description TEXT,
  ordering INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prompts (
  prompt_key TEXT PRIMARY KEY CHECK (prompt_key IN ('prompt1', 'prompt2')),
  prompt_text TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS share_tokens (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
