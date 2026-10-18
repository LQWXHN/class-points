import { Hono } from 'hono';

export function snapshotRoutes() {
  const app = new Hono();

  app.get('/snapshot', async (c) => {
    const db = c.get('db');
    const students = await db.all('SELECT * FROM students WHERE deleted=0 ORDER BY id');
    const groups = await db.all('SELECT * FROM groups WHERE deleted=0 ORDER BY id');
    const rules = await db.all('SELECT * FROM point_rules WHERE deleted=0 ORDER BY type, id');
    let announcements = await db.all(
      'SELECT * FROM announcements WHERE deleted=0 ORDER BY created_at DESC LIMIT 50');
    const cfgRows = await db.all(
      "SELECT key, value FROM admin_config WHERE key IN ('site_title','avatar_frame_leaderboard','avatar_frame_cards','avatar_frame_tier','tier_rules')");
    const config = {};
    for (const r of cfgRows) config[r.key] = r.value;

    // 公告附带 read_count（按设备去重）；category/edited/editor 列随行返回
    const readCounts = await db.all(
      'SELECT ann_uid, COUNT(DISTINCT device_uid) AS c FROM announcement_reads GROUP BY ann_uid');
    const rcMap = {};
    for (const r of readCounts) rcMap[r.ann_uid] = r.c;
    announcements = announcements.map(a => ({
      ...a,
      category: a.category || '通知公告',
      edited: a.edited ? 1 : 0,
      read_count: rcMap[a.uid] || 0,
    }));

    return c.json({
      ok: true,
      data: { students, groups, rules, announcements, config, serverTime: new Date().toISOString() },
    });
  });

  return app;
}
