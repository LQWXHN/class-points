-- 回归夹具：严格仿 wrangler d1 export（v4.149）真实格式
-- 特征：单行 CREATE TABLE（多空格）、双引号标识符、单行 INSERT、
--       字符串内中文/逗号/反斜杠转义、replace('...','\n',char(10)) 函数表达式、
--       sqlite_sequence、PRAGMA、尾部 CREATE INDEX。
PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE admin_config (     key   TEXT PRIMARY KEY,     value TEXT NOT NULL );
CREATE TABLE groups (     id   INTEGER PRIMARY KEY AUTOINCREMENT,     name TEXT NOT NULL,     color TEXT NOT NULL DEFAULT '#34c759',     signature TEXT NOT NULL DEFAULT '',     created_at TEXT,     updated_at TEXT );
CREATE TABLE students (     id INTEGER PRIMARY KEY AUTOINCREMENT,     name TEXT,     student_no TEXT,     group_id INTEGER,     points INTEGER,     avatar TEXT,     avatar_url TEXT,     created_at TEXT,     updated_at TEXT );
CREATE TABLE point_rules (     id INTEGER PRIMARY KEY AUTOINCREMENT,     type TEXT,     reason TEXT,     points INTEGER,     is_custom INTEGER,     created_at TEXT );
CREATE TABLE point_records (     id INTEGER PRIMARY KEY AUTOINCREMENT,     student_id INTEGER,     student_name TEXT,     group_name TEXT,     type TEXT,     reason TEXT,     points INTEGER,     operator TEXT,     created_at TEXT,     synced_at TEXT );
CREATE TABLE announcements (     id INTEGER PRIMARY KEY AUTOINCREMENT,     title TEXT,     content TEXT,     file_url TEXT,     file_name TEXT,     file_type TEXT,     file_size INTEGER,     created_at TEXT );
CREATE TABLE device_tokens (     id INTEGER PRIMARY KEY AUTOINCREMENT,     token TEXT,     device_name TEXT,     activated_at TEXT,     last_seen TEXT,     ip TEXT,     ua TEXT,     country TEXT,     city TEXT,     activation_code TEXT );
CREATE TABLE backup_log (     id INTEGER PRIMARY KEY AUTOINCREMENT,     filename TEXT,     size INTEGER,     type TEXT,     r2_key TEXT,     created_at TEXT );
CREATE TABLE admin_users (     id INTEGER PRIMARY KEY AUTOINCREMENT,     username TEXT,     password_hash TEXT,     password_salt TEXT,     role TEXT,     display_name TEXT,     created_at TEXT,     last_login TEXT );
CREATE TABLE login_logs (     id INTEGER PRIMARY KEY AUTOINCREMENT,     username TEXT,     role TEXT,     ip TEXT,     ua TEXT,     country TEXT,     city TEXT,     success INTEGER,     created_at TEXT );
CREATE TABLE audit_logs (     id INTEGER PRIMARY KEY AUTOINCREMENT,     operator TEXT,     action TEXT,     target TEXT,     detail TEXT,     ip TEXT,     created_at TEXT );
CREATE TABLE face_descriptors (     id INTEGER PRIMARY KEY AUTOINCREMENT,     label TEXT,     descriptor BLOB,     created_at TEXT );

INSERT INTO "admin_config" ("key","value") VALUES('site_title','高一（3）班');
INSERT INTO "admin_config" ("key","value") VALUES('avatar_frame_leaderboard','gold');
INSERT INTO "admin_config" ("key","value") VALUES('notify_email','teacher@example.com');
INSERT INTO "admin_config" ("key","value") VALUES('rescue_email','rescue@example.com');
INSERT INTO "admin_config" ("key","value") VALUES('resend_api_key','re_SHOULDBEDROPPED');
INSERT INTO "admin_config" ("key","value") VALUES('password_hash','SHOULDBEDROPPED');
INSERT INTO "admin_config" ("key","value") VALUES('password_salt','SHOULDBEDROPPED');
INSERT INTO "admin_config" ("key","value") VALUES('device_activation_codes','[{"code":"AA11BB22","label":"教室大屏","createdAt":"2026-09-01T08:00:00.000Z","createdBy":"teacher","used":false},{"code":"CC33DD44","label":"办公室","createdAt":"2026-09-02T08:00:00.000Z","createdBy":"teacher","used":true,"usedAt":"2026-09-02T09:00:00.000Z","usedBy":"办公室PC","usedIp":"1.2.3.4"}]');

INSERT INTO "groups" ("id","name","color","created_at","updated_at","signature") VALUES(1,'星辰组','#34c759','2026-09-01 08:00:00','2026-09-01 08:00:00','志存高远');
INSERT INTO "groups" ("id","name","color","created_at","updated_at","signature") VALUES(2,'山海组','#007aff','2026-09-01 08:00:00','2026-09-01 08:00:00','脚踏实地');

INSERT INTO "students" ("id","name","student_no","group_id","points","avatar","avatar_url","created_at","updated_at") VALUES(101,'张三','1',1,120,'https://classpoint.example.top/api/file/uploads%2F1791000000000_avatar1.jpg','','2026-09-01 09:00:00','2026-10-01 10:00:00');
INSERT INTO "students" ("id","name","student_no","group_id","points","avatar","avatar_url","created_at","updated_at") VALUES(102,'李四','2',2,85,'😀','','2026-09-01 09:00:00','2026-10-01 10:00:00');
INSERT INTO "students" ("id","name","student_no","group_id","points","avatar","avatar_url","created_at","updated_at") VALUES(103,'王五','3',NULL,-5,'','','2026-09-01 09:00:00','2026-10-01 10:00:00');

INSERT INTO "point_rules" ("id","type","reason","points","is_custom","created_at") VALUES(11,'add','作业优秀',5,1,'2026-09-01 08:00:00');
INSERT INTO "point_rules" ("id","type","reason","points","is_custom","created_at") VALUES(12,'subtract','迟到，未交作业',-3,1,'2026-09-01 08:00:00');

INSERT INTO "point_records" ("id","student_id","student_name","group_name","type","reason","points","operator","created_at","synced_at") VALUES(1001,101,'张三','星辰组','add','作业优秀',5,'device','2026-09-10 10:00:00','2026-09-10 10:00:01');
INSERT INTO "point_records" ("id","student_id","student_name","group_name","type","reason","points","operator","created_at","synced_at") VALUES(1002,102,'李四','山海组','subtract','迟到，被提醒两次',-3,'teacher','2026-09-11 10:00:00','2026-09-11 10:00:01');

INSERT INTO "announcements" ("id","title","content","file_url","file_name","file_type","file_size","created_at") VALUES(5,'开学通知',replace('各位同学：\n明天带课本','\\n',char(10)),'','','',0,'2026-09-01 08:00:00');
INSERT INTO "announcements" ("id","title","content","file_url","file_name","file_type","file_size","created_at") VALUES(6,'月考安排','见附件','/api/file/uploads%2F1791200000000_%E6%9C%88%E8%80%83.xlsx','月考.xlsx','application/vnd.ms-excel',204800,'2026-10-01 08:00:00');

INSERT INTO "device_tokens" ("id","token","device_name","activated_at","last_seen","ip","ua","country","city","activation_code") VALUES(21,'tok_aaaa','教室大屏','2026-09-01 09:00:00','2026-10-01 10:00:00','1.2.3.4','Mozilla','中国','赣州','AA11BB22');
INSERT INTO "device_tokens" ("id","token","device_name","activated_at","last_seen","ip","ua","country","city","activation_code") VALUES(22,'tok_bbbb','办公室PC','2026-09-02 09:00:00','2026-10-01 09:00:00','1.2.3.5','Mozilla','中国','赣州','CC33DD44');

INSERT INTO "backup_log" ("id","filename","size","type","r2_key","created_at") VALUES(31,'backup-2026-10-01.sql.gz',102400,'auto','backups/backup-2026-10-01.sql.gz','2026-10-01 04:00:00');

INSERT INTO "admin_users" ("id","username","password_hash","password_salt","role","display_name","created_at","last_login") VALUES(1,'teacher','hash1','salt1','teacher','班主任','2026-09-01 08:00:00','2026-10-01 10:00:00');

INSERT INTO "login_logs" ("id","username","role","ip","ua","country","city","success","created_at") VALUES(41,'teacher','teacher','1.2.3.4','Mozilla','中国','赣州',1,'2026-10-01 10:00:00');
INSERT INTO "login_logs" ("id","username","role","ip","ua","country","city","success","created_at") VALUES(42,'teacher','teacher','9.9.9.9','Mozilla','中国','赣州',0,'2026-10-01 09:00:00');

INSERT INTO "audit_logs" ("id","operator","action","target","detail","ip","created_at") VALUES(51,'teacher','generate_device_code','教室大屏','AA11BB22','1.2.3.4','2026-09-01 09:00:00');

INSERT INTO "sqlite_sequence" ("name","seq") VALUES('students',103);
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('point_records',1002);

CREATE INDEX idx_records_created ON point_records(created_at);
