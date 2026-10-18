// Node 端入口：better-sqlite3 + 磁盘存储 + 静态资源托管 + sync runner + 04:00 自动备份
import { serve } from '@hono/node-server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeDb } from './db/node-db.js';
import { createDiskStorage } from './storage/disk-storage.js';
import { createApp } from './app.js';
import { createRunner } from './sync/runner.js';
import { buildBackup } from './routes/backup.js';
import { setSyncOrigin, getConfig, setConfig, now } from './routes/_helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const PORT = parseInt(process.env.PORT || '8787');
const DATA_DIR = process.env.DATA_DIR || path.join(PROJECT_ROOT, 'data');
const SYNC_SECRET = process.env.SYNC_SECRET || '';
const CF_PEER_URL = process.env.CF_PEER_URL || '';
const WEB_DIR = path.join(PROJECT_ROOT, 'web');

// data/config.json 可覆盖环境变量
let fileCfg = {};
const cfgPath = path.join(DATA_DIR, 'config.json');
if (fs.existsSync(cfgPath)) {
  try { fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
}
const syncSecret = fileCfg.SYNC_SECRET || SYNC_SECRET;
const peerUrl = fileCfg.CF_PEER_URL || CF_PEER_URL;

setSyncOrigin('node');

const db = createNodeDb({ dataDir: DATA_DIR });
const schemaSql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
await db.execSchema(schemaSql);
await migrateV41(db);
await migrateV42(db);
await migrateV44(db);
await migrateV45(db);
await migrateV46(db);
await migrateV47(db);

const storage = createDiskStorage({ dataDir: DATA_DIR });

// v4.1 幂等迁移：对已存在的 v4.0 老库补 announcements 三列。
// 新表由 schema.sql 的 CREATE TABLE IF NOT EXISTS 自动建，无需在此处理。
async function migrateV41(db) {
  const cols = await db.all('PRAGMA table_info(announcements)');
  const names = new Set((cols || []).map(c => c.name));
  if (!names.has('category')) await db.run("ALTER TABLE announcements ADD COLUMN category TEXT NOT NULL DEFAULT '通知公告'");
  if (!names.has('edited'))   await db.run('ALTER TABLE announcements ADD COLUMN edited   INTEGER NOT NULL DEFAULT 0');
  if (!names.has('editor'))   await db.run("ALTER TABLE announcements ADD COLUMN editor    TEXT NOT NULL DEFAULT ''");
}

// v4.2 幂等迁移：双周榜锚点从 2024-01-01 改为 2026-10-01，
// 旧锚点写入的 rank_snapshots(kind='biweekly') 纯缓存，启动时清空，由首次请求确定性重算。
// 重复执行 DELETE 无副作用（表为空时 delete 0 行）。
async function migrateV42(db) {
  await db.run("DELETE FROM rank_snapshots WHERE kind='biweekly'");
}

// v4.4 幂等迁移：新列、脏数据归一、内置规则、默认配置、VAPID 密钥自动生成
async function migrateV44(db) {
  // 1. 补列
  const prCols = await db.all('PRAGMA table_info(point_records)');
  const prNames = new Set((prCols || []).map(c => c.name));
  if (!prNames.has('hidden')) await db.run('ALTER TABLE point_records ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');

  const rrCols = await db.all('PRAGMA table_info(point_rules)');
  const rrNames = new Set((rrCols || []).map(c => c.name));
  if (!rrNames.has('is_builtin')) await db.run('ALTER TABLE point_rules ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 0');

  const auCols = await db.all('PRAGMA table_info(admin_users)');
  const auNames = new Set((auCols || []).map(c => c.name));
  if (!auNames.has('avatar')) await db.run("ALTER TABLE admin_users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''");

  // 2. 历史脏数据归一：subtract → sub，points 取绝对值
  await db.run("UPDATE point_rules SET type='sub', points=ABS(points) WHERE type='subtract'");
  // 流水同样归一：旧 subtract 流水统一为 sub、分值取绝对值
  await db.run("UPDATE point_records SET type='sub', points=ABS(points) WHERE type='subtract'");
  // 早期联调遗留的测试垃圾流水（apply=0 且原因为“测试”，分值为天文数字）隐藏，不进任何列表
  await db.run("UPDATE point_records SET hidden=1 WHERE apply=0 AND reason='测试'");

  // 3. 两条内置「自定义」规则（固定 uid，冲突忽略）
  const t = now();
  await db.run("INSERT OR IGNORE INTO point_rules (uid, type, reason, points, is_custom, is_builtin, created_at, updated_at, deleted) VALUES ('builtin-rule-add', 'add', '自定义', 0, 1, 1, ?, ?, 0)", t, t);
  await db.run("INSERT OR IGNORE INTO point_rules (uid, type, reason, points, is_custom, is_builtin, created_at, updated_at, deleted) VALUES ('builtin-rule-sub', 'sub', '自定义', 0, 1, 1, ?, ?, 0)", t, t);

  // 4. 默认配置键（仅当不存在时写）
  const defaults = {
    rescue_email: 'admin@example.com',
    sites: JSON.stringify([{ name: '主站', url: 'https://points.example.com' }, { name: '备用站', url: 'https://points1.example.com' }]),
    ext_links: JSON.stringify({ github: '', home: '', blog: '' }),
    system_version: 'v4.4（2026-10-15）',
    notify_sound: 'ganlu',
    notify_sound_url: '',
  };
  for (const [k, v] of Object.entries(defaults)) {
    const row = await db.get('SELECT key FROM admin_config WHERE key=?', k);
    if (!row) await setConfig(db, k, v);
  }
}

// v4.5 幂等迁移：chat_stickers 表 + 默认 config biweekly_rank_enabled='1'
async function migrateV45(db) {
  await db.run(`CREATE TABLE IF NOT EXISTS chat_stickers (
    uid TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '', url TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_stickers_owner ON chat_stickers(owner_type, owner_id)');
  const row = await db.get('SELECT key FROM admin_config WHERE key=?', 'biweekly_rank_enabled');
  if (!row) await setConfig(db, 'biweekly_rank_enabled', '1');
}

// v4.6 幂等迁移：chat_reads 表 + 默认 config 键
async function migrateV46(db) {
  await db.run(`CREATE TABLE IF NOT EXISTS chat_reads (
    reader_type TEXT NOT NULL, reader_id TEXT NOT NULL,
    last_read_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (reader_type, reader_id)
  )`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_chat_reads_time ON chat_reads(last_read_at)');
  const defaults = {
    front_account_name: '前台',
    front_account_avatar: '🏫',
    chat_notice: '欢迎使用班级通知群，请文明发言',
    chat_sensitive_words: '',
  };
  for (const [k, v] of Object.entries(defaults)) {
    const row = await db.get('SELECT key FROM admin_config WHERE key=?', k);
    if (!row) await setConfig(db, k, v);
  }
}

// v4.7 幂等迁移：删除聊天/IM 模块（chat_messages/chat_favorites/chat_stickers/chat_reads/push_subscriptions）
// 及相关 config 键与同步事件。保留反馈表 feedback_messages。
async function migrateV47(db) {
  // 按外键依赖顺序 DROP（先子后父，此处无显式外键，顺序不影响）
  await db.run('DROP TABLE IF EXISTS chat_reads');
  await db.run('DROP TABLE IF EXISTS chat_stickers');
  await db.run('DROP TABLE IF EXISTS chat_favorites');
  await db.run('DROP TABLE IF EXISTS push_subscriptions');
  await db.run('DROP TABLE IF EXISTS chat_messages');

  // 删除聊天相关 config 键
  await db.run(`DELETE FROM admin_config WHERE key IN
    ('chat_notice','chat_sensitive_words','front_account_name','front_account_avatar',
     'vapid_public_key','vapid_private_key')`);

  // 清理残留同步事件
  await db.run(`DELETE FROM sync_events WHERE tbl IN
    ('chat_messages','chat_favorites','chat_stickers','chat_reads','push_subscriptions')`);

  // 系统版本号
  await db.run("UPDATE admin_config SET value='v4.7（2026-10-18）' WHERE key='system_version'");
  const vRow = await db.get("SELECT key FROM admin_config WHERE key='system_version'");
  if (!vRow) await setConfig(db, 'system_version', 'v4.7（2026-10-18）');
}

// schema.sql 已通过 INSERT OR IGNORE 预置 teacher/admin 账户与默认配置，无需再次 seed

const app = createApp({ db, storage, origin: 'node', syncSecret, peerUrl });

// 静态资源：/assets、*.html、/admin/index.html
const pageMap = {
  '/': '/index.html',
  '/start': '/start.html',
  '/ae': '/ae.html',
  '/history': '/history.html',
  '/new': '/new.html',
  '/send': '/send.html',
  '/admin': '/admin/index.html',
};
app.all('*', async (c) => {
  const p = new URL(c.req.url).pathname;
  if (p.startsWith('/api/')) return c.json({ ok: false, error: 'Not Found' }, 404);
  // 规范：/admin 跳转到 /admin/（避免无斜杠时相对资源路径解析错误）
  if (p === '/admin') return c.redirect('/admin/', 302);
  // 末尾斜杠归一：/admin/ -> /admin；/start/ -> /start；根路径保留 '/'
  const normPath = p === '/' ? '/' : p.replace(/\/+$/, '');
  let rel = '';
  if (pageMap[normPath]) rel = pageMap[normPath];
  else rel = normPath.replace(/^\//, '');
  const full = path.join(WEB_DIR, rel);
  if (!full.startsWith(WEB_DIR)) return c.text('Forbidden', 403);
  if (!fs.existsSync(full) && !path.extname(full)) {
    // 兜底：目录形式（如 /foo/）尝试对应 pageMap
    const tryMap = pageMap[normPath] || pageMap['/' + (normPath.split('/').filter(Boolean)[0] || '')];
    if (tryMap) {
      const t2 = path.join(WEB_DIR, tryMap);
      if (fs.existsSync(t2)) return serveStatic(c, t2);
    }
  }
  if (!fs.existsSync(full)) return c.text('Not Found', 404);
  return serveStatic(c, full);
});

function serveStatic(c, fullPath) {
  const ext = path.extname(fullPath).toLowerCase();
  const mime = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  }[ext] || 'application/octet-stream';
  const body = fs.readFileSync(fullPath);
  // HTML 每次校验；静态资源短缓存 + 必须回源校验，保证发版后边缘/浏览器不滞留旧 JS/CSS
  const cacheControl = ext === '.html'
    ? 'no-cache'
    : 'public, max-age=300, must-revalidate';
  return c.body(body, 200, { 'Content-Type': mime, 'Cache-Control': cacheControl });
}

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[node] listening on http://127.0.0.1:${PORT}  data=${DATA_DIR}`);
});

// sync runner
let runner = null;
if (peerUrl && syncSecret) {
  await setConfig(db, 'sync_my_url', `http://127.0.0.1:${PORT}`).catch(() => {});
  runner = createRunner({ db, storage, peerUrl, syncSecret, origin: 'node', pollMs: 60000 });
  await runner.start();
}

// 04:00 自动备份
function scheduleAutoBackup() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(4, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(() => {
    autoBackupOnce().catch(e => console.error('[autoBackup]', e.message));
    scheduleAutoBackup();
  }, next.getTime() - now.getTime());
}
async function autoBackupOnce() {
  const enabled = await getConfig(db, 'auto_backup_enabled');
  if (enabled !== '1') return;
  const backup = await buildBackup(db);
  const filename = `backup_auto_${Date.now()}.json`;
  const json = JSON.stringify(backup);
  await storage.put(`backups/${filename}`, json, 'application/json');
  await db.run('INSERT INTO backup_log (uid, filename, size, type, storage_key, created_at) VALUES (?,?,?,?,?,?)',
    crypto.randomUUID(), filename, json.length, 'auto', `backups/${filename}`, Date.now());
}
scheduleAutoBackup();

export { db, storage, app, runner };
