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
  '/send': '/send.html',
  '/admin': '/admin/index.html',
};

function pickBucket(env) {
  // wrangler.toml 绑定名是 R2；本地 dev 用 BUCKET 也兼容
  return env.R2 || env.BUCKET;
}

export default {
  async fetch(request, env, ctx) {
    setSyncOrigin('worker');

    const db = createWorkerDb(env.DB);
    const storage = createR2Storage(pickBucket(env));
    const syncSecret = env.SYNC_SECRET || '';
    const peerUrl = env.NODE_PEER_URL || env.HOME_PEER_URL || '';

    const app = createApp({ db, storage, origin: 'worker', syncSecret, peerUrl });

    const url = new URL(request.url);
    const p = url.pathname;

    if (p.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }

    // 无后缀路由重写（含末尾斜杠归一）
    const normPath = p === '/' ? '/' : p.replace(/\/+$/, '');
    let targetPath = p;
    if (PAGE_REWRITES[normPath]) targetPath = PAGE_REWRITES[normPath];
    else {
      const firstSeg = '/' + (normPath.split('/').filter(Boolean)[0] || '');
      if (PAGE_REWRITES[firstSeg]) targetPath = PAGE_REWRITES[firstSeg];
    }
    const newUrl = new URL(request.url);
    newUrl.pathname = targetPath;
    const req2 = new Request(newUrl.toString(), request);
    return env.ASSETS.fetch(req2, env, ctx);
  },

  // cron：每分钟跑同步；04:00 UTC 自动备份
  async scheduled(event, env, ctx) {
    setSyncOrigin('worker');
    ctx.waitUntil((async () => {
      const db = createWorkerDb(env.DB);
      const storage = createR2Storage(pickBucket(env));
      const syncSecret = env.SYNC_SECRET || '';
      const peerUrl = env.NODE_PEER_URL || env.HOME_PEER_URL || '';

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
