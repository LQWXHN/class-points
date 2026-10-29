/* 班级积分系统 Service Worker：离线外壳缓存 + 一键极速预载（手动预缓存，分批下载） */
const VERSION = 'cp-v94';
const SHELL_CACHE = 'cp-shell-' + VERSION;
const PRELOAD_CACHE = 'cp-preload'; // 预载缓存固定命名，跨版本保留（表情等静态资源不随更新重下）
const SHELL = [
  '/', '/index.html', '/new', '/history', '/chat',
  '/assets/apple.css', '/assets/common.js',
  '/assets/vendor/fontawesome/css/all.min.css',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c =>
    Promise.all(SHELL.map(u => c.add(u).catch(() => null)))
  ).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  // 清理所有旧版本缓存（外壳与预载）
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== PRELOAD_CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // 页面导航：网络优先（保证部署后拿到新版），离线回退缓存
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        const cp = res.clone();
        caches.open(SHELL_CACHE).then(c => c.put(e.request, cp));
        return res;
      }).catch(() => caches.match(e.request).then(h => h || caches.match('/index.html')))
    );
    return;
  }
  // 静态资源：预载缓存优先，其次外壳缓存，最后网络
  e.respondWith(
    caches.match(e.request, { cacheName: PRELOAD_CACHE }).then(hit =>
      hit || caches.match(e.request, { cacheName: SHELL_CACHE }).then(hit =>
        hit || fetch(e.request).then(res => {
          if (res.ok) {
            const cp = res.clone();
            caches.open(SHELL_CACHE).then(c => c.put(e.request, cp));
          }
          return res;
        })
      )
    )
  );
});

// 一键预载：分批下载并回传进度
self.addEventListener('message', e => {
  const msg = e.data || {};
  if (msg.type === 'PRECACHE') {
    precacheList(msg.urls || [], e.source);
  } else if (msg.type === 'CLEAR_PRELOAD') {
    caches.delete(PRELOAD_CACHE).then(() => {
      if (e.source) e.source.postMessage({ type: 'PRELOAD_CLEARED' });
    });
  } else if (msg.type === 'PRELOAD_STATUS') {
    reportStatus(e.source);
  }
});

async function precacheList(urls, source) {
  const cache = await caches.open(PRELOAD_CACHE);
  let done = 0;
  const BATCH = 4;
  for (let i = 0; i < urls.length; i += BATCH) {
    await Promise.all(urls.slice(i, i + BATCH).map(async u => {
      try {
        const hit = await cache.match(u);
        if (!hit) {
          const r = await fetch(u, { cache: 'no-cache' });
          if (r && r.ok) await cache.put(u, r);
        }
      } catch {}
      done++;
    }));
    if (source) source.postMessage({ type: 'PRECACHE_PROGRESS', done, total: urls.length });
  }
  if (source) source.postMessage({ type: 'PRECACHE_DONE', done, total: urls.length });
}

async function reportStatus(source) {
  if (!source) return;
  let count = 0;
  try {
    const cache = await caches.open(PRELOAD_CACHE);
    count = (await cache.keys()).length;
  } catch {}
  source.postMessage({ type: 'PRELOAD_STATUS', count, version: VERSION });
}
