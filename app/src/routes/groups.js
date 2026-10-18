import { Hono } from 'hono';
import { uid, now, verifyUser, writeSyncEvent, logAudit, clientIp } from './_helpers.js';

export function groupsRoutes() {
  const app = new Hono();
  const ORIGIN = (c) => c.get('origin') || '';

  app.get('/groups', async (c) => {
    const db = c.get('db');
    return c.json({ ok: true, data: await db.all('SELECT * FROM groups WHERE deleted=0 ORDER BY id') });
  });

  app.post('/groups', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const { name, color, signature } = await c.req.json().catch(() => ({}));
    if (!name) return c.json({ ok: false, error: '组名不能为空' }, 400);
    const t = now();
    const gUid = uid();
    const snap = { uid: gUid, name, color: color || '#34c759', signature: signature || '', created_at: t, updated_at: t, deleted: 0 };
    const r = await db.tx(async () => {
      const res = await db.run(
        'INSERT INTO groups (uid, name, color, signature, created_at, updated_at) VALUES (?,?,?,?,?,?)',
        gUid, name, snap.color, snap.signature, t, t);
      await writeSyncEvent(db, { tbl: 'groups', row_uid: gUid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
      return res;
    });
    return c.json({ ok: true, id: r.lastRowId });
  });

  app.put('/groups/:id', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const existing = await db.get('SELECT * FROM groups WHERE id=? AND deleted=0', id);
    if (!existing) return c.json({ ok: false, error: '小组不存在' }, 404);
    const b = await c.req.json().catch(() => ({}));
    const name = b.name ?? existing.name;
    const color = b.color ?? existing.color;
    const signature = b.signature ?? existing.signature;
    const t = now();
    const snap = { uid: existing.uid, name, color, signature, created_at: existing.created_at, updated_at: t, deleted: 0 };
    await db.tx(async () => {
      await db.run('UPDATE groups SET name=?, color=?, signature=?, updated_at=? WHERE id=?', name, color, signature, t, id);
      await writeSyncEvent(db, { tbl: 'groups', row_uid: existing.uid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
    });
    return c.json({ ok: true });
  });

  app.delete('/groups/:id', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const existing = await db.get('SELECT uid FROM groups WHERE id=? AND deleted=0', id);
    if (!existing) return c.json({ ok: false, error: '小组不存在' }, 404);
    const t = now();
    await db.tx(async () => {
      await db.run('UPDATE groups SET deleted=1, updated_at=? WHERE id=?', t, id);
      await db.run('UPDATE students SET group_id=NULL, updated_at=? WHERE group_id=?', t, id);
      await writeSyncEvent(db, { tbl: 'groups', row_uid: existing.uid, op: 'delete', snapshot: { uid: existing.uid }, origin: ORIGIN(c) });
    });
    return c.json({ ok: true });
  });

  app.post('/groups/batch-delete', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const { ids } = await c.req.json().catch(() => ({}));
    if (!ids || !ids.length) return c.json({ ok: false, error: '未提供ID' }, 400);
    const t = now();
    const uids = [];
    for (const id of ids) {
      const row = await db.get('SELECT uid FROM groups WHERE id=? AND deleted=0', id);
      if (row) uids.push({ id, uid: row.uid });
    }
    await db.tx(async () => {
      for (const { id, uid: guid } of uids) {
        await db.run('UPDATE groups SET deleted=1, updated_at=? WHERE id=?', t, id);
        await db.run('UPDATE students SET group_id=NULL, updated_at=? WHERE group_id=?', t, id);
        await writeSyncEvent(db, { tbl: 'groups', row_uid: guid, op: 'delete', snapshot: { uid: guid }, origin: ORIGIN(c) });
      }
    });
    await logAudit(db, me.username, 'batch_delete_groups', ids.join(','), `删除 ${ids.length} 个小组`, clientIp(c));
    return c.json({ ok: true, count: ids.length });
  });

  return app;
}
