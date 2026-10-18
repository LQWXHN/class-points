-- ============================================================
-- 班级积分系统 v4.4 迁移脚本（Cloudflare D1 端）
-- 幂等：ALTER ADD COLUMN 需先检查（D1 无 IF NOT EXISTS for columns），由 node 启动迁移保证；
--       本脚本由 D1 手动执行，若列已存在会报错可忽略。
-- 执行：wrangler d1 execute class-points-db-v4 --remote --file=scripts/migrate-v44.sql
-- ============================================================

-- 1. 列补充（D1 不支持 ADD COLUMN IF NOT EXISTS，重复执行报错可忽略）
ALTER TABLE point_records    ADD COLUMN hidden      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE point_rules      ADD COLUMN is_builtin   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admin_users      ADD COLUMN avatar       TEXT NOT NULL DEFAULT '';

-- 2. 历史脏数据归一：subtract → sub，points 取绝对值
UPDATE point_rules SET type='sub', points=ABS(points) WHERE type='subtract';
UPDATE point_records SET type='sub', points=ABS(points) WHERE type='subtract';
UPDATE point_records SET hidden=1 WHERE apply=0 AND reason='测试';

-- 3. 两条内置「自定义」规则（固定 uid，冲突忽略）
INSERT OR IGNORE INTO point_rules (uid, type, reason, points, is_custom, is_builtin, created_at, updated_at, deleted)
VALUES ('builtin-rule-add', 'add', '自定义', 0, 1, 1, 0, 0, 0);
INSERT OR IGNORE INTO point_rules (uid, type, reason, points, is_custom, is_builtin, created_at, updated_at, deleted)
VALUES ('builtin-rule-sub', 'sub', '自定义', 0, 1, 1, 0, 0, 0);

-- 4. 新表（CREATE TABLE IF NOT EXISTS 幂等）
CREATE TABLE IF NOT EXISTS chat_messages (
  uid TEXT PRIMARY KEY,
  sender_type TEXT NOT NULL,
  sender_id TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  file_type TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0,
  mention TEXT NOT NULL DEFAULT '',
  reply_to TEXT NOT NULL DEFAULT '',
  recalled INTEGER NOT NULL DEFAULT 0,
  recalled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chat_time ON chat_messages(created_at);

CREATE TABLE IF NOT EXISTS chat_favorites (
  uid TEXT PRIMARY KEY,
  message_uid TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(message_uid, owner_type, owner_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  uid TEXT PRIMARY KEY,
  audience TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL DEFAULT '',
  auth TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(endpoint)
);

CREATE TABLE IF NOT EXISTS feedback_messages (
  uid TEXT PRIMARY KEY,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fb_time ON feedback_messages(created_at);
