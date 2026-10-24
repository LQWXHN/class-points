-- ============================================================
-- 班级积分系统 v4.0 同构 Schema（SQLite / Cloudflare D1 通用）
-- 时间戳统一为 INTEGER 毫秒 epoch；布尔为 INTEGER 0/1
-- 所有业务表带 uid(TEXT UUID) / created_at / updated_at / deleted
-- point_records 为仅追加事件流；sync_events 为双向同步事件日志
-- ============================================================

-- 账户（内置 teacher 班主任 / admin 超级管理员，首次进入分别设置密码）
CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'teacher',   -- teacher | super
  display_name  TEXT NOT NULL DEFAULT '',
  avatar        TEXT NOT NULL DEFAULT '',          -- v4.4: dataURL 或 /api/file URL
  last_login    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted       INTEGER NOT NULL DEFAULT 0
);

-- 登录会话（修复旧版 Token 可伪造漏洞：随机串必须落库、每次校验查表）
CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT NOT NULL UNIQUE,
  username   TEXT NOT NULL,
  role       TEXT NOT NULL,
  ip         TEXT NOT NULL DEFAULT '',
  ua         TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

-- 登录尝试（失败次数限制）
CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  success    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_la_lookup ON login_attempts(ip, username, created_at);

-- 键值配置（替代旧 KV：验证码、同步游标、各类系统配置都放这里，两端通用）
CREATE TABLE IF NOT EXISTS kv_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 系统配置
CREATE TABLE IF NOT EXISTS admin_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

-- 激活码（独立成表；万能激活码为代码常量，绝不写入此表）
CREATE TABLE IF NOT EXISTS activation_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE,
  code       TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  used       INTEGER NOT NULL DEFAULT 0,
  used_at    INTEGER,
  used_by    TEXT NOT NULL DEFAULT '',
  used_ip    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);

-- 已激活设备（绑定本地持久 UUID，指纹留档审计）
CREATE TABLE IF NOT EXISTS device_tokens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE,
  token           TEXT NOT NULL UNIQUE,
  device_uuid     TEXT NOT NULL,
  fingerprint     TEXT NOT NULL DEFAULT '',
  device_name     TEXT NOT NULL DEFAULT '',
  ip              TEXT NOT NULL DEFAULT '',
  ua              TEXT NOT NULL DEFAULT '',
  activation_code TEXT NOT NULL DEFAULT '',
  is_master       INTEGER NOT NULL DEFAULT 0,
  last_seen       INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dt_token ON device_tokens(token);
CREATE INDEX IF NOT EXISTS idx_dt_uuid ON device_tokens(device_uuid);

-- 小组
CREATE TABLE IF NOT EXISTS groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#34c759',
  signature  TEXT NOT NULL DEFAULT '',
  avatar     TEXT NOT NULL DEFAULT '',            -- v4.8: 组头像（Emoji 或 /api/file 上传 URL；空=默认 users 图标）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);

-- 学生（group_id 为本端局部 id，group_uid 为跨端稳定关联）
CREATE TABLE IF NOT EXISTS students (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  student_no TEXT NOT NULL DEFAULT '',
  group_id   INTEGER,
  group_uid  TEXT NOT NULL DEFAULT '',
  points     INTEGER NOT NULL DEFAULT 0,
  avatar     TEXT NOT NULL DEFAULT '👦',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_students_group ON students(group_uid);

-- 积分规则
CREATE TABLE IF NOT EXISTS point_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL,              -- add | sub
  reason     TEXT NOT NULL,
  points     INTEGER NOT NULL,
  is_custom  INTEGER NOT NULL DEFAULT 1,
  is_builtin INTEGER NOT NULL DEFAULT 0, -- v4.4: 1=内置自定义规则（不可改删）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);

-- 积分流水（仅追加事件流）
-- type: add 加分 | sub 扣分 | system 系统 | set 直接设定(超管直改/重置/迁移期初)
-- apply=1 的记录在同步回放时影响积分余额；apply=0 仅为迁移历史展示
CREATE TABLE IF NOT EXISTS point_records (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uid          TEXT NOT NULL UNIQUE,
  student_id   INTEGER,
  student_uid  TEXT NOT NULL DEFAULT '',
  student_name TEXT NOT NULL DEFAULT '',
  group_name   TEXT NOT NULL DEFAULT '',
  type         TEXT NOT NULL DEFAULT 'system',
  reason       TEXT NOT NULL DEFAULT '',
  points       INTEGER NOT NULL DEFAULT 0,
  operator     TEXT NOT NULL DEFAULT 'system',
  apply        INTEGER NOT NULL DEFAULT 1,
  hidden       INTEGER NOT NULL DEFAULT 0, -- v4.4: 1=超管直改隐藏流水（学生端不可见，双周榜计入）
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pr_uid ON point_records(student_uid);
CREATE INDEX IF NOT EXISTS idx_pr_time ON point_records(created_at);

-- 班级动态（通知/公告，含附件）
-- v4.1 增列：category 分类 / edited 是否被编辑过 / editor 最后编辑人
CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  author     TEXT NOT NULL DEFAULT '',
  file_url   TEXT NOT NULL DEFAULT '',
  file_name  TEXT NOT NULL DEFAULT '',
  file_type  TEXT NOT NULL DEFAULT '',
  file_size  INTEGER NOT NULL DEFAULT 0,
  category   TEXT NOT NULL DEFAULT '通知公告',
  edited     INTEGER NOT NULL DEFAULT 0,
  editor     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ann_time ON announcements(created_at);

-- 公告历史版本（只增不改；编辑前把当前主表行完整快照插入此处）
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

-- 公告已读回执（按设备去重）
CREATE TABLE IF NOT EXISTS announcement_reads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT NOT NULL UNIQUE,
  ann_uid     TEXT NOT NULL DEFAULT '',
  device_uid  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  UNIQUE(ann_uid, device_uid)
);
CREATE INDEX IF NOT EXISTS idx_ar_ann ON announcement_reads(ann_uid);

-- 前台发给后台的消息（设备投稿，教师可标记已读/软删）
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

-- 排行历史缓存（双周榜等确定性重算结果，按 kind+period_index 唯一）
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

-- 备份记录（storage_key：R2 key 或 Node 本地相对路径）
CREATE TABLE IF NOT EXISTS backup_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT NOT NULL UNIQUE,
  filename    TEXT NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  type        TEXT NOT NULL DEFAULT 'manual', -- manual | auto
  storage_key TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

-- 登录日志
CREATE TABLE IF NOT EXISTS login_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE,
  username   TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  ua         TEXT NOT NULL DEFAULT '',
  success    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- 审计日志
CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE,
  operator   TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL DEFAULT '',
  target     TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- 双向同步事件日志
-- op: upsert | delete；snapshot 为行完整 JSON；ts 毫秒
-- apply_delta=1 时该事件（point_records 加分/扣分/set）回放需调整 students.points
CREATE TABLE IF NOT EXISTS sync_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_uid   TEXT NOT NULL UNIQUE,
  tbl         TEXT NOT NULL,
  row_uid     TEXT NOT NULL,
  op          TEXT NOT NULL,
  snapshot    TEXT NOT NULL DEFAULT '{}',
  apply_delta INTEGER NOT NULL DEFAULT 0,
  origin      TEXT NOT NULL DEFAULT '',
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_se_cursor ON sync_events(id);
CREATE INDEX IF NOT EXISTS idx_se_row ON sync_events(tbl, row_uid);

-- 初始化内置账户与默认配置（幂等）
INSERT OR IGNORE INTO admin_users (uid, username, role, display_name, created_at, updated_at)
VALUES ('u-teacher-seed', 'teacher', 'teacher', '班主任', 0, 0);
INSERT OR IGNORE INTO admin_users (uid, username, role, display_name, created_at, updated_at)
VALUES ('u-admin-seed', 'admin', 'super', '超级管理员', 0, 0);
INSERT OR IGNORE INTO admin_config (key, value, updated_at) VALUES ('site_title', '班级积分系统', 0);

-- 系统级公告（面向所有设备/端的置顶通知，独立于班级动态 announcements）
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

-- ============================================================
-- v4.4 新表
-- ============================================================

-- 用户反馈
CREATE TABLE IF NOT EXISTS feedback_messages (
  uid          TEXT PRIMARY KEY,
  from_type    TEXT NOT NULL,
  from_id      TEXT NOT NULL DEFAULT '',
  from_name    TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '',
  attachments  TEXT NOT NULL DEFAULT '', -- JSON 数组
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fb_time ON feedback_messages(created_at);
