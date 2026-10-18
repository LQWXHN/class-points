// 双向同步端到端测试：A(8787) ↔ B(8788)，共享 SYNC_SECRET，通过直接读 sqlite sync_events 并 POST 到对端模拟一轮。
// 用例：
//  (a) A 生成激活码 → 一轮后 B list-codes 可见
//  (b) B 用该码 activate → 一轮后 A device_tokens 出现；持 B 端 token 调 A /api/device/verify 返回 valid
//  (c) A 改 site_title → B snapshot 生效；B 改 teacher 密码 → A 用新密码登录成功
//  (d) 重复两轮无重复行
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const A = process.env.A_URL || 'http://127.0.0.1:8787';
const B = process.env.B_URL || 'http://127.0.0.1:8788';
const A_DB = process.env.A_DB || 'F:/DESKTOP/班级积分系统/app/data-sync-a/app.db';
const B_DB = process.env.B_DB || 'F:/DESKTOP/班级积分系统/app/data-sync-b/app.db';
const SECRET = process.env.SYNC_SECRET || 'shared-secret-for-test';

let pass = 0, fail = 0; const fails = [];
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; fails.push(name); console.log('  FAIL', name, extra ?? ''); }
}

async function j(base, method, p, { token, body, headers } = {}) {
  const h = { ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  return { status: r.status, data };
}

// 从 db 读 id>since 的 events，POST 到 targetBase（带 X-Sync-Key）
async function pushEvents(srcDbPath, sinceMap, targetBase, peerName) {
  const d = new Database(srcDbPath, { readonly: true });
  const since = sinceMap[srcDbPath] || 0;
  const rows = d.prepare('SELECT * FROM sync_events WHERE id > ? ORDER BY id').all(since);
  d.close();
  if (rows.length) {
    const resp = await fetch(targetBase + '/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Key': SECRET },
      body: JSON.stringify({ peer: peerName, last_id: 0, events: rows }),
    });
    const data = await resp.json();
    sinceMap[srcDbPath] = rows[rows.length - 1].id;
    return { pushed: rows.length, reply: data };
  }
  return { pushed: 0, reply: null };
}

async function round(label) {
  console.log(`--- round: ${label} ---`);
  const sinceMap = globalThis.__sinceMap || (globalThis.__sinceMap = {});
  const r1 = await pushEvents(A_DB, sinceMap, B, 'node-A');
  console.log(`  A→B pushed ${r1.pushed}`);
  const r2 = await pushEvents(B_DB, sinceMap, A, 'node-B');
  console.log(`  B→A pushed ${r2.pushed}`);
}

async function ensureTeacherPwd(base, username, pwd) {
  let r = await j(base, 'POST', '/api/auth/login', { body: { username, password: pwd } });
  if (r.data.ok) return r.data.token;
  // 可能未 setup
  await j(base, 'POST', '/api/auth/setup', { body: { username, password: pwd } });
  r = await j(base, 'POST', '/api/auth/login', { body: { username, password: pwd } });
  if (!r.data.ok) throw new Error(`ensureTeacherPwd ${base} ${username} failed: ${JSON.stringify(r.data)}`);
  return r.data.token;
}

// ============ 开始 ============
console.log('## 初始化两端 teacher 密码');
const A_pwd0 = 'A-teacher-pwd-1';
const B_pwd0 = 'B-teacher-pwd-1';
let A_tok = await ensureTeacherPwd(A, 'teacher', A_pwd0);
let B_tok = await ensureTeacherPwd(B, 'teacher', B_pwd0);
t('A teacher login', !!A_tok);
t('B teacher login', !!B_tok);

console.log('## 清空游标（每次测试重置）');
globalThis.__sinceMap = {};

console.log('## (a) A 生成激活码 → 同步到 B');
let r = await j(A, 'POST', '/api/device/generate-code', { token: A_tok, body: { label: 'A-lab' } });
t('A generate-code', r.data.ok === true && !!r.data.code, JSON.stringify(r.data));
const theCode = r.data.code;
t('A list-codes contains own code', (await j(A, 'GET', '/api/device/list-codes', { token: A_tok })).data.data.some(x => x.code === theCode));
let bCodes = (await j(B, 'GET', '/api/device/list-codes', { token: B_tok })).data.data || [];
t('B list-codes empty before sync', bCodes.length === 0, bCodes);
await round('A generate-code → B');
bCodes = (await j(B, 'GET', '/api/device/list-codes', { token: B_tok })).data.data || [];
t('(a) B list-codes now contains the code', bCodes.some(x => x.code === theCode), JSON.stringify(bCodes));

console.log('## (b) B 用该码 activate → 同步回 A → A 能验 B 签发的 token');
r = await j(B, 'POST', '/api/device/activate', { body: { code: theCode, deviceName: 'B-pc', uuid: 'uuid-B-pc', fingerprint: 'fp-B' } });
t('B activate with shared code', r.data.ok === true && !!r.data.token, JSON.stringify(r.data));
const B_devToken = r.data.token;
let aDevResp = await fetch(A + '/api/device/verify', { headers: { 'X-Device-Token': B_devToken } });
let aDevJson = await aDevResp.json();
t('A verify BEFORE sync rejects B token', aDevJson.valid === false);
await round('B activate → A');
aDevResp = await fetch(A + '/api/device/verify', { headers: { 'X-Device-Token': B_devToken } });
aDevJson = await aDevResp.json();
t('(b) A verify AFTER sync accepts B token', aDevJson.valid === true, JSON.stringify(aDevJson));
// 用 admin token 看 A 端设备列表
await ensureTeacherPwd(A, 'admin', 'A-admin-pwd-1').catch(() => {});
let adminLogin = await j(A, 'POST', '/api/auth/login', { body: { username: 'admin', password: 'A-admin-pwd-1' } });
if (!adminLogin.data.ok) {
  await j(A, 'POST', '/api/auth/setup', { body: { username: 'admin', password: 'A-admin-pwd-1' } });
  adminLogin = await j(A, 'POST', '/api/auth/login', { body: { username: 'admin', password: 'A-admin-pwd-1' } });
}
const A_admin_tok = adminLogin.data.token;
r = await j(A, 'GET', '/api/super/devices', { token: A_admin_tok });
t('A super/devices shows B device', r.data.ok === true && r.data.data.some(d => d.token === B_devToken), JSON.stringify(r.data.data));

console.log('## (c) A 改 site_title → B snapshot 生效；B 改 teacher 密码 → A 用新密码登录');
r = await j(A, 'PUT', '/api/config', { token: A_tok, body: { site_title: '主站-主标题-2026' } });
t('A PUT config site_title', r.data.ok === true);
let snapB = await j(B, 'GET', '/api/snapshot');
t('B snapshot site_title BEFORE sync not updated', snapB.data.data.config.site_title !== '主站-主标题-2026');
await round('A config → B');
snapB = await j(B, 'GET', '/api/snapshot');
t('(c) B snapshot site_title updated', snapB.data.data.config.site_title === '主站-主标题-2026', snapB.data.data.config.site_title);

const B_pwd_new = 'B-teacher-NEW-pwd-2';
r = await j(B, 'POST', '/api/auth/change-password', { token: B_tok, body: { newPassword: B_pwd_new } });
t('B change-password', r.data.ok === true);
// A 用 B_pwd0 登录应失败（密码已被 B 端改了，同步前 A 还保留旧 hash）
let aLoginOld = await j(A, 'POST', '/api/auth/login', { body: { username: 'teacher', password: B_pwd0 } });
t('A login with OLD pwd before sync still OK (A still has old hash)', aLoginOld.data.ok === true);
await round('B change-password → A');
let aLoginNew = await j(A, 'POST', '/api/auth/login', { body: { username: 'teacher', password: B_pwd_new } });
t('(c) A login with NEW pwd after sync', aLoginNew.data.ok === true, JSON.stringify(aLoginNew.data));
// 同步后 B 端也用新密码登录
let bLoginNew = await j(B, 'POST', '/api/auth/login', { body: { username: 'teacher', password: B_pwd_new } });
t('B still login with NEW pwd', bLoginNew.data.ok === true);
A_tok = aLoginNew.data.token; B_tok = bLoginNew.data.token;

console.log('## (d) 重复两轮：A 加学生，B 加学生，最后两端学生数/总积分一致，无重复');
// A 加一个学生 +5
r = await j(A, 'POST', '/api/students', { token: A_tok, body: { name: 'A生-01', points: 0 } });
const A_sid = r.data.id;
t('A create student', !!A_sid);
await j(A, 'POST', '/api/points/batch', { token: A_tok, body: { operations: [{ studentId: A_sid, type: 'add', reason: 'A加分', points: 5 }] } });
// B 加一个学生 +7
r = await j(B, 'POST', '/api/students', { token: B_tok, body: { name: 'B生-01', points: 0 } });
const B_sid = r.data.id;
t('B create student', !!B_sid);
await j(B, 'POST', '/api/points/batch', { token: B_tok, body: { operations: [{ studentId: B_sid, type: 'add', reason: 'B加分', points: 7 }] } });
await round('d round-1: A/B both write');

// 再来一轮：A 给 A生-01 再 +3
r = await j(A, 'POST', '/api/points/batch', { token: A_tok, body: { operations: [{ studentId: A_sid, type: 'add', reason: 'A再加', points: 3 }] } });
await round('d round-2');

// 验证两端一致
let aSnap = await j(A, 'GET', '/api/snapshot');
let bSnap = await j(B, 'GET', '/api/snapshot');
const aStu = aSnap.data.data.students;
const bStu = bSnap.data.data.students;
t('(d) A students count == B students count', aStu.length === bStu.length, `A=${aStu.length} B=${bStu.length}`);
const aSum = aStu.reduce((s, x) => s + (x.points || 0), 0);
const bSum = bStu.reduce((s, x) => s + (x.points || 0), 0);
t('(d) A sum points == B sum points', aSum === bSum, `A=${aSum} B=${bSum}`);
// 无重复 uid
const aUids = aStu.map(s => s.uid); const bUids = bStu.map(s => s.uid);
t('(d) no duplicate uids on A', new Set(aUids).size === aUids.length);
t('(d) no duplicate uids on B', new Set(bUids).size === bUids.length);
// point_records 条数一致
let aRec = await j(A, 'GET', '/api/records?limit=1000');
let bRec = await j(B, 'GET', '/api/records?limit=1000');
t('(d) A records total == B records total', aRec.data.total === bRec.data.total, `A=${aRec.data.total} B=${bRec.data.total}`);

console.log(`\n===== SYNC RESULT: ${pass} PASS / ${fail} FAIL =====`);
if (fails.length) console.log('FAILED:', fails.join('; '));
process.exit(fail ? 1 : 0);
