import { Hono } from 'hono';
import {
  uid, now, genToken, hashPassword, clientIp, logAudit, verifyUser, writeSyncEvent,
} from './_helpers.js';
export function superRoutes() {
  const app = new Hono();
  const ORIGIN = (c) => c.get('origin') || '';

  async function requireSuper(c) {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    if (me.role !== 'super') return c.json({ ok: false, error: '需要超级管理员权限' }, 403);
    return me;
  }
  const isResp = (r) => r instanceof Response;

  app.get('/super/users', async (c) => {
    const me = await requireSuper(c); if (isResp(me)) return me;
    const db = c.get('db');
    return c.json({ ok: true, data: await db.all(
      'SELECT id, uid, username, role, display_name, last_login, created_at FROM admin_users WHERE deleted=0 ORDER BY id') });
  });

  app.post('/super/users', async (c) => {
    const me = await requireSuper(c); if (isResp(me)) return me;
    const db = c.get('db');
    const { username, password, display_name, role } = await c.req.json().catch(() => ({}));
    if (!username || !password) return c.json({ ok: false, error: '用户名密码不能为空' }, 400);
    if (username === 'admin') return c.json({ ok: false, error: 'admin 为系统保留' }, 400);
    if (String(password).length < 4) return c.json({ ok: false, error: '密码至少4位' }, 400);
    const exist = await db.get('SELECT id FROM admin_users WHERE username=?', username);
    if (exist) return c.json({ ok: false, error: '用户名已存在' }, 400);
    const salt = genToken(16);
    const hash = await hashPassword(String(password), salt);
    const t = now();
    const uUid = uid();
    await db.run(
      'INSERT INTO admin_users (uid, username, password_hash, password_salt, role, display_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      uUid, username, hash, salt, role || 'teacher', display_name || username, t, t);
    const row = await db.get('SELECT * FROM admin_users WHERE uid=?', uUid);
    await writeSyncEvent(db, { tbl: 'admin_users', row_uid: uUid, op: 'upsert', snapshot: row });
    await logAudit(db, me.username, 'create_user', username, `role=${role || 'teacher'}`, clientIp(c));
    return c.json({ ok: true });
  });

  app.put('/super/users/:id', async (c) => {
    const me = await requireSuper(c); if (isResp(me)) return me;
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const target = await db.get('SELECT * FROM admin_users WHERE id=?', id);
    if (!target) return c.json({ ok: false, error: '账户不存在' }, 404);
    if (target.username === 'admin') return c.json({ ok: false, error: 'admin 账户不可修改' }, 400);
    const { display_name, role, newPassword } = await c.req.json().catch(() => ({}));
    const t = now();
    if (newPassword && String(newPassword).length >= 4) {
      const salt = genToken(16);
      const hash = await hashPassword(String(newPassword), salt);
      await db.run('UPDATE admin_users SET password_hash=?, password_salt=?, display_name=?, role=?, updated_at=? WHERE id=?',
        hash, salt, display_name || target.display_name, role || target.role, t, id);
    } else {
      await db.run('UPDATE admin_users SET display_name=?, role=?, updated_at=? WHERE id=?',
        display_name || target.display_name, role || target.role, t, id);
    }
    const row = await db.get('SELECT * FROM admin_users WHERE id=?', id);
    await writeSyncEvent(db, { tbl: 'admin_users', row_uid: row.uid, op: 'upsert', snapshot: row });
    await logAudit(db, me.username, 'update_user', target.username, '', clientIp(c));
    return c.json({ ok: true });
  });

  app.delete('/super/users/:id', async (c) => {
    const me = await requireSuper(c); if (isResp(me)) return me;
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const target = await db.get('SELECT * FROM admin_users WHERE id=?', id);
    if (!target) return c.json({ ok: false, error: '账户不存在' }, 404);
    if (target.username === 'admin') return c.json({ ok: false, error: 'admin 账户不可删除' }, 400);
    await db.run('UPDATE admin_users SET deleted=1, updated_at=? WHERE id=?', now(), id);
    await writeSyncEvent(db, { tbl: 'admin_users', row_uid: target.uid, op: 'delete', snapshot: { uid: target.uid } });
    await logAudit(db, me.username, 'delete_user', target.username, '', clientIp(c));
    return c.json({ ok: true });
  });

  app.get('/super/devices', async (c) => {
    const me = await requireSuper(c); if (isResp(me)) return me;
    const db = c.get('db');
    return c.json({ ok: true, data: await db.all('SELECT * FROM device_tokens WHERE deleted=0 ORDER BY created_at DESC') });
  });

  app.delete('/super/devices/:id', async (c) => {
    const me = await requireSuper(c); if (isResp(me)) return me;
    const db = c.get('db');
    const id = parseInt(c.req.param('id'));
    const target = await db.get('SELECT uid FROM device_tokens WHERE id=? AND deleted=0', id);
    if (!target) return c.json({ ok: false, error: '设备不存在' }, 404);
    await db.run('UPDATE device_tokens SET deleted=1, updated_at=? WHERE id=?', now(), id);
    await writeSyncEvent(db, { tbl: 'device_tokens', row_uid: target.uid, op: 'delete', snapshot: { uid: target.uid } });
    await logAudit(db, me.username, 'delete_device', String(id), '', clientIp(c));
    return c.json({ ok: true });
  });

  app.get('/super/logins', async (c) => {
    const me = await requireSuper(c); if (isResp(me)) return me;
    const db = c.get('db');
    const limit = parseInt(c.req.query('limit') || '200');
    return c.json({ ok: true, data: await db.all('SELECT * FROM login_logs ORDER BY created_at DESC LIMIT ?', limit) });
  });

  app.get('/super/audit', async (c) => {
    const me = await requireSuper(c); if (isResp(me)) return me;
    const db = c.get('db');
    const limit = parseInt(c.req.query('limit') || '200');
    return c.json({ ok: true, data: await db.all('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?', limit) });
  });

  app.post('/super/set-points', async (c) => {
    const me = await requireSuper(c); if (isResp(me)) return me;
    const db = c.get('db');
    const { studentId, points, note } = await c.req.json().catch(() => ({}));
    const s = await db.get('SELECT * FROM students WHERE id=? AND deleted=0', studentId);
    if (!s) return c.json({ ok: false, error: '学生不存在' }, 404);
    const t = now();
    const oldPoints = s.points || 0;
    const newPoints = parseInt(points) || 0;
    const delta = newPoints - oldPoints;
    // v4.4：写一条 hidden=1 的 add/sub 流水（双周榜计入，学生端 /records 不可见）
    // 同时 UPDATE students.points，同步事件带 force_points:1 让对端直接覆盖余额。
    await db.tx(async () => {
      await db.run('UPDATE students SET points=?, updated_at=? WHERE id=?', newPoints, t, s.id);
      const studentSnap = {
        uid: s.uid, name: s.name, student_no: s.student_no,
        group_id: s.group_id, group_uid: s.group_uid, points: newPoints, avatar: s.avatar,
        created_at: s.created_at, updated_at: t, deleted: 0, force_points: 1,
      };
      await writeSyncEvent(db, { tbl: 'students', row_uid: s.uid, op: 'upsert', snapshot: studentSnap, origin: ORIGIN(c) });

      if (delta !== 0) {
        const recUid = uid();
        const isAdd = delta > 0;
        const recSnap = {
          uid: recUid, student_id: s.id, student_uid: s.uid,
          student_name: s.name, group_name: '',
          type: isAdd ? 'add' : 'sub',
          reason: note || '超管直改',
          points: Math.abs(delta),
          operator: me.username, apply: 1, hidden: 1, created_at: t,
        };
        await db.run(
          `INSERT INTO point_records (uid, student_id, student_uid, student_name, group_name, type, reason, points, operator, apply, hidden, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          recUid, s.id, s.uid, s.name, '', recSnap.type, recSnap.reason, recSnap.points, me.username, 1, 1, t);
        // apply_delta:0 —— 余额由前面的 force_points 事件权威覆盖，
        // 此流水仅用于双周榜统计，回放时不再累加，避免双重计数。
        await writeSyncEvent(db, { tbl: 'point_records', row_uid: recUid, op: 'upsert', snapshot: recSnap, apply_delta: 0, origin: ORIGIN(c) });
      }
    });
    // 操作审计照常记录（超管审计功能，对学生不可见）
    await logAudit(db, me.username, 'super_set_points', s.name,
      `${oldPoints} → ${newPoints}${note ? ' (' + note + ')' : ''}`, clientIp(c));
    return c.json({ ok: true });
  });

  return app;
}
