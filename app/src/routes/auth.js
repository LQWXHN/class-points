import { Hono } from 'hono';
import {
  uid, now, genToken, hashPassword, getConfig, setConfig, getKv, setKv,
  clientIp, ua, logAudit, logLogin, notify, sendEmail, verifyUser, writeSyncEvent,
} from './_helpers.js';

export function authRoutes() {
  const app = new Hono();

  app.get('/auth/status', async (c) => {
    const db = c.get('db');
    const t = await db.get("SELECT password_hash FROM admin_users WHERE username='teacher'");
    const a = await db.get("SELECT password_hash FROM admin_users WHERE username='admin'");
    return c.json({
      ok: true,
      hasTeacherPassword: !!(t && t.password_hash),
      hasAdminPassword: !!(a && a.password_hash),
    });
  });

  app.post('/auth/setup', async (c) => {
    const db = c.get('db');
    const { username, password } = await c.req.json().catch(() => ({}));
    if (!username || !password || String(password).length < 4)
      return c.json({ ok: false, error: '用户名和密码不能为空，密码至少4位' }, 400);
    const u = await db.get('SELECT * FROM admin_users WHERE username = ?', username);
    if (!u) return c.json({ ok: false, error: '账户不存在' }, 400);
    if (u.password_hash) return c.json({ ok: false, error: '该账户密码已设置' }, 400);
    const salt = genToken(16);
    const hash = await hashPassword(String(password), salt);
    const t = now();
    await db.run('UPDATE admin_users SET password_hash=?, password_salt=?, updated_at=? WHERE username=?',
      hash, salt, t, username);
    const uRow = await db.get('SELECT * FROM admin_users WHERE username=?', username);
    await writeSyncEvent(db, { tbl: 'admin_users', row_uid: uRow.uid, op: 'upsert', snapshot: uRow });
    return c.json({ ok: true });
  });

  app.post('/auth/login', async (c) => {
    const db = c.get('db');
    const { username, password } = await c.req.json().catch(() => ({}));
    const ip = clientIp(c); const u = ua(c);
    const since = now() - 5 * 60 * 1000;
    const failRow = await db.get(
      'SELECT COUNT(*) AS c FROM login_attempts WHERE ip=? AND username=? AND success=0 AND created_at >= ?',
      ip, username || '', since);
    if (failRow && failRow.c >= 5)
      return c.json({ ok: false, error: '尝试过于频繁，请 5 分钟后再试' }, 429);

    const user = username ? await db.get('SELECT * FROM admin_users WHERE username=? AND deleted=0', username) : null;
    if (!user) {
      await db.run('INSERT INTO login_attempts (username, ip, success, created_at) VALUES (?,?,?,?)', username || '', ip, 0, now());
      await logLogin(db, { username: username || '', role: '', ip, ua: u, success: false });
      return c.json({ ok: false, error: '账户不存在' }, 401);
    }
    if (!user.password_hash)
      return c.json({ ok: false, error: 'need_setup', needSetup: true, username });

    const inputHash = await hashPassword(String(password || ''), user.password_salt);
    if (inputHash !== user.password_hash) {
      await db.run('INSERT INTO login_attempts (username, ip, success, created_at) VALUES (?,?,?,?)', username, ip, 0, now());
      await logLogin(db, { username, role: user.role, ip, ua: u, success: false });
      return c.json({ ok: false, error: '密码错误' }, 401);
    }

    await db.run('INSERT INTO login_attempts (username, ip, success, created_at) VALUES (?,?,?,?)', username, ip, 1, now());
    const token = genToken(32);
    const expires = now() + 7 * 86400000;
    await db.run('INSERT INTO sessions (token, username, role, ip, ua, created_at, expires_at) VALUES (?,?,?,?,?,?,?)',
      token, user.username, user.role, ip, u, now(), expires);
    await db.run('UPDATE admin_users SET last_login=? WHERE username=?', now(), user.username);
    await logLogin(db, { username, role: user.role, ip, ua: u, success: true });
    await notify(db, 'login', '【班级积分系统】登录提醒',
      `<p>账户：<b>${user.username}</b>（${user.role === 'super' ? '超级管理员' : '班主任'}）</p>
       <p>时间：${new Date().toLocaleString('zh-CN')}</p>
       <p>IP：${ip}</p>
       <p>登录方式：账号密码</p>
       <p>设备：${u}</p>`);
    return c.json({ ok: true, token, role: user.role, display_name: user.display_name });
  });

  app.post('/auth/change-password', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const { newPassword } = await c.req.json().catch(() => ({}));
    if (!newPassword || String(newPassword).length < 4)
      return c.json({ ok: false, error: '密码至少4位' }, 400);
    const salt = genToken(16);
    const hash = await hashPassword(String(newPassword), salt);
    const t = now();
    await db.run('UPDATE admin_users SET password_hash=?, password_salt=?, updated_at=? WHERE username=?',
      hash, salt, t, me.username);
    const uRow = await db.get('SELECT * FROM admin_users WHERE username=?', me.username);
    await writeSyncEvent(db, { tbl: 'admin_users', row_uid: uRow.uid, op: 'upsert', snapshot: uRow });
    await logAudit(db, me.username, 'change_password', me.username, '', clientIp(c));
    return c.json({ ok: true });
  });

  app.post('/auth/send-code', async (c) => {
    const db = c.get('db');
    const { email } = await c.req.json().catch(() => ({}));
    const rescueEmail = await getConfig(db, 'rescue_email');
    if (!rescueEmail) return c.json({ ok: false, error: '邮件服务未配置，请联系管理员' }, 400);
    if (!email || email !== rescueEmail) return c.json({ ok: false, error: '邮箱不匹配' }, 400);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await setKv(db, `verify_code:${email}`, JSON.stringify({ code, exp: now() + 300000 }));
    const sent = await sendEmail(db, email, '【班级积分系统】密码重置验证码',
      `<div style="font-family:sans-serif;padding:20px;">
         <h2>您的验证码是：<span style="font-size:28px;letter-spacing:4px;">${code}</span></h2>
         <p style="color:#666;">5 分钟内有效，请勿泄露。</p>
       </div>`);
    if (!sent) return c.json({ ok: false, error: '邮件发送失败，请稍后再试' }, 500);
    return c.json({ ok: true, msg: '验证码已发送到邮箱' });
  });

  app.post('/auth/reset-password', async (c) => {
    const db = c.get('db');
    const { username, email, code, newPassword } = await c.req.json().catch(() => ({}));
    if (!newPassword || String(newPassword).length < 4)
      return c.json({ ok: false, error: '密码至少4位' }, 400);
    const rescueEmail = await getConfig(db, 'rescue_email');
    if (!rescueEmail || email !== rescueEmail) return c.json({ ok: false, error: '邮箱不匹配' }, 400);
    const storedRaw = await getKv(db, `verify_code:${email}`);
    let stored = null;
    try { stored = storedRaw && JSON.parse(storedRaw); } catch {}
    if (!stored || stored.exp < now() || stored.code !== code)
      return c.json({ ok: false, error: '验证码错误或已过期' }, 400);
    await db.run('DELETE FROM kv_meta WHERE key=?', `verify_code:${email}`);
    const u = await db.get('SELECT * FROM admin_users WHERE username=? AND deleted=0', username || 'teacher');
    if (!u) return c.json({ ok: false, error: '账户不存在' }, 400);
    const salt = genToken(16);
    const hash = await hashPassword(String(newPassword), salt);
    const t = now();
    await db.run('UPDATE admin_users SET password_hash=?, password_salt=?, updated_at=? WHERE username=?',
      hash, salt, t, u.username);
    const uRow = await db.get('SELECT * FROM admin_users WHERE username=?', u.username);
    await writeSyncEvent(db, { tbl: 'admin_users', row_uid: uRow.uid, op: 'upsert', snapshot: uRow });
    return c.json({ ok: true });
  });

  // GET /auth/me
  app.get('/auth/me', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const row = await db.get('SELECT username, role, display_name, avatar FROM admin_users WHERE username=? AND deleted=0', me.username);
    if (!row) return c.json({ ok: false, error: '账户不存在' }, 404);
    return c.json({ ok: true, data: {
      username: row.username, role: row.role,
      display_name: row.display_name || row.username, avatar: row.avatar || '',
    }});
  });

  // PUT /auth/profile  {display_name?, avatar?}
  app.put('/auth/profile', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const body = await c.req.json().catch(() => ({}));
    const t = now();
    let displayName = me.display_name;
    let avatar = null;
    if (body.display_name !== undefined) {
      displayName = String(body.display_name || '').trim().slice(0, 12);
      if (!displayName) return c.json({ ok: false, error: '昵称不能为空' }, 400);
    }
    if (body.avatar !== undefined) {
      avatar = String(body.avatar || '');
      if (avatar) {
        // dataURL 校验：image/png|jpeg|webp 且 ≤200KB
        const m = avatar.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
        if (!m) return c.json({ ok: false, error: '头像仅支持 png/jpeg/webp 格式' }, 400);
        const bytes = Buffer.from(m[2], 'base64');
        if (bytes.length > 200 * 1024) return c.json({ ok: false, error: '头像大小超过 200KB' }, 400);
      }
    }
    if (avatar !== null) {
      await db.run('UPDATE admin_users SET display_name=?, avatar=?, updated_at=? WHERE username=?', displayName, avatar, t, me.username);
    } else {
      await db.run('UPDATE admin_users SET display_name=?, updated_at=? WHERE username=?', displayName, t, me.username);
    }
    const uRow = await db.get('SELECT * FROM admin_users WHERE username=?', me.username);
    await writeSyncEvent(db, { tbl: 'admin_users', row_uid: uRow.uid, op: 'upsert', snapshot: uRow });
    return c.json({ ok: true, data: {
      username: uRow.username, role: uRow.role,
      display_name: uRow.display_name || uRow.username, avatar: uRow.avatar || '',
    }});
  });

  return app;
}
