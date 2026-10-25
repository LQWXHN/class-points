import { Hono } from 'hono';
import { uid, now, verifyUser, writeSyncEvent, getConfig, getKv, setKv, notify } from './_helpers.js';

export async function buildBackup(db) {
  const students = await db.all('SELECT * FROM students WHERE deleted=0 ORDER BY id');
  const groups = await db.all('SELECT * FROM groups WHERE deleted=0 ORDER BY id');
  const rules = await db.all('SELECT * FROM point_rules WHERE deleted=0 ORDER BY id');
  const announcements = await db.all('SELECT * FROM announcements WHERE deleted=0 ORDER BY id');
  const cfgRows = await db.all(
    `SELECT key, value FROM admin_config
     WHERE key NOT IN ('password_hash','password_salt','resend_api_key','resend_from','notify_email')`);
  const config = {};
  for (const r of cfgRows) config[r.key] = r.value;
  // v5.0 群聊四表
  let chat_messages = [], chat_reads = [], chat_favorites = [], chat_notices = [];
  try { chat_messages = await db.all('SELECT * FROM chat_messages WHERE deleted=0 ORDER BY id'); } catch {}
  try { chat_reads = await db.all('SELECT * FROM chat_reads'); } catch {}
  try { chat_favorites = await db.all('SELECT * FROM chat_favorites'); } catch {}
  try { chat_notices = await db.all('SELECT * FROM chat_notices WHERE deleted=0 ORDER BY id'); } catch {}
  return {
    version: '5.0',
    exportedAt: new Date().toISOString(),
    students, groups, rules, announcements, config,
    chat_messages, chat_reads, chat_favorites, chat_notices,
  };
}

// 备份文件名规范：backup_<type>_<epochMs>.json，type ∈ auto|manual
function parseBackupName(filename) {
  const m = /^backup_(auto|manual)_(\d+)\.json$/.exec(filename || '');
  if (!m) return null;
  return { type: m[1], created_at: Number(m[2]) };
}

// 直接枚举本端存储里的 backups/（不依赖备份日志，所见即所得，最稳）
export async function listBackupFiles(storage) {
  const objs = await storage.list('backups/');
  const rows = [];
  for (const o of objs) {
    const filename = o.key.split('/').pop();
    if (!filename.endsWith('.json')) continue;
    const meta = parseBackupName(filename) || { type: 'manual', created_at: 0 };
    rows.push({
      key: o.key, filename,
      size: Number(o.size) || 0,
      type: meta.type,
      created_at: meta.created_at,
    });
  }
  rows.sort((a, b) => b.created_at - a.created_at);
  return rows;
}

// 自动备份保留份数（每周一份，留 8 份 ≈ 2 个月）
const AUTO_KEEP = 8;

// 生成一份备份并写入本端存储。source: 'server'（家里服务器） | 'cloud'（Cloudflare）
export async function performBackup(db, storage, { type = 'manual', source = 'server' } = {}) {
  // 自动备份防重：cron 每分钟触发，同一触发窗口（10 分钟内）不重复生成
  if (type === 'auto') {
    const guardKey = 'last_auto_backup_' + source;
    const last = Number(await getKv(db, guardKey) || 0);
    if (Date.now() - last < 10 * 60 * 1000) return { skipped: true };
    await setKv(db, guardKey, Date.now());
  }
  const t = Date.now();
  const backup = await buildBackup(db);
  const filename = `backup_${type}_${t}.json`;
  const key = `backups/${filename}`;
  const json = JSON.stringify(backup);
  await storage.put(key, json, 'application/json');
  await db.run('INSERT INTO backup_log (uid, filename, size, type, storage_key, created_at) VALUES (?,?,?,?,?,?)',
    uid(), filename, json.length, type, key, t);

  if (type === 'auto') {
    // 仅保留最近 AUTO_KEEP 份自动备份
    const autos = (await listBackupFiles(storage)).filter(r => r.type === 'auto').slice(AUTO_KEEP);
    for (const old of autos) {
      try { await storage.del(old.key); } catch {}
      await db.run('DELETE FROM backup_log WHERE storage_key=?', old.key);
    }
  }

  // 邮件通知（notify_on_backup=1 时；主题含位置/文件名/时间）
  const locLabel = source === 'cloud' ? 'Cloudflare 备用站' : '家里服务器';
  const typeLabel = type === 'auto' ? '每周自动备份' : '手动备份';
  const timeStr = new Date(t).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  try {
    await notify(db, 'backup',
      `【班级积分】数据备份成功（${source === 'cloud' ? 'Cloudflare' : '服务器'}）`,
      `<p><b>${typeLabel}已完成</b></p>
       <p>位置：${locLabel}<br>
          时间：${timeStr}（北京时间）<br>
          文件名：${filename}<br>
          大小：${(json.length / 1024).toFixed(1)} KB</p>
       <p style="color:#888;font-size:12px">此邮件由班级积分系统自动发送</p>`);
  } catch (e) { console.error('[backup notify]', e.message); }

  return { filename, size: json.length, created_at: t, key };
}

// 转发到对端（node <-> worker）的备份内部接口
async function peerFetch(c, suffix, init) {
  const peerUrl = c.get('peerUrl');
  const secret = c.get('syncSecret');
  if (!peerUrl || !secret) throw new Error('对端未配置，无法访问另一处备份');
  const base = peerUrl.replace(/\/+$/, '');
  const url = base + (suffix.startsWith('/') ? suffix : '/' + suffix);
  const headers = { 'X-Sync-Key': secret };
  if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const resp = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  return resp;
}

export function backupRoutes() {
  const app = new Hono();
  const localSide = (c) => (c.get('origin') === 'worker' ? 'cloud' : 'server');
  const peerSide = (c) => (localSide(c) === 'server' ? 'cloud' : 'server');

  // 列出备份：?side=server|cloud
  app.get('/backup/list', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const side = c.req.query('side') || localSide(c);
    if (side !== localSide(c)) {
      try {
        const resp = await peerFetch(c, '/api/sync/backup/list', { method: 'POST' });
        return c.body(resp.body, resp.status, { 'Content-Type': 'application/json' });
      } catch (e) {
        return c.json({ ok: true, data: [], unreachable: true, error: e.message });
      }
    }
    const rows = await listBackupFiles(c.get('storage'));
    return c.json({ ok: true, data: rows });
  });

  // 立即备份：{type:'manual', side:'server'|'cloud'}
  app.post('/backup/create', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const type = body.type === 'auto' ? 'auto' : 'manual';
    const side = body.side || localSide(c);
    if (side !== localSide(c)) {
      try {
        const resp = await peerFetch(c, '/api/sync/backup/create', {
          method: 'POST', body: JSON.stringify({ type }),
        });
        const data = await resp.text();
        return c.body(data, resp.status, { 'Content-Type': 'application/json' });
      } catch (e) {
        return c.json({ ok: false, error: '对端备份失败：' + e.message }, 502);
      }
    }
    const meta = await performBackup(c.get('db'), c.get('storage'), { type, source: side });
    return c.json({ ok: true, ...meta });
  });

  // 下载：?key=...&side=...
  app.get('/backup/download', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const key = c.req.query('key');
    if (!key) return c.json({ ok: false, error: '缺少参数' }, 400);
    const side = c.req.query('side') || localSide(c);
    if (side !== localSide(c)) {
      try {
        const resp = await peerFetch(c, '/api/sync/backup/file?key=' + encodeURIComponent(key), { method: 'GET' });
        if (!resp.ok) return c.body(resp.body, resp.status);
        return c.body(resp.body, 200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${key.split('/').pop()}"`,
        });
      } catch (e) {
        return c.json({ ok: false, error: '对端下载失败：' + e.message }, 502);
      }
    }
    const got = await c.get('storage').get(key);
    if (!got) return c.json({ ok: false, error: '文件不存在' }, 404);
    return c.body(got.body, 200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${key.split('/').pop()}"`,
    });
  });

  // 删除：{key, side}
  app.post('/backup/delete', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const { key, side } = await c.req.json().catch(() => ({}));
    if (!key) return c.json({ ok: false, error: '缺少 key' }, 400);
    const targetSide = side || localSide(c);
    if (targetSide !== localSide(c)) {
      try {
        const resp = await peerFetch(c, '/api/sync/backup/delete', {
          method: 'POST', body: JSON.stringify({ key }),
        });
        return c.body(resp.body, resp.status, { 'Content-Type': 'application/json' });
      } catch (e) {
        return c.json({ ok: false, error: '对端删除失败：' + e.message }, 502);
      }
    }
    try { await c.get('storage').del(key); } catch {}
    await c.get('db').run('DELETE FROM backup_log WHERE storage_key=?', key);
    return c.json({ ok: true });
  });

  app.post('/backup/restore', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const { backupData } = await c.req.json().catch(() => ({}));
    if (!backupData) return c.json({ ok: false, error: '无备份数据' }, 400);
    await restoreBackup(db, backupData, c.get('origin') || '');
    return c.json({ ok: true });
  });

  // 存储用量（本端，保留兼容）
  app.get('/r2/usage', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const rows = await listBackupFiles(c.get('storage'));
    const total = rows.reduce((s, o) => s + o.size, 0);
    return c.json({ ok: true, totalSize: total, count: rows.length, freeLimit: 10 * 1024 * 1024 * 1024 });
  });

  return app;
}

// 按 uid upsert 并补同步事件；事务外预载 existing，事务内只写
export async function restoreBackup(db, backup, origin) {
  const t = now();
  // 事务外预载
  const groupUids = (backup.groups || []).filter(g => g.uid).map(g => g.uid);
  const studentUids = (backup.students || []).filter(s => s.uid).map(s => s.uid);
  const ruleUids = (backup.rules || []).filter(r => r.uid).map(r => r.uid);
  const annUids = (backup.announcements || []).filter(a => a.uid).map(a => a.uid);

  const existingGroups = new Map();
  if (groupUids.length) {
    const rows = await db.all(`SELECT id, uid FROM groups WHERE uid IN (${groupUids.map(()=>'?').join(',')})`, ...groupUids);
    for (const r of rows) existingGroups.set(r.uid, r);
  }
  const existingStudents = new Set((await db.all(
    `SELECT uid FROM students WHERE uid IN (${studentUids.length ? studentUids.map(()=>'?').join(',') : "''"})`,
    ...studentUids)).map(r => r.uid));
  const existingRules = new Set((await db.all(
    `SELECT uid FROM point_rules WHERE uid IN (${ruleUids.length ? ruleUids.map(()=>'?').join(',') : "''"})`,
    ...ruleUids)).map(r => r.uid));
  const existingAnns = new Set((await db.all(
    `SELECT uid FROM announcements WHERE uid IN (${annUids.length ? annUids.map(()=>'?').join(',') : "''"})`,
    ...annUids)).map(r => r.uid));

  await db.tx(async () => {
    const groupUidToId = {};
    for (const g of (backup.groups || [])) {
      if (!g.uid) continue;
      const ex = existingGroups.get(g.uid);
      if (!ex) {
        const res = await db.run(
          'INSERT INTO groups (uid, name, color, signature, avatar, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
          g.uid, g.name, g.color || '#34c759', g.signature || '', g.avatar || '', g.created_at || t, t);
        groupUidToId[g.uid] = res.lastRowId;
      } else {
        await db.run('UPDATE groups SET name=?, color=?, signature=?, avatar=?, updated_at=? WHERE uid=?',
          g.name, g.color || '#34c759', g.signature ?? '', g.avatar || '', t, g.uid);
        groupUidToId[g.uid] = ex.id;
      }
      writeSyncEvent && await writeSyncEvent(db, { tbl: 'groups', row_uid: g.uid, op: 'upsert',
        snapshot: { ...g, name: g.name, color: g.color || '#34c759', signature: g.signature || '', avatar: g.avatar || '', updated_at: t }, origin });
    }
    for (const s of (backup.students || [])) {
      if (!s.uid) continue;
      const gid = s.group_uid ? (groupUidToId[s.group_uid] || null) : null;
      if (!existingStudents.has(s.uid)) {
        await db.run(
          `INSERT INTO students (uid, name, student_no, group_id, group_uid, points, avatar, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          s.uid, s.name, s.student_no || '', gid, s.group_uid || '', s.points || 0, s.avatar || '👦', s.created_at || t, t);
      } else {
        await db.run(
          `UPDATE students SET name=?, student_no=?, group_id=?, group_uid=?, points=?, avatar=?, updated_at=? WHERE uid=?`,
          s.name, s.student_no || '', gid, s.group_uid || '', s.points ?? 0, s.avatar || '👦', t, s.uid);
      }
      await writeSyncEvent(db, { tbl: 'students', row_uid: s.uid, op: 'upsert',
        snapshot: { ...s, group_id: gid, group_uid: s.group_uid || '', updated_at: t }, origin });
    }
    for (const r of (backup.rules || [])) {
      if (!r.uid) continue;
      if (!existingRules.has(r.uid)) {
        await db.run('INSERT INTO point_rules (uid, type, reason, points, is_custom, is_builtin, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
          r.uid, r.type, r.reason, r.points || 0, r.is_custom ?? 1, r.is_builtin ?? 0, r.sort_order || 0, r.created_at || t, t);
      } else {
        await db.run('UPDATE point_rules SET type=?, reason=?, points=?, sort_order=?, updated_at=? WHERE uid=?',
          r.type, r.reason, r.points ?? 0, r.sort_order || 0, t, r.uid);
      }
      await writeSyncEvent(db, { tbl: 'point_rules', row_uid: r.uid, op: 'upsert',
        snapshot: { ...r, updated_at: t }, origin });
    }
    for (const a of (backup.announcements || [])) {
      if (!a.uid) continue;
      if (!existingAnns.has(a.uid)) {
        await db.run(
          `INSERT INTO announcements (uid, title, content, author, file_url, file_name, file_type, file_size, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          a.uid, a.title, a.content || '', a.author || '', a.file_url || '', a.file_name || '', a.file_type || '', a.file_size || 0, a.created_at || t, t);
      } else {
        await db.run(
          `UPDATE announcements SET title=?, content=?, author=?, file_url=?, file_name=?, file_type=?, file_size=?, updated_at=? WHERE uid=?`,
          a.title, a.content || '', a.author || '', a.file_url || '', a.file_name || '', a.file_type || '', a.file_size || 0, t, a.uid);
      }
      await writeSyncEvent(db, { tbl: 'announcements', row_uid: a.uid, op: 'upsert',
        snapshot: { ...a, updated_at: t }, origin });
    }
    if (backup.config) {
      for (const [k, v] of Object.entries(backup.config)) {
        if (k === 'password_hash' || k === 'password_salt' || k === 'resend_api_key') continue;
        await db.run('INSERT OR REPLACE INTO admin_config (key, value, updated_at) VALUES (?,?,?)', k, String(v), t);
        await writeSyncEvent(db, { tbl: 'admin_config', row_uid: k, op: 'upsert', snapshot: { key: k, value: String(v), updated_at: t }, origin });
      }
    }

    // v5.0 群聊四表恢复
    for (const m of (backup.chat_messages || [])) {
      if (!m.uid) continue;
      await db.run(
        `INSERT OR REPLACE INTO chat_messages (uid, sender_key, sender_name, sender_avatar, msg_type,
                content, attachments, reply_to, recalled, created_at, updated_at, deleted)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
        m.uid, m.sender_key || '', m.sender_name || '', m.sender_avatar || '', m.msg_type || 'text',
        m.content || '', typeof m.attachments === 'string' ? m.attachments : JSON.stringify(m.attachments || []),
        m.reply_to || '', m.recalled ? 1 : 0, m.created_at || t, t);
      await writeSyncEvent(db, { tbl: 'chat_messages', row_uid: m.uid, op: 'upsert',
        snapshot: { ...m, attachments: typeof m.attachments === 'string' ? JSON.parse(m.attachments || '[]') : (m.attachments || []), updated_at: t, deleted: 0 }, origin });
    }
    for (const r of (backup.chat_reads || [])) {
      if (!r.member_key) continue;
      await db.run(
        `INSERT OR REPLACE INTO chat_reads (member_key, last_read_id, last_read_at, updated_at) VALUES (?,?,?,?)`,
        r.member_key, r.last_read_id || 0, r.last_read_at || t, t);
      await writeSyncEvent(db, { tbl: 'chat_reads', row_uid: r.member_key, op: 'upsert',
        snapshot: { member_key: r.member_key, last_read_id: r.last_read_id || 0, last_read_at: r.last_read_at || t, updated_at: t }, origin });
    }
    for (const f of (backup.chat_favorites || [])) {
      if (!f.member_key || !f.msg_uid) continue;
      await db.run(
        'INSERT OR IGNORE INTO chat_favorites (member_key, msg_uid, created_at) VALUES (?,?,?)',
        f.member_key, f.msg_uid, f.created_at || t);
      await writeSyncEvent(db, { tbl: 'chat_favorites', row_uid: f.member_key + ':' + f.msg_uid, op: 'upsert',
        snapshot: { member_key: f.member_key, msg_uid: f.msg_uid, created_at: f.created_at || t }, origin });
    }
    for (const n of (backup.chat_notices || [])) {
      if (!n.uid) continue;
      await db.run(
        'INSERT OR REPLACE INTO chat_notices (uid, content, author, created_at, updated_at, deleted) VALUES (?,?,?,?,?,0)',
        n.uid, n.content || '', n.author || '', n.created_at || t, t);
      await writeSyncEvent(db, { tbl: 'chat_notices', row_uid: n.uid, op: 'upsert',
        snapshot: { ...n, updated_at: t, deleted: 0 }, origin });
    }
  });
}
