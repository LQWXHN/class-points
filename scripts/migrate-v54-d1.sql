-- v5.4 D1-only migration: point_rules.category + chat_notices.is_active
-- (point_records.fabricated already exists on D1 from v5.2, so it is omitted here)
ALTER TABLE point_rules ADD COLUMN category TEXT NOT NULL DEFAULT '常规';
ALTER TABLE chat_notices ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
-- （注：内容由AI生成）
