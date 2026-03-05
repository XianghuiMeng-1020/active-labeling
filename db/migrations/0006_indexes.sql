-- Indexes for session reset, recent ops, rate-limit cleanup, and idempotency TTL
CREATE INDEX IF NOT EXISTS idx_label_attempts_session ON label_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_label_attempts_created ON label_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_interaction_events_attempt ON interaction_events(attempt_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_end);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);
