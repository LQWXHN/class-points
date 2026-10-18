// Worker 端 R2 存储抽象
export function createR2Storage(bucket) {
  return {
    put(key, bytes, contentType) {
      return bucket.put(key, bytes, contentType ? { httpMetadata: { contentType } } : undefined);
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      return { body: obj.body, size: obj.size, contentType: obj.httpMetadata?.contentType || 'application/octet-stream' };
    },
    del(key) { return bucket.delete(key); },
    async list(prefix = '') {
      const out = [];
      let cursor;
      do {
        const res = await bucket.list({ prefix, cursor });
        for (const o of res.objects || []) out.push({ key: o.key, size: o.size });
        cursor = res.truncated ? res.cursor : null;
      } while (cursor);
      return out;
    },
    async exists(key) {
      const obj = await bucket.head?.(key) ?? await bucket.get(key);
      return !!obj;
    },
    url(key) { return '/api/file/' + encodeURIComponent(key); },
  };
}
