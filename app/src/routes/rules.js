import { Hono } from 'hono';
import { uid, now, verifyUser, getConfig, setConfig, writeSyncEvent } from './_helpers.js';

// 归一 type：subtract/minus → sub；其余非法值 → add
function normType(t) {
  const v = String(t || '').toLowerCase();
  if (v === 'sub' || v === 'subtract' || v === 'minus') return 'sub';
  return 'add';
}

// 清洗分类标签：trim、去空、去重、每项 ≤20 字
function cleanCategories(arr) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(arr) ? arr : []) {
    const v = String(item || '').trim().slice(0, 20);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function rulesRoutes() {
  const app = new Hono();
  const ORIGIN = (c) => c.get('origin') || '';

  app.get('/rules', async (c) => {
    const db = c.get('db');
    return c.json({ ok: true, data: await db.all(
      'SELECT * FROM point_rules WHERE deleted=0 ORDER BY type, sort_order ASC, id ASC') });
  });

  // v5.4: 分类并集 = point_categories 配置顺序 + point_rules 实际出现的 distinct category（去重、去空、保序）
  app.get('/rules/categories', async (c) => {
    const db = c.get('db');
    let raw = await getConfig(db, 'point_categories');
    let configured = [];
    try { configured = JSON.parse(raw || '[]'); } catch {}
    if (!Array.isArray(configured)) configured = [];
    if (!configured.length) {
      configured = ['常规'];
      await setConfig(db, 'point_categories', JSON.stringify(configured));
    }
    const rows = await db.all('SELECT DISTINCT category FROM point_rules WHERE deleted=0');
    const out = [];
    const seen = new Set();
    for (const item of configured) {
      const v = String(item || '').trim();
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    }
    for (const r of rows) {
      const v = String(r.category || '').trim();
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    }
    return c.json({ ok: true, data: out });
  });

  // v5.4: 保存分类标签（staff），写 point_categories（setConfig 自带 admin_config 同步事件）
  app.post('/rules/categories', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const body = await c.req.json().catch(() => ({}));
    const cleaned = cleanCategories(body.categories);
    if (cleaned.length > 30) return c.json({ ok: false, error: '分类总数不能超过 30' }, 400);
    await setConfig(db, 'point_categories', JSON.stringify(cleaned));
    return c.json({ ok: true, data: cleaned });
  });

  app.post('/rules', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const { type, reason, points, category } = await c.req.json().catch(() => ({}));
    if (!reason) return c.json({ ok: false, error: '参数不完整' }, 400);
    const t = now();
    const rUid = uid();
    const nType = normType(type);
    const nPoints = Math.abs(parseInt(points) || 0);
    const nCategory = String(category || '').trim().slice(0, 20) || '常规';
    // 新规则排在该类型末尾
    const maxRow = await db.get('SELECT COALESCE(MAX(sort_order),0) AS m FROM point_rules WHERE type=? AND deleted=0', nType);
    const sortOrder = (maxRow ? maxRow.m : 0) + 1;
    const snap = { uid: rUid, type: nType, reason, points: nPoints, is_custom: 1, is_builtin: 0, sort_order: sortOrder, category: nCategory, created_at: t, updated_at: t, deleted: 0 };
    const r = await db.tx(async () => {
      const res = await db.run(
        'INSERT INTO point_rules (uid, type, reason, points, is_custom, is_builtin, sort_order, category, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        rUid, nType, reason, nPoints, 1, 0, sortOrder, nCategory, t, t);
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
    const nCategory = b.category !== undefined
      ? (String(b.category || '').trim().slice(0, 20) || '常规')
      : (existing.category || '常规');
    const t = now();
    const snap = { uid: existing.uid, type: nType, reason, points: nPoints, is_custom: existing.is_custom, is_builtin: 0, sort_order: existing.sort_order || 0, category: nCategory, created_at: existing.created_at, updated_at: t, deleted: 0 };
    await db.tx(async () => {
      await db.run('UPDATE point_rules SET reason=?, points=?, type=?, category=?, updated_at=? WHERE id=?', reason, nPoints, nType, nCategory, t, id);
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
        // snapshot 用整行，带出 category / sort_order 等全部字段
        const snap = { ...row, sort_order: so, updated_at: t };
        await writeSyncEvent(db, { tbl: 'point_rules', row_uid: o.uid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
      }
    });
    return c.json({ ok: true });
  });

  return app;
}
