-- Persist difficulty ranking submissions from users
CREATE TABLE IF NOT EXISTS ranking_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  essay_index INTEGER NOT NULL,
  ordering TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, essay_index)
);

CREATE INDEX IF NOT EXISTS idx_ranking_session ON ranking_submissions(session_id);
