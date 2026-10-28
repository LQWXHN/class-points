-- v5.2 迁移：拟造加减分字段 + 删除双周榜
ALTER TABLE point_records ADD COLUMN fabricated INTEGER NOT NULL DEFAULT 0;
DROP TABLE IF EXISTS biweekly_snapshots;
DELETE FROM rank_snapshots WHERE kind='biweekly';
DELETE FROM admin_config WHERE key='biweekly_rank_enabled';
