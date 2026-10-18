// v4.3 自测：锚点校验 + 万能码激活不崩 + 邮件事件触发 Resend（fake key 会 401，但能看到请求被发出）
const A = 'http://127.0.0.1:8821';
let pass = 0, fail = 0;
function check(label, cond, extra='') {
  cond ? pass++ : fail++;
  console.log(cond ? 'PASS' : 'FAIL', label, extra ? '| ' + extra : '');
}

async function login(u, p) {
  await fetch(A + '/api/auth/setup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u,password:p}) }).catch(()=>{});
  const r = await fetch(A + '/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u,password:p}) });
  return (await r.json()).token;
}

// 1. 锚点：2026-10-15 应落 index=0, is_current=true, period_start=10-12
const rk = await (await fetch(A + '/api/rankings/biweekly?period=current')).json();
const d = rk.data;
const expectedStart = Date.UTC(2026, 9, 12) - 8*3600*1000;
const expectedEnd = Date.UTC(2026, 9, 26) - 8*3600*1000;
check('anchor period_index=0', d.period_index === 0, 'idx=' + d.period_index);
check('anchor is_current=true', d.is_current === true);
check('anchor period_start=2026-10-12', d.period_start === expectedStart, 'got=' + new Date(d.period_start).toISOString());
// period_end 在 current 模式下是 now（不是 10-26），所以只校验 bounds 历史值
const h0 = (d.history||[]).find(h => h.period_index === 0);
check('history[0].period_end=2026-10-26', h0 && h0.period_end === expectedEnd, h0 ? new Date(h0.period_end).toISOString() : 'no h0');

// 2. 配置邮件（fake key，会 401 但请求会发出，日志能看到）
const adminTok = await login('admin', 'v43-pwd');
await fetch(A + '/api/config', { method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+adminTok}, body:JSON.stringify({
  resend_api_key: 'fake-key-for-test',
  resend_from: 'onboarding@resend.dev',
  notify_email: 'teacher@example.com',
  notify_on_login: '1',
  notify_on_device_code: '1',
  notify_on_master_code: '1',
}) });

// 3. 触发登录通知
await login('teacher', 'v43-pwd');  // setup + login → 应发 login 邮件

// 4. 生成激活码
const gc = await fetch(A + '/api/device/generate-code', { method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+adminTok}, body:JSON.stringify({label:'v43测试'}) });
const gcJ = await gc.json();
check('generate-code 200', gc.status === 200 && gcJ.ok === true, gc.status);
const code = gcJ.code;

// 5. 用普通激活码激活设备（应发 device_code 已使用通知）
const act1 = await fetch(A + '/api/device/activate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code, deviceName:'测试平板', uuid:'uuid-v43-1'}) });
const act1J = await act1.json();
check('normal activate 200', act1.status === 200 && act1J.ok === true, act1.status);

// 6. 用万能码激活新设备（应发 master_code 通知）
const act2 = await fetch(A + '/api/device/activate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code:'CHANGE_ME_MASTER_CODE', deviceName:'万能设备', uuid:'uuid-v43-2'}) });
const act2J = await act2.json();
check('master activate new 200', act2.status === 200 && act2J.ok === true, act1.status + ' ' + JSON.stringify(act2J));
const masterToken = act2J.token;

// 7. 复用万能码同 uuid（也应发 master_code 通知）
const act3 = await fetch(A + '/api/device/activate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code:'CHANGE_ME_MASTER_CODE', deviceName:'万能设备', uuid:'uuid-v43-2'}) });
const act3J = await act3.json();
check('master activate reuse 200', act3.status === 200 && act3J.ok === true && act3J.token === masterToken, act3.status);

// 8. 未配置邮件时不应崩（清掉 notify_email 再触发一次）
await fetch(A + '/api/config', { method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+adminTok}, body:JSON.stringify({notify_email:''}) });
const act4 = await fetch(A + '/api/device/activate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code:'CHANGE_ME_MASTER_CODE', deviceName:'无邮件设备', uuid:'uuid-v43-3'}) });
check('master activate without email 200 (no crash)', act4.status === 200, act4.status);

console.log(`\n===== V4.3 RESULT: ${pass} PASS / ${fail} FAIL =====`);
process.exit(fail ? 1 : 0);
