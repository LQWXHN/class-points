// v5.0 WxPusher 后台设置与回调路由
import { Hono } from 'hono';
import { verifyUser, getConfig, setConfig, now } from './_helpers.js';
import { createBindQrcode, handleCallback } from '../push/wxpusher.js';

export function wxpusherRoutes() {
  const app = new Hono();

  // 订阅回调（公开，WxPusher 服务端调用）
  app.post('/wxpusher/callback', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const r = await handleCallback(c.get('db'), body);
    return c.json(r);
  });

  // 状态查询：当前绑定情况 + 开关 + appToken 是否配置（不返回 token 本身）
  app.get('/wxpusher/status', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const staff = await db.all(
      "SELECT username, display_name, role, wxpusher_uid FROM admin_users WHERE deleted=0"
    );
    return c.json({
      ok: true,
      enabled: (await getConfig(db, 'wxpusher_enabled')) === '1',
      app_token_configured: !!(await getConfig(db, 'wxpusher_app_token')),
      front_channel: (await getConfig(db, 'chat_front_push_channel')) || 'browser',
      front_bound: !!(await getConfig(db, 'wxpusher_uid_front')),
      group_name: (await getConfig(db, 'chat_group_name')) || '二班群',
      me: { username: me.username, role: me.role, wxpusher_uid: (me.wxpusher_uid || '') },
      members: staff.map(s => ({
        member_key: s.username, name: s.display_name || s.username,
        role: s.role, bound: !!s.wxpusher_uid,
      })).concat([{
        member_key: 'front', name: (await getConfig(db, 'front_account_name')) || '二班学生',
        role: 'front', bound: !!(await getConfig(db, 'wxpusher_uid_front')),
      }]),
    });
  });

  // 更新设置：{enabled?, front_channel?, group_name?}；appToken 仅 super
  app.post('/wxpusher/settings', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const body = await c.req.json().catch(() => ({}));
    if (body.enabled !== undefined) {
      await setConfig(db, 'wxpusher_enabled', body.enabled ? '1' : '0');
    }
    if (body.front_channel !== undefined) {
      const ch = body.front_channel === 'wxpusher' ? 'wxpusher' : 'browser';
      await setConfig(db, 'chat_front_push_channel', ch);
    }
    if (body.group_name !== undefined) {
      await setConfig(db, 'chat_group_name', String(body.group_name || '').slice(0, 30) || '二班群');
    }
    // appToken 仅 super
    if (body.app_token !== undefined) {
      if (me.role !== 'super') return c.json({ ok: false, error: '仅超管可修改 AppToken' }, 403);
      await setConfig(db, 'wxpusher_app_token', String(body.app_token || '').trim());
    }
    return c.json({ ok: true });
  });

  // 为某成员（含自己）生成绑定二维码
  app.post('/wxpusher/bind-qrcode', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const body = await c.req.json().catch(() => ({}));
    let memberKey = body.member_key || me.username;
    // 安全：非 super 只能给自己绑
    if (me.role !== 'super' && memberKey !== me.username) {
      return c.json({ ok: false, error: '仅可绑定自己' }, 403);
    }
    const r = await createBindQrcode(c.get('db'), memberKey);
    return c.json(r);
  });

  // 解绑
  app.post('/wxpusher/unbind', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const body = await c.req.json().catch(() => ({}));
    let memberKey = body.member_key || me.username;
    if (me.role !== 'super' && memberKey !== me.username) {
      return c.json({ ok: false, error: '仅可解绑自己' }, 403);
    }
    const db = c.get('db');
    if (memberKey === 'front') {
      await setConfig(db, 'wxpusher_uid_front', '');
    } else {
      await db.run('UPDATE admin_users SET wxpusher_uid=?, updated_at=? WHERE username=?', '', now(), memberKey);
    }
    return c.json({ ok: true });
  });

  return app;
}
