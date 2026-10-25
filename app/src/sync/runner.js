// Node 端主动同步 runner：每 60s 一轮，推本端出列事件、拉对端新增、补文件
import { getKv, setKv } from '../routes/_helpers.js';
import { keyFromUrl, extractUploadKeys } from './replay.js';

function toBuffer(x) {
  if (x == null) return null;
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof ArrayBuffer) return Buffer.from(x);
  if (ArrayBuffer.isView(x)) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  if (typeof x === 'string') return Buffer.from(x, 'utf8');
  return null;
}

export function createRunner({ db, storage, peerUrl, syncSecret, origin, pollMs = 60000 }) {
  let timer = null;
  let running = false;

  function fileBearing(tbl) {
    return tbl === 'announcements' || tbl === 'front_messages' || tbl === 'announcement_versions'
      || tbl === 'system_announcements' || tbl === 'groups' || tbl === 'chat_messages';
  }

  // 从 snapshot 收集需要推/拉的 key（system_announcements 从 Markdown content 提取）
  function keysFromSnap(tbl, snap) {
    if (tbl === 'system_announcements') return extractUploadKeys(snap && snap.content);
    if (tbl === 'groups') {
      const av = snap && snap.avatar;
      if (typeof av === 'string' && av.startsWith('/api/file/')) {
        const k = keyFromUrl(av);
        return k ? [k] : [];
      }
      return [];
    }
    if (tbl === 'chat_messages') {
      // attachments 是数组 [{url, ...}]，提取 /api/file/ 开头的 url 对应的 key
      const atts = Array.isArray(snap && snap.attachments) ? snap.attachments : [];
      const out = [];
      for (const a of atts) {
        const k = keyFromUrl((a && a.url) || '');
        if (k) out.push(k);
      }
      return out;
    }
    const k = keyFromUrl(snap && snap.file_url);
    return k ? [k] : [];
  }

  async function pushFiles(db, peerUrl, secret, events, myHost) {
    const files = [];
    const keys = [];
    const pushed = new Set();
    for (const ev of events) {
      if (!fileBearing(ev.tbl) || ev.op !== 'upsert') continue;
      let snap = {};
      try { snap = JSON.parse(ev.snapshot); } catch { continue; }
      for (const k of keysFromSnap(ev.tbl, snap)) {
        if (!k || pushed.has(k)) continue;
        pushed.add(k);
        const buf = await storage.get(k);
        if (!buf) continue;
        const bytes = toBuffer(buf.body);
        if (!bytes) continue;
        const fname = ev.tbl === 'system_announcements' ? k.split('/').pop() : (snap.file_name || k);
        files.push(new File([bytes], fname, { type: snap.file_type || 'application/octet-stream' }));
        keys.push(k);
      }
    }
    if (!files.length) return;
    const fd = new FormData();
    fd.append('keys', JSON.stringify(keys));
    for (const f of files) fd.append('files', f);
    try {
      await fetch(`${peerUrl}/api/sync/files`, { method: 'POST', headers: { 'X-Sync-Key': secret }, body: fd });
    } catch (e) { console.error('[pushFiles]', e.message); }
  }

  async function pullMissingFiles(db, peerUrl, secret, events, myHost) {
    for (const ev of events) {
      if (!fileBearing(ev.tbl) || ev.op !== 'upsert') continue;
      let snap = {};
      try { snap = JSON.parse(ev.snapshot); } catch { continue; }
      for (const k of keysFromSnap(ev.tbl, snap)) {
        if (!k) continue;
        const exists = await storage.exists(k);
        if (exists) continue;
        // system_announcements / groups 用相对路径，直接从对端 /api/file/<key> 拉
        const src = (ev.tbl === 'system_announcements' || ev.tbl === 'groups')
          ? `${peerUrl}/api/file/${encodeURIComponent(k)}`
          : (snap.file_url || `${peerUrl}/api/file/${encodeURIComponent(k)}`);
        try {
          const resp = await fetch(src);
          if (!resp.ok) continue;
          const buf = Buffer.from(await resp.arrayBuffer());
          await storage.put(k, buf, snap.file_type || 'application/octet-stream');
          // 仅单列 file_url 表需要重写本地行；system_announcements / groups / chat_messages 用相对路径无需改写
          if (ev.tbl !== 'announcement_versions' && ev.tbl !== 'system_announcements' && ev.tbl !== 'groups' && ev.tbl !== 'chat_messages' && snap.file_url) {
            const targetUrl = snap.file_url.replace(peerUrl, myHost);
            await db.run(`UPDATE ${ev.tbl} SET file_url=? WHERE uid=?`, targetUrl, ev.row_uid);
          }
        } catch (e) { /* ignore */ }
      }
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const lastOutId = Number(await getKv(db, 'sync_out_id') || 0);
      const myEvents = await db.all('SELECT * FROM sync_events WHERE id > ? ORDER BY id', lastOutId);
      let peerLastId = Number(await getKv(db, 'sync_peer_last_id') || 0);
      const myHost = (await getKv(db, 'sync_my_url')) || '';

      const resp = await fetch(`${peerUrl}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sync-Key': syncSecret },
        body: JSON.stringify({ peer: origin, last_id: peerLastId, events: myEvents }),
      });
      if (!resp.ok) {
        await setKv(db, 'sync_last_error', 'HTTP ' + resp.status);
        return;
      }
      const data = await resp.json();
      if (myEvents.length) await setKv(db, 'sync_out_id', myEvents[myEvents.length - 1].id);
      await setKv(db, 'sync_last_push_at', Date.now());

      // 对方推过来的事件已经由 /api/sync 路由内部 replay 落库；这里补同步游标与文件
      if (data.events && data.events.length) {
        await pullMissingFiles(db, peerUrl, syncSecret, data.events, myHost);
        await setKv(db, 'sync_peer_last_id', data.last_id);
      }
      if (myEvents.length) await pushFiles(db, peerUrl, syncSecret, myEvents, myHost);
      await setKv(db, 'sync_last_pull_at', Date.now());
      await setKv(db, 'sync_last_error', '');
    } catch (e) {
      await setKv(db, 'sync_last_error', e.message);
    } finally {
      running = false;
    }
  }

  async function start() {
    if (timer) return;
    await tick().catch(e => console.error('[runner initial tick]', e.message));
    timer = setInterval(() => tick().catch(e => console.error('[runner tick]', e.message)), pollMs);
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  async function runOnce() { await tick(); }

  return { start, stop, runOnce };
}
