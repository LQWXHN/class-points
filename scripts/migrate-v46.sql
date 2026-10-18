-- ============================================================
-- 班级积分系统 v4.6 迁移脚本（Cloudflare D1 端）
-- 幂等：CREATE TABLE IF NOT EXISTS / 索引 IF NOT EXISTS；config 默认值由 node 启动迁移保证。
-- 执行：wrangler d1 execute class-points-db-v4 --remote --file=scripts/migrate-v46.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_reads (
  reader_type   TEXT NOT NULL,
  reader_id     TEXT NOT NULL,
  last_read_at  INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (reader_type, reader_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_reads_time ON chat_reads(last_read_at);
