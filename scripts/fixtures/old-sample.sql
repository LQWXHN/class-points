-- 合成旧库导出（仿 wrangler d1 export 格式），仅用于自测 migrate.mjs + verify-migration.mjs
-- 表结构与旧 class-points-worker 一致

CREATE TABLE `admin_users` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `username` TEXT UNIQUE,
  `password_hash` TEXT,
  `password_salt` TEXT,
  `role` TEXT,
  `display_name` TEXT,
  `created_at` TEXT,
  `last_login` TEXT
);
--> statement-breakpoint
CREATE TABLE `admin_config` (
  `key` TEXT PRIMARY KEY,
  `value` TEXT
);
--> statement-breakpoint
CREATE TABLE `device_tokens` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `token` TEXT,
  `device_name` TEXT,
  `ip` TEXT,
  `ua` TEXT,
  `country` TEXT,
  `city` TEXT,
  `activation_code` TEXT,
  `activated_at` TEXT,
  `last_seen` TEXT
);
--> statement-breakpoint
CREATE TABLE `login_logs` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `username` TEXT,
  `role` TEXT,
  `ip` TEXT,
  `ua` TEXT,
  `country` TEXT,
  `city` TEXT,
  `success` INTEGER,
  `created_at` TEXT
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `operator` TEXT,
  `action` TEXT,
  `target` TEXT,
  `detail` TEXT,
  `ip` TEXT,
  `created_at` TEXT
);
--> statement-breakpoint
CREATE TABLE `groups` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `name` TEXT,
  `color` TEXT,
  `signature` TEXT,
  `created_at` TEXT,
  `updated_at` TEXT
);
--> statement-breakpoint
CREATE TABLE `students` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `name` TEXT,
  `student_no` TEXT,
  `group_id` INTEGER,
  `points` INTEGER,
  `avatar` TEXT,
  `created_at` TEXT,
  `updated_at` TEXT
);
--> statement-breakpoint
CREATE TABLE `point_rules` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `type` TEXT,
  `reason` TEXT,
  `points` INTEGER,
  `is_custom` INTEGER,
  `created_at` TEXT,
  `updated_at` TEXT
);
--> statement-breakpoint
CREATE TABLE `point_records` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `student_id` INTEGER,
  `student_name` TEXT,
  `group_name` TEXT,
  `type` TEXT,
  `reason` TEXT,
  `points` INTEGER,
  `operator` TEXT,
  `created_at` TEXT
);
--> statement-breakpoint
CREATE TABLE `announcements` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `title` TEXT,
  `content` TEXT,
  `file_url` TEXT,
  `file_name` TEXT,
  `file_type` TEXT,
  `file_size` INTEGER,
  `created_at` TEXT
);
--> statement-breakpoint
CREATE TABLE `backup_log` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `filename` TEXT,
  `size` INTEGER,
  `type` TEXT,
  `r2_key` TEXT,
  `created_at` TEXT
);
--> statement-breakpoint
CREATE TABLE `face_descriptors` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `label` TEXT,
  `descriptor` BLOB,
  `created_at` TEXT
);
--> statement-breakpoint

INSERT INTO `admin_users` VALUES
(1,'teacher','oldhash123','oldsalt','teacher','班主任','2025-09-01 08:00:00','2026-10-10 12:00:00'),
(2,'admin','oldhash456','oldsalt2','super','超级管理员','2025-09-01 08:00:00',NULL);
--> statement-breakpoint

INSERT INTO `admin_config` VALUES
('class_name','三年级二班'),
('avatar_frame_leaderboard','gold'),
('avatar_frame_cards','silver'),
('avatar_frame_tier','bronze'),
('resend_from','onboarding@resend.dev'),
('notify_email','admin@example.com'),
('notify_on_login','1'),
('rescue_email','rescue@example.com'),
('auto_backup_enabled','1'),
('auto_backup_keep_days','14'),
('resend_api_key','re_xxxxxxxxxxxxSECRET'),
('face_enabled','0'),
('device_activation_code','OLDCODE99'),
('device_activation_codes','[{"code":"ABCD1234","label":"教室大屏","createdAt":"2025-09-02T10:00:00.000Z","createdBy":"teacher","used":true,"usedAt":"2025-09-02T10:05:00.000Z","usedBy":"教室电脑","usedIp":"1.2.3.4"},{"code":"WXYZ8888","label":"办公室平板","createdAt":"2025-09-03T09:00:00.000Z","createdBy":"teacher","used":false}]');
--> statement-breakpoint

INSERT INTO `device_tokens` VALUES
(1,'tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','教室电脑','1.2.3.4','Mozilla/5.0','中国','赣州','ABCD1234','2025-09-02 10:05:00','2026-10-10 11:59:00'),
(2,'tok_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','办公室平板','5.6.7.8','Mozilla/5.0','中国','赣州','WXYZ8888','2025-09-03 09:10:00','2026-10-09 18:00:00');
--> statement-breakpoint

INSERT INTO `login_logs` VALUES
(1,'teacher','teacher','1.2.3.4','Mozilla/5.0','中国','赣州',1,'2026-10-10 12:00:00'),
(2,'admin','super','1.2.3.4','Mozilla/5.0','中国','赣州',1,'2026-10-08 09:00:00'),
(3,'teacher','teacher','9.9.9.9','Mozilla/5.0','中国','赣州',0,'2026-10-07 22:00:00');
--> statement-breakpoint

INSERT INTO `audit_logs` VALUES
(1,'teacher','generate_device_code','教室大屏','ABCD1234','1.2.3.4','2025-09-02 10:00:00'),
(2,'admin','set_points','张三','手动加 5 分','1.2.3.4','2026-10-01 15:00:00');
--> statement-breakpoint

INSERT INTO `groups` VALUES
(1,'青龙组','#34c759','龙腾虎跃','2025-09-01 08:00:00','2026-09-01 08:00:00'),
(2,'白虎组','#007aff','锐不可当','2025-09-01 08:00:00','2026-09-01 08:00:00');
--> statement-breakpoint

INSERT INTO `students` VALUES
(1,'张三','202501',1,120,'','2025-09-01 09:00:00','2026-10-10 10:00:00'),
(2,'李四','202502',1,85,'','2025-09-01 09:00:00','2026-10-09 10:00:00'),
(3,'王五','202503',2,200,'','2025-09-01 09:00:00','2026-10-10 09:00:00'),
(4,'赵六','202504',2,40,'','2025-09-01 09:00:00','2026-10-08 10:00:00'),
(5,'钱七','202505',NULL,-5,'','2025-09-01 09:00:00','2026-10-07 10:00:00');
--> statement-breakpoint

INSERT INTO `point_rules` VALUES
(1,'add','作业优秀',5,1,'2025-09-01 08:00:00','2025-09-01 08:00:00'),
(2,'sub','迟到',-3,1,'2025-09-01 08:00:00','2025-09-01 08:00:00'),
(3,'add','大扫除',10,1,'2025-09-01 08:00:00','2025-09-01 08:00:00');
--> statement-breakpoint

INSERT INTO `point_records` VALUES
(1,1,'张三','青龙组','add','作业优秀',5,'device','2025-09-10 10:00:00'),
(2,1,'张三','青龙组','sub','迟到',-3,'device','2025-09-11 10:00:00'),
(3,3,'王五','白虎组','add','大扫除',10,'teacher','2025-09-12 10:00:00'),
(4,2,'李四','青龙组','add','作业优秀',5,'device','2025-09-13 10:00:00'),
(5,5,'钱七',NULL,'sub','没交作业',-5,'teacher','2025-09-14 10:00:00'),
(6,4,'赵六','白虎组','system','所有学生积分已重置为0',0,'admin','2025-09-01 08:30:00');
--> statement-breakpoint

INSERT INTO `announcements` VALUES
(1,'开学通知','明天正式上课，请带好课本。','','','',0,'2025-09-01 08:00:00'),
(2,'运动会照片','见附件','/api/file/20261001_运动会.jpg','运动会.jpg','image/jpeg',204800,'2026-10-01 08:00:00');
--> statement-breakpoint

INSERT INTO `backup_log` VALUES
(1,'backup-2026-10-01.sql.gz',102400,'auto','backups/backup-2026-10-01.sql.gz','2026-10-01 04:00:00');
--> statement-breakpoint

INSERT INTO `face_descriptors` VALUES
(1,'teacher',X'0102030405060708090A0B0C0D0E0F10','2025-09-01 08:00:00'),
(2,'admin',X'1112131415161718191A1B1C1D1E1F20','2025-09-01 08:00:00');
--> statement-breakpoint
