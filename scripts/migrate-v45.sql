-- ============================================================
-- 班级积分系统 v4.5 迁移脚本（Cloudflare D1 端）
-- 幂等：CREATE TABLE IF NOT EXISTS / 索引 IF NOT EXISTS；config 默认值通过 node 启动迁移保证。
-- 执行：wrangler d1 execute class-points-db-v4 --remote --file=scripts/migrate-v45.sql
-- ============================================================

-- 1. 自定义表情包表
CREATE TABLE IF NOT EXISTS chat_stickers (
  uid         TEXT PRIMARY KEY,
  owner_type  TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stickers_owner ON chat_stickers(owner_type, owner_id);
