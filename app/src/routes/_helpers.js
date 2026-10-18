// 共享工具：密码 hash、配置、审计、邮件通知、鉴权、同步事件写入（全异步）
import { randomUUID } from 'node:crypto';

export const uid = () => randomUUID();
export const now = () => Date.now();

let CURRENT_ORIGIN = 'node';
export function setSyncOrigin(o) { CURRENT_ORIGIN = o || 'node'; }
export function getSyncOrigin() { return CURRENT_ORIGIN; }

export function genToken(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, km, 256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

export async function getConfig(db, key) {
  const r = await db.get('SELECT value FROM admin_config WHERE key = ?', key);
  return r ? r.value : '';
}
export async function setConfig(db, key, value) {
  const t = now();
  const v = String(value);
  await db.run('INSERT OR REPLACE INTO admin_config (key, value, updated_at) VALUES (?,?,?)', key, v, t);
  await writeSyncEvent(db, { tbl: 'admin_config', row_uid: key, op: 'upsert', snapshot: { key, value: v, updated_at: t } });
}

export async function getKv(db, key) {
  const r = await db.get('SELECT value FROM kv_meta WHERE key = ?', key);
  return r ? r.value : '';
}
export async function setKv(db, key, value) {
  await db.run('INSERT OR REPLACE INTO kv_meta (key, value) VALUES (?, ?)', key, String(value));
}

export function clientIp(c) {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '127.0.0.1';
}
export function ua(c) { return c.req.header('User-Agent') || ''; }

export async function logAudit(db, operator, action = '', target = '', detail = '', ip = '') {
  const t = now();
  const aUid = uid();
  await db.run('INSERT INTO audit_logs (uid, operator, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)',
    aUid, operator, action, target, detail, ip, t);
  await writeSyncEvent(db, { tbl: 'audit_logs', row_uid: aUid, op: 'upsert',
    snapshot: { uid: aUid, operator, action, target, detail, ip, created_at: t } });
}

export async function logLogin(db, { username, role, ip, ua: u, success }) {
  const t = now();
  const lUid = uid();
  await db.run('INSERT INTO login_logs (uid, username, role, ip, ua, success, created_at) VALUES (?,?,?,?,?,?,?)',
    lUid, username || '', role || '', ip || '', u || '', success ? 1 : 0, t);
  await writeSyncEvent(db, { tbl: 'login_logs', row_uid: lUid, op: 'upsert',
    snapshot: { uid: lUid, username: username || '', role: role || '', ip: ip || '', ua: u || '', success: success ? 1 : 0, created_at: t } });
}

export async function sendEmail(db, to, subject, html) {
  const apiKey = await getConfig(db, 'resend_api_key');
  if (!apiKey) return false;
  const from = (await getConfig(db, 'resend_from')) || 'onboarding@resend.dev';
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!resp.ok) { console.error('Resend error:', await resp.text()); return false; }
    return true;
  } catch (e) { console.error('Resend fail:', e.message); return false; }
}

export async function notify(db, eventType, subject, html) {
  const ne = await getConfig(db, 'notify_email');
  if (!ne) return;
  if ((await getConfig(db, `notify_on_${eventType}`)) !== '1') return;
  await sendEmail(db, ne, subject, html);
}

export async function verifyUser(c) {
  const auth = c.req.header('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const db = c.get('db');
  await db.run('DELETE FROM sessions WHERE expires_at < ?', now());
  const row = await db.get(
    `SELECT s.username, s.role, COALESCE(a.display_name, '') AS display_name
     FROM sessions s LEFT JOIN admin_users a ON a.username = s.username
     WHERE s.token = ?`, token);
  if (!row) return null;
  return { username: row.username, role: row.role, display_name: row.display_name || row.username };
}

export async function verifyDevice(c) {
  const token = c.req.header('X-Device-Token') || '';
  if (!token) return null;
  const db = c.get('db');
  const row = await db.get('SELECT * FROM device_tokens WHERE token = ? AND deleted = 0', token);
  if (row) {
    await db.run('UPDATE device_tokens SET last_seen = ?, updated_at = ? WHERE id = ?', now(), now(), row.id);
  }
  return row;
}

export async function writeSyncEvent(db, { tbl, row_uid, op, snapshot, apply_delta = 0, origin = '' }) {
  await db.run(
    'INSERT INTO sync_events (event_uid, tbl, row_uid, op, snapshot, apply_delta, origin, ts) VALUES (?,?,?,?,?,?,?,?)',
    uid(), tbl, row_uid, op, JSON.stringify(snapshot), apply_delta, origin || CURRENT_ORIGIN, now()
  );
}
