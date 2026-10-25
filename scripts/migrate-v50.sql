-- v5.0 D1 幂等迁移：群聊四表 + admin_users.wxpusher_uid 列 + 默认配置 + 版本号
-- 注意：D1 不支持 IF NOT EXISTS 于 ALTER TABLE；列已存在时 ALTER 会报错属正常（可忽略）

-- 四表（IF NOT EXISTS 安全）
CREATE TABLE IF NOT EXISTS chat_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uid          TEXT NOT NULL UNIQUE,
  sender_key   TEXT NOT NULL,
  sender_name  TEXT NOT NULL,
  sender_avatar TEXT NOT NULL DEFAULT '',
  msg_type     TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  attachments  TEXT NOT NULL DEFAULT '[]',
  reply_to     TEXT NOT NULL DEFAULT '',
  recalled     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL DEFAULT 0,
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chat_msg_time ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_msg_reply ON chat_messages(reply_to);

CREATE TABLE IF NOT EXISTS chat_reads (
  member_key    TEXT PRIMARY KEY,
  last_read_id  INTEGER NOT NULL DEFAULT 0,
  last_read_at  INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chat_favorites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_key   TEXT NOT NULL,
  msg_uid      TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE(member_key, msg_uid)
);
CREATE INDEX IF NOT EXISTS idx_chat_fav_member ON chat_favorites(member_key);

CREATE TABLE IF NOT EXISTS chat_notices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid          TEXT NOT NULL UNIQUE,
  content      TEXT NOT NULL,
  author       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL DEFAULT 0,
  deleted      INTEGER NOT NULL DEFAULT 0
);

-- admin_users.wxpusher_uid（列已存在时报错可忽略）
ALTER TABLE admin_users ADD COLUMN wxpusher_uid TEXT NOT NULL DEFAULT '';

-- 默认配置键（幂等）
INSERT OR IGNORE INTO admin_config (key, value, updated_at) VALUES ('chat_group_name', '二班群', 0);
INSERT OR IGNORE INTO admin_config (key, value, updated_at) VALUES ('chat_enabled', '1', 0);
INSERT OR IGNORE INTO admin_config (key, value, updated_at) VALUES ('chat_notice', '欢迎使用班级群，请文明发言', 0);
INSERT OR IGNORE INTO admin_config (key, value, updated_at) VALUES ('wxpusher_app_token', '', 0);
INSERT OR IGNORE INTO admin_config (key, value, updated_at) VALUES ('wxpusher_enabled', '0', 0);
INSERT OR IGNORE INTO admin_config (key, value, updated_at) VALUES ('chat_front_push_channel', 'browser', 0);
INSERT OR IGNORE INTO admin_config (key, value, updated_at) VALUES ('wxpusher_uid_front', '', 0);
INSERT OR IGNORE INTO admin_config (key, value, updated_at) VALUES ('front_account_name', '二班学生', 0);
INSERT OR IGNORE INTO admin_config (key, value, updated_at) VALUES ('front_account_avatar', '👦', 0);

-- 系统版本号
UPDATE admin_config SET value='v5.0（2026-10-25）' WHERE key='system_version';
INSERT OR IGNORE INTO admin_config (key, value, updated_at) VALUES ('system_version', 'v5.0（2026-10-25）', 0);
