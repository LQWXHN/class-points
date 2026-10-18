import { Hono } from 'hono';
import { uid, now, verifyUser, writeSyncEvent } from './_helpers.js';

// 系统级公告：公开可读（is_active=1），管理类接口需超管
export function systemAnnouncementsRoutes() {
  const app = new Hono();
  const ORIGIN = (c) => c.get('origin') || '';

  async function requireSuper(c) {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    if (me.role !== 'super') return c.json({ ok: false, error: '需要超级管理员权限' }, 403);
    return me;
  }

  // 公开列表（无需登录）：仅返回启用且未删除的公告，按创建时间倒序
  app.get('/system-announcements', async (c) => {
    const db = c.get('db');
    const rows = await db.all(
      'SELECT * FROM system_announcements WHERE is_active=1 AND deleted=0 ORDER BY created_at DESC');
    return c.json({ ok: true, data: rows });
  });

  // 管理列表（超管）：返回全部，含已停用/已删除
  app.get('/system-announcements/all', async (c) => {
    const me = await requireSuper(c); if (me instanceof Response) return me;
    const db = c.get('db');
    const rows = await db.all(
      'SELECT * FROM system_announcements ORDER BY updated_at DESC');
    return c.json({ ok: true, data: rows });
  });

  // 新建（超管）
  app.post('/system-announcements', async (c) => {
    const me = await requireSuper(c); if (me instanceof Response) return me;
    const db = c.get('db');
    const { title, content } = await c.req.json().catch(() => ({}));
    if (!title) return c.json({ ok: false, error: '标题不能为空' }, 400);
    const t = now();
    const aUid = uid();
    const createdBy = me.display_name || me.username;
    const snap = {
      uid: aUid, title, content: content || '', created_by: createdBy,
      is_active: 1, created_at: t, updated_at: t, deleted: 0,
    };
    const r = await db.tx(async () => {
      await db.run(
        `INSERT INTO system_announcements (uid, title, content, created_by, is_active, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`,
        aUid, title, content || '', createdBy, 1, t, t);
      await writeSyncEvent(db, { tbl: 'system_announcements', row_uid: aUid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
    });
    return c.json({ ok: true, id: r.lastRowId, data: { ...snap, id: r.lastRowId } });
  });

  // 编辑（超管）：更新 title / content / is_active
  app.put('/system-announcements/:id', async (c) => {
    const me = await requireSuper(c); if (me instanceof Response) return me;
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const existing = await db.get('SELECT * FROM system_announcements WHERE id=?', id);
    if (!existing) return c.json({ ok: false, error: '公告不存在' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const title = body.title ?? existing.title;
    if (!title) return c.json({ ok: false, error: '标题不能为空' }, 400);
    const content = body.content ?? existing.content;
    const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;
    const t = now();
    const snap = {
      uid: existing.uid, title, content: content || '', created_by: existing.created_by || '',
      is_active: isActive, created_at: existing.created_at, updated_at: t,
      deleted: existing.deleted,
    };
    await db.run(
      'UPDATE system_announcements SET title=?, content=?, is_active=?, updated_at=? WHERE id=?',
      title, content || '', isActive, t, id);
    await writeSyncEvent(db, { tbl: 'system_announcements', row_uid: existing.uid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
    return c.json({ ok: true, data: snap });
  });

  // 软删（超管）
  app.delete('/system-announcements/:id', async (c) => {
    const me = await requireSuper(c); if (me instanceof Response) return me;
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const existing = await db.get('SELECT uid FROM system_announcements WHERE id=? AND deleted=0', id);
    if (!existing) return c.json({ ok: false, error: '公告不存在' }, 404);
    const t = now();
    await db.run('UPDATE system_announcements SET deleted=1, updated_at=? WHERE id=?', t, id);
    await writeSyncEvent(db, { tbl: 'system_announcements', row_uid: existing.uid, op: 'delete', snapshot: { uid: existing.uid, updated_at: t }, origin: ORIGIN(c) });
    return c.json({ ok: true });
  });

  return app;
}
