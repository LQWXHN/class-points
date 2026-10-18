// Node(8787) ↔ Worker(8790) 跨端同步冒烟
import Database from 'better-sqlite3';

const A = 'http://127.0.0.1:8787';
const B = 'http://127.0.0.1:8790';
const A_DB = 'F:/DESKTOP/班级积分系统/app/data-cross/app.db';
const SECRET = 'shared-secret-for-test';

async function j(base, m, p, { token, body, headers } = {}) {
  const h = { ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + p, { method: m, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, data: ct.includes('json') ? await r.json() : await r.text() };
}

async function ensurePwd(base, username, pwd) {
  let r = await j(base, 'POST', '/api/auth/login', { body: { username, password: pwd } });
  if (r.data.ok) return r.data.token;
  await j(base, 'POST', '/api/auth/setup', { body: { username, password: pwd } });
  r = await j(base, 'POST', '/api/auth/login', { body: { username, password: pwd } });
  return r.data.token;
}

// 一轮：把 A 的 sync_events 推给 B
async function pushAToB() {
  const d = new Database(A_DB, { readonly: true });
  const rows = d.prepare('SELECT * FROM sync_events ORDER BY id').all();
  d.close();
  const resp = await fetch(B + '/api/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Key': SECRET },
    body: JSON.stringify({ peer: 'node-A', last_id: 0, events: rows }),
  });
  return { pushed: rows.length, reply: await resp.json() };
}

console.log('## 1. 两端 teacher 登录');
const A_tok = await ensurePwd(A, 'teacher', 't1234');
const B_tok = await ensurePwd(B, 'teacher', 't1234');
console.log('  A tok?', !!A_tok, ' B tok?', !!B_tok);

console.log('## 2. A 端建组 + 建学生 + 加分 +10');
let r = await j(A, 'POST', '/api/groups', { token: A_tok, body: { name: '跨端组', color: '#123456' } });
const gid = r.data.id;
r = await j(A, 'POST', '/api/students', { token: A_tok, body: { name: '跨端学生甲', group_id: gid, points: 0 } });
const sid = r.data.id;
await j(A, 'POST', '/api/points/batch', { token: A_tok, body: { operations: [{ studentId: sid, type: 'add', reason: '跨端测试', points: 10 }] } });

console.log('## 3. 同步 A→B');
const pr = await pushAToB();
console.log('  pushed events:', pr.pushed);

console.log('## 4. B 端 snapshot 验证');
r = await j(B, 'GET', '/api/snapshot');
const st = r.data.data.students;
console.log('  B students count =', st.length, ' first =', JSON.stringify(st[st.length - 1]));
const found = st.find(s => s.name === '跨端学生甲');
console.log('  B 找到跨端学生甲?', !!found, ' points =', found?.points);

console.log('## 5. B 端 records 条数');
r = await j(B, 'GET', '/api/records?limit=10');
console.log('  B records total =', r.data.total);

console.log('## 6. B 端反向写一条学生 +5，推回 A');
// 先把 B 的 teacher 密码同步到与 A 相同（已 ensurePwd 用同密码）
r = await j(B, 'POST', '/api/students', { token: B_tok, body: { name: 'Worker学生', points: 0 } });
const B_sid = r.data.id;
await j(B, 'POST', '/api/points/batch', { token: B_tok, body: { operations: [{ studentId: B_sid, type: 'add', reason: 'worker写', points: 5 }] } });

// B 的 sync_events 我们没法直接读 D1，但 B 的 /api/sync 会拉 A 的事件；这里用同样接口让 A 拉一次 B：
// 把 A 的已处理事件再次推给 B（B 会幂等跳过），同时请求 B 返回 events（origin=node-A 过滤掉）
const resp = await fetch(B + '/api/sync', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Key': SECRET },
  body: JSON.stringify({ peer: 'node-A', last_id: 0, events: [] }),
});
const data = await resp.json();
console.log('  B 返回给 A 的 events:', data.events.length);
// 把 B 的 events 推回 A
const resp2 = await fetch(A + '/api/sync', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Key': SECRET },
  body: JSON.stringify({ peer: 'worker-B', last_id: 0, events: data.events }),
});
console.log('  A 接收 B events:', (await resp2.json()).ok);

r = await j(A, 'GET', '/api/snapshot');
const A_st = r.data.data.students;
const wstu = A_st.find(s => s.name === 'Worker学生');
console.log('## 7. A 端 snapshot: students count =', A_st.length, ' 找到 Worker学生?', !!wstu, ' points =', wstu?.points);
const aSum = A_st.reduce((s, x) => s + (x.points || 0), 0);
const bSum = r.data.data.students.reduce((s, x) => s + (x.points || 0), 0);
const B_st = (await j(B, 'GET', '/api/snapshot')).data.data.students;
const Bsum = B_st.reduce((s, x) => s + (x.points || 0), 0);
console.log('## 8. 两端 sum points: A =', aSum, ' B =', Bsum, (aSum === Bsum ? 'MATCH' : 'MISMATCH'));
