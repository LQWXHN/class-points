// Node 端入口：better-sqlite3 + 磁盘存储 + 静态资源托管 + sync runner + 04:00 自动备份
import { serve } from '@hono/node-server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeDb } from './db/node-db.js';
import { createDiskStorage } from './storage/disk-storage.js';
import { createApp } from './app.js';
import { createRunner } from './sync/runner.js';
import { buildBackup, performBackup } from './routes/backup.js';
import { setSyncOrigin, getConfig, setConfig, now, writeSyncEvent } from './routes/_helpers.js';
import { startProbeLoop, pickPeerOnline } from './sites-health.js';

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
const peerFallback = fileCfg.CF_PEER_URL || CF_PEER_URL;
const resolvePeer = () => pickPeerOnline('node') || peerFallback;

setSyncOrigin('node');

const db = createNodeDb({ dataDir: DATA_DIR });
const schemaSql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
await db.execSchema(schemaSql);
await migrateV41(db);
await migrateV44(db);
await migrateV45(db);
await migrateV46(db);
await migrateV47(db);
await migrateV48(db);
await migrateV49(db);
await migrateV50(db);

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

// v4.5 幂等迁移：chat_stickers 表
async function migrateV45(db) {
  await db.run(`CREATE TABLE IF NOT EXISTS chat_stickers (
    uid TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '', url TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_stickers_owner ON chat_stickers(owner_type, owner_id)');
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
  // v4.7 清理 v4.6 聊天模块；但 v5.0 复用了同名表（chat_messages 等），
  // 若检测到 v5.0 表结构（含 uid 列）则整段跳过，避免每次重启把群聊数据清空。
  const cols = await db.all('PRAGMA table_info(chat_messages)');
  const isV50 = (cols || []).some(c => c.name === 'uid');
  if (isV50) {
    // v4.7 版本号也不再覆盖（由后续 migrate 设置）
    return;
  }
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

// v4.8 幂等迁移：弹窗背景模糊开关；groups 表补 avatar 列；point_rules 补 sort_order 列。
async function migrateV48(db) {
  // 弹窗背景模糊开关：'1' 开（历史默认行为），'0' 关
  const blurRow = await db.get('SELECT key FROM admin_config WHERE key=?', 'modal_blur_enabled');
  if (!blurRow) await setConfig(db, 'modal_blur_enabled', '1');

  // groups.avatar 列（v4.8 新增小组头像）
  const grpCols = await db.all('PRAGMA table_info(groups)');
  const grpNames = new Set((grpCols || []).map(c => c.name));
  if (!grpNames.has('avatar')) {
    await db.run("ALTER TABLE groups ADD COLUMN avatar TEXT NOT NULL DEFAULT ''");
  }

  // point_rules.sort_order 列（v4.8 规则拖拽排序）
  const prCols = await db.all('PRAGMA table_info(point_rules)');
  const prNames = new Set((prCols || []).map(c => c.name));
  if (!prNames.has('sort_order')) {
    await db.run('ALTER TABLE point_rules ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    // 按现有 type, id 顺序回填 sort_order=1,2,3...
    for (const t of ['add', 'sub']) {
      const rows = await db.all('SELECT uid FROM point_rules WHERE type=? AND deleted=0 ORDER BY id', t);
      let i = 1;
      for (const r of rows) {
        await db.run('UPDATE point_rules SET sort_order=? WHERE uid=?', i++, r.uid);
      }
    }
  }

  // 系统版本号
  await db.run("UPDATE admin_config SET value='v4.8（2026-10-24）' WHERE key='system_version'");
  const vRow = await db.get("SELECT key FROM admin_config WHERE key='system_version'");
  if (!vRow) await setConfig(db, 'system_version', 'v4.8（2026-10-24）');
}

// v4.9 幂等迁移：无表结构变更，仅更新系统版本号
async function migrateV49(db) {
  await db.run("UPDATE admin_config SET value='v4.9（2026-10-25）' WHERE key='system_version'");
  const vRow = await db.get("SELECT key FROM admin_config WHERE key='system_version'");
  if (!vRow) await setConfig(db, 'system_version', 'v4.9（2026-10-25）');
}

// v5.0 幂等迁移：群聊模块（四表必须在此显式建，因为 migrateV47 会 DROP 旧 chat 表）+ admin_users.wxpusher_uid 列 + 默认配置
async function migrateV50(db) {
  // 显式建四表（IF NOT EXISTS 幂等；schema.sql 也有，但 migrateV47 会 DROP，所以这里必须再建）
  await db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    sender_key TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_avatar TEXT NOT NULL DEFAULT '',
    msg_type TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    attachments TEXT NOT NULL DEFAULT '[]',
    reply_to TEXT NOT NULL DEFAULT '',
    recalled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0
  )`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_chat_msg_time ON chat_messages(created_at)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_chat_msg_reply ON chat_messages(reply_to)');

  await db.run(`CREATE TABLE IF NOT EXISTS chat_reads (
    member_key TEXT PRIMARY KEY,
    last_read_id INTEGER NOT NULL DEFAULT 0,
    last_read_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS chat_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_key TEXT NOT NULL,
    msg_uid TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(member_key, msg_uid)
  )`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_chat_fav_member ON chat_favorites(member_key)');

  await db.run(`CREATE TABLE IF NOT EXISTS chat_notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    author TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0
  )`);

  // admin_users.wxpusher_uid 列
  const auCols = await db.all('PRAGMA table_info(admin_users)');
  const auNames = new Set((auCols || []).map(c => c.name));
  if (!auNames.has('wxpusher_uid')) {
    await db.run("ALTER TABLE admin_users ADD COLUMN wxpusher_uid TEXT NOT NULL DEFAULT ''");
  }

  const defaults = {
    chat_group_name: '二班群',
    chat_enabled: '1',
    chat_notice: '欢迎使用班级群，请文明发言',
    wxpusher_app_token: '',
    wxpusher_enabled: '0',
    chat_front_push_channel: 'browser',
    wxpusher_uid_front: '',
    front_account_name: '二班学生',
    front_account_avatar: '👦',
  };
  for (const [k, v] of Object.entries(defaults)) {
    const row = await db.get('SELECT key FROM admin_config WHERE key=?', k);
    if (!row) await setConfig(db, k, v);
  }

  await db.run("UPDATE admin_config SET value='v5.1（2026-10-25）' WHERE key='system_version'");
  const vRow = await db.get("SELECT key FROM admin_config WHERE key='system_version'");
  if (!vRow) await setConfig(db, 'system_version', 'v5.1（2026-10-25）');
}

// schema.sql 已通过 INSERT OR IGNORE 预置 teacher/admin 账户与默认配置，无需再次 seed

const app = createApp({ db, storage, origin: 'node', syncSecret, peerUrl: peerFallback });

// 静态资源：/assets、*.html、/admin/index.html
const pageMap = {
  '/': '/index.html',
  '/start': '/start.html',
  '/ae': '/ae.html',
  '/history': '/history.html',
  '/new': '/new.html',
  '/chat': '/chat.html',
  '/chat/teacher': '/chat-staff.html',
  '/chat/admin': '/chat-staff.html',
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
  // HTML 每次校验；表情素材长期缓存（内容不变，保证再次打开一点即显）；其余静态资源短缓存
  const norm = fullPath.replace(/\\/g, '/');
  const cacheControl = ext === '.html'
    ? 'no-cache'
    : norm.includes('/assets/qq-face/')
      ? 'public, max-age=604800, immutable'
      : 'public, max-age=300, must-revalidate';
  return c.body(body, 200, { 'Content-Type': mime, 'Cache-Control': cacheControl });
}

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[node] listening on http://127.0.0.1:${PORT}  data=${DATA_DIR}`);
});

// sync runner
let runner = null;
// v5.1：站点健康探测（每 60s），无 syncSecret 也运行（支撑 sites-health 接口与推送域名选择）
startProbeLoop(async () => {
  try {
    const raw = await getConfig(db, 'sites') || '[]';
    return JSON.parse(raw);
  } catch { return []; }
}, 60000);
if (syncSecret) {
  await setConfig(db, 'sync_my_url', `http://127.0.0.1:${PORT}`).catch(() => {});
  // peer 每轮按探测结果动态选择，全失败回退配置
  runner = createRunner({ db, storage, peerUrl: resolvePeer, syncSecret, origin: 'node', pollMs: 60000 });
  await runner.start();
}

// 每周一 04:00（服务器本地时间）自动备份
function scheduleAutoBackup() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(4, 0, 0, 0);
  // getDay(): 0=周日, 1=周一, ... 6=周六
  const daysToMonday = (1 - now.getDay() + 7) % 7;
  next.setDate(now.getDate() + daysToMonday);
  if (next <= now) next.setDate(next.getDate() + 7);
  setTimeout(() => {
    autoBackupOnce().catch(e => console.error('[autoBackup]', e.message));
    scheduleAutoBackup();
  }, next.getTime() - now.getTime());
}
async function autoBackupOnce() {
  const enabled = await getConfig(db, 'auto_backup_enabled');
  if (enabled !== '1') return;
  const meta = await performBackup(db, storage, { type: 'auto', source: 'server' });
  console.log('[autoBackup] ok', meta.filename);
}
scheduleAutoBackup();

export { db, storage, app, runner };
