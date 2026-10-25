import { Hono } from 'hono';
import { verifyUser, verifyDevice } from './_helpers.js';

const MAX_BYTES = 600 * 1024 * 1024; // 600MB

export function uploadRoutes() {
  const app = new Hono();

  app.post('/upload', async (c) => {
    // 教师/超管发布公告 与 设备前台发消息 都要上传附件，二者任一通过即可
    const me = await verifyUser(c);
    const dev = me ? null : await verifyDevice(c);
    if (!me && !dev) return c.json({ ok: false, error: '未登录' }, 401);
    // 早拒绝：依据 Content-Length 直接拒 >600MB，避免把整个 multipart 读进内存
    const cl = Number(c.req.header('Content-Length') || 0);
    if (cl > MAX_BYTES) {
      return c.json({ ok: false, error: '请求体过大，单个文件不能超过 600MB' }, 413);
    }
    let form;
    try { form = await c.req.formData(); }
    catch { return c.json({ ok: false, error: '未找到文件或请求体过大（>600MB）' }, 400); }
    const file = form.get('file');
    if (!file || typeof file === 'string') return c.json({ ok: false, error: '未找到文件' }, 400);
    if (file.size > MAX_BYTES) {
      return c.json({ ok: false, error: '单个文件不能超过 600MB' }, 400);
    }
    const storage = c.get('storage');
    // 可选 prefix（如 'chat'）→ uploads/chat/；默认 uploads/
    const prefix = String(form.get('prefix') || '').trim();
    const safePrefix = /^[a-z0-9_\-/]*$/i.test(prefix) && !prefix.startsWith('/') ? prefix.replace(/\/+$/, '') : '';
    const dir = safePrefix ? `uploads/${safePrefix}/` : 'uploads/';
    const safeName = file.name.replace(/[^\w.\-一-龥]/g, '_').slice(0, 120) || 'file';
    const key = `${dir}${Date.now()}_${safeName}`;
    const buf = Buffer.from(await file.arrayBuffer());
    await storage.put(key, buf, file.type || 'application/octet-stream');
    return c.json({
      ok: true, url: storage.url(key), key,
      name: file.name, size: file.size, type: file.type || '',
    });
  });

  app.get('/file/*', async (c) => {
    const p = new URL(c.req.url).pathname;
    const key = decodeURIComponent(p.replace(/^\/api\/file\//, ''));
    if (!key) return c.json({ ok: false, error: 'Not Found' }, 404);
    const storage = c.get('storage');
    const got = await storage.get(key);
    if (!got) return c.json({ ok: false, error: 'Not Found' }, 404);
    return c.body(got.body, 200, {
      'Content-Type': got.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
    });
  });

  return app;
}
