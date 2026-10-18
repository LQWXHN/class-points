import { Hono } from 'hono';
import { uid, now, verifyUser, writeSyncEvent, getConfig } from './_helpers.js';

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
  return {
    version: '4.0',
    exportedAt: new Date().toISOString(),
    students, groups, rules, announcements, config,
  };
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
          'INSERT INTO groups (uid, name, color, signature, created_at, updated_at) VALUES (?,?,?,?,?,?)',
          g.uid, g.name, g.color || '#34c759', g.signature || '', g.created_at || t, t);
        groupUidToId[g.uid] = res.lastRowId;
      } else {
        await db.run('UPDATE groups SET name=?, color=?, signature=?, updated_at=? WHERE uid=?',
          g.name, g.color || '#34c759', g.signature ?? '', t, g.uid);
        groupUidToId[g.uid] = ex.id;
      }
      writeSyncEvent && await writeSyncEvent(db, { tbl: 'groups', row_uid: g.uid, op: 'upsert',
        snapshot: { ...g, name: g.name, color: g.color || '#34c759', signature: g.signature || '', updated_at: t }, origin });
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
        await db.run('INSERT INTO point_rules (uid, type, reason, points, is_custom, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
          r.uid, r.type, r.reason, r.points || 0, r.is_custom ?? 1, r.created_at || t, t);
      } else {
        await db.run('UPDATE point_rules SET type=?, reason=?, points=?, updated_at=? WHERE uid=?',
          r.type, r.reason, r.points ?? 0, t, r.uid);
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
  });
}

export function backupRoutes() {
  const app = new Hono();

  app.post('/backup/create', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const storage = c.get('storage');
    let type = 'manual';
    try { const b = await c.req.json(); if (b && b.type) type = b.type; } catch {}
    const backup = await buildBackup(db);
    const filename = `backup_${type}_${Date.now()}.json`;
    const key = `backups/${filename}`;
    const json = JSON.stringify(backup);
    await storage.put(key, json, 'application/json');
    await db.run('INSERT INTO backup_log (uid, filename, size, type, storage_key, created_at) VALUES (?,?,?,?,?,?)',
      uid(), filename, json.length, type, key, now());
    if (type === 'auto') {
      const keepDays = parseInt(await getConfig(db, 'auto_backup_keep_days') || '7');
      const cutoff = Date.now() - keepDays * 86400000;
      const old = await db.all("SELECT storage_key FROM backup_log WHERE type='auto' AND created_at < ?", cutoff);
      for (const row of old) if (row.storage_key) await storage.del(row.storage_key);
      await db.run("DELETE FROM backup_log WHERE type='auto' AND created_at < ?", cutoff);
    }
    return c.json({ ok: true, filename, size: json.length });
  });

  app.get('/backup/list', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    return c.json({ ok: true, data: await db.all('SELECT * FROM backup_log ORDER BY created_at DESC') });
  });

  app.get('/backup/download', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const storage = c.get('storage');
    const key = c.req.query('key');
    if (!key) return c.json({ ok: false, error: '缺少参数' }, 400);
    const got = await storage.get(key);
    if (!got) return c.json({ ok: false, error: '文件不存在' }, 404);
    return c.body(got.body, 200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${key.split('/').pop()}"`,
    });
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

  app.post('/backup/delete', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const storage = c.get('storage');
    const { id, key } = await c.req.json().catch(() => ({}));
    if (key) await storage.del(key);
    if (id) await db.run('DELETE FROM backup_log WHERE id=?', id);
    return c.json({ ok: true });
  });

  app.get('/r2/usage', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const storage = c.get('storage');
    const list = await storage.list('backups/');
    let total = 0, count = 0;
    for (const o of list) { total += o.size; count++; }
    return c.json({ ok: true, totalSize: total, count, freeLimit: 10 * 1024 * 1024 * 1024 });
  });

  return app;
}
