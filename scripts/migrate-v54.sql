-- v5.4 迁移：积分规则分类 + 群公告开启/关闭 + 拟造列兜底
-- 幂等：SQLite 与 D1 均可执行（重复执行报 duplicate column 时属正常，已迁移）
ALTER TABLE point_rules ADD COLUMN category TEXT NOT NULL DEFAULT '常规';
ALTER TABLE chat_notices ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE point_records ADD COLUMN fabricated INTEGER NOT NULL DEFAULT 0;
