import { Hono } from 'hono';
import { uid, now, verifyUser, verifyDevice, writeSyncEvent } from './_helpers.js';

// 固定分类（前后台共用，写死常量）
export const ANNOUNCEMENT_CATEGORIES = ['通知公告', '作业提醒', '考试成绩', '班级活动', '其他'];
const DEFAULT_CATEGORY = '通知公告';
function normCategory(c) {
  const v = String(c || '').trim();
  return ANNOUNCEMENT_CATEGORIES.includes(v) ? v : DEFAULT_CATEGORY;
}

export function announcementsRoutes() {
  const app = new Hono();
  const ORIGIN = (c) => c.get('origin') || '';

  // 列表：教师/超管（支持 category/keyword/page/page_size，附带 read_count / device_total），
  // 同时允许已激活设备读取（前台 /new 班级动态）
  app.get('/announcements', async (c) => {
    const me = await verifyUser(c) || await verifyDevice(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const categoryRaw = c.req.query('category') || '';
    const category = ANNOUNCEMENT_CATEGORIES.includes(categoryRaw) ? categoryRaw : '';
    const keyword = String(c.req.query('keyword') || '').trim();
    const page = Math.max(1, parseInt(c.req.query('page') || '1'));
    const pageSize = Math.min(200, Math.max(1, parseInt(c.req.query('page_size') || '50')));

    const where = ['deleted=0'];
    const params = [];
    if (category) {
      where.push('category=?'); params.push(category);
    }
    if (keyword) {
      where.push('(title LIKE ? OR content LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    const whereSql = 'WHERE ' + where.join(' AND ');

    const rows = await db.all(
      `SELECT * FROM announcements ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params, pageSize, (page - 1) * pageSize);
    const totalRow = await db.get(`SELECT COUNT(*) AS c FROM announcements ${whereSql}`, ...params);

    // 已读数（按设备去重）与设备总数
    const readCounts = await db.all(
      'SELECT ann_uid, COUNT(DISTINCT device_uid) AS c FROM announcement_reads GROUP BY ann_uid');
    const rcMap = {};
    for (const r of readCounts) rcMap[r.ann_uid] = r.c;
    const devTotalRow = await db.get('SELECT COUNT(*) AS c FROM device_tokens WHERE deleted=0');
    const deviceTotal = devTotalRow ? devTotalRow.c : 0;

    const data = rows.map(r => ({
      ...r,
      category: r.category || DEFAULT_CATEGORY,
      edited: r.edited ? 1 : 0,
      read_count: rcMap[r.uid] || 0,
      device_total: deviceTotal,
    }));
    return c.json({ ok: true, data, total: totalRow ? totalRow.c : 0, page, page_size: pageSize });
  });

  // 新建（教师/超管）
  app.post('/announcements', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const { title, content, category, file_url, file_name, file_type, file_size } = await c.req.json().catch(() => ({}));
    if (!title) return c.json({ ok: false, error: '标题不能为空' }, 400);
    const t = now();
    const aUid = uid();
    const author = me.display_name || me.username;
    const cat = normCategory(category);
    const snap = {
      uid: aUid, title, content: content || '', author,
      category: cat, edited: 0, editor: '',
      file_url: file_url || '', file_name: file_name || '',
      file_type: file_type || '', file_size: file_size || 0,
      created_at: t, updated_at: t, deleted: 0,
    };
    const r = await db.tx(async () => {
      await db.run(
        `INSERT INTO announcements (uid, title, content, author, file_url, file_name, file_type, file_size,
                category, edited, editor, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        aUid, title, content || '', author, file_url || '', file_name || '', file_type || '', file_size || 0,
        cat, 0, '', t, t);
      await writeSyncEvent(db, { tbl: 'announcements', row_uid: aUid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
    });
    return c.json({ ok: true, id: r.lastRowId });
  });

  // 编辑（教师/超管）：编辑前把当前主表行完整快照进 announcement_versions，再更新主表
  app.put('/announcements/:id', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const existing = await db.get('SELECT * FROM announcements WHERE id=? AND deleted=0', id);
    if (!existing) return c.json({ ok: false, error: '动态不存在' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const title = body.title ?? existing.title;
    if (!title) return c.json({ ok: false, error: '标题不能为空' }, 400);
    const t = now();
    const editor = `${me.display_name || ''}${me.display_name && me.username ? '/' : ''}${me.username}`;
    const cat = normCategory(body.category ?? existing.category);

    // 版本快照（编辑前的当前行）
    const verUid = uid();
    const verSnap = {
      uid: verUid, ann_uid: existing.uid,
      title: existing.title, content: existing.content || '', category: existing.category || DEFAULT_CATEGORY,
      file_url: existing.file_url || '', file_name: existing.file_name || '',
      file_type: existing.file_type || '', file_size: existing.file_size || 0,
      editor, created_at: t,
    };
    // 更新后主表快照
    const mainSnap = {
      uid: existing.uid, title, content: body.content ?? existing.content,
      author: existing.author || '', category: cat, edited: 1, editor,
      file_url: body.file_url !== undefined ? (body.file_url || '') : existing.file_url || '',
      file_name: body.file_name !== undefined ? (body.file_name || '') : existing.file_name || '',
      file_type: body.file_type !== undefined ? (body.file_type || '') : existing.file_type || '',
      file_size: body.file_size !== undefined ? (body.file_size || 0) : existing.file_size || 0,
      created_at: existing.created_at, updated_at: t, deleted: 0,
    };
    await db.tx(async () => {
      await db.run(
        `INSERT INTO announcement_versions (uid, ann_uid, title, content, category, file_url, file_name, file_type, file_size, editor, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        verUid, existing.uid, verSnap.title, verSnap.content, verSnap.category,
        verSnap.file_url, verSnap.file_name, verSnap.file_type, verSnap.file_size,
        editor, t);
      await writeSyncEvent(db, { tbl: 'announcement_versions', row_uid: verUid, op: 'upsert', snapshot: verSnap, origin: ORIGIN(c) });

      await db.run(
        `UPDATE announcements SET title=?, content=?, file_url=?, file_name=?, file_type=?, file_size=?,
                category=?, edited=1, editor=?, updated_at=? WHERE id=?`,
        title, mainSnap.content, mainSnap.file_url, mainSnap.file_name, mainSnap.file_type, mainSnap.file_size,
        cat, editor, t, id);
      await writeSyncEvent(db, { tbl: 'announcements', row_uid: existing.uid, op: 'upsert', snapshot: mainSnap, origin: ORIGIN(c) });
    });
    return c.json({ ok: true });
  });

  // 历史版本列表（教师/超管，只读）
  app.get('/announcements/:id/versions', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const existing = await db.get('SELECT uid FROM announcements WHERE id=? AND deleted=0', id);
    if (!existing) return c.json({ ok: false, error: '动态不存在' }, 404);
    const rows = await db.all(
      'SELECT * FROM announcement_versions WHERE ann_uid=? ORDER BY created_at DESC', existing.uid);
    return c.json({ ok: true, data: rows });
  });

  // 设备已读回执（幂等）
  app.post('/announcements/:id/read', async (c) => {
    const dev = await verifyDevice(c);
    if (!dev) return c.json({ ok: false, error: '设备未授权' }, 401);
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const existing = await db.get('SELECT uid FROM announcements WHERE id=? AND deleted=0', id);
    if (!existing) return c.json({ ok: false, error: '动态不存在' }, 404);
    const deviceUuid = dev.device_uuid || dev.uid;
    const dup = await db.get(
      'SELECT uid FROM announcement_reads WHERE ann_uid=? AND device_uid=?', existing.uid, deviceUuid);
    if (dup) return c.json({ ok: true, already: true });
    const t = now();
    const readUid = uid();
    const snap = { uid: readUid, ann_uid: existing.uid, device_uid: deviceUuid, created_at: t };
    await db.tx(async () => {
      await db.run(
        'INSERT INTO announcement_reads (uid, ann_uid, device_uid, created_at) VALUES (?,?,?,?)',
        readUid, existing.uid, deviceUuid, t);
      await writeSyncEvent(db, { tbl: 'announcement_reads', row_uid: readUid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
    });
    return c.json({ ok: true });
  });

  app.delete('/announcements/:id', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const existing = await db.get('SELECT uid FROM announcements WHERE id=? AND deleted=0', id);
    if (!existing) return c.json({ ok: false, error: '动态不存在' }, 404);
    const t = now();
    await db.tx(async () => {
      await db.run('UPDATE announcements SET deleted=1, updated_at=? WHERE id=?', t, id);
      await writeSyncEvent(db, { tbl: 'announcements', row_uid: existing.uid, op: 'delete', snapshot: { uid: existing.uid, updated_at: t }, origin: ORIGIN(c) });
    });
    return c.json({ ok: true });
  });

  return app;
}
