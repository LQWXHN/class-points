-- ============================================================
-- 班级积分系统 v4.2 迁移脚本（Cloudflare D1 端）
-- 新增：system_announcements 系统公告表
-- 修正：双周榜锚点改为 2026-10-01，清理旧锚点写入的 rank_snapshots 缓存（纯缓存可重建）
-- 执行方式：wrangler d1 execute class-points-db-v4 --remote --file=scripts/migrate-v42.sql
-- 幂等：CREATE TABLE IF NOT EXISTS；DELETE 纯缓存，重复执行无副作用
-- ============================================================

CREATE TABLE IF NOT EXISTS system_announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sa_active ON system_announcements(is_active, created_at);

-- 双周榜锚点从 2024-01-01 改为 2026-10-01；旧缓存行纯缓存，删除后由首次请求确定性重算
DELETE FROM rank_snapshots WHERE kind='biweekly';
