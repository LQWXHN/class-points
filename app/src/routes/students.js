import { Hono } from 'hono';
import { uid, now, verifyUser, verifyDevice, writeSyncEvent } from './_helpers.js';

export function studentsRoutes() {
  const app = new Hono();
  const ORIGIN = (c) => c.get('origin') || '';

  app.get('/students', async (c) => {
    const db = c.get('db');
    return c.json({ ok: true, data: await db.all('SELECT * FROM students WHERE deleted=0 ORDER BY id') });
  });

  app.post('/students', async (c) => {
    const me = await verifyUser(c);
    const dev = await verifyDevice(c);
    if (!me && !dev) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const { name, student_no, group_id, points, avatar } = await c.req.json().catch(() => ({}));
    if (!name) return c.json({ ok: false, error: '姓名不能为空' }, 400);
    let groupUid = '';
    if (group_id) {
      const g = await db.get('SELECT uid FROM groups WHERE id=? AND deleted=0', group_id);
      if (g) groupUid = g.uid;
    }
    const t = now();
    const sUid = uid();
    const snap = {
      uid: sUid, name, student_no: student_no || '', group_id: group_id || null,
      group_uid: groupUid, points: points || 0, avatar: avatar || '👦',
      created_at: t, updated_at: t, deleted: 0,
    };
    const r = await db.tx(async () => {
      const res = await db.run(
        `INSERT INTO students (uid, name, student_no, group_id, group_uid, points, avatar, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        sUid, name, student_no || '', group_id || null, groupUid, points || 0, avatar || '👦', t, t);
      await writeSyncEvent(db, { tbl: 'students', row_uid: sUid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
      return res;
    });
    return c.json({ ok: true, id: r.lastRowId });
  });

  app.put('/students/:id', async (c) => {
    const me = await verifyUser(c);
    const dev = await verifyDevice(c);
    if (!me && !dev) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const existing = await db.get('SELECT * FROM students WHERE id=? AND deleted=0', id);
    if (!existing) return c.json({ ok: false, error: '学生不存在' }, 404);
    const b = await c.req.json().catch(() => ({}));
    const name = b.name ?? existing.name;
    const student_no = b.student_no ?? existing.student_no;
    let group_id = b.group_id !== undefined ? b.group_id : existing.group_id;
    let group_uid = existing.group_uid;
    if (b.group_id !== undefined) {
      const g = await db.get('SELECT uid FROM groups WHERE id=? AND deleted=0', b.group_id);
      group_uid = g ? g.uid : '';
      if (!g) group_id = null;
    }
    const points = b.points !== undefined ? b.points : existing.points;
    const avatar = b.avatar ?? existing.avatar;
    const t = now();
    const snap = {
      uid: existing.uid, name, student_no, group_id, group_uid, points, avatar,
      created_at: existing.created_at, updated_at: t, deleted: 0,
    };
    await db.tx(async () => {
      await db.run(
        `UPDATE students SET name=?, student_no=?, group_id=?, group_uid=?, points=?, avatar=?, updated_at=? WHERE id=?`,
        name, student_no, group_id || null, group_uid, points, avatar, t, id);
      await writeSyncEvent(db, { tbl: 'students', row_uid: existing.uid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
    });
    return c.json({ ok: true });
  });

  app.delete('/students/:id', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const existing = await db.get('SELECT uid FROM students WHERE id=? AND deleted=0', id);
    if (!existing) return c.json({ ok: false, error: '学生不存在' }, 404);
    const t = now();
    await db.tx(async () => {
      await db.run('UPDATE students SET deleted=1, updated_at=? WHERE id=?', t, id);
      await writeSyncEvent(db, { tbl: 'students', row_uid: existing.uid, op: 'delete', snapshot: { uid: existing.uid }, origin: ORIGIN(c) });
    });
    return c.json({ ok: true });
  });

  app.post('/students/batch-delete', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const { ids } = await c.req.json().catch(() => ({}));
    if (!ids || !ids.length) return c.json({ ok: false, error: '未提供ID' }, 400);
    const t = now();
    const uids = [];
    for (const id of ids) {
      const row = await db.get('SELECT uid FROM students WHERE id=? AND deleted=0', id);
      if (row) uids.push({ id, uid: row.uid });
    }
    await db.tx(async () => {
      for (const { id, uid: suid } of uids) {
        await db.run('UPDATE students SET deleted=1, updated_at=? WHERE id=?', t, id);
        await writeSyncEvent(db, { tbl: 'students', row_uid: suid, op: 'delete', snapshot: { uid: suid }, origin: ORIGIN(c) });
      }
    });
    return c.json({ ok: true, count: ids.length });
  });

  return app;
}
