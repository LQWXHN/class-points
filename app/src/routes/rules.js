import { Hono } from 'hono';
import { uid, now, verifyUser, writeSyncEvent } from './_helpers.js';

// 归一 type：subtract/minus → sub；其余非法值 → add
function normType(t) {
  const v = String(t || '').toLowerCase();
  if (v === 'sub' || v === 'subtract' || v === 'minus') return 'sub';
  return 'add';
}

export function rulesRoutes() {
  const app = new Hono();
  const ORIGIN = (c) => c.get('origin') || '';

  app.get('/rules', async (c) => {
    const db = c.get('db');
    return c.json({ ok: true, data: await db.all(
      'SELECT * FROM point_rules WHERE deleted=0 ORDER BY type, sort_order ASC, id ASC') });
  });

  app.post('/rules', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const { type, reason, points } = await c.req.json().catch(() => ({}));
    if (!reason) return c.json({ ok: false, error: '参数不完整' }, 400);
    const t = now();
    const rUid = uid();
    const nType = normType(type);
    const nPoints = Math.abs(parseInt(points) || 0);
    // 新规则排在该类型末尾
    const maxRow = await db.get('SELECT COALESCE(MAX(sort_order),0) AS m FROM point_rules WHERE type=? AND deleted=0', nType);
    const sortOrder = (maxRow ? maxRow.m : 0) + 1;
    const snap = { uid: rUid, type: nType, reason, points: nPoints, is_custom: 1, is_builtin: 0, sort_order: sortOrder, created_at: t, updated_at: t, deleted: 0 };
    const r = await db.tx(async () => {
      const res = await db.run(
        'INSERT INTO point_rules (uid, type, reason, points, is_custom, is_builtin, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        rUid, nType, reason, nPoints, 1, 0, sortOrder, t, t);
      await writeSyncEvent(db, { tbl: 'point_rules', row_uid: rUid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
      return res;
    });
    return c.json({ ok: true, id: r.lastRowId });
  });

  app.put('/rules/:id', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const existing = await db.get('SELECT * FROM point_rules WHERE id=? AND deleted=0', id);
    if (!existing) return c.json({ ok: false, error: '规则不存在' }, 404);
    if (existing.is_builtin) return c.json({ ok: false, error: '内置规则不可修改' }, 400);
    const b = await c.req.json().catch(() => ({}));
    const reason = b.reason ?? existing.reason;
    if (!reason) return c.json({ ok: false, error: '原因不能为空' }, 400);
    const nType = b.type !== undefined ? normType(b.type) : existing.type;
    const nPoints = b.points !== undefined ? Math.abs(parseInt(b.points) || 0) : Math.abs(existing.points || 0);
    const t = now();
    const snap = { uid: existing.uid, type: nType, reason, points: nPoints, is_custom: existing.is_custom, is_builtin: 0, sort_order: existing.sort_order || 0, created_at: existing.created_at, updated_at: t, deleted: 0 };
    await db.tx(async () => {
      await db.run('UPDATE point_rules SET reason=?, points=?, type=?, updated_at=? WHERE id=?', reason, nPoints, nType, t, id);
      await writeSyncEvent(db, { tbl: 'point_rules', row_uid: existing.uid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
    });
    return c.json({ ok: true });
  });

  app.delete('/rules/:id', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const existing = await db.get('SELECT * FROM point_rules WHERE id=? AND deleted=0', id);
    if (!existing) return c.json({ ok: false, error: '规则不存在' }, 404);
    if (existing.is_builtin) return c.json({ ok: false, error: '内置规则不可修改' }, 400);
    const t = now();
    await db.tx(async () => {
      await db.run('UPDATE point_rules SET deleted=1, updated_at=? WHERE id=?', t, id);
      await writeSyncEvent(db, { tbl: 'point_rules', row_uid: existing.uid, op: 'delete', snapshot: { uid: existing.uid }, origin: ORIGIN(c) });
    });
    return c.json({ ok: true });
  });

  // POST /rules/reorder  body: {orders:[{uid, sort_order}, ...]}
  app.post('/rules/reorder', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const body = await c.req.json().catch(() => ({}));
    const orders = Array.isArray(body.orders) ? body.orders : [];
    const t = now();
    // 事务外预载所有命中行（node-db 不允许 tx 内 get）
    const rowsByUid = {};
    for (const o of orders) {
      if (!o || !o.uid) continue;
      const row = await db.get('SELECT * FROM point_rules WHERE uid=? AND deleted=0', o.uid);
      if (row) rowsByUid[o.uid] = row;
    }
    await db.tx(async () => {
      for (const o of orders) {
        if (!o || !o.uid) continue;
        const row = rowsByUid[o.uid];
        if (!row) continue;
        const so = parseInt(o.sort_order) || 0;
        await db.run('UPDATE point_rules SET sort_order=?, updated_at=? WHERE uid=?', so, t, o.uid);
        const snap = {
          uid: row.uid, type: row.type, reason: row.reason, points: row.points,
          is_custom: row.is_custom, is_builtin: row.is_builtin, sort_order: so,
          created_at: row.created_at, updated_at: t, deleted: 0,
        };
        await writeSyncEvent(db, { tbl: 'point_rules', row_uid: o.uid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
      }
    });
    return c.json({ ok: true });
  });

  return app;
}
