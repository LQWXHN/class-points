// 验证：激活码大小写归一 + records total 带时间范围
const BASE = 'http://127.0.0.1:8787';
async function j(m, p, { token, body, headers } = {}) {
  const h = { ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + p, { method: m, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
}

// setup teacher
await j('POST', '/api/auth/setup', { body: { username: 'teacher', password: 't1234' } });
let r = await j('POST', '/api/auth/login', { body: { username: 'teacher', password: 't1234' } });
const tok = r.data.token;

console.log('## 1. 万能码三种写法');
for (const code of ['CHANGE_ME_MASTER_CODE', 'CHANGE_ME_MASTER_CODE', 'CHANGE_ME_MASTER_CODE']) {
  r = await j('POST', '/api/device/activate', { body: { code, deviceName: 't', uuid: 'uuid-m-' + code } });
  console.log(`  ${code} -> ok=${r.data.ok} token?${!!r.data.token}`);
}

console.log('## 2. 普通激活码小写输入');
r = await j('POST', '/api/device/generate-code', { token: tok, body: { label: 'case-test' } });
const up = r.data.code;
console.log('  generated (upper):', up);
const lo = up.toLowerCase();
r = await j('POST', '/api/device/activate', { body: { code: lo, deviceName: 'lo-pc', uuid: 'uuid-lo-1' } });
console.log(`  activate lowercase ${lo} -> ok=${r.data.ok}`);
// 第二次同码应失败
r = await j('POST', '/api/device/activate', { body: { code: lo, deviceName: 'lo-pc', uuid: 'uuid-lo-2' } });
console.log(`  activate same code again -> ok=${r.data.ok} expected false`);

console.log('## 3. records total 带时间范围');
// 建一个学生 + 加分
r = await j('POST', '/api/students', { token: tok, body: { name: '时间测试生', points: 0 } });
const sid = r.data.id;
await j('POST', '/api/points/batch', { token: tok, body: { operations: [{ studentId: sid, type: 'add', reason: 'x', points: 3 }] } });
await j('POST', '/api/points/batch', { token: tok, body: { operations: [{ studentId: sid, type: 'sub', reason: 'y', points: 1 }] } });

r = await j('GET', '/api/records?limit=10');
console.log('  no range, total =', r.data.total, '(expected 2)');

const now = Date.now();
const future = new Date(now + 86400000).toISOString().slice(0, 10);
const past = new Date(now - 86400000).toISOString().slice(0, 10);
r = await j('GET', '/api/records?start=' + future + '&limit=10');
console.log('  future-only range, total =', r.data.total, '(expected 0)');
r = await j('GET', '/api/records?start=' + past + '&end=' + future + '&limit=10');
console.log('  wide range, total =', r.data.total, '(expected 2)');
