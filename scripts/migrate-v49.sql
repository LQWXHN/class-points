-- v4.9 迁移：无表结构变更，仅更新系统版本号（幂等，可重复执行）
UPDATE admin_config SET value='v4.9（2026-10-25）' WHERE key='system_version';
INSERT INTO admin_config (key, value, updated_at)
  SELECT 'system_version', 'v4.9（2026-10-25）', 0
  WHERE NOT EXISTS (SELECT 1 FROM admin_config WHERE key='system_version');
