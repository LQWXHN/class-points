import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig, verifyUser } from './_helpers.js';

// 与 node.js 的 DATA_DIR 解析保持一致：systemd 下 cwd=app/，数据在同级 ../data
const NODE_DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), '..', 'data');

export function publicRoutes() {
  const app = new Hono();

  // GET /public/bootstrap — 无鉴权
  app.get('/public/bootstrap', async (c) => {
    const db = c.get('db');
    const sites = await getConfig(db, 'sites') || '[]';
    const extLinks = await getConfig(db, 'ext_links') || '{}';
    const version = await getConfig(db, 'system_version') || '';
    const sound = await getConfig(db, 'notify_sound') || 'ganlu';
    const soundUrl = await getConfig(db, 'notify_sound_url') || '';
    const biweeklyEnabled = await getConfig(db, 'biweekly_rank_enabled') || '1';
    let sitesArr = [], extObj = {};
    try { sitesArr = JSON.parse(sites); } catch {}
    try { extObj = JSON.parse(extLinks); } catch {}
    return c.json({
      ok: true,
      sites: sitesArr,
      ext_links: extObj,
      system_version: version,
      notify_sound: sound,
      notify_sound_url: soundUrl,
      biweekly_rank_enabled: biweeklyEnabled,
    });
  });

  // GET /storage/usage — staff
  app.get('/storage/usage', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const origin = c.get('origin');
    let dbSize = 0, backupsSize = 0, uploadsSize = 0, backupCount = 0;

    if (origin === 'node') {
      // node 端：dataDir 下 db 文件、backups、uploads
      const dataDir = NODE_DATA_DIR;
      try {
        const dbFile = path.join(dataDir, 'app.db');
        if (fs.existsSync(dbFile)) dbSize = fs.statSync(dbFile).size;
      } catch {}
      try {
        const bDir = path.join(dataDir, 'backups');
        if (fs.existsSync(bDir)) {
          for (const f of fs.readdirSync(bDir)) {
            try {
              const st = fs.statSync(path.join(bDir, f));
              if (st.isFile()) { backupsSize += st.size; backupCount++; }
            } catch {}
          }
        }
      } catch {}
      try {
        const uDir = path.join(dataDir, 'uploads');
        if (fs.existsSync(uDir)) {
          const walk = (dir) => {
            for (const f of fs.readdirSync(dir)) {
              const p = path.join(dir, f);
              const st = fs.statSync(p);
              if (st.isDirectory()) walk(p);
              else uploadsSize += st.size;
            }
          };
          walk(uDir);
        }
      } catch {}
    } else {
      // Worker 端：D1 无法取大小（dbSize 留 0）；备份与上传走 R2 list 汇总
      const storage = c.get('storage');
      if (storage) {
        try {
          const b = await storage.list('backups/');
          backupsSize = b.reduce((s, f) => s + (f.size || 0), 0);
          backupCount = b.length;
        } catch {}
        try {
          const u = await storage.list('uploads/');
          uploadsSize = u.reduce((s, f) => s + (f.size || 0), 0);
        } catch {}
      }
    }

    const total = dbSize + backupsSize + uploadsSize;
    return c.json({
      ok: true,
      db_size: dbSize,
      backups_size: backupsSize,
      uploads_size: uploadsSize,
      total,
      backup_count: backupCount,
      quota_bytes: 10737418240, // 10GB
    });
  });

  return app;
}
