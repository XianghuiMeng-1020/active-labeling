-- Record time spent by user on each page (route).
-- Per-question time is already in label_attempts (per unit).
CREATE TABLE IF NOT EXISTS page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  page_path TEXT NOT NULL,
  entered_at_epoch_ms INTEGER NOT NULL,
  left_at_epoch_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_page_views_session ON page_views(session_id);
