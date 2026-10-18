// 单端冒烟测试：BASE_URL 环境变量可指向任意实例（默认 http://127.0.0.1:8787）
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
let pass = 0, fail = 0;
const fails = [];
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; fails.push(name); console.log('  FAIL', name, extra ?? ''); }
}
async function j(method, path, { token, body, headers } = {}) {
  const h = { ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  return { status: r.status, data, headers: r.headers };
}

console.log('# 1. auth/status');
let r = await j('GET', '/api/auth/status');
t('status ok', r.data.ok === true);
t('teacher not setup', r.data.hasTeacherPassword === false);

console.log('# 2. setup teacher & admin');
r = await j('POST', '/api/auth/setup', { body: { username: 'teacher', password: 't1234' } });
t('teacher setup', r.data.ok === true, JSON.stringify(r.data));
r = await j('POST', '/api/auth/setup', { body: { username: 'admin', password: 'a1234' } });
t('admin setup', r.data.ok === true);
r = await j('POST', '/api/auth/setup', { body: { username: 'teacher', password: 'x' } });
t('setup again rejected', r.data.ok === false);

console.log('# 3. login correct + old forged token rejected');
r = await j('POST', '/api/auth/login', { body: { username: 'teacher', password: 't1234' } });
t('teacher login', r.data.ok === true && !!r.data.token);
const teacherToken = r.data.token;
r = await j('GET', '/api/device/list-codes', { token: 'legacy_fake_token_should_not_pass' });
t('forged legacy token rejected', r.status === 401);
r = await j('GET', '/api/students', { token: teacherToken });
t('valid token reads students', r.data.ok === true);

r = await j('POST', '/api/auth/login', { body: { username: 'admin', password: 'a1234' } });
t('admin login', r.data.ok === true);
const adminToken = r.data.token;

console.log('# 3b. rate limit (用独立用户名，避免影响 teacher)');
for (let i = 0; i < 5; i++) {
  r = await j('POST', '/api/auth/login', { body: { username: 'ratelimit-x', password: 'wrong' } });
}
t('5th wrong login returns 401 (last)', r.status === 401);
r = await j('POST', '/api/auth/login', { body: { username: 'ratelimit-x', password: 'wrong' } });
t('6th wrong login returns 429', r.status === 429, r.status);

console.log('# 5. device: generate-code, activate, master code');
r = await j('POST', '/api/device/generate-code', { token: teacherToken, body: { label: 'smoke lab' } });
t('generate-code', r.data.ok === true && r.data.code, JSON.stringify(r.data));
const theCode = r.data.code;

r = await j('GET', '/api/device/list-codes', { token: teacherToken });
t('list-codes contains our code', r.data.ok === true && r.data.data.some(x => x.code === theCode));
t('list-codes does NOT contain master', r.data.ok === true && !r.data.data.some(x => x.code === 'CHANGE_ME_MASTER_CODE'));

r = await j('POST', '/api/device/activate', { body: { code: theCode, deviceName: 'smoke-pc', uuid: 'uuid-smoke-1', fingerprint: 'fp-1' } });
t('activate with generated code', r.data.ok === true && !!r.data.token, JSON.stringify(r.data));
const devToken = r.data.token;

r = await j('POST', '/api/device/activate', { body: { code: theCode, deviceName: 'x', uuid: 'uuid-smoke-1', fingerprint: 'fp-1' } });
t('same code 2nd activate fails', r.data.ok === false);

r = await j('GET', '/api/device/verify', { headers: { 'X-Device-Token': devToken } });
t('device verify ok', r.data.ok === true && r.data.valid === true);

r = await j('POST', '/api/device/activate', { body: { code: 'CHANGE_ME_MASTER_CODE', deviceName: 'master-1', uuid: 'uuid-master-1' } });
t('master code activate 1', r.data.ok === true);
const masterTok1 = r.data.token;
r = await j('POST', '/api/device/activate', { body: { code: 'CHANGE_ME_MASTER_CODE', deviceName: 'master-2', uuid: 'uuid-master-2' } });
t('master code repeat activate', r.data.ok === true);
r = await j('GET', '/api/device/list-codes', { token: teacherToken });
t('list-codes still no master', r.data.ok === true && !r.data.data.some(x => x.code === 'CHANGE_ME_MASTER_CODE'));

console.log('# 6. groups / students / points / snapshot');
r = await j('POST', '/api/groups', { token: teacherToken, body: { name: '第一组', color: '#ff0000' } });
t('create group', r.data.ok === true);
const groupId = r.data.id;
r = await j('POST', '/api/students', { token: teacherToken, body: { name: '张三', group_id: groupId, points: 0 } });
t('create student', r.data.ok === true);
const stuId = r.data.id;
r = await j('POST', '/api/points/batch', { token: teacherToken, body: { operations: [{ studentId: stuId, type: 'add', reason: '课堂表现', points: 5 }] } });
t('points/batch +5', r.data.ok === true);
r = await j('GET', '/api/snapshot');
t('snapshot student points=5', r.data.ok === true && r.data.data.students.find(s => s.id === stuId).points === 5,
  JSON.stringify(r.data.data.students));
r = await j('GET', '/api/records?limit=10');
t('records has 1 row', r.data.ok === true && r.data.total === 1, r.data.total);

console.log('# 7. super set-points');
r = await j('POST', '/api/super/set-points', { token: adminToken, body: { studentId: stuId, points: 100, note: 'test' } });
t('super set-points to 100', r.data.ok === true);
r = await j('GET', '/api/snapshot');
t('snapshot now 100', r.data.data.students.find(s => s.id === stuId).points === 100);

console.log('# 8. announcements + upload');
const fileBytes = new TextEncoder().encode('hello ' + Date.now());
const fd = new FormData();
fd.append('file', new Blob([fileBytes], { type: 'text/plain' }), 'note.txt');
fd.append('title', '公告标题');
fd.append('content', '公告内容');
const upResp = await fetch(BASE + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + teacherToken }, body: fd });
const upData = await upResp.json();
t('upload file', upData.ok === true && upData.url, JSON.stringify(upData));
r = await j('POST', '/api/announcements', { token: teacherToken, body: { title: '通知一', content: '内容', file_url: upData.url, file_name: 'note.txt', file_type: 'text/plain', file_size: fileBytes.length } });
t('create announcement', r.data.ok === true);
r = await j('GET', upData.url);
t('read uploaded file', r.status === 200 && r.data.includes('hello'));

console.log('# 9. backup create/list');
r = await j('POST', '/api/backup/create', { token: adminToken, body: { type: 'manual' } });
t('backup create', r.data.ok === true, JSON.stringify(r.data));
r = await j('GET', '/api/backup/list', { token: adminToken });
t('backup list', r.data.ok === true && r.data.data.length >= 1);

console.log('# 10. config GET masked resend key');
r = await j('GET', '/api/config', { token: teacherToken });
t('config site_title', r.data.ok === true && r.data.data.site_title === '班级积分系统');
t('config has no resend_api_key raw', r.data.ok === true && !('resend_api_key' in r.data.data));

console.log(`\n===== RESULT: ${pass} PASS / ${fail} FAIL =====`);
if (fails.length) console.log('FAILED:', fails.join('; '));
process.exit(fail ? 1 : 0);
