// v5.0 群聊路由（/api/chat）：单群，front + staff(teacher/admin) 三账号
// 鉴权：staff=Bearer；front=X-Device-Token；member_key front='front'，staff=username
// SSE 在 node 主站内存广播；worker 端由 worker.js 反代到主站
import { Hono } from 'hono';
import { uid, now, verifyUser, verifyDevice, getConfig, writeSyncEvent } from './_helpers.js';
import { pushChatMessage } from '../push/wxpusher.js';

// ---------- SSE hub（node 内存；worker 端不实现 SSE，前端走轮询） ----------
const sseClients = new Set(); // { member_key, controller, heartbeat }

function sseBroadcast(event, data, excludeMemberKey = '') {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const cl of sseClients) {
    if (cl.member_key === excludeMemberKey) continue;
    try { cl.controller.enqueue(new TextEncoder().encode(payload)); } catch {}
  }
}

async function authChat(c) {
  // 1) Bearer / header 优先
  const me = await verifyUser(c);
  if (me) {
    // 补 avatar / wxpusher_uid
    const db = c.get('db');
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
  // 2) front：header 或 query ?dt= 设备 token（EventSource 不支持自定义头）
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
  // 3) staff：query ?t=<token>（SSE 用）
  const qt = c.req.query('t');
  if (qt) {
    await db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
    const row = await db.get(
      `SELECT s.username, s.role, COALESCE(a.display_name,'') AS display_name, a.avatar, a.wxpusher_uid
       FROM sessions s LEFT JOIN admin_users a ON a.username=s.username
       WHERE s.token=?`, qt);
    if (row) {
      return {
        member_key: row.username,
        name: row.display_name || row.username,
        avatar: row.avatar || '',
        wxpusher_uid: row.wxpusher_uid || '',
        role: row.role,
        is_staff: true,
      };
    }
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

// 构造消息返回对象（带 reply 快照 + read_count）
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
  // read_count: 其他成员 last_read_at >= m.created_at 的数量
  const row = await db.get(
    `SELECT COUNT(*) AS c FROM chat_reads WHERE member_key != ? AND last_read_at >= ?`,
    m.sender_key, m.created_at
  );
  let attachments = [];
  try { attachments = JSON.parse(m.attachments || '[]'); } catch {}
  return {
    id: m.id, uid: m.uid,
    sender_key: m.sender_key, sender_name: m.sender_name, sender_avatar: m.sender_avatar,
    msg_type: m.msg_type, content: m.content, attachments,
    reply_to: m.reply_to, reply,
    recalled: m.recalled, deleted: m.deleted,
    created_at: m.created_at, updated_at: m.updated_at,
    read_count: (row && row.c) || 0,
    is_favorite: favoriteSet ? favoriteSet.has(m.uid) : false,
  };
}

export function chatRoutes() {
  const app = new Hono();

  // 上下文：成员 + 群名 + 公告 + me + 未读起点 + 我收藏的 msg_uid 列表
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

  // 历史分页：?before=<id>&limit=50；返回升序数组（id < before 的最近 limit 条）
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
    rows.reverse(); // 升序返回
    const favSet = new Set((await db.all(
      'SELECT msg_uid FROM chat_favorites WHERE member_key=?', me.member_key
    )).map(r => r.msg_uid));
    const shaped = [];
    for (const m of rows) shaped.push(await shapeMsg(db, m, favSet));
    const members = await listMembers(db);
    return c.json({ ok: true, messages: shaped, members });
  });

  // 增量轮询：?after=<id>；返回 id > after 的升序数组
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

  // 搜索：?q=关键字&page=1；按 content / sender_name / 文件名 LIKE
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

  // 发消息：{msg_type, content, attachments, reply_to}
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
    // 单文件 ≤ 600MB（前端上传时已拦截；这里兜底）
    const LIMIT = 600 * 1024 * 1024;
    for (const a of attachments) {
      if (a.size > LIMIT) return c.json({ ok: false, error: '单个文件不能超过 600MB' }, 400);
    }
    const replyTo = String(body.reply_to || '').slice(0, 64);
    const t = now();
    const msgUid = uid();
    const senderName = me.member_key === 'front' ? me.name : me.name;
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
    sseBroadcast('message', shaped, me.member_key);
    // 推送（WxPusher）：异步，不阻塞响应；origin 来自请求（不写死域名）
    const origin = new URL(c.req.url, 'http://x').origin === 'http://x'
      ? (new URL(c.req.url)).origin || ''
      : (c.req.header('Origin') || new URL(c.req.url, c.req.header('Referer') || 'http://localhost').origin);
    pushChatMessage(db, shaped, me.member_key, { origin }).catch(e => console.error('[wxpush]', e.message));
    return c.json({ ok: true, message: shaped });
  });

  // 已读上报：{after_id}；upsert 自己的阅读位（front 共享一条）
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
    sseBroadcast('read', { member_key: me.member_key, last_read_id: afterId, last_read_at: t });
    return c.json({ ok: true });
  });

  // 撤回：本人 2 分钟内；staff 不限
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
    sseBroadcast('recall', { uid: msgUid, recalled: 1 });
    return c.json({ ok: true });
  });

  // 收藏：GET 列表 / POST 添加 / DELETE 取消（按 member_key 隔离）
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

  // 群公告：GET 最新一条；POST 仅 staff
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
    sseBroadcast('notice', { uid: nUid, content, author: me.name, created_at: t });
    return c.json({ ok: true, notice: { uid: nUid, content, author: me.name, created_at: t } });
  });

  // 未读数：last_read_id < 最大消息 id 的数量
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
    return c.json({ ok: true, count: (cnt && cnt.c) || 0, last_id: mid });
  });

  // 群文件：msg_type=file AND recalled=0 AND deleted=0
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

  // SSE 流（仅 node 主站；worker 端由 worker.js 反代到主站）
  app.get('/chat/stream', async (c) => {
    const me = await authChat(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const body = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(`event: hello\ndata: ${JSON.stringify({ ok: true, member_key: me.member_key })}\n\n`));
        const cl = { member_key: me.member_key, controller };
        sseClients.add(cl);
        const hb = setInterval(() => {
          try { controller.enqueue(enc.encode(`event: ping\ndata: {}\n\n`)); } catch {}
        }, 25000);
        cl.hb = hb;
      },
      cancel() {
        for (const cl of sseClients) {
          if (cl.controller === controller) {
            if (cl.hb) clearInterval(cl.hb);
            sseClients.delete(cl);
          }
        }
      },
    });
    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });

  return app;
}
