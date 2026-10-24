/* 班级积分系统 v4.9 Service Worker：离线外壳缓存（仅缓存，不含推送） */
const CACHE = 'cp-v56';
const SHELL = ['/', '/index.html', '/new', '/history', '/assets/apple.css', '/assets/common.js', '/assets/vendor/fontawesome/css/all.min.css'];

self.addEventListener('install', e => {
  // 逐个缓存，单个失败不影响整体安装
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.all(SHELL.map(u => c.add(u).catch(() => null)))
  ).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // 页面导航：网络优先（保证部署后拿到新版），离线回退缓存
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        const cp = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp));
        return res;
      }).catch(() => caches.match(e.request).then(h => h || caches.match('/index.html')))
    );
    return;
  }
  // 静态资源：缓存优先
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const cp = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, cp));
      return res;
    }))
  );
});
