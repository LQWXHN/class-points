import { Hono } from 'hono';
import { uid, now, getConfig, verifyUser, writeSyncEvent } from './_helpers.js';

// 双周榜周期锚点：2026-10-26 00:00 Asia/Shanghai，每 14 天一个周期（v5.1）
// 第 1 期（index 0）= 2026-10-26 00:00 ~ 2026-11-09 00:00（即 10-26~11-08 共 14 天）
const ANCHOR = Date.UTC(2026, 9, 26) - 8 * 3600 * 1000;
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
const round2 = (x) => Math.round(x * 100) / 100;

// ============================================================
// 双周榜规则（v4.8 起，最简单、可对账的口径）：
//   某组本期进步分 = 该组在本期结束时的小组平均分 − 该组在本期开始时的小组平均分
// 其中"小组平均分"与小组榜完全一致：组内现有成员（未删除、已分组）积分之和 ÷ 人数。
// 两时点的每个学生积分由 point_records 流水确定性重放得出：
//   type='set' → 余额绝对值（迁移期初余额 / 全部重置为 0）
//   type='add' → 加分；type='sub' → 减分；apply=1 才计入（含 hidden=1 超管直改）
// 组归属按学生当前所在小组；历史上换组的流水不影响（系统不记录组归属历史）。
// 数学上：小组平均分只差 = 窗口内组内净加减总分之和 ÷ 人数，
// 但直接用两时点平均分会自动正确处理 set/重置等边界，不会漏算。
// ============================================================
async function computeBiweekly(db, start, end, periodStartKey, isCurrent) {
  // 现有学生（未删除且已分组），按当前组归属
  const stus = await db.all(
    "SELECT uid, group_uid, points FROM students WHERE deleted=0 AND group_uid != ''");

  // 截至 end（不含）之前的全部生效流水，一次取出后按学生重放（快照缺失时的兜底口径）
  const recs = await db.all(
    `SELECT student_uid, type, points, created_at
     FROM point_records
     WHERE apply=1 AND created_at < ?
     ORDER BY student_uid, created_at`,
    end);

  const recsByStu = {};
  for (const r of recs) {
    if (!recsByStu[r.student_uid]) recsByStu[r.student_uid] = [];
    recsByStu[r.student_uid].push(r);
  }

  // 每个学生在本期开始、结束两个时点的累计积分（流水重放兜底）
  const startBal = {};
  const endBal = {};
  for (const s of stus) {
    const arr = recsByStu[s.uid] || [];
    let bal = 0;
    let startCaptured = false;
    for (const r of arr) {
      if (!startCaptured && r.created_at >= start) { startBal[s.uid] = bal; startCaptured = true; }
      if (r.type === 'set') bal = Number(r.points) || 0;
      else if (r.type === 'sub') bal -= Number(r.points) || 0;
      else bal += Number(r.points) || 0;
    }
    if (!startCaptured) startBal[s.uid] = bal;
    endBal[s.uid] = bal;
  }

  // 组信息
  const groups = await db.all('SELECT uid, name, color FROM groups WHERE deleted=0');
  const gInfo = {};
  for (const g of groups) gInfo[g.uid] = g;

  // v5.1 快照口径（用户指定）：期首/期末各记一次小组总分与人数，
  // 进步分 = (期末总分 − 期首总分) ÷ 期末人数；缺快照时回退流水重放
  // period_start 用 CAST 兼容历史手插数据的文本形式（"1792944000000" / "1792944000000.0"）
  const snapRows = await db.all(
    'SELECT kind, group_id, total, member_count FROM biweekly_snapshots WHERE CAST(period_start AS REAL)=?',
    Number(periodStartKey));
  const startSnap = {}, endSnap = {};
  for (const r of snapRows) {
    const target = r.kind === 'end' ? endSnap : startSnap;
    target[r.group_id] = r;
  }

  // 按当前组聚合（期末口径）
  const agg = {};
  for (const s of stus) {
    const g = s.group_uid;
    if (!agg[g]) agg[g] = { n: 0, startSum: 0, endSum: 0, startN: 0 };
    agg[g].n++;
    agg[g].startSum += startBal[s.uid] || 0;
    agg[g].endSum += endBal[s.uid] || 0;
  }

  const rows = [];
  for (const [gUid, a] of Object.entries(agg)) {
    if (!a.n) continue;
    // 期末：当期取实时总分与人数，历史期取期末快照
    let endSum = a.endSum, endN = a.n;
    if (!isCurrent && endSnap[gUid]) {
      endSum = Number(endSnap[gUid].total);
      endN = endSnap[gUid].member_count;
    }
    // 期首：有快照用快照，否则用流水重放
    let startSum = a.startSum, startN = a.n;
    if (startSnap[gUid]) {
      startSum = Number(startSnap[gUid].total);
      startN = startSnap[gUid].member_count;
    }
    const info = gInfo[gUid] || { name: '', color: '#34c759' };
    const totalDelta = endSum - startSum;
    rows.push({
      group_uid: gUid,
      group_name: info.name,
      color: info.color || '#34c759',
      member_count: endN,
      avg_start: round2(startSum / (startN || endN)),
      avg_end: round2(endSum / endN),
      total_delta: round2(totalDelta),
      delta_avg: round2(totalDelta / endN), // = (期末总分 − 期首总分) ÷ 期末人数
    });
  }
  // 历史期若有期末快照里多出的组（当期已分组、现在已删/改组），补齐
  if (!isCurrent) {
    for (const [gUid, e] of Object.entries(endSnap)) {
      if (rows.some(r => r.group_uid === gUid)) continue;
      const s = startSnap[gUid] || { total: 0, member_count: e.member_count };
      const info = gInfo[gUid] || { name: '（已解散小组）', color: '#8e8e93' };
      const totalDelta = Number(e.total) - Number(s.total);
      rows.push({
        group_uid: gUid, group_name: info.name, color: info.color || '#8e8e93',
        member_count: e.member_count,
        avg_start: round2(Number(s.total) / (s.member_count || e.member_count)),
        avg_end: round2(Number(e.total) / e.member_count),
        total_delta: round2(totalDelta),
        delta_avg: round2(totalDelta / e.member_count),
      });
    }
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
    const curIdx = Math.max(0, periodIndexAt(nowMs)); // 第一期开始前（锚点前一天）也展示第一期
    const periodParam = c.req.query('period') || 'current';

    let index, isCurrent;
    if (periodParam === 'current' || periodParam === '') {
      index = curIdx; isCurrent = true;
    } else {
      const pi = parseInt(periodParam);
      if (Number.isNaN(pi) || pi < 0) return c.json({ ok: false, error: 'period 参数无效' }, 400);
      index = pi; isCurrent = (index === curIdx);
    }

    const bounds = periodBounds(index);
    // 当期重算到当前时刻（多取 1ms 以覆盖同毫秒写入）；历史期按周期边界 [start,end) 取数
    const endMs = isCurrent ? nowMs + 1 : bounds.period_end;

    let rows;
    if (isCurrent) {
      rows = await computeBiweekly(db, bounds.period_start, endMs, bounds.period_start, true);
    } else {
      // 已结束周期：优先读缓存，没有则用快照确定性重算并 UPSERT 缓存（发同步事件）
      let cached = await db.get(
        "SELECT payload FROM rank_snapshots WHERE kind='biweekly' AND period_index=?", index);
      if (cached) {
        try {
          const parsed = JSON.parse(cached.payload);
          rows = Array.isArray(parsed) ? parsed : (parsed.rows || []);
        } catch { rows = await computeBiweekly(db, bounds.period_start, bounds.period_end, bounds.period_start, false); }
      } else {
        rows = await computeBiweekly(db, bounds.period_start, bounds.period_end, bounds.period_start, false);
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
      period_end: bounds.period_end,
      is_current: isCurrent,
      not_started: isCurrent && nowMs < bounds.period_start,
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
