import { Hono } from 'hono';
import { uid, now, verifyUser, verifyDevice, writeSyncEvent } from './_helpers.js';

export function frontMessagesRoutes() {
  const app = new Hono();
  const ORIGIN = (c) => c.get('origin') || '';

  async function requireStaff(c) {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    return me;
  }

  // 设备投稿（设备鉴权）
  app.post('/front-messages', async (c) => {
    const dev = await verifyDevice(c);
    if (!dev) return c.json({ ok: false, error: '设备未授权' }, 401);
    const db = c.get('db');
    const { title, content, file_url, file_name, file_type, file_size } = await c.req.json().catch(() => ({}));
    if (!title && !content) return c.json({ ok: false, error: '标题或正文至少填一项' }, 400);
    const t = now();
    const mUid = uid();
    const snap = {
      uid: mUid, title: title || '', content: content || '',
      file_url: file_url || '', file_name: file_name || '',
      file_type: file_type || '', file_size: file_size || 0,
      device_uid: dev.device_uuid || dev.uid,
      device_name: dev.device_name || '',
      is_read: 0, read_at: null, read_by: '',
      created_at: t, updated_at: t, deleted: 0,
    };
    const r = await db.tx(async () => {
      await db.run(
        `INSERT INTO front_messages (uid, title, content, file_url, file_name, file_type, file_size,
                device_uid, device_name, is_read, read_at, read_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        mUid, snap.title, snap.content, snap.file_url, snap.file_name, snap.file_type, snap.file_size,
        snap.device_uid, snap.device_name, 0, null, '', t, t);
      await writeSyncEvent(db, { tbl: 'front_messages', row_uid: mUid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
    });
    return c.json({ ok: true, id: r.lastRowId });
  });

  // 教师列表（分页，可筛未读；返回总数与未读数）
  app.get('/front-messages', async (c) => {
    const me = await requireStaff(c); if (me instanceof Response) return me;
    const db = c.get('db');
    const isReadParam = c.req.query('is_read');
    const page = Math.max(1, parseInt(c.req.query('page') || '1'));
    const pageSize = Math.min(200, Math.max(1, parseInt(c.req.query('page_size') || '30')));

    const where = ['deleted=0'];
    const params = [];
    if (isReadParam === '0') { where.push('is_read=0'); }
    else if (isReadParam === '1') { where.push('is_read=1'); }
    const whereSql = 'WHERE ' + where.join(' AND ');

    const rows = await db.all(
      `SELECT * FROM front_messages ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params, pageSize, (page - 1) * pageSize);
    const totalRow = await db.get(`SELECT COUNT(*) AS c FROM front_messages ${whereSql}`, ...params);
    const unreadRow = await db.get('SELECT COUNT(*) AS c FROM front_messages WHERE deleted=0 AND is_read=0');
    return c.json({
      ok: true, data: rows,
      total: totalRow ? totalRow.c : 0,
      unread: unreadRow ? unreadRow.c : 0,
      page, page_size: pageSize,
    });
  });

  // 未读计数（教师/超管 Bearer，供桌面提醒脚本轮询；只返回数字）
  app.get('/front-messages/unread-count', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const row = await db.get('SELECT COUNT(*) AS c FROM front_messages WHERE deleted=0 AND is_read=0');
    return c.json({ ok: true, unread: row ? row.c : 0 });
  });

  // 详情
  app.get('/front-messages/:id', async (c) => {
    const me = await requireStaff(c); if (me instanceof Response) return me;
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const row = await db.get('SELECT * FROM front_messages WHERE id=? AND deleted=0', id);
    if (!row) return c.json({ ok: false, error: '消息不存在' }, 404);
    return c.json({ ok: true, data: row });
  });

  // 标记已读（教师/超管）
  app.post('/front-messages/:id/read', async (c) => {
    const me = await requireStaff(c); if (me instanceof Response) return me;
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const existing = await db.get('SELECT * FROM front_messages WHERE id=? AND deleted=0', id);
    if (!existing) return c.json({ ok: false, error: '消息不存在' }, 404);
    if (existing.is_read) return c.json({ ok: true });
    const t = now();
    const snap = {
      uid: existing.uid, title: existing.title, content: existing.content,
      file_url: existing.file_url || '', file_name: existing.file_name || '',
      file_type: existing.file_type || '', file_size: existing.file_size || 0,
      device_uid: existing.device_uid, device_name: existing.device_name,
      is_read: 1, read_at: t, read_by: me.username,
      created_at: existing.created_at, updated_at: t, deleted: 0,
    };
    await db.tx(async () => {
      await db.run('UPDATE front_messages SET is_read=1, read_at=?, read_by=?, updated_at=? WHERE id=?',
        t, me.username, t, id);
      await writeSyncEvent(db, { tbl: 'front_messages', row_uid: existing.uid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
    });
    return c.json({ ok: true });
  });

  // 软删（教师/超管）
  app.delete('/front-messages/:id', async (c) => {
    const me = await requireStaff(c); if (me instanceof Response) return me;
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const existing = await db.get('SELECT uid FROM front_messages WHERE id=? AND deleted=0', id);
    if (!existing) return c.json({ ok: false, error: '消息不存在' }, 404);
    const t = now();
    await db.tx(async () => {
      await db.run('UPDATE front_messages SET deleted=1, updated_at=? WHERE id=?', t, id);
      await writeSyncEvent(db, { tbl: 'front_messages', row_uid: existing.uid, op: 'delete', snapshot: { uid: existing.uid, updated_at: t }, origin: ORIGIN(c) });
    });
    return c.json({ ok: true });
  });

  return app;
}
