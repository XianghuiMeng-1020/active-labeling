-- Rate limiting: key = (identifier + path + window_slot), 1-minute windows
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_end TEXT NOT NULL
);

-- Session reset: only holder of reset_token can reset
ALTER TABLE sessions ADD COLUMN reset_token TEXT;

-- Share tokens: optional expiry and revoke
ALTER TABLE share_tokens ADD COLUMN expires_at TEXT;
ALTER TABLE share_tokens ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0;
