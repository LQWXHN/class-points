-- v5.1 迁移：biweekly_snapshots 表
CREATE TABLE IF NOT EXISTS biweekly_snapshots (
  period_start TEXT NOT NULL,
  kind TEXT NOT NULL,
  group_id TEXT NOT NULL,
  total REAL NOT NULL,
  member_count INTEGER NOT NULL,
  taken_at INTEGER NOT NULL,
  PRIMARY KEY (period_start, kind, group_id)
);

UPDATE admin_config SET value='v5.1（2026-10-25）' WHERE key='system_version';
