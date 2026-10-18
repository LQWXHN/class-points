import { Hono } from 'hono';
import { uid, now, verifyUser, verifyDevice, writeSyncEvent } from './_helpers.js';

export function pointsRoutes() {
  const app = new Hono();
  const ORIGIN = (c) => c.get('origin') || '';

  app.post('/points/batch', async (c) => {
    const me = await verifyUser(c);
    const dev = await verifyDevice(c);
    if (!me && !dev) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const { operations } = await c.req.json().catch(() => ({}));
    if (!operations || !operations.length) return c.json({ ok: false, error: '无操作数据' }, 400);
    const operator = me ? me.username : 'device';
    const t = now();

    // 事务外预载：本次涉及的 students 与全量 groups
    const studentIds = [...new Set(operations.map(o => o.studentId).filter(x => x != null))];
    const studentMap = new Map();
    if (studentIds.length) {
      const rows = await db.all(
        `SELECT * FROM students WHERE id IN (${studentIds.map(() => '?').join(',')}) AND deleted=0`,
        ...studentIds);
      for (const s of rows) studentMap.set(s.id, s);
    }
    const groupMap = new Map();
    const groups = await db.all('SELECT id, name FROM groups WHERE deleted=0');
    for (const g of groups) groupMap.set(g.id, g.name);

    await db.tx(async () => {
      for (const op of operations) {
        const student = studentMap.get(op.studentId);
        if (!student) continue;
        const groupName = groupMap.get(student.group_id) || '';
        // v4.4: 归一 type（subtract/minus → sub）；custom=1 时按 type 兜底符号
        let opType = String(op.type || 'add').toLowerCase();
        if (opType === 'subtract' || opType === 'minus') opType = 'sub';
        if (opType !== 'add' && opType !== 'sub') opType = 'add';
        let opPoints = parseInt(op.points) || 0;
        if (op.custom === 1) {
          // custom 必须非零整数，服务端按 type 定符号
          if (!op.reason || !String(op.reason).trim()) continue;
          if (opPoints === 0) continue;
          opPoints = Math.abs(opPoints);
          if (opType === 'sub') opPoints = -opPoints;
        }
        const newPoints = (student.points || 0) + opPoints;
        await db.run('UPDATE students SET points=?, updated_at=? WHERE id=?', newPoints, t, student.id);
        const studentSnap = {
          uid: student.uid, name: student.name, student_no: student.student_no,
          group_id: student.group_id, group_uid: student.group_uid,
          points: newPoints, avatar: student.avatar,
          created_at: student.created_at, updated_at: t, deleted: 0,
        };
        await writeSyncEvent(db, { tbl: 'students', row_uid: student.uid, op: 'upsert', snapshot: studentSnap, origin: ORIGIN(c) });

        const recUid = uid();
        const recSnap = {
          uid: recUid, student_id: student.id, student_uid: student.uid,
          student_name: student.name, group_name: groupName,
          type: opType, reason: op.reason || '', points: Math.abs(opPoints),
          operator, apply: 1, hidden: 0, created_at: t,
        };
        await db.run(
          `INSERT INTO point_records (uid, student_id, student_uid, student_name, group_name, type, reason, points, operator, apply, hidden, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          recUid, student.id, student.uid, student.name, groupName, recSnap.type, recSnap.reason, recSnap.points, operator, 1, 0, t);
        await writeSyncEvent(db, { tbl: 'point_records', row_uid: recUid, op: 'upsert', snapshot: recSnap, apply_delta: 1, origin: ORIGIN(c) });
      }
    });
    return c.json({ ok: true, count: operations.length });
  });

  app.post('/points/reset', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const t = now();
    // 事务外预载
    const students = await db.all('SELECT * FROM students WHERE deleted=0');
    const groupMap = new Map();
    const groups = await db.all('SELECT id, name FROM groups WHERE deleted=0');
    for (const g of groups) groupMap.set(g.id, g.name);

    await db.tx(async () => {
      for (const s of students) {
        await db.run('UPDATE students SET points=0, updated_at=? WHERE id=?', t, s.id);
        const studentSnap = {
          uid: s.uid, name: s.name, student_no: s.student_no,
          group_id: s.group_id, group_uid: s.group_uid, points: 0, avatar: s.avatar,
          created_at: s.created_at, updated_at: t, deleted: 0,
        };
        await writeSyncEvent(db, { tbl: 'students', row_uid: s.uid, op: 'upsert', snapshot: studentSnap, origin: ORIGIN(c) });

        const recUid = uid();
        const groupName = groupMap.get(s.group_id) || '';
        const recSnap = {
          uid: recUid, student_id: s.id, student_uid: s.uid, student_name: s.name,
          group_name: groupName, type: 'set', reason: '所有学生积分已重置为0', points: 0,
          operator: me.username, apply: 1, hidden: 0, created_at: t,
        };
        await db.run(
          `INSERT INTO point_records (uid, student_id, student_uid, student_name, group_name, type, reason, points, operator, apply, hidden, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          recUid, s.id, s.uid, s.name, groupName, 'set', '所有学生积分已重置为0', 0, me.username, 1, 0, t);
        await writeSyncEvent(db, { tbl: 'point_records', row_uid: recUid, op: 'upsert', snapshot: recSnap, apply_delta: 1, origin: ORIGIN(c) });
      }
    });
    return c.json({ ok: true });
  });

  return app;
}
