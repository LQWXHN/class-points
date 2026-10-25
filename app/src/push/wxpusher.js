// v5.0 WxPusher 推送：发消息、带参二维码、订阅回调绑定
// 文档：https://wxpusher.zjiecode.com/docs/
// 频控：同成员 30 秒内多条合并为一条（内存 map，node 进程内）
import { getConfig, setConfig } from '../routes/_helpers.js';

const WX_BASE = 'https://wxpusher.zjiecode.com';

// 频控缓冲：key=uid, value={uid, textParts, atMs, url, summary}
const pending = new Map();

function memberUrl(origin, member) {
  if (!origin) return '';
  if (member.role === 'super') return origin + '/chat/admin';
  if (member.role === 'teacher') return origin + '/chat/teacher';
  return origin + '/chat';
}

function enqueuePush(member, text, url, summaryOverride) {
  const existing = pending.get(member.uid);
  if (existing) {
    existing.textParts.push(text);
    if (url) existing.url = url;
    return;
  }
  const buf = { uid: member.uid, textParts: [text], atMs: Date.now(), url: url || '', summaryOverride: summaryOverride || '' };
  pending.set(member.uid, buf);
  setTimeout(() => {
    pending.delete(member.uid);
    const multi = buf.textParts.length > 1;
    const summary = multi ? '【班级积分系统】' + buf.textParts.length + ' 条新消息' : (buf.summaryOverride || '【班级积分系统】新消息');
    sendWxMessageRaw(buf.uid, buf.textParts.join('\n'), buf.url, summary).catch(() => {});
  }, 30 * 1000);
}

async function sendWxMessageRaw(uid, content, url, summary) {
  const appToken = globalThis.__WX_APP_TOKEN || '';
  if (!appToken || !uid || !content) return;
  try {
    const body = {
      appToken,
      content_type: 1,
      uids: [uid],
      content,
      summary: summary || '【班级积分系统】新消息',
    };
    if (url) body.url = url;
    const resp = await fetch(`${WX_BASE}/api/send/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) console.error('[wxpusher send]', await resp.text());
  } catch (e) { console.error('[wxpusher send]', e.message); }
}

export async function pushChatMessage(db, msg, senderKey, opts) {
  opts = opts || {};
  if (!(await isEnabled(db))) return;
  const appToken = await getAppToken(db);
  if (!appToken) return;
  globalThis.__WX_APP_TOKEN = appToken;
  const members = await fetchMemberUids(db, senderKey);
  if (!members.length) return;
  const summary = summarize(msg);
  const text = `${msg.sender_name || '有人'}给你发了消息：${summary}`;
  for (const m of members) enqueuePush(m, text, memberUrl(opts.origin || '', m));
}

// v5.1：群公告变更推送（复用频控）
export async function pushNotice(db, authorName, content, senderKey, opts) {
  opts = opts || {};
  if (!(await isEnabled(db))) return;
  const appToken = await getAppToken(db);
  if (!appToken) return;
  globalThis.__WX_APP_TOKEN = appToken;
  const members = await fetchMemberUids(db, senderKey);
  if (!members.length) return;
  const summary = content.length > 60 ? content.slice(0, 60) + '…' : content;
  const text = `${authorName}更新了群公告：${summary}`;
  for (const m of members) enqueuePush(m, text, memberUrl(opts.origin || '', m), '【班级积分系统】群公告');
}

async function getAppToken(db) {
  return (await getConfig(db, 'wxpusher_app_token')) || '';
}

async function isEnabled(db) {
  return (await getConfig(db, 'wxpusher_enabled')) === '1';
}

function summarize(msg) {
  if (msg.msg_type === 'image') return '[图片]';
  if (msg.msg_type === 'file') {
    const a = (msg.attachments || [])[0];
    return '[文件] ' + (a && a.name || '');
  }
  const c = msg.content || '';
  return c.length > 60 ? c.slice(0, 60) + '…' : c;
}

async function fetchMemberUids(db, exceptSenderKey) {
  // 返回 [{member_key, wxpusher_uid, role}]，过滤发送者与未绑定者
  const staff = await db.all(
    "SELECT username, wxpusher_uid, role FROM admin_users WHERE deleted=0 AND wxpusher_uid IS NOT NULL AND wxpusher_uid != ''"
  );
  const out = [];
  for (const s of staff) {
    if (s.username === exceptSenderKey) continue;
    out.push({ member_key: s.username, uid: s.wxpusher_uid, role: s.role });
  }
  // front：已绑定 UID 就推（v5.0 起通知统一走 WxPusher，chat_front_push_channel 废弃）
  const frontUid = await getConfig(db, 'wxpusher_uid_front');
  if (frontUid && exceptSenderKey !== 'front') {
    out.push({ member_key: 'front', uid: frontUid, role: 'front' });
  }
  return out;
}

// 带参二维码：scene=member:<key>；返回 WxPusher 的二维码 URL / 图片
export async function createBindQrcode(db, memberKey) {
  const appToken = await getAppToken(db);
  if (!appToken) return { ok: false, error: '未配置 WxPusher AppToken' };
  try {
    const resp = await fetch(`${WX_BASE}/api/fun/create/qrcode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appToken,
        extra: `member:${memberKey}`,
        validTime: 600,
      }),
    });
    const data = await resp.json();
    if (data.code !== 1000) return { ok: false, error: data.msg || '创建二维码失败' };
    return {
      ok: true,
      url: (data.data && data.data.urlShort) || (data.data && data.data.codeUrl) || '',
      image: (data.data && data.data.tempImageUrl) || (data.data && data.data.url) || '',
      scene: `member:${memberKey}`,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 订阅回调：把 UID 绑定到 scene 中的 member_key
export async function handleCallback(db, body) {
  // WxPusher 回调结构：{action, appId, data:{uid, scene|extra, ...}, ...}
  const action = body && body.action;
  const data = (body && body.data) || {};
  const uid = data.uid || '';
  // 不同版本字段：data.scene 或 data.extra
  const scene = data.scene || data.extra || (body && body.scene) || (body && body.extra) || '';
  if (!uid || !scene) return { ok: false, error: 'missing uid/scene' };
  if (action !== 'app_subscribe') return { ok: true, ignored: true };
  const m = /^member:(.+)$/.exec(scene);
  if (!m) return { ok: false, error: 'unknown scene' };
  const memberKey = m[1];
  if (memberKey === 'front') {
    // 存到 admin_config
    await setConfig(db, 'wxpusher_uid_front', uid);
    return { ok: true, bound: 'front' };
  }
  // staff：写 admin_users.wxpusher_uid
  await db.run('UPDATE admin_users SET wxpusher_uid=?, updated_at=? WHERE username=?', uid, Date.now(), memberKey);
  return { ok: true, bound: memberKey };
}
