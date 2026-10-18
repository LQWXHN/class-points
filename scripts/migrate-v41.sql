-- ============================================================
-- 班级积分系统 v4.1 一次性迁移脚本（SQLite / Cloudflare D1 通用）
-- 内容：
--   1) announcements 增三列：category / edited / editor
--   2) 新建四张表：announcement_versions / announcement_reads /
--      front_messages / rank_snapshots
-- 用法（部署时在本地与 remote 各执行一次）：
--   npx wrangler d1 execute class-points-db-v4 --local  --config app/wrangler.dev.toml --file=scripts/migrate-v41.sql
--   npx wrangler d1 execute class-points-db-v4 --remote --file=scripts/migrate-v41.sql
-- Node 主站（better-sqlite3）无需手动跑本脚本：node.js 启动时会做
-- 同样的幂等迁移（PRAGMA table_info 检查后再 ALTER）。
-- 注意：本脚本为一次性，重复执行 ALTER 会报 "duplicate column"，属正常。
-- ============================================================

-- 1) announcements 增列
ALTER TABLE announcements ADD COLUMN category TEXT NOT NULL DEFAULT '通知公告';
ALTER TABLE announcements ADD COLUMN edited   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE announcements ADD COLUMN editor    TEXT NOT NULL DEFAULT '';

-- 2) 公告历史版本（只增不改）
CREATE TABLE IF NOT EXISTS announcement_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE,
  ann_uid    TEXT NOT NULL DEFAULT '',
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT '通知公告',
  file_url   TEXT NOT NULL DEFAULT '',
  file_name  TEXT NOT NULL DEFAULT '',
  file_type  TEXT NOT NULL DEFAULT '',
  file_size  INTEGER NOT NULL DEFAULT 0,
  editor     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_av_ann ON announcement_versions(ann_uid);

-- 3) 公告已读回执（按设备去重）
CREATE TABLE IF NOT EXISTS announcement_reads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT NOT NULL UNIQUE,
  ann_uid     TEXT NOT NULL DEFAULT '',
  device_uid  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  UNIQUE(ann_uid, device_uid)
);
CREATE INDEX IF NOT EXISTS idx_ar_ann ON announcement_reads(ann_uid);

-- 4) 前台发给后台的消息
CREATE TABLE IF NOT EXISTS front_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '',
  file_url   TEXT NOT NULL DEFAULT '',
  file_name  TEXT NOT NULL DEFAULT '',
  file_type  TEXT NOT NULL DEFAULT '',
  file_size  INTEGER NOT NULL DEFAULT 0,
  device_uid TEXT NOT NULL DEFAULT '',
  device_name TEXT NOT NULL DEFAULT '',
  is_read    INTEGER NOT NULL DEFAULT 0,
  read_at    INTEGER,
  read_by    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fm_time ON front_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_fm_unread ON front_messages(is_read, deleted);

-- 5) 排行历史缓存
CREATE TABLE IF NOT EXISTS rank_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL DEFAULT '',
  period_index  INTEGER NOT NULL DEFAULT 0,
  period_start  INTEGER NOT NULL DEFAULT 0,
  period_end    INTEGER NOT NULL DEFAULT 0,
  payload       TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  UNIQUE(kind, period_index)
);
CREATE INDEX IF NOT EXISTS idx_rs_kind ON rank_snapshots(kind, period_index);
