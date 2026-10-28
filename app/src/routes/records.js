import { Hono } from 'hono';
import { verifyUser } from './_helpers.js';

function fmtTs(ms) {
  const d = new Date(Number(ms));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const BASELINE_HIDE = "NOT (type='set' AND reason='期初余额（数据迁移）') AND hidden=0";

function range(start, end) {
  let s = null, e = null;
  if (start !== undefined && start !== '') {
    if (/^\d+$/.test(String(start))) s = Number(start);
    else { const d = new Date(start); if (!isNaN(d)) s = d.getTime(); }
  }
  if (end !== undefined && end !== '') {
    if (/^\d+$/.test(String(end))) e = Number(end);
    else { const d = new Date(end); if (!isNaN(d)) e = d.getTime() + 24 * 3600 * 1000 - 1; }
  }
  return { s, e };
}

export function recordsRoutes() {
  const app = new Hono();

  function buildWhere(query) {
    const cond = [BASELINE_HIDE];
    const params = [];
    const { s, e } = range(query.start, query.end);
    if (s !== null) { cond.push('created_at >= ?'); params.push(s); }
    if (e !== null) { cond.push('created_at <= ?'); params.push(e); }
    const type = query.type;
    if (type === 'add' || type === 'sub' || type === 'set' || type === 'system') {
      cond.push('type = ?'); params.push(type);
    }
    const kw = (query.kw || '').trim();
    if (kw) {
      cond.push('(student_name LIKE ? OR reason LIKE ? OR operator LIKE ?)');
      const like = '%' + kw + '%';
      params.push(like, like, like);
    }
    return { whereSql: cond.join(' AND '), params };
  }

  app.get('/records', async (c) => {
    const db = c.get('db');
    const me = await verifyUser(c);
    const isSuper = me && me.role === 'super';
    const limit = parseInt(c.req.query('limit') || '100');
    const offset = parseInt(c.req.query('offset') || '0');
    const { whereSql, params } = buildWhere(c.req.query());
    const sql = `SELECT * FROM point_records WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const rows = await db.all(sql, ...params, limit, offset);
    const totalRow = await db.get(
      `SELECT COUNT(*) AS c FROM point_records WHERE ${whereSql}`, ...params);
    const data = rows.map(r => {
      if (isSuper) return r;
      const { fabricated, ...rest } = r;
      return rest;
    });
    return c.json({ ok: true, data, total: totalRow.c });
  });

  app.get('/export/records', async (c) => {
    const db = c.get('db');
    const { whereSql, params } = buildWhere(c.req.query());
    const sql = `SELECT * FROM point_records WHERE ${whereSql} ORDER BY created_at DESC`;
    const rows = await db.all(sql, ...params);
    const safe = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const header = '时间,学生,小组,类型,原因,积分变化,操作者\n';
    const body = rows.map(r => [
      fmtTs(r.created_at), safe(r.student_name), safe(r.group_name),
      r.type, safe(r.reason), r.points, safe(r.operator),
    ].join(',')).join('\r\n');
    return c.body('\ufeff' + header + body, 200, {
      'Content-Type': 'text/csv;charset=utf-8',
      'Content-Disposition': 'attachment; filename="records.csv"',
    });
  });

  return app;
}
