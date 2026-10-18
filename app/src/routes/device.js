import { Hono } from 'hono';
import {
  uid, now, genToken, clientIp, ua, logAudit, notify, verifyUser, verifyDevice, writeSyncEvent,
} from './_helpers.js';

// 调试用万能激活码：可重复使用、不过期、绝不写入 activation_codes、list-codes 永不返回
// 生产部署时通过环境变量 MASTER_CODE 覆盖，仓库默认值仅占位。
export const MASTER_CODE = process.env.MASTER_CODE || 'change-me-on-deploy';

export function deviceRoutes() {
  const app = new Hono();

  app.post('/device/activate', async (c) => {
    const db = c.get('db');
    const { code, deviceName, uuid, fingerprint } = await c.req.json().catch(() => ({}));
    if (!code) return c.json({ ok: false, error: '缺少激活码' }, 400);
    const ip = clientIp(c); const u = ua(c);
    const t = now();
    const name = deviceName || '教室电脑';

    // 防御性归一：前端可能做过大写化或用户手输小写，统一转大写后比较
    // 普通激活码生成时已是大写；万能码判断大小写不敏感；activation_code 字段仍按原常量写库
    const rawCode = String(code || '').trim();
    const normCode = rawCode.toUpperCase();

    if (normCode === MASTER_CODE.toUpperCase()) {
      // 修复：同一 device_uuid 已有万能码(master)设备时，直接复用已有 token，不再重复插入
      const existing = await db.get(
        'SELECT * FROM device_tokens WHERE device_uuid=? AND is_master=1 AND deleted=0', uuid || '');
      if (existing) {
        await db.run('UPDATE device_tokens SET last_seen=?, updated_at=? WHERE id=?', t, t, existing.id);
        // 复用万能码也算一次使用，发通知（失败不影响激活响应）
        notify(db, 'master_code', '【班级积分系统】万能激活码使用提醒',
          `<p>设备名：<b>${existing.device_name || name}</b></p>
           <p>设备 UUID：${existing.device_uuid || uuid || ''}</p>
           <p>使用方式：万能激活码（复用已有设备）</p>
           <p>时间：${new Date().toLocaleString('zh-CN')}</p>
           <p>IP：${ip}</p><p>设备：${u}</p>`).catch(e => console.error('[master_code notify]', e.message));
        return c.json({ ok: true, token: existing.token });
      }
      const token = genToken(32);
      const dUid = uid();
      const snap = {
        uid: dUid, token, device_uuid: uuid || '', fingerprint: fingerprint || '',
        device_name: name, ip, ua: u, activation_code: MASTER_CODE, is_master: 1,
        last_seen: t, created_at: t, updated_at: t, deleted: 0,
      };
      await db.run(
        `INSERT INTO device_tokens (uid, token, device_uuid, fingerprint, device_name, ip, ua, activation_code, is_master, last_seen, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        dUid, token, snap.device_uuid, snap.fingerprint, name, ip, u, MASTER_CODE, 1, t, t, t);
      await writeSyncEvent(db, { tbl: 'device_tokens', row_uid: dUid, op: 'upsert', snapshot: snap });
      notify(db, 'master_code', '【班级积分系统】万能激活码使用提醒',
        `<p>设备名：<b>${name}</b></p>
         <p>设备 UUID：${uuid || ''}</p>
         <p>使用方式：万能激活码（新建设备）</p>
         <p>时间：${new Date().toLocaleString('zh-CN')}</p>
         <p>IP：${ip}</p><p>设备：${u}</p>`).catch(e => console.error('[master_code notify]', e.message));
      return c.json({ ok: true, token });
    }

    const entry = await db.get('SELECT * FROM activation_codes WHERE code=? AND deleted=0', normCode);
    if (!entry) return c.json({ ok: false, error: '激活码错误' }, 401);
    if (entry.used) return c.json({ ok: false, error: '该激活码已被使用' }, 401);
    const existed = await db.get(
      'SELECT id FROM device_tokens WHERE device_uuid=? AND deleted=0 AND is_master=0', uuid || '');
    if (existed) return c.json({ ok: false, error: '该设备已激活过，请使用万能码或联系管理员' }, 401);

    const token = genToken(32);
    const dUid = uid();
    const devSnap = {
      uid: dUid, token, device_uuid: uuid || '', fingerprint: fingerprint || '',
      device_name: name, ip, ua: u, activation_code: normCode, is_master: 0,
      last_seen: t, created_at: t, updated_at: t, deleted: 0,
    };
    const codeSnap = {
      uid: entry.uid, code: normCode, label: entry.label, created_by: entry.created_by,
      used: 1, used_at: t, used_by: name, used_ip: ip,
      created_at: entry.created_at, updated_at: t, deleted: 0,
    };
    await db.tx(async () => {
      await db.run(
        `INSERT INTO device_tokens (uid, token, device_uuid, fingerprint, device_name, ip, ua, activation_code, is_master, last_seen, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        dUid, token, devSnap.device_uuid, devSnap.fingerprint, name, ip, u, normCode, 0, t, t, t);
      await writeSyncEvent(db, { tbl: 'device_tokens', row_uid: dUid, op: 'upsert', snapshot: devSnap });
      await db.run('UPDATE activation_codes SET used=1, used_at=?, used_by=?, used_ip=?, updated_at=? WHERE id=?',
        t, name, ip, t, entry.id);
      await writeSyncEvent(db, { tbl: 'activation_codes', row_uid: entry.uid, op: 'upsert', snapshot: codeSnap });
    });
    await notify(db, 'device_code', '【班级积分系统】激活码已被设备使用',
      `<p>激活码：<b>${code}</b></p><p>设备名：${name}</p>
       <p>时间：${new Date().toLocaleString('zh-CN')}</p><p>IP：${ip}</p>`);
    return c.json({ ok: true, token });
  });

  app.get('/device/verify', async (c) => {
    const db = c.get('db');
    const token = c.req.header('X-Device-Token') || '';
    let valid = false;
    if (token) {
      const row = await db.get('SELECT id FROM device_tokens WHERE token=? AND deleted=0', token);
      if (row) {
        await db.run('UPDATE device_tokens SET last_seen=? WHERE id=?', now(), row.id);
        valid = true;
      }
    }
    return c.json({ ok: true, valid });
  });

  // v4.1：本设备已读公告 uid 集合（以服务端为准，localStorage 仅离线缓存）
  app.get('/device/read-state', async (c) => {
    const dev = await verifyDevice(c);
    if (!dev) return c.json({ ok: false, error: '设备未授权' }, 401);
    const db = c.get('db');
    const deviceUuid = dev.device_uuid || dev.uid;
    const rows = await db.all(
      'SELECT ann_uid FROM announcement_reads WHERE device_uid=?', deviceUuid);
    return c.json({ ok: true, read_ann_uids: rows.map(r => r.ann_uid), t: now() });
  });

  app.post('/device/generate-code', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    let label = '';
    try { const b = await c.req.json(); label = ((b && b.label) || '').trim(); } catch {}
    if (!label) return c.json({ ok: false, error: '请填写备注' }, 400);
    const code = genToken(8).toUpperCase();
    const t = now();
    const cUid = uid();
    const snap = {
      uid: cUid, code, label, created_by: me.username,
      used: 0, used_at: null, used_by: '', used_ip: '',
      created_at: t, updated_at: t, deleted: 0,
    };
    await db.run('INSERT INTO activation_codes (uid, code, label, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      cUid, code, label, me.username, t, t);
    await writeSyncEvent(db, { tbl: 'activation_codes', row_uid: cUid, op: 'upsert', snapshot: snap });
    await logAudit(db, me.username, 'generate_device_code', label, code, clientIp(c));
    await notify(db, 'device_code', '【班级积分系统】新激活码已生成',
      `<p>激活码：<b style="font-size:20px;">${code}</b></p><p>备注：${label}</p>
       <p>操作人：${me.username}</p>
       <p>时间：${new Date().toLocaleString('zh-CN')}</p>`);
    return c.json({ ok: true, code, label });
  });

  app.get('/device/list-codes', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const rows = await db.all(
      'SELECT code, label, created_by, used, used_at, used_by, used_ip, created_at FROM activation_codes WHERE deleted=0 ORDER BY created_at DESC');
    return c.json({ ok: true, data: rows });
  });

  app.post('/device/delete-code', async (c) => {
    const me = await verifyUser(c);
    if (!me) return c.json({ ok: false, error: '未登录' }, 401);
    const db = c.get('db');
    const { code } = await c.req.json().catch(() => ({}));
    if (!code) return c.json({ ok: false, error: '缺少激活码' }, 400);
    const t = now();
    const codeRow = await db.get('SELECT uid FROM activation_codes WHERE code=? AND deleted=0', code);
    const devRows = await db.all('SELECT uid FROM device_tokens WHERE activation_code=? AND deleted=0', code);
    await db.tx(async () => {
      if (codeRow) {
        await db.run('UPDATE activation_codes SET deleted=1, updated_at=? WHERE uid=?', t, codeRow.uid);
        await writeSyncEvent(db, { tbl: 'activation_codes', row_uid: codeRow.uid, op: 'delete', snapshot: { uid: codeRow.uid } });
      }
      for (const d of devRows) {
        await db.run('UPDATE device_tokens SET deleted=1, updated_at=? WHERE uid=?', t, d.uid);
        await writeSyncEvent(db, { tbl: 'device_tokens', row_uid: d.uid, op: 'delete', snapshot: { uid: d.uid } });
      }
    });
    await logAudit(db, me.username, 'delete_device_code', code, `软删码 ${codeRow ? 1 : 0} 个及设备 ${devRows.length} 台`, clientIp(c));
    return c.json({ ok: true });
  });

  return app;
}
