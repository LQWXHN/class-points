// v4.1 双端集成自测：A(8801) ↔ B(8802)，手动按 sync_events 互推（同 test-sync.mjs 模式）
// 验证：公告分类/编辑/版本/已读、前台消息(含附件)、双周榜两端一致+缓存稳定、
//       超管直改零流水且两端积分一致、重复同步幂等。
import Database from 'better-sqlite3';

const A = process.env.A_URL || 'http://127.0.0.1:8801';
const B = process.env.B_URL || 'http://127.0.0.1:8802';
const A_DB = process.env.A_DB || 'F:/DESKTOP/班级积分系统/app/tmp/v41-a/app.db';
const B_DB = process.env.B_DB || 'F:/DESKTOP/班级积分系统/app/tmp/v41-b/app.db';
const SECRET = process.env.SYNC_SECRET || 'v41-shared-secret';

let pass = 0, fail = 0; const fails = [];
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; fails.push(name); console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
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
  const sm = globalThis.__sm || (globalThis.__sm = {});
  const r1 = await pushEvents(A_DB, sm, B, 'node-A');
  console.log(`  A→B pushed ${r1.pushed}`);
  const r2 = await pushEvents(B_DB, sm, A, 'node-B');
  console.log(`  B→A pushed ${r2.pushed}`);
}

async function ensureUser(base, username, pwd) {
  let r = await j(base, 'POST', '/api/auth/login', { body: { username, password: pwd } });
  if (r.data.ok) return r.data.token;
  await j(base, 'POST', '/api/auth/setup', { body: { username, password: pwd } });
  r = await j(base, 'POST', '/api/auth/login', { body: { username, password: pwd } });
  if (!r.data.ok) throw new Error(`login ${username} @ ${base} failed`);
  return r.data.token;
}

// ============ 开始 ============
console.log('## 登录 teacher / admin');
const A_tok = await ensureUser(A, 'teacher', 'a-teacher-1');
const B_tok = await ensureUser(B, 'teacher', 'b-teacher-1');
const A_admin = await ensureUser(A, 'admin', 'a-admin-1');
t('A teacher/admin login', !!A_tok && !!A_admin);

console.log('## A 建组+学生，同步');
let r = await j(A, 'POST', '/api/groups', { token: A_tok, body: { name: '一组', color: '#f00' } });
t('A create group', r.data.ok === true, r.data);
const A_group = (await j(A, 'GET', '/api/groups', { token: A_tok })).data.data[0];
r = await j(A, 'POST', '/api/students', { token: A_tok, body: { name: '测试生', group_id: A_group.id, points: 0 } });
const A_sid = r.data.id;
t('A create student', !!A_sid);
await j(A, 'POST', '/api/points/batch', { token: A_tok, body: { operations: [{ studentId: A_sid, type: 'add', reason: '课堂加分', points: 10 }] } });
await round('init');

let bStu = (await j(B, 'GET', '/api/snapshot')).data.data.students;
t('B sees student after sync', bStu.length === 1 && bStu[0].points === 10, bStu);

console.log('## 公告：A 发布(考试成绩) → 同步 → B snapshot 带 category');
r = await j(A, 'POST', '/api/announcements', { token: A_tok, body: { title: '数学月考安排', content: '周五', category: '考试成绩' } });
t('A post announcement', r.data.ok === true && !!r.data.id, r.data);
const A_annId = r.data.id;
await round('ann post');
let bAnn = (await j(B, 'GET', '/api/snapshot')).data.data.announcements[0];
t('B snapshot announcement category=考试成绩', bAnn && bAnn.category === '考试成绩' && bAnn.edited === 0, bAnn);

console.log('## 公告编辑：A PUT → 版本行 + edited → 同步到 B');
r = await j(A, 'PUT', `/api/announcements/${A_annId}`, { token: A_tok, body: { title: '数学月考安排(改)', content: '周五下午', category: '考试成绩' } });
t('A PUT edit', r.data.ok === true, r.data);
let aVers = (await j(A, 'GET', `/api/announcements/${A_annId}/versions`, { token: A_tok })).data.data;
t('A versions has 1 row', aVers.length === 1 && aVers[0].title === '数学月考安排', aVers);
t('A version fields shape', aVers[0] && 'uid' in aVers[0] && 'ann_uid' in aVers[0] && 'editor' in aVers[0] && 'file_url' in aVers[0]);
await round('ann edit');
let aAnnAfter = (await j(A, 'GET', '/api/announcements', { token: A_tok, query: '' })).data.data.find(x => x.id === A_annId);
let bVers = (await j(B, 'GET', `/api/announcements/${A_annId}/versions`, { token: B_tok })).data.data;
t('B versions synced', bVers.length === 1, bVers);
let bAnnList = (await j(B, 'GET', '/api/announcements', { token: B_tok })).data.data.find(x => x.id === A_annId);
t('B main edited=1 title updated', bAnnList && bAnnList.edited === 1 && bAnnList.title === '数学月考安排(改)', bAnnList);

console.log('## 分类过滤 / keyword');
let filtered = (await j(A, 'GET', '/api/announcements?category=考试成绩', { token: A_tok })).data.data;
t('category filter finds it', filtered.length === 1);
filtered = (await j(A, 'GET', '/api/announcements?category=班级活动', { token: A_tok })).data.data;
t('category filter excludes', filtered.length === 0);

console.log('## 设备已读：B 激活设备 → read → 同步 → A read_count=1');
r = await j(B, 'POST', '/api/device/activate', { body: { code: 'CHANGE_ME_MASTER_CODE', deviceName: '平板', uuid: 'uuid-pad-1' } });
t('B device activate', r.data.ok === true && !!r.data.token, r.data);
const B_dev = r.data.token;
r = await j(B, 'POST', `/api/announcements/${A_annId}/read`, { headers: { 'X-Device-Token': B_dev } });
t('B device read', r.data.ok === true, r.data);
let bReadState = await j(B, 'GET', '/api/device/read-state', { headers: { 'X-Device-Token': B_dev } });
const annUid = bAnnList.uid;
t('B read-state contains ann uid', bReadState.data.read_ann_uids.includes(annUid), bReadState.data);
// 幂等：再读一次
await j(B, 'POST', `/api/announcements/${A_annId}/read`, { headers: { 'X-Device-Token': B_dev } });
await round('device read');
let aAnnList = (await j(A, 'GET', '/api/announcements', { token: A_tok })).data.data.find(x => x.id === A_annId);
t('A read_count=1 after sync', aAnnList.read_count === 1, aAnnList);
// announcement_reads 不重复
const dA = new Database(A_DB, { readonly: true });
const readsOnA = dA.prepare('SELECT COUNT(*) c FROM announcement_reads').get().c;
dA.close();
t('A announcement_reads no duplicate', readsOnA === 1, readsOnA);

console.log('## 前台消息：B 设备上传附件 + 发消息 → 同步 → A 列表/未读/详情/已读/删除');
r = await j(B, 'POST', '/api/upload', { headers: { 'X-Device-Token': B_dev } }); // 先试无文件
// 用 formData 上传
const fd = new FormData();
fd.append('file', new Blob(['hello-v41-content']), 'note.txt');
const upResp = await fetch(B + '/api/upload', { method: 'POST', headers: { 'X-Device-Token': B_dev }, body: fd });
const upJson = await upResp.json();
t('B device upload', upJson.ok === true && !!upJson.url, upJson);
r = await j(B, 'POST', '/api/front-messages', { headers: { 'X-Device-Token': B_dev }, body: { title: '提问', content: '这道题没懂', file_url: upJson.url, file_name: 'note.txt', file_type: 'text/plain', file_size: 18 } });
t('B post front-message', r.data.ok === true, r.data);
const A_fmId = null;
await round('front msg');
let aFm = (await j(A, 'GET', '/api/front-messages', { token: A_tok })).data;
t('A front-messages total=1 unread=1', aFm.total === 1 && aFm.unread === 1 && aFm.data.length === 1, aFm);
const fmUid = aFm.data[0].uid;
const fmId = aFm.data[0].id;
t('A front msg has attachment', !!aFm.data[0].file_url, aFm.data[0]);
let aFmDetail = (await j(A, 'GET', `/api/front-messages/${fmId}`, { token: A_tok })).data.data;
t('A front detail', aFmDetail && aFmDetail.title === '提问');
r = await j(A, 'POST', `/api/front-messages/${fmId}/read`, { token: A_tok });
t('A mark read', r.data.ok === true);
await round('front read');
let bFm = (await j(B, 'GET', '/api/front-messages', { token: B_tok })).data;
t('B front msg is_read=1 unread=0', bFm.data[0].is_read === 1 && bFm.unread === 0, bFm);
r = await j(A, 'DELETE', `/api/front-messages/${fmId}`, { token: A_tok });
t('A delete front msg', r.data.ok === true);
await round('front delete');
bFm = (await j(B, 'GET', '/api/front-messages', { token: B_tok })).data;
t('B front msg soft-deleted (total 0)', bFm.total === 0, bFm);

console.log('## 双周榜：两端 current 一致；历史周期缓存稳定');
let aBw = (await j(A, 'GET', '/api/rankings/biweekly?period=current')).data.data;
let bBw = (await j(B, 'GET', '/api/rankings/biweekly?period=current')).data.data;
t('biweekly current exists', !!aBw.rows && aBw.is_current === true);
t('biweekly history present', Array.isArray(aBw.history) && aBw.history.length > 0);
t('biweekly rows: group 一组 delta_avg=10', aBw.rows.length === 1 && aBw.rows[0].group_name === '一组' && aBw.rows[0].total_delta === 10 && aBw.rows[0].delta_avg === 10, aBw.rows);
t('biweekly A==B rows', JSON.stringify(aBw.rows) === JSON.stringify(bBw.rows), { A: aBw.rows, B: bBw.rows });

const pastIdx = aBw.period_index - 1;
let aPast1 = (await j(A, 'GET', `/api/rankings/biweekly?period=${pastIdx}`)).data.data;
let aPast2 = (await j(A, 'GET', `/api/rankings/biweekly?period=${pastIdx}`)).data.data;
t('biweekly past recompute stable (cache)', JSON.stringify(aPast1.rows) === JSON.stringify(aPast2.rows));
t('biweekly past is_current=false', aPast1.is_current === false && aPast1.period_index === pastIdx);
const dA2 = new Database(A_DB, { readonly: true });
const rsRow = dA2.prepare("SELECT * FROM rank_snapshots WHERE kind='biweekly' AND period_index=?").get(pastIdx);
dA2.close();
t('rank_snapshots cached row exists', !!rsRow, rsRow);
await round('rank cache event');
let bPast = (await j(B, 'GET', `/api/rankings/biweekly?period=${pastIdx}`)).data.data;
t('B biweekly past consistent', JSON.stringify(bPast.rows) === JSON.stringify(aPast1.rows));

console.log('## 超管直改：A admin set-points → 零流水；同步后 B 积分一致');
let recBefore = (await j(A, 'GET', '/api/records?limit=500')).data.total;
r = await j(A, 'POST', '/api/super/set-points', { token: A_admin, body: { studentId: A_sid, points: 999, note: '调试' } });
t('A super set-points', r.data.ok === true, r.data);
let recAfter = (await j(A, 'GET', '/api/records?limit=500')).data.total;
t('A records total unchanged (zero flow)', recAfter === recBefore, { before: recBefore, after: recAfter });
let aStuSnap = (await j(A, 'GET', '/api/snapshot')).data.data.students[0];
t('A student points=999', aStuSnap.points === 999, aStuSnap);
await round('super set');
let bStuSnap = (await j(B, 'GET', '/api/snapshot')).data.data.students[0];
t('B student points=999 via force_points', bStuSnap.points === 999, bStuSnap);
let bRec = (await j(B, 'GET', '/api/records?limit=500')).data.total;
t('B records total unchanged (no set record)', bRec === recBefore, { B: bRec, expected: recBefore });

console.log('## 重复同步幂等：再推一轮，计数不增');
const dA3 = new Database(A_DB, { readonly: true });
const stuCountA = dA3.prepare('SELECT COUNT(*) c FROM students').get().c;
const recCountA = dA3.prepare('SELECT COUNT(*) c FROM point_records').get().c;
dA3.close();
await round('idempotency extra');
const dA4 = new Database(A_DB, { readonly: true });
const stuCountA2 = dA4.prepare('SELECT COUNT(*) c FROM students').get().c;
const recCountA2 = dA4.prepare('SELECT COUNT(*) c FROM point_records').get().c;
dA4.close();
t('idempotent: students count stable', stuCountA === stuCountA2, { before: stuCountA, after: stuCountA2 });
t('idempotent: point_records count stable', recCountA === recCountA2, { before: recCountA, after: recCountA2 });

console.log(`\n===== V4.1 SYNC RESULT: ${pass} PASS / ${fail} FAIL =====`);
if (fails.length) console.log('FAILED:', fails.join('; '));
process.exit(fail ? 1 : 0);
