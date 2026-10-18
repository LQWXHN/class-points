import { Hono } from 'hono';
import { getKv, setKv, verifyUser } from './_helpers.js';
import { replayEvent, keyFromUrl, extractUploadKeys } from '../sync/replay.js';

// 事件携带的附件引用若本地缺失，加入 need_files 向对端索要
function fileBearingTable(tbl) {
  return tbl === 'announcements' || tbl === 'front_messages' || tbl === 'announcement_versions'
    || tbl === 'system_announcements';
}
async function collectNeedFile(storage, needFiles, tbl, rowUid, snap) {
  if (!snap) return;
  // 单列 file_url 的表
  if (tbl !== 'system_announcements' && snap.file_url) {
    const k = keyFromUrl(snap.file_url);
    if (k && !(await storage.exists(k))) {
      needFiles.push({ row_uid: rowUid, url: snap.file_url, name: snap.file_name || '', type: snap.file_type || '' });
    }
    return;
  }
  // system_announcements：从 Markdown content 里提取 /api/file/uploads/... 图片
  if (tbl === 'system_announcements' && snap.content) {
    const keys = extractUploadKeys(snap.content);
    for (const k of keys) {
      if (await storage.exists(k)) continue;
      const url = '/api/file/' + encodeURIComponent(k);
      if (needFiles.some(x => keyFromUrl(x.url || '') === k)) continue;
      needFiles.push({ row_uid: rowUid, url, name: k.split('/').pop() || '', type: 'image/*' });
    }
  }
}

export function syncRoutes() {
  const app = new Hono();

  app.post('/sync', async (c) => {
    const secret = c.get('syncSecret');
    const key = c.req.header('X-Sync-Key') || '';
    if (!secret || key !== secret) return c.json({ ok: false, error: 'unauthorized' }, 401);
    const db = c.get('db');
    const storage = c.get('storage');
    const body = await c.req.json().catch(() => ({}));
    const peer = body.peer || 'unknown';
    const lastId = Number(body.last_id || 0);
    const events = body.events || [];
    const needFiles = [];

    for (const ev of events) {
      if (!ev || !ev.event_uid) continue;
      const seen = await db.get('SELECT id FROM sync_events WHERE event_uid=?', ev.event_uid);
      if (seen) continue;
      await db.run(
        `INSERT INTO sync_events (event_uid, tbl, row_uid, op, snapshot, apply_delta, origin, ts)
         VALUES (?,?,?,?,?,?,?,?)`,
        ev.event_uid, ev.tbl, ev.row_uid, ev.op,
        typeof ev.snapshot === 'string' ? ev.snapshot : JSON.stringify(ev.snapshot || {}),
        ev.apply_delta || 0, peer, ev.ts || Date.now());
      try { await replayEvent(db, ev); } catch (e) { console.error('[sync replay]', e.message); }
      if (ev.op === 'upsert' && fileBearingTable(ev.tbl)) {
        let snap = {};
        try { snap = JSON.parse(typeof ev.snapshot === 'string' ? ev.snapshot : JSON.stringify(ev.snapshot || {})); } catch {}
        await collectNeedFile(storage, needFiles, ev.tbl, ev.row_uid, snap);
      }
    }

    // 自愈：每次同步都扫描最近公告、前台消息、系统公告，凡是库里引用但本地存储缺失的文件都向对端索要，
    // 不依赖当次是否为新事件，保证历史漏推/临时失败最终能追平。
    const fileRows = await db.all(
      `SELECT * FROM (
         SELECT uid, file_url, file_name, file_type, created_at FROM announcements WHERE deleted=0 AND file_url IS NOT NULL AND file_url != ''
         UNION ALL
         SELECT uid, file_url, file_name, file_type, created_at FROM front_messages WHERE deleted=0 AND file_url IS NOT NULL AND file_url != ''
       ) ORDER BY created_at DESC LIMIT 200`);
    for (const a of fileRows) {
      const k = keyFromUrl(a.file_url);
      if (!k) continue;
      if (needFiles.some(x => keyFromUrl(x.url || '') === k)) continue;
      if (await storage.exists(k)) continue;
      needFiles.push({ row_uid: a.uid, url: a.file_url, name: a.file_name || '', type: a.file_type || '' });
    }
    // 系统公告：从 Markdown content 提取图片附件
    const saRows = await db.all(
      `SELECT uid, content FROM system_announcements WHERE deleted=0 AND content IS NOT NULL AND content != '' LIMIT 200`);
    for (const sa of saRows) {
      for (const k of extractUploadKeys(sa.content || '')) {
        if (needFiles.some(x => keyFromUrl(x.url || '') === k)) continue;
        if (await storage.exists(k)) continue;
        needFiles.push({ row_uid: sa.uid, url: '/api/file/' + encodeURIComponent(k), name: k.split('/').pop() || '', type: 'image/*' });
      }
    }

    const maxRow = await db.get('SELECT MAX(id) AS m FROM sync_events');
    const myLast = maxRow ? (maxRow.m || 0) : 0;
    const out = await db.all('SELECT * FROM sync_events WHERE id > ? AND origin != ? ORDER BY id', lastId, peer);
    return c.json({ ok: true, last_id: myLast, events: out, server_time: Date.now(), need_files: needFiles });
  });

  app.post('/sync/files', async (c) => {
    const secret = c.get('syncSecret');
    const key = c.req.header('X-Sync-Key') || '';
    if (!secret || key !== secret) return c.json({ ok: false, error: 'unauthorized' }, 401);
    const storage = c.get('storage');
    const form = await c.req.formData();
    let keys = [];
    try { keys = JSON.parse(form.get('keys') || '[]'); } catch {}
    const files = form.getAll('files');
    for (let i = 0; i < keys.length && i < files.length; i++) {
      const f = files[i];
      const buf = Buffer.from(await f.arrayBuffer());
      await storage.put(keys[i], buf, f.type || 'application/octet-stream');
    }
    return c.json({ ok: true, count: Math.min(keys.length, files.length) });
  });

  app.get('/sync/status', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const origin = c.get('origin');
    if (origin === 'worker') {
      return c.json({ ok: true, enabled: true, role: 'backup', peer_url: c.get('peerUrl') || '' });
    }
    const pendingRow = await db.get(
      "SELECT COUNT(*) AS c FROM sync_events WHERE id > COALESCE((SELECT CAST(value AS INTEGER) FROM kv_meta WHERE key='sync_out_id'), 0)");
    return c.json({
      ok: true,
      enabled: !!c.get('peerUrl'),
      peer_url: c.get('peerUrl') || '',
      last_push_at: await getKv(db, 'sync_last_push_at'),
      last_pull_at: await getKv(db, 'sync_last_pull_at'),
      last_error: await getKv(db, 'sync_last_error'),
      pending_out: pendingRow ? pendingRow.c : 0,
    });
  });

  return app;
}
