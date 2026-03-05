-- Track how many times each user has run the custom LLM prompt per unit.
-- Server enforces a maximum of 5 custom runs per (session, unit, phase).
CREATE TABLE IF NOT EXISTS llm_run_counts (
  session_id TEXT NOT NULL,
  unit_id    TEXT NOT NULL,
  phase      TEXT NOT NULL CHECK (phase IN ('normal', 'active')),
  mode       TEXT NOT NULL CHECK (mode IN ('prompt1', 'prompt2', 'custom')),
  run_count  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, unit_id, phase, mode)
);
