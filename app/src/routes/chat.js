// v5.2 群聊路由（/api/chat）：单群，front + staff(teacher/admin) 三账号
// 鉴权：staff=Bearer；front=X-Device-Token
import { Hono } from 'hono';
import { uid, now, verifyUser, verifyDevice, getConfig, setConfig, writeSyncEvent } from './_helpers.js';
import { pushChatMessage } from '../push/wxpusher.js';

async function authChat(c) {
  const db = c.get('db');
  let dev = await verifyDevice(c);
  if (!dev) {
    const dt = c.req.query('dt');
    if (dt) {
      dev = await db.get('SELECT * FROM device_tokens WHERE token = ? AND deleted = 0', dt);
    }
  }
  if (dev) {
    const name = (await getConfig(db, 'front_account_name')) || '二班学生';
    const avatar = (await getConfig(db, 'front_account_avatar')) || '👦';
    const wxpusher_uid = (await getConfig(db, 'wxpusher_uid_front')) || '';
    return { member_key: 'front', name, avatar, wxpusher_uid, role: 'front', is_staff: false, device: dev };
  }
  const me = await verifyUser(c);
  if (me) {
    const row = await db.get('SELECT avatar, wxpusher_uid FROM admin_users WHERE username=? AND deleted=0', me.username);
    return {
      member_key: me.username,
      name: me.display_name || me.username,
      avatar: (row && row.avatar) || '',
      wxpusher_uid: (row && row.wxpusher_uid) || '',
      role: me.role,
      is_staff: true,
    };
  }
  return null;
}

async function listMembers(db) {
  const staffRows = await db.all(
    "SELECT username, display_name, role, avatar FROM admin_users WHERE deleted=0 ORDER BY role='super' DESC, username"
  );
  const frontName = (await getConfig(db, 'front_account_name')) || '二班学生';
  const frontAvatar = (await getConfig(db, 'front_account_avatar')) || '👦';
  const reads = await db.all('SELECT * FROM chat_reads');
  const readMap = new Map(reads.map(r => [r.member_key, r]));
  const members = [];
  members.push({
    member_key: 'front',
    name: frontName,
    avatar: frontAvatar,
    role: 'front',
    last_read_id: (readMap.get('front') || {}).last_read_id || 0,
    last_read_at: (readMap.get('front') || {}).last_read_at || 0,
  });
  for (const s of staffRows) {
    const r = readMap.get(s.username) || {};
    members.push({
      member_key: s.username,
      name: s.display_name || s.username,
      avatar: s.avatar || '',
      role: s.role,
      last_read_id: r.last_read_id || 0,
      last_read_at: r.last_read_at || 0,
    });
  }
  return members;
}

async function latestNotice(db) {
  const row = await db.get(
    "SELECT * FROM chat_notices WHERE deleted=0 ORDER BY id DESC LIMIT 1"
  );
  return row || null;
}

async function shapeMsg(db, m, favoriteSet) {
  let reply = { deleted: 1 };
  if (m.reply_to) {
    const r = await db.get(
      "SELECT uid, sender_name, msg_type, content, recalled, deleted FROM chat_messages WHERE uid=?",
      m.reply_to
    );
    if (r && !r.deleted) {
      reply = {
        uid: r.uid, sender_name: r.sender_name, msg_type: r.msg_type,
        content: r.content, recalled: r.recalled, deleted: 0,
      };
    }
  }
  let attachments = [];
  try { attachments = JSON.parse(m.attachments || '[]'); } catch {}
  return {
    id: m.id, uid: m.uid,
    sender_key: m.sender_key, sender_name: m.sender_name, sender_avatar: m.sender_avatar,
    msg_type: m.msg_type, content: m.content, attachments,
    reply_to: m.reply_to, reply,
    recalled: m.recalled, deleted: m.deleted,
    created_at: m.created_at, updated_at: m.updated_at,
    is_favorite: favoriteSet ? favoriteSet.has(m.uid) : false,
  };
}

export function chatRoutes() {
  const app = new Hono();

  app.get('/chat/context', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const members = await listMembers(db);
    const notice = await latestNotice(db);
    const groupName = (await getConfig(db, 'chat_group_name')) || '二班群';
    const myRead = await db.get('SELECT * FROM chat_reads WHERE member_key=?', me.member_key);
    const favRows = await db.all('SELECT msg_uid FROM chat_favorites WHERE member_key=?', me.member_key);
    return c.json({
      ok: true,
      group_name: groupName,
      notice: notice ? {
        uid: notice.uid, content: notice.content, author: notice.author,
        created_at: notice.created_at, updated_at: notice.updated_at,
      } : null,
      members,
      me: { member_key: me.member_key, name: me.name, avatar: me.avatar, role: me.role },
      my_last_read_id: myRead ? myRead.last_read_id : 0,
      my_last_read_at: myRead ? myRead.last_read_at : 0,
      favorites: favRows.map(r => r.msg_uid),
    });
  });

  app.get('/chat/messages', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const before = Number(c.req.query('before') || 0);
    const limit = Math.min(Math.max(Number(c.req.query('limit') || 50), 1), 200);
    let rows;
    if (before > 0) {
      rows = await db.all(
        'SELECT * FROM chat_messages WHERE deleted=0 AND id < ? ORDER BY id DESC LIMIT ?',
        before, limit
      );
    } else {
      rows = await db.all(
        'SELECT * FROM chat_messages WHERE deleted=0 ORDER BY id DESC LIMIT ?', limit
      );
    }
    rows.reverse();
    const favSet = new Set((await db.all(
      'SELECT msg_uid FROM chat_favorites WHERE member_key=?', me.member_key
    )).map(r => r.msg_uid));
    const shaped = [];
    for (const m of rows) shaped.push(await shapeMsg(db, m, favSet));
    const members = await listMembers(db);
    return c.json({ ok: true, messages: shaped, members });
  });

  app.get('/chat/new', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const after = Number(c.req.query('after') || 0);
    const rows = await db.all(
      'SELECT * FROM chat_messages WHERE deleted=0 AND id > ? ORDER BY id ASC LIMIT 200',
      after
    );
    const favSet = new Set((await db.all(
      'SELECT msg_uid FROM chat_favorites WHERE member_key=?', me.member_key
    )).map(r => r.msg_uid));
    const shaped = [];
    for (const m of rows) shaped.push(await shapeMsg(db, m, favSet));
    return c.json({ ok: true, messages: shaped });
  });

  app.get('/chat/search', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const q = (c.req.query('q') || '').trim();
    if (!q) return c.json({ ok: true, messages: [], total: 0 });
    const page = Math.max(Number(c.req.query('page') || 1), 1);
    const limit = 30;
    const offset = (page - 1) * limit;
    const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%';
    const rows = await db.all(
      `SELECT * FROM chat_messages
       WHERE deleted=0 AND (content LIKE ? ESCAPE '\\' OR sender_name LIKE ? ESCAPE '\\' OR attachments LIKE ? ESCAPE '\\')
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      like, like, like, limit, offset
    );
    const totalRow = await db.get(
      `SELECT COUNT(*) AS c FROM chat_messages
       WHERE deleted=0 AND (content LIKE ? ESCAPE '\\' OR sender_name LIKE ? ESCAPE '\\' OR attachments LIKE ? ESCAPE '\\')`,
      like, like, like
    );
    return c.json({
      ok: true,
      messages: rows.map(m => ({
        id: m.id, uid: m.uid, sender_name: m.sender_name,
        msg_type: m.msg_type, content: m.content,
        attachments: (() => { try { return JSON.parse(m.attachments || '[]'); } catch { return []; } })(),
        created_at: m.created_at, recalled: m.recalled,
      })),
      total: (totalRow && totalRow.c) || 0,
      page,
    });
  });

  app.post('/chat/messages', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const body = await c.req.json().catch(() => ({}));
    const msgType = ['text', 'image', 'file'].includes(body.msg_type) ? body.msg_type : 'text';
    const content = String(body.content || '').slice(0, 4000);
    let attachments = [];
    if (Array.isArray(body.attachments)) {
      attachments = body.attachments.slice(0, 10).map(a => ({
        name: String(a.name || ''),
        size: Number(a.size || 0),
        type: String(a.type || ''),
        url: String(a.url || ''),
      }));
    }
    const LIMIT = 600 * 1024 * 1024;
    for (const a of attachments) {
      if (a.size > LIMIT) return c.json({ ok: false, error: '单个文件不能超过 600MB' }, 400);
    }
    const replyTo = String(body.reply_to || '').slice(0, 64);
    const t = now();
    const msgUid = uid();
    const senderName = me.name;
    await db.run(
      `INSERT INTO chat_messages (uid, sender_key, sender_name, sender_avatar, msg_type, content, attachments, reply_to, recalled, created_at, updated_at, deleted)
       VALUES (?,?,?,?,?,?,?,?,0,?,?,0)`,
      msgUid, me.member_key, senderName, me.avatar || '', msgType, content,
      JSON.stringify(attachments), replyTo, t, t
    );
    const row = await db.get('SELECT * FROM chat_messages WHERE uid=?', msgUid);
    await writeSyncEvent(db, {
      tbl: 'chat_messages', row_uid: msgUid, op: 'upsert',
      snapshot: {
        uid: msgUid, sender_key: me.member_key, sender_name: senderName,
        sender_avatar: me.avatar || '', msg_type: msgType, content, attachments,
        reply_to: replyTo, recalled: 0, created_at: t, updated_at: t, deleted: 0,
      },
    });
    const shaped = await shapeMsg(db, row, null);
    const { pickPublicOnline } = await import('../sites-health.js');
    const origin = pickPublicOnline() || (c.req.header('Origin') || (c.req.header('Referer') ? new URL(c.req.header('Referer')).origin : '')) || '';
    pushChatMessage(db, shaped, me.member_key, { origin }).catch(e => console.error('[wxpush]', e.message));
    return c.json({ ok: true, message: shaped });
  });

  app.post('/chat/read', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const body = await c.req.json().catch(() => ({}));
    const afterId = Math.max(Number(body.after_id || 0), 0);
    const t = now();
    await db.run(
      `INSERT INTO chat_reads (member_key, last_read_id, last_read_at, updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(member_key) DO UPDATE SET last_read_id=MAX(?, chat_reads.last_read_id), last_read_at=?, updated_at=?`,
      me.member_key, afterId, t, t, afterId, t, t
    );
    await writeSyncEvent(db, {
      tbl: 'chat_reads', row_uid: me.member_key, op: 'upsert',
      snapshot: { member_key: me.member_key, last_read_id: afterId, last_read_at: t, updated_at: t },
    });
    return c.json({ ok: true });
  });

  app.post('/chat/messages/:uid/recall', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const msgUid = c.req.param('uid');
    const row = await db.get('SELECT * FROM chat_messages WHERE uid=? AND deleted=0', msgUid);
    if (!row) return c.json({ ok: false, error: '消息不存在' }, 404);
    const isOwner = row.sender_key === me.member_key;
    const isStaff = !!me.is_staff;
    if (!isOwner && !isStaff) return c.json({ ok: false, error: '无权撤回' }, 403);
    if (isOwner && !isStaff && (now() - row.created_at) > 2 * 60 * 1000) {
      return c.json({ ok: false, error: '超过 2 分钟，无法撤回' }, 400);
    }
    const t = now();
    await db.run('UPDATE chat_messages SET recalled=1, updated_at=? WHERE uid=?', t, msgUid);
    await writeSyncEvent(db, {
      tbl: 'chat_messages', row_uid: msgUid, op: 'upsert',
      snapshot: { ...row, recalled: 1, updated_at: t },
    });
    return c.json({ ok: true });
  });

  app.get('/chat/favorites', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const rows = await db.all(
      `SELECT m.* FROM chat_favorites f JOIN chat_messages m ON m.uid = f.msg_uid
       WHERE f.member_key=? AND m.deleted=0 ORDER BY f.created_at DESC LIMIT 200`,
      me.member_key
    );
    return c.json({ ok: true, messages: await Promise.all(rows.map(m => shapeMsg(db, m, null))) });
  });
  app.post('/chat/favorites', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const body = await c.req.json().catch(() => ({}));
    const msgUid = String(body.msg_uid || '');
    if (!msgUid) return c.json({ ok: false, error: '缺少 msg_uid' }, 400);
    await db.run(
      'INSERT OR IGNORE INTO chat_favorites (member_key, msg_uid, created_at) VALUES (?,?,?)',
      me.member_key, msgUid, now()
    );
    await writeSyncEvent(db, {
      tbl: 'chat_favorites', row_uid: me.member_key + ':' + msgUid, op: 'upsert',
      snapshot: { member_key: me.member_key, msg_uid: msgUid, created_at: now() },
    });
    return c.json({ ok: true });
  });
  app.delete('/chat/favorites/:msg_uid', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const msgUid = c.req.param('msg_uid');
    await db.run('DELETE FROM chat_favorites WHERE member_key=? AND msg_uid=?', me.member_key, msgUid);
    return c.json({ ok: true });
  });

  app.get('/chat/notice', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const row = await latestNotice(c.get('db'));
    return c.json({ ok: true, notice: row ? {
      uid: row.uid, content: row.content, author: row.author,
      created_at: row.created_at, updated_at: row.updated_at,
    } : null });
  });
  app.post('/chat/notice', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    if (!me.is_staff) return c.json({ ok: false, error: '仅老师可编辑公告' }, 403);
    const db = c.get('db');
    const body = await c.req.json().catch(() => ({}));
    const content = String(body.content || '').slice(0, 2000);
    const t = now();
    const nUid = uid();
    await db.run(
      'INSERT INTO chat_notices (uid, content, author, created_at, updated_at, deleted) VALUES (?,?,?,?,?,0)',
      nUid, content, me.name, t, t
    );
    await writeSyncEvent(db, {
      tbl: 'chat_notices', row_uid: nUid, op: 'upsert',
      snapshot: { uid: nUid, content, author: me.name, created_at: t, updated_at: t, deleted: 0 },
    });
    const { pickPublicOnline } = await import('../sites-health.js');
    const origin = pickPublicOnline() || (c.req.header('Origin') || '');
    const { pushNotice } = await import('../push/wxpusher.js');
    pushNotice(db, me.name, content, me.member_key, { origin }).catch(e => console.error('[wxpush notice]', e.message));
    return c.json({ ok: true, notice: { uid: nUid, content, author: me.name, created_at: t } });
  });

  app.get('/admin/sites-health', async (c) => {
    const me = await verifyUser(c);
    if (!me || me.role !== 'super') return c.json({ ok: false, error: '需要超管权限' }, 403);
    const { getSiteHealth } = await import('../sites-health.js');
    return c.json({ ok: true, health: getSiteHealth() });
  });

  app.get('/chat/unread-count', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const last = await db.get('SELECT MAX(id) AS mid FROM chat_messages WHERE deleted=0');
    const mid = (last && last.mid) || 0;
    const read = await db.get('SELECT last_read_id FROM chat_reads WHERE member_key=?', me.member_key);
    const lrid = (read && read.last_read_id) || 0;
    const cnt = await db.get(
      'SELECT COUNT(*) AS c FROM chat_messages WHERE id > ? AND deleted=0 AND sender_key != ?',
      lrid, me.member_key
    );
    const lastMsg = await db.get(
      "SELECT sender_name, msg_type, content, attachments, recalled FROM chat_messages WHERE deleted=0 ORDER BY id DESC LIMIT 1"
    );
    let preview = '';
    if (lastMsg) {
      if (lastMsg.recalled) preview = (lastMsg.sender_name || '有人') + '撤回了一条消息';
      else if (lastMsg.msg_type === 'image') preview = '[图片]';
      else if (lastMsg.msg_type === 'file') {
        try { const a = JSON.parse(lastMsg.attachments || '[]')[0]; preview = '[文件] ' + (a && a.name || ''); }
        catch { preview = '[文件]'; }
      } else {
        let t = lastMsg.content || '';
        t = t.replace(/\[face:(?:wx|qq):[^\]]+\]/g, '[表情]');
        preview = t.length > 20 ? t.slice(0, 20) + '…' : t;
      }
    }
    return c.json({ ok: true, count: (cnt && cnt.c) || 0, last_id: mid, preview, last_sender: (lastMsg && lastMsg.sender_name) || '' });
  });

  app.get('/chat/files', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const rows = await db.all(
      `SELECT * FROM chat_messages WHERE msg_type='file' AND recalled=0 AND deleted=0 ORDER BY id DESC LIMIT 200`
    );
    const files = [];
    for (const m of rows) {
      let atts = [];
      try { atts = JSON.parse(m.attachments || '[]'); } catch {}
      for (const a of atts) {
        files.push({
          msg_uid: m.uid, name: a.name, size: a.size, type: a.type, url: a.url,
          sender_name: m.sender_name, created_at: m.created_at,
        });
      }
    }
    return c.json({ ok: true, files });
  });

  // v5.2: 前台资料编辑（设备 token 鉴权）
  app.post('/chat/front-profile', async (c) => {
    const me = await authChat(c);
    if (!me || me.member_key !== 'front') return c.json({ ok: false, error: '需要前台设备登录' }, 401);
    const db = c.get('db');
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || '').slice(0, 50);
    const avatar = String(body.avatar || '').slice(0, 500);
    if (name) await setConfig(db, 'front_account_name', name);
    if (avatar) await setConfig(db, 'front_account_avatar', avatar);
    return c.json({ ok: true, name: name || (await getConfig(db, 'front_account_name')), avatar: avatar || (await getConfig(db, 'front_account_avatar')) });
  });

  // v5.2: 自定义表情包
  app.get('/chat/stickers', async (c) => {
    const db = c.get('db');
    const raw = await getConfig(db, 'custom_stickers');
    let list = [];
    try { list = JSON.parse(raw || '[]'); } catch {}
    return c.json({ ok: true, stickers: list });
  });
  app.post('/chat/stickers', async (c) => {
    const me = await verifyUser(c);
    if (!me || (me.role !== 'teacher' && me.role !== 'super')) return c.json({ ok: false, error: '仅老师可添加' }, 403);
    const db = c.get('db');
    const body = await c.req.json().catch(() => ({}));
    const url = String(body.url || '').slice(0, 500);
    const name = String(body.name || '').slice(0, 50);
    if (!url) return c.json({ ok: false, error: '缺少 url' }, 400);
    const raw = await getConfig(db, 'custom_stickers');
    let list = [];
    try { list = JSON.parse(raw || '[]'); } catch {}
    list.push({ url, name: name || url });
    await setConfig(db, 'custom_stickers', JSON.stringify(list));
    return c.json({ ok: true, stickers: list });
  });
  app.delete('/chat/stickers', async (c) => {
    const me = await verifyUser(c);
    if (!me || (me.role !== 'teacher' && me.role !== 'super')) return c.json({ ok: false, error: '仅老师可删除' }, 403);
    const db = c.get('db');
    const body = await c.req.json().catch(() => ({}));
    const url = String(body.url || '');
    const raw = await getConfig(db, 'custom_stickers');
    let list = [];
    try { list = JSON.parse(raw || '[]'); } catch {}
    list = list.filter(s => s.url !== url);
    await setConfig(db, 'custom_stickers', JSON.stringify(list));
    return c.json({ ok: true, stickers: list });
  });

  return app;
}
