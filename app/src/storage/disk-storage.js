// Node 端磁盘存储抽象（DATA_DIR 下 uploads/ 与 backups/）
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html;charset=utf-8', '.css': 'text/css;charset=utf-8',
  '.js': 'application/javascript;charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json', '.txt': 'text/plain;charset=utf-8',
  '.pdf': 'application/pdf',
};

export function createDiskStorage({ dataDir }) {
  const base = path.resolve(dataDir);
  function resolve(key) {
    const p = path.normalize(path.join(base, key));
    if (!p.startsWith(base)) throw new Error('非法 key: ' + key);
    return p;
  }
  return {
    put(key, bytes, contentType) {
      const p = resolve(key);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      // 兼容 Buffer / Uint8Array / string / ArrayBuffer
      fs.writeFileSync(p, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    },
    get(key) {
      const p = resolve(key);
      if (!fs.existsSync(p)) return null;
      const buf = fs.readFileSync(p);
      const ext = path.extname(p).toLowerCase();
      return { body: buf, size: buf.length, contentType: MIME[ext] || 'application/octet-stream' };
    },
    del(key) {
      const p = resolve(key);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    },
    list(prefix = '') {
      const root = path.join(base, prefix);
      const out = [];
      if (!fs.existsSync(root)) return out;
      (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else out.push({ key: path.relative(base, full).split(path.sep).join('/'), size: fs.statSync(full).size });
        }
      })(root);
      return out;
    },
    exists(key) {
      try { return fs.existsSync(resolve(key)); } catch { return false; }
    },
    url(key) { return '/api/file/' + encodeURIComponent(key); },
  };
}
