-- v5.5 D1 migration: enable auto backup (key already exists as '0', so upsert)
INSERT INTO admin_config (key, value, updated_at)
VALUES ('auto_backup_enabled', '1', 0)
ON CONFLICT(key) DO UPDATE SET value = '1';
