// Worker 端主动同步 tick：每分钟由 scheduled cron 调用
// 方向：Worker → HOME_PEER_URL（家里主站）。本端事件推过去，对端响应里的事件由本端 replay 进 D1。
// 游标存 D1 kv_meta；附件双向由 Worker 主动发起。
import { getKv, setKv } from '../routes/_helpers.js';
import { replayEvent, keyFromUrl, extractUploadKeys } from './replay.js';

async function toBuffer(x) {
  if (x == null) return null;
  if (typeof x === 'string') return Buffer.from(x, 'utf8');
  if (x instanceof ArrayBuffer) return Buffer.from(x);
  if (ArrayBuffer.isView(x)) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  if (typeof x.arrayBuffer === 'function') return Buffer.from(await x.arrayBuffer()); // Blob/File
  if (typeof x.getReader === 'function') return Buffer.from(await new Response(x).arrayBuffer()); // R2 ReadableStream
  return null;
}

// 带附件引用的表（附件自愈扫描覆盖）
function fileBearingTable(tbl) {
  return tbl === 'announcements' || tbl === 'front_messages' || tbl === 'announcement_versions'
    || tbl === 'system_announcements';
}

// 从事件 snapshot 中收集所有需要推/拉的存储 key（system_announcements 从 Markdown content 提取）
function keysFromSnap(tbl, snap) {
  if (tbl === 'system_announcements') {
    return extractUploadKeys(snap && snap.content);
  }
  const k = keyFromUrl(snap && snap.file_url);
  return k ? [k] : [];
}

export async function runWorkerTick({ db, storage, peerUrl, syncSecret }) {
  if (!peerUrl || !syncSecret) return { skipped: true, reason: 'no peer/secret' };
  const myHost = '/api/file'; // Worker 端 file_url 用相对路径，本站自己解析

  // 1. 读游标
  const lastOutId = Number(await getKv(db, 'sync_out_id') || 0);
  let peerLastId = Number(await getKv(db, 'sync_peer_last_id') || 0);
  const myEvents = await db.all('SELECT * FROM sync_events WHERE id > ? ORDER BY id', lastOutId);

  // 2. POST 到主站
  const resp = await fetch(`${peerUrl}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sync-Key': syncSecret },
    body: JSON.stringify({ peer: 'worker', last_id: peerLastId, events: myEvents }),
  });
  if (!resp.ok) throw new Error('peer HTTP ' + resp.status);
  const data = await resp.json();

  // 3. 更新发送游标
  if (myEvents.length) {
    await setKv(db, 'sync_out_id', myEvents[myEvents.length - 1].id);
  }
  await setKv(db, 'sync_last_push_at', Date.now());

  // 4. 把主站返回的事件落 D1（幂等 by event_uid）并 replay
  const incoming = data.events || [];
  for (const ev of incoming) {
    if (!ev || !ev.event_uid) continue;
    const seen = await db.get('SELECT id FROM sync_events WHERE event_uid=?', ev.event_uid);
    if (seen) continue;
    await db.run(
      `INSERT INTO sync_events (event_uid, tbl, row_uid, op, snapshot, apply_delta, origin, ts)
       VALUES (?,?,?,?,?,?,?,?)`,
      ev.event_uid, ev.tbl, ev.row_uid, ev.op,
      typeof ev.snapshot === 'string' ? ev.snapshot : JSON.stringify(ev.snapshot || {}),
      ev.apply_delta || 0, ev.origin || 'node', ev.ts || Date.now());
    try { await replayEvent(db, ev); } catch (e) { console.error('[worker replay]', e.message); }
  }
  if (incoming.length) await setKv(db, 'sync_peer_last_id', data.last_id);
  await setKv(db, 'sync_last_pull_at', Date.now());

  // 5. 文件双向
  await pushFilesToPeer(db, storage, peerUrl, syncSecret, myEvents);
  // 对端在响应里声明它缺的文件（含历史 tick 漏推的），按需补推，保证可追平
  await pushNeededFiles(storage, peerUrl, syncSecret, data.need_files || []);
  await pullMissingFiles(db, storage, peerUrl, syncSecret, incoming);
  await reconcilePullMissing(db, storage, peerUrl, syncSecret);

  await setKv(db, 'sync_last_error', '');
  return { pushed: myEvents.length, received: incoming.length, last_id: data.last_id };
}

async function pushFilesToPeer(db, storage, peerUrl, secret, events) {
  const files = [];
  const keys = [];
  const pushed = new Set();
  for (const ev of events) {
    if (!fileBearingTable(ev.tbl) || ev.op !== 'upsert') continue;
    let snap = {};
    try { snap = JSON.parse(ev.snapshot); } catch { continue; }
    for (const k of keysFromSnap(ev.tbl, snap)) {
      if (!k || pushed.has(k)) continue;
      pushed.add(k);
      const obj = await storage.get(k);
      if (!obj) continue;
      const bytes = await toBuffer(obj.body);
      if (!bytes) continue;
      const fname = ev.tbl === 'system_announcements' ? k.split('/').pop() : (snap.file_name || k);
      files.push(new File([bytes], fname, { type: obj.contentType || snap.file_type || 'application/octet-stream' }));
      keys.push(k);
    }
  }
  if (!files.length) return;
  const fd = new FormData();
  fd.append('keys', JSON.stringify(keys));
  for (const f of files) fd.append('files', f);
  await fetch(`${peerUrl}/api/sync/files`, { method: 'POST', headers: { 'X-Sync-Key': secret }, body: fd });
}

async function pullMissingFiles(db, storage, peerUrl, secret, events) {
  for (const ev of events) {
    if (!fileBearingTable(ev.tbl) || ev.op !== 'upsert') continue;
    let snap = {};
    try { snap = JSON.parse(ev.snapshot); } catch { continue; }
    for (const k of keysFromSnap(ev.tbl, snap)) {
      if (!k) continue;
      if (await storage.exists(k)) continue;
      try {
        // 从主站拉：/api/file/<key>，带 X-Sync-Key（主站对带同步密钥的请求放行）
        const r = await fetch(`${peerUrl}/api/file/${encodeURIComponent(k)}`, { headers: { 'X-Sync-Key': secret } });
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        const ct = r.headers.get('content-type') || snap.file_type || 'application/octet-stream';
        await storage.put(k, buf, ct);
        // 重写本端行 file_url 为本地相对路径（本站 /api/file 会解析到 R2）
        // system_announcements 的图片以 Markdown 相对路径嵌入，两端都直接可访问，无需改写 content
        if (ev.tbl !== 'announcement_versions' && ev.tbl !== 'system_announcements' && snap.file_url) {
          await db.run(`UPDATE ${ev.tbl} SET file_url=? WHERE uid=?`, `/api/file/${encodeURIComponent(k)}`, ev.row_uid);
        }
      } catch (e) { /* ignore */ }
    }
  }
}

// 对端 /api/sync 响应里的 need_files：它 replay 了公告事件但本地没有对应文件
async function pushNeededFiles(storage, peerUrl, secret, needFiles) {
  if (!Array.isArray(needFiles) || !needFiles.length) return;
  const files = [];
  const keys = [];
  for (const nf of needFiles) {
    const k = keyFromUrl(nf.url || '');
    if (!k) continue;
    const obj = await storage.get(k);
    if (!obj) continue;
    const bytes = await toBuffer(obj.body);
    if (!bytes) continue;
    files.push(new File([bytes], nf.name || k, { type: obj.contentType || nf.type || 'application/octet-stream' }));
    keys.push(k);
  }
  if (!files.length) return;
  const fd = new FormData();
  fd.append('keys', JSON.stringify(keys));
  for (const f of files) fd.append('files', f);
  await fetch(`${peerUrl}/api/sync/files`, { method: 'POST', headers: { 'X-Sync-Key': secret }, body: fd });
}

// 自愈：扫描本端最近公告、前台消息、系统公告，凡是引用了文件但 R2 缺失的，主动从主站拉回（覆盖历史漏拉）
async function reconcilePullMissing(db, storage, peerUrl, secret) {
  const rows = await db.all(
    `SELECT * FROM (
       SELECT 'announcements' AS tbl, uid, file_url, file_name, file_type, created_at FROM announcements WHERE deleted=0 AND file_url IS NOT NULL AND file_url != ''
       UNION ALL
       SELECT 'front_messages' AS tbl, uid, file_url, file_name, file_type, created_at FROM front_messages WHERE deleted=0 AND file_url IS NOT NULL AND file_url != ''
       UNION ALL
       SELECT 'chat_messages' AS tbl, uid, file_url, file_name, file_type, created_at FROM chat_messages WHERE deleted=0 AND file_url IS NOT NULL AND file_url != ''
     ) ORDER BY created_at DESC LIMIT 200`);
  for (const a of rows) {
    const k = keyFromUrl(a.file_url);
    if (!k) continue;
    if (await storage.exists(k)) continue;
    try {
      const r = await fetch(`${peerUrl}/api/file/${encodeURIComponent(k)}`, { headers: { 'X-Sync-Key': secret } });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const ct = r.headers.get('content-type') || a.file_type || 'application/octet-stream';
      await storage.put(k, buf, ct);
      await db.run(`UPDATE ${a.tbl} SET file_url=? WHERE uid=?`, `/api/file/${encodeURIComponent(k)}`, a.uid);
    } catch (e) { /* ignore, retry next tick */ }
  }
  // 系统公告：从 Markdown content 提取图片附件，缺失则拉回（content 用相对路径，两端通用，无需改写）
  const saRows = await db.all(
    `SELECT uid, content FROM system_announcements WHERE deleted=0 AND content IS NOT NULL AND content != '' LIMIT 200`);
  const pulled = new Set();
  for (const sa of saRows) {
    for (const k of extractUploadKeys(sa.content || '')) {
      if (!k || pulled.has(k)) continue;
      pulled.add(k);
      if (await storage.exists(k)) continue;
      try {
        const r = await fetch(`${peerUrl}/api/file/${encodeURIComponent(k)}`, { headers: { 'X-Sync-Key': secret } });
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        const ct = r.headers.get('content-type') || 'image/*';
        await storage.put(k, buf, ct);
      } catch (e) { /* ignore, retry next tick */ }
    }
  }
}
