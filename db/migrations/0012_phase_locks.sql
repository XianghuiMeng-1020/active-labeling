-- Phase locks: teachers can lock/unlock each phase independently.
-- Default: manual unlocked (0), llm locked (1), survey locked (1).
INSERT OR IGNORE INTO config(key, value, updated_at) VALUES ('lock_manual',  '0', datetime('now'));
INSERT OR IGNORE INTO config(key, value, updated_at) VALUES ('lock_llm',     '1', datetime('now'));
INSERT OR IGNORE INTO config(key, value, updated_at) VALUES ('lock_survey',  '1', datetime('now'));
