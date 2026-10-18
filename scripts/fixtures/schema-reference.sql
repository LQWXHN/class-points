-- ============================================================
-- 班级积分系统 v4.0 新 schema 参考实现（供迁移自测）
-- 注意：权威文件是 app/src/db/schema.sql（后端 A 维护）。
-- 本文件仅在 app/src/db/schema.sql 尚未就位时，让 migrate.mjs 能端到端自测。
-- 列名以 SPEC.md §3 为准：每张业务表有 uid/created_at/updated_at/deleted。
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'teacher',
  password_hash TEXT DEFAULT '',
  password_salt TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  role TEXT DEFAULT 'teacher',
  display_name TEXT DEFAULT '',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  ip TEXT DEFAULT '',
  username TEXT DEFAULT '',
  success INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kv_meta (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  key TEXT NOT NULL UNIQUE,
  value TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS activation_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  label TEXT DEFAULT '',
  used INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER,
  used_by TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  device_name TEXT DEFAULT '',
  uuid TEXT,
  fingerprint TEXT,
  activation_code TEXT DEFAULT '',
  is_master INTEGER NOT NULL DEFAULT 0,
  ip TEXT DEFAULT '',
  ua TEXT DEFAULT '',
  country TEXT DEFAULT '',
  city TEXT DEFAULT '',
  activated_at INTEGER,
  last_seen INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#007aff',
  signature TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  student_no TEXT DEFAULT '',
  group_id INTEGER,
  group_uid TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  avatar TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS point_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'add',
  reason TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  is_custom INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS point_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  student_uid TEXT,
  student_name TEXT DEFAULT '',
  group_name TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'system',
  reason TEXT DEFAULT '',
  points INTEGER NOT NULL DEFAULT 0,
  operator TEXT DEFAULT 'system',
  apply INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  author TEXT DEFAULT '系统',
  file_url TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  file_type TEXT DEFAULT '',
  file_size INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS backup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  filename TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  type TEXT DEFAULT 'manual',
  r2_key TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  username TEXT DEFAULT '',
  role TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  ua TEXT DEFAULT '',
  country TEXT DEFAULT '',
  city TEXT DEFAULT '',
  success INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  operator TEXT DEFAULT '',
  action TEXT DEFAULT '',
  target TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_uid TEXT NOT NULL UNIQUE,
  origin TEXT DEFAULT 'node',
  op TEXT NOT NULL DEFAULT 'upsert',
  table_name TEXT NOT NULL,
  row_uid TEXT NOT NULL,
  snapshot TEXT DEFAULT '',
  apply_delta INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
