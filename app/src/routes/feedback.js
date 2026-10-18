import { Hono } from 'hono';
import { uid, now, getConfig, verifyUser, verifyDevice, writeSyncEvent } from './_helpers.js';

// 反馈：staff/device 均可，每天 3 次（按身份计），发邮件到 rescue_email
export function feedbackRoutes() {
  const app = new Hono();
  const ORIGIN = (c) => c.get('origin') || '';

  async function identify(c) {
    const staff = await verifyUser(c);
    if (staff) return { type: 'staff', id: staff.username, name: staff.display_name || staff.username };
    const dev = await verifyDevice(c);
    if (dev) return { type: 'device', id: dev.device_uuid || dev.uid, name: dev.device_name || '设备' };
    return null;
  }

  // POST /feedback
  app.post('/feedback', async (c) => {
    const who = await identify(c);
    if (!who) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const body = await c.req.json().catch(() => ({}));
    const content = String(body.content || '').trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 3) : [];
    if (!content && !attachments.length) {
      return c.json({ ok: false, error: '内容或附件至少填一项' }, 400);
    }
    // 每日 3 次限制
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const countRow = await db.get(
      'SELECT COUNT(*) AS c FROM feedback_messages WHERE from_type=? AND from_id=? AND created_at >= ?',
      who.type, who.id, todayStart.getTime());
    if (countRow && countRow.c >= 3) {
      return c.json({ ok: false, error: '今日反馈次数已用完（每天3次）' }, 429);
    }
    const t = now();
    const fUid = uid();
    const attachJson = JSON.stringify(attachments);
    const snap = {
      uid: fUid, from_type: who.type, from_id: who.id, from_name: who.name,
      content, attachments: attachJson, created_at: t,
    };
    await db.tx(async () => {
      await db.run(
        'INSERT INTO feedback_messages (uid, from_type, from_id, from_name, content, attachments, created_at) VALUES (?,?,?,?,?,?,?)',
        fUid, who.type, who.id, who.name, content, attachJson, t);
      await writeSyncEvent(db, { tbl: 'feedback_messages', row_uid: fUid, op: 'upsert', snapshot: snap, origin: ORIGIN(c) });
    });

    // 发邮件（fire-and-forget，失败不阻断）
    const emailError = await sendFeedbackEmail(c, db, who, content, attachments).catch(e => e.message);

    return c.json({ ok: true, uid: fUid, ...(emailError ? { email_error: String(emailError) } : {}) });
  });

  // GET /feedback/remaining
  app.get('/feedback/remaining', async (c) => {
    const who = await identify(c);
    if (!who) return c.json({ ok: false, error: '未授权' }, 401);
    const db = c.get('db');
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const row = await db.get(
      'SELECT COUNT(*) AS c FROM feedback_messages WHERE from_type=? AND from_id=? AND created_at >= ?',
      who.type, who.id, todayStart.getTime());
    const used = row ? row.c : 0;
    return c.json({ ok: true, remaining: Math.max(0, 3 - used) });
  });

  // GET /feedback/list (super)
  app.get('/feedback/list', async (c) => {
    const me = await verifyUser(c);
    if (!me || me.role !== 'super') return c.json({ ok: false, error: '需要超级管理员权限' }, 403);
    const db = c.get('db');
    const rows = await db.all('SELECT * FROM feedback_messages ORDER BY created_at DESC LIMIT 200');
    return c.json({ ok: true, data: rows });
  });

  return app;
}

async function sendFeedbackEmail(c, db, who, content, attachments) {
  const apiKey = await getConfig(db, 'resend_api_key');
  if (!apiKey) return 'no resend key';
  const from = (await getConfig(db, 'resend_from')) || 'onboarding@resend.dev';
  const to = (await getConfig(db, 'rescue_email')) || 'admin@example.com';
  const storage = c.get('storage');
  const html = `
    <p>来自：<b>${who.name}</b>（${who.type === 'staff' ? '教师' : '设备'}）</p>
    <p>时间：${new Date().toLocaleString('zh-CN')}</p>
    <p>内容：</p>
    <p>${String(content || '').replace(/\n/g, '<br>') || '（无文字）'}</p>
    ${attachments.length ? '<p>附件：' + attachments.map(a => a.name).join('、') + '</p>' : ''}
  `;
  // 附件读 base64（最多 3 个，每个 ≤20MB 由前端保证）
  const resendAttachments = [];
  for (const a of attachments) {
    try {
      if (!a.url) continue;
      const key = a.url.replace(/^\/api\/file\//, '');
      const obj = await storage.get(key);
      if (!obj) continue;
      const buf = Buffer.from(await obj.arrayBuffer ? await obj.arrayBuffer() : obj.body);
      resendAttachments.push({
        filename: a.name || 'file',
        content: buf.toString('base64'),
        content_type: a.type || 'application/octet-stream',
      });
    } catch {}
  }
  const body = { from, to: [to], subject: '【班级积分】用户反馈', html };
  if (resendAttachments.length) body.attachments = resendAttachments;
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) return 'Resend ' + resp.status;
  return null;
}
