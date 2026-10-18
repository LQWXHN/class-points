import { Hono } from 'hono';
import { uid, now, getConfig, verifyUser, writeSyncEvent } from './_helpers.js';

// 双周榜周期锚点：2026-10-12 00:00 Asia/Shanghai，每 14 天一个周期
// 第 1 期（index 0）= 2026-10-12 00:00 ~ 2026-10-26 00:00（即 10-12~10-25 共 14 天）；10-12 之前的数据不计入
const ANCHOR = Date.UTC(2026, 9, 12) - 8 * 3600 * 1000; // = 2026-10-12 00:00+08:00 的 epoch ms
const PERIOD_MS = 14 * 24 * 3600 * 1000;

function periodIndexAt(t) {
  return Math.floor((t - ANCHOR) / PERIOD_MS);
}
function periodBounds(index) {
  return {
    period_index: index,
    period_start: ANCHOR + index * PERIOD_MS,
    period_end: ANCHOR + (index + 1) * PERIOD_MS,
  };
}

// 确定性重算某周期 [start, end) 的人均变化榜
async function computeBiweekly(db, start, end) {
  // 窗口内 apply=1 的 add/sub 流水（排除 set），按学生当前组汇总 signed points
  const recs = await db.all(
    `SELECT pr.student_uid, pr.type, pr.points
     FROM point_records pr
     WHERE pr.apply=1 AND pr.type IN ('add','sub')
       AND pr.created_at >= ? AND pr.created_at < ?`,
    start, end);

  // 学生当前组归属
  const stus = await db.all("SELECT uid, group_uid FROM students WHERE deleted=0 AND group_uid != ''");
  const groupOf = {};
  for (const s of stus) groupOf[s.uid] = s.group_uid;

  const deltaByGroup = {};
  for (const r of recs) {
    const g = groupOf[r.student_uid];
    if (!g) continue; // 未分组/已删除学生不计
    if (!deltaByGroup[g]) deltaByGroup[g] = 0;
    deltaByGroup[g] += (r.type === 'sub' ? -1 : 1) * Number(r.points || 0);
  }

  // 各组当前人数
  const memberByGroup = {};
  for (const s of stus) {
    memberByGroup[s.group_uid] = (memberByGroup[s.group_uid] || 0) + 1;
  }

  const groups = await db.all('SELECT uid, name, color FROM groups WHERE deleted=0');
  const gInfo = {};
  for (const g of groups) gInfo[g.uid] = g;

  const rows = [];
  for (const [gUid, memberCount] of Object.entries(memberByGroup)) {
    if (!memberCount) continue;
    const info = gInfo[gUid] || { name: '', color: '#34c759' };
    const totalDelta = Math.round(deltaByGroup[gUid] || 0);
    rows.push({
      group_uid: gUid,
      group_name: info.name,
      color: info.color || '#34c759',
      member_count: memberCount,
      total_delta: totalDelta,
      delta_avg: Math.round((totalDelta / memberCount) * 100) / 100,
    });
  }
  rows.sort((a, b) => b.delta_avg - a.delta_avg || b.total_delta - a.total_delta);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

export function rankingsRoutes() {
  const app = new Hono();
  const ORIGIN = (c) => c.get('origin') || '';

  // 公开（同 snapshot 无需登录）
  app.get('/rankings/biweekly', async (c) => {
    const db = c.get('db');
    // v4.6：开关关闭时仅 super 可访问
    const enabled = await getConfig(db, 'biweekly_rank_enabled') || '1';
    if (enabled !== '1') {
      const staff = await verifyUser(c).catch(() => null);
      if (!staff || staff.role !== 'super') {
        return c.json({ ok: false, error: '双周排行已关闭' }, 403);
      }
    }
    const nowMs = now();
    const curIdx = periodIndexAt(nowMs);
    const periodParam = c.req.query('period') || 'current';

    let index, isCurrent;
    if (periodParam === 'current' || periodParam === '') {
      index = curIdx; isCurrent = true;
    } else {
      const pi = parseInt(periodParam);
      if (Number.isNaN(pi)) return c.json({ ok: false, error: 'period 参数无效' }, 400);
      index = pi; isCurrent = (index === curIdx);
    }

    const bounds = periodBounds(index);
    const endMs = isCurrent ? nowMs : bounds.period_end;

    let rows;
    if (isCurrent) {
      rows = await computeBiweekly(db, bounds.period_start, endMs);
    } else {
      // 已结束周期：优先读缓存，没有则确定性重算并 UPSERT 缓存（发同步事件）
      let cached = await db.get(
        "SELECT payload FROM rank_snapshots WHERE kind='biweekly' AND period_index=?", index);
      if (cached) {
        try {
          const parsed = JSON.parse(cached.payload);
          rows = Array.isArray(parsed) ? parsed : (parsed.rows || []);
        } catch { rows = await computeBiweekly(db, bounds.period_start, bounds.period_end); }
      } else {
        rows = await computeBiweekly(db, bounds.period_start, bounds.period_end);
        const snap = {
          uid: uid(), kind: 'biweekly', period_index: index,
          period_start: bounds.period_start, period_end: bounds.period_end,
          payload: JSON.stringify(rows), created_at: nowMs,
        };
        await db.tx(async () => {
          await db.run(
            `INSERT INTO rank_snapshots (uid, kind, period_index, period_start, period_end, payload, created_at)
             VALUES (?,?,?,?,?,?,?)`,
            snap.uid, snap.kind, snap.period_index, snap.period_start, snap.period_end,
            snap.payload, snap.created_at);
          await writeSyncEvent(db, { tbl: 'rank_snapshots', row_uid: snap.uid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
        });
      }
    }

    const resp = {
      period_index: index,
      period_start: bounds.period_start,
      period_end: endMs,
      is_current: isCurrent,
      rows,
    };
    if (isCurrent) {
      const history = [];
      const from = Math.max(0, curIdx - 25);
      for (let i = from; i <= curIdx; i++) {
        const b = periodBounds(i);
        history.push({ period_index: i, period_start: b.period_start, period_end: b.period_end });
      }
      resp.history = history;
    }
    return c.json({ ok: true, data: resp });
  });

  return app;
}
