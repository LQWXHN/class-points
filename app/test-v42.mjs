// v4.2 双端自测：A=8811, B=8812
const A = 'http://127.0.0.1:8811', B = 'http://127.0.0.1:8812';
let pass = 0, fail = 0;
function check(label, cond, extra='') {
  cond ? pass++ : fail++;
  console.log(cond ? 'PASS' : 'FAIL', label, extra ? '| ' + extra : '');
}

async function login(base, u, p) {
  await fetch(base + '/api/auth/setup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u,password:p}) }).catch(()=>{});
  const r = await fetch(base + '/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u,password:p}) });
  return (await r.json()).token;
}
async function dev(base) {
  const r = await fetch(base + '/api/devices/activate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uuid:'dev-v42-'+Date.now(), name:'平板'}) });
  const j = await r.json(); return j.token;
}

// ---- 1. 双周榜锚点：今天 2026-10-14 必须落在第 0 期进行中 ----
const rk = await (await fetch(A + '/api/rankings/biweekly?period=current')).json();
const d = rk.data;
const expectedStart = Date.UTC(2026, 9, 1) - 8*3600*1000; // 2026-10-01 00:00+08
check('biweekly period_index=0', d.period_index === 0, 'idx=' + d.period_index);
check('biweekly is_current=true', d.is_current === true);
check('biweekly period_start=2026-10-01', d.period_start === expectedStart, 'got=' + new Date(d.period_start).toISOString());
check('biweekly rows=[] (empty fixture)', Array.isArray(d.rows) && d.rows.length === 0);
check('biweekly history has current', Array.isArray(d.history) && d.history.some(h => h.period_index === 0));

// ---- 2. unread-count 鉴权：无 token 401，带 token 200 ----
const noTok = await fetch(A + '/api/front-messages/unread-count');
check('unread-count no token -> 401', noTok.status === 401, 'status=' + noTok.status);
const tok = await login(A, 'teacher', 'v42-pwd');
const withTok = await fetch(A + '/api/front-messages/unread-count', { headers: { Authorization: 'Bearer ' + tok } });
const withTokJ = await withTok.json();
check('unread-count with token -> {ok,unread}', withTok.status === 200 && withTokJ.ok === true && typeof withTokJ.unread === 'number', JSON.stringify(withTokJ));

// ---- 3. 系统公告：超管可发（含 Markdown 图片），公开可读，teacher 发会 403 ----
const adminTok = await login(A, 'admin', 'v42-pwd');
const saBody = { title: '月考安排', content: '本周三月考 ![](/api/file/uploads/2026/10/sample.png)\n\n请做好准备。' };
const postSa = await fetch(A + '/api/system-announcements', { method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+adminTok}, body:JSON.stringify(saBody) });
const postSaJ = await postSa.json();
check('super POST system-announcements', postSa.status === 200 && postSaJ.ok === true && postSaJ.data && postSaJ.data.uid, 'status=' + postSa.status);
const saUid = postSaJ.data.uid;

const asTeacher = await fetch(A + '/api/system-announcements', { method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+tok}, body:JSON.stringify({title:'x', content:'y'}) });
check('teacher POST system-announcements -> 403', asTeacher.status === 403, 'status=' + asTeacher.status);

const pubList = await (await fetch(A + '/api/system-announcements')).json();
check('public GET system-announcements contains new', pubList.ok && pubList.data.some(x => x.uid === saUid), 'count=' + (pubList.data||[]).length);

// ---- 4. 同步事件：A 的 system_announcements 推送 B 后 B 也有 ----
// 手动从 A 读 sync_events 推到 B（模拟 worker cron）
async function pushTo(peerUrl, peerName) {
  const evs = await (await fetch(A + '/api/sync', { method:'POST', headers:{'Content-Type':'application/json','X-Sync-Key':'v42-secret'}, body:JSON.stringify({peer:'test-'+peerName, last_id:0, events:[]}) })).json();
  // evs.events 是 A 的新事件；直接发给 B
  const sent = await fetch(B + '/api/sync', { method:'POST', headers:{'Content-Type':'application/json','X-Sync-Key':'v42-secret'}, body:JSON.stringify({peer:'node-a', last_id:0, events: evs.events || []}) });
  return await sent.json();
}
// A 上刚发的系统公告事件要推到 B
const bAfterSync = await pushTo(B, 'b');
check('push events to B ok', bAfterSync.ok === true);
const bPubList = await (await fetch(B + '/api/system-announcements')).json();
check('B public GET system-announcements contains saUid', bPubList.ok && bPubList.data.some(x => x.uid === saUid), 'count=' + (bPubList.data||[]).length);

// ---- 5. 回归：超管 set-points 零流水 ----
// 先造一个学生
await fetch(A + '/api/students', { method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+adminTok}, body:JSON.stringify({name:'测试甲', group_uid:''}) });
const stuList = await (await fetch(A + '/api/students', { headers:{Authorization:'Bearer '+adminTok} })).json();
const stu = (stuList.data||[]).find(s => s.name === '测试甲');
const recBefore = await (await fetch(A + '/api/records?limit=1000', { headers:{Authorization:'Bearer '+adminTok} })).json();
await fetch(A + '/api/super/set-points', { method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+adminTok}, body:JSON.stringify({studentId: stu.id, points: 88, note:'v42回归'}) });
const recAfter = await (await fetch(A + '/api/records?limit=1000', { headers:{Authorization:'Bearer '+adminTok} })).json();
check('super set-points zero records', recAfter.total === recBefore.total, 'before=' + recBefore.total + ' after=' + recAfter.total);

// ---- 6. 回归：期初 set 隐藏（fixture 里没有，只确认不报错） ----
check('records endpoint ok', recAfter.ok === true);

console.log(`\n===== V4.2 RESULT: ${pass} PASS / ${fail} FAIL =====`);
process.exit(fail ? 1 : 0);
