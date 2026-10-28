/* 鐝骇绉垎绯荤粺 v5.0 Service Worker锛氱绾垮澹崇紦瀛橈紙浠呯紦瀛橈紝涓嶅惈鎺ㄩ€侊級 */
const CACHE = 'cp-v90';
const SHELL = ['/', '/index.html', '/new', '/history', '/chat', '/assets/apple.css', '/assets/common.js', '/assets/vendor/fontawesome/css/all.min.css'];

self.addEventListener('install', e => {
  // 閫愪釜缂撳瓨锛屽崟涓け璐ヤ笉褰卞搷鏁翠綋瀹夎
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
  // 椤甸潰瀵艰埅锛氱綉缁滀紭鍏堬紙淇濊瘉閮ㄧ讲鍚庢嬁鍒版柊鐗堬級锛岀绾垮洖閫€缂撳瓨
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
  // 闈欐€佽祫婧愶細缂撳瓨浼樺厛
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const cp = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, cp));
      return res;
    }))
  );
});
