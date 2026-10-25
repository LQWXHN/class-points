// Worker 端入口：D1 + R2 + ASSETS；schema 由 CLI 预建；scheduled 每分钟同步 + 04:00 自动备份
import { createWorkerDb } from './db/worker-db.js';
import { createR2Storage } from './storage/r2-storage.js';
import { createApp } from './app.js';
import { setSyncOrigin, getConfig } from './routes/_helpers.js';
import { runWorkerTick } from './sync/worker-tick.js';

const PAGE_REWRITES = {
  '/': '/index.html',
  '/start': '/start.html',
  '/ae': '/ae.html',
  '/history': '/history.html',
  '/new': '/new.html',
  '/chat': '/chat.html',
  '/chat/teacher': '/chat-staff.html',
  '/chat/admin': '/chat-staff.html',
  '/admin': '/admin/index.html',
};

function pickBucket(env) {
  // wrangler.toml 绑定名是 R2；本地 dev 用 BUCKET 也兼容
  return env.R2 || env.BUCKET;
}

// v5.1: 动态 peer 选择（真实探测 bootstrap，30s 缓存）
let peerCache = { url: '', ts: 0 };
async function probeBootstrap(url) {
  const started = Date.now();
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const r = await fetch(url.replace(/\/+$/, '') + '/api/public/bootstrap', { signal: c.signal, redirect: 'follow' });
    clearTimeout(t);
    if (!r.ok) return { online: false, instance: '' };
    const j = await r.json().catch(() => ({}));
    return { online: true, instance: j.instance || '', latency: Date.now() - started };
  } catch { return { online: false, instance: '' }; }
}
async function resolvePeerUrl(env, db, selfInstance) {
  if (peerCache.url && Date.now() - peerCache.ts < 30000) return peerCache.url;
  let fallback = '';
  if (selfInstance === 'worker') fallback = env.NODE_PEER_URL || env.HOME_PEER_URL || '';
  else fallback = env.CF_PEER_URL || '';
  try {
    const row = await db.get('SELECT value FROM config WHERE key=?', 'sites');
    if (row && row.value) {
      const sites = JSON.parse(row.value);
      for (const s of sites) {
        const u = (s.url || '').replace(/\/+$/, '');
        if (!u.startsWith('https://')) continue;
        if (/127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|localhost/.test(new URL(u).hostname)) continue;
        const r = await probeBootstrap(u);
        if (r.online && r.instance !== selfInstance) {
          peerCache = { url: u, ts: Date.now() };
          return u;
        }
      }
    }
  } catch {}
  peerCache = { url: fallback, ts: Date.now() };
  return fallback;
}

export default {
  async fetch(request, env, ctx) {
    setSyncOrigin('worker');

    const db = createWorkerDb(env.DB);
    const storage = createR2Storage(pickBucket(env));
    const syncSecret = env.SYNC_SECRET || '';
    const peerUrl = await resolvePeerUrl(env, db, 'worker');

    const app = createApp({ db, storage, origin: 'worker', syncSecret, peerUrl });

    const url = new URL(request.url);
    const p = url.pathname;

    // v5.0：群聊 /api/chat/* 全部反代到主站（数据单源 SQLite）
    // 鉴权透传：Authorization / X-Device-Token；SSE 流原样回传
    if (p.startsWith('/api/chat/') && peerUrl) {
      const target = peerUrl.replace(/\/+$/, '') + request.url.replace(/^https?:\/\/[^/]+/, '');
      const headers = new Headers(request.headers);
      if (syncSecret) headers.set('X-Sync-Key', syncSecret);
      // 保留原鉴权头；Authorization / X-Device-Token 已自动透传
      const init = { method: request.method, headers, body: ['GET','HEAD'].includes(request.method) ? undefined : request.body };
      return fetch(target, init);
    }
    // v5.0：WxPusher 订阅回调走主站（WxPusher 配置主站 URL，但保险起见 worker 也代理）
    if (p === '/api/wxpusher/callback' && peerUrl) {
      const target = peerUrl.replace(/\/+$/, '') + '/api/wxpusher/callback';
      const headers = new Headers(request.headers);
      if (syncSecret) headers.set('X-Sync-Key', syncSecret);
      return fetch(target, { method: 'POST', headers, body: request.body });
    }

    // v5.1：staff 在备用站登录时，让主站同时建会话，并把 D1 本地会话换成同一 token，
    // 保证一个 token 对本地 D1 接口与反代到主站的 /api/chat/* 都有效（主站不可用时退回本地登录）
    if (p === '/api/auth/login' && request.method === 'POST') {
      const localRes = await app.fetch(request.clone(), env, ctx);
      const localJson = await localRes.clone().json().catch(() => null);
      if (localJson && localJson.ok && localJson.token && peerUrl) {
        try {
          const peerRes = await fetch(peerUrl.replace(/\/+$/, '') + '/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Sync-Key': syncSecret },
            body: await request.clone().text(),
          });
          const peerJson = await peerRes.json().catch(() => null);
          if (peerJson && peerJson.ok && peerJson.token) {
            await db.run('UPDATE sessions SET token=? WHERE token=?', peerJson.token, localJson.token);
            return new Response(JSON.stringify(peerJson), {
              status: peerRes.status,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        } catch (e) { /* 主站不可达，使用本地会话 */ }
      }
      return localRes;
    }

    if (p.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }

    // 无后缀路由重写（含末尾斜杠归一）
    const normPath = p === '/' ? '/' : p.replace(/\/+$/, '');
    let targetPath = p;
    const firstSeg = '/' + (normPath.split('/').filter(Boolean)[0] || '');
    if (PAGE_REWRITES[normPath]) targetPath = PAGE_REWRITES[normPath];
    else if (PAGE_REWRITES[firstSeg]) targetPath = PAGE_REWRITES[firstSeg];
    // v5.0：/chat/teacher 与 /chat/admin 用 302 跳到 /chat-staff.html（ASSETS 绑定对跨段重写不稳定）
    if (normPath === '/chat/teacher' || normPath === '/chat/admin') {
      return Response.redirect(new URL('/chat-staff.html', request.url).toString(), 302);
    }
    // 未匹配的路径（如已下线的 /send）直接 404，不要走 ASSETS 导致 500
    if (targetPath === p && !PAGE_REWRITES[normPath] && !PAGE_REWRITES[firstSeg]) {
      return new Response('Not Found', { status: 404 });
    }
    const newUrl = new URL(request.url);
    newUrl.pathname = targetPath;
    return env.ASSETS.fetch(newUrl.toString());
  },

  // cron：每分钟跑同步；04:00 UTC 自动备份
  async scheduled(event, env, ctx) {
    setSyncOrigin('worker');
    ctx.waitUntil((async () => {
      const db = createWorkerDb(env.DB);
      const storage = createR2Storage(pickBucket(env));
      const syncSecret = env.SYNC_SECRET || '';
      const peerUrl = await resolvePeerUrl(env, db, 'worker');

      // ---- 1. 同步 tick（每分钟）----
      try {
        const r = await runWorkerTick({ db, storage, peerUrl, syncSecret });
        if (r.skipped) {
          await db.run("INSERT OR REPLACE INTO kv_meta (key, value) VALUES ('sync_last_error', ?)",
            'skipped: no peer/secret');
        } else {
          console.log('[sync] tick ok', JSON.stringify(r));
        }
      } catch (e) {
        console.error('[sync] tick failed', e.message);
        await db.run("INSERT OR REPLACE INTO kv_meta (key, value) VALUES ('sync_last_error', ?)", e.message);
      }

      // ---- 2. 每周一 04:00（北京时间）自动备份 ----
      try {
        const bj = new Date(Date.now() + 8 * 3600 * 1000);
        if (bj.getUTCDay() === 1 && bj.getUTCHours() === 4 && bj.getUTCMinutes() < 1) {
          const enabled = await getConfig(db, 'auto_backup_enabled');
          if (enabled === '1') {
            const { performBackup } = await import('./routes/backup.js');
            const meta = await performBackup(db, storage, { type: 'auto', source: 'cloud' });
            console.log('[backup] auto ok', meta.filename);
          }
        }
      } catch (e) {
        console.error('[backup] auto failed', e.message);
      }
    })());
  },
};
