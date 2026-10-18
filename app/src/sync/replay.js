// 同步回放：按 row_uid upsert，编辑类按 updated_at LWW；delete 软删
// point_records 特殊：apply_delta=1 时 add/sub 累加，set 覆盖余额，且幂等
export function keyFromUrl(u) {
  if (!u) return '';
  const m = u.match(/\/api\/file\/(.+)$/);
  if (m) return decodeURIComponent(m[1]);
  return '';
}

// 从 Markdown/纯文本 content 里提取所有 /api/file/<key> 引用的 key（去重、保序）。
// 用于 system_announcements：图片以 ![](/api/file/uploads/xxx) 嵌入，附件需双向自愈。
export function extractUploadKeys(text) {
  if (!text || typeof text !== 'string') return [];
  const seen = new Set();
  const out = [];
  const re = /\/api\/file\/([^\s)\]"']+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let k = m[1];
    // 去掉末尾标点（. , ; ）等）
    k = k.replace(/[.,;:!?)\]]+$/, '');
    try { k = decodeURIComponent(k); } catch { /* keep raw */ }
    if (k && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

function parseSnap(s) {
  if (!s) return {};
  if (typeof s === 'string') { try { return JSON.parse(s); } catch { return {}; } }
  return s;
}

async function applyUpsert(db, ev, table, opts = {}) {
  const snap = parseSnap(ev.snapshot);
  if (!snap.uid && opts.keyCol !== 'key') return;
  const uidCol = opts.keyCol || 'uid';
  const keyVal = snap[uidCol];

  if (ev.op === 'delete') {
    await db.run(`UPDATE ${table} SET deleted=1 WHERE ${uidCol}=?`, keyVal);
    return;
  }

  // force_points（超管直改）：无论新建/已存在都直接覆盖 points，必须先于 LWW 跳过判断，
  // updated_at 用事件里的新值。这是唯一允许回放覆盖余额的 students 事件。
  if (table === 'students' && snap.force_points === 1) {
    let gid = null;
    if (snap.group_uid) {
      const g = await db.get('SELECT id FROM groups WHERE uid=?', snap.group_uid);
      if (g) gid = g.id;
    }
    const localForce = await db.get('SELECT id FROM students WHERE uid=?', keyVal);
    if (localForce) {
      await db.run(
        `UPDATE students SET name=?, student_no=?, group_id=?, group_uid=?, points=?, avatar=?, updated_at=?, deleted=0 WHERE uid=?`,
        snap.name, snap.student_no || '', gid, snap.group_uid || '', snap.points || 0,
        snap.avatar || '👦', snap.updated_at || Date.now(), keyVal);
    } else {
      await db.run(
        `INSERT INTO students (uid, name, student_no, group_id, group_uid, points, avatar, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        keyVal, snap.name, snap.student_no || '', gid, snap.group_uid || '', snap.points || 0,
        snap.avatar || '👦', snap.created_at || Date.now(), snap.updated_at || Date.now());
    }
    return;
  }

  // LWW：本地已存在且 updated_at 更新，跳过
  const local = await db.get(`SELECT * FROM ${table} WHERE ${uidCol}=?`, keyVal);
  if (local) {
    if (snap.updated_at && Number(local.updated_at || 0) >= Number(snap.updated_at || 0)) return;
  }

  if (table === 'students') {
    let gid = null;
    if (snap.group_uid) {
      const g = await db.get('SELECT id FROM groups WHERE uid=?', snap.group_uid);
      if (g) gid = g.id;
    }
    if (local) {
      // 已存在：只更新元数据，不覆盖 points（余额由 point_records apply_delta 事件维护）
      await db.run(
        `UPDATE students SET name=?, student_no=?, group_id=?, group_uid=?, avatar=?, updated_at=?, deleted=0 WHERE uid=?`,
        snap.name, snap.student_no || '', gid, snap.group_uid || '', snap.avatar || '👦',
        snap.updated_at || Date.now(), keyVal);
    } else {
      // 新建：snapshot.points 作为初值（后续 apply_delta 事件累加）
      await db.run(
        `INSERT INTO students (uid, name, student_no, group_id, group_uid, points, avatar, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        keyVal, snap.name, snap.student_no || '', gid, snap.group_uid || '', snap.points || 0,
        snap.avatar || '👦', snap.created_at || Date.now(), snap.updated_at || Date.now());
    }
    return;
  }

  if (table === 'groups') {
    if (local) {
      await db.run(`UPDATE groups SET name=?, color=?, signature=?, updated_at=?, deleted=0 WHERE uid=?`,
        snap.name, snap.color || '#34c759', snap.signature || '', snap.updated_at || Date.now(), keyVal);
    } else {
      await db.run(`INSERT INTO groups (uid, name, color, signature, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
        keyVal, snap.name, snap.color || '#34c759', snap.signature || '',
        snap.created_at || Date.now(), snap.updated_at || Date.now());
    }
    return;
  }

  if (table === 'point_rules') {
    if (local) {
      await db.run(`UPDATE point_rules SET type=?, reason=?, points=?, is_custom=?, updated_at=?, deleted=0 WHERE uid=?`,
        snap.type, snap.reason, snap.points || 0, snap.is_custom ?? 1, snap.updated_at || Date.now(), keyVal);
    } else {
      await db.run(`INSERT INTO point_rules (uid, type, reason, points, is_custom, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
        keyVal, snap.type, snap.reason, snap.points || 0, snap.is_custom ?? 1,
        snap.created_at || Date.now(), snap.updated_at || Date.now());
    }
    return;
  }

  if (table === 'announcements') {
    if (local) {
      await db.run(
        `UPDATE announcements SET title=?, content=?, author=?, file_url=?, file_name=?, file_type=?, file_size=?,
                category=?, edited=?, editor=?, updated_at=?, deleted=0 WHERE uid=?`,
        snap.title, snap.content || '', snap.author || '', snap.file_url || '', snap.file_name || '',
        snap.file_type || '', snap.file_size || 0,
        snap.category || '通知公告', snap.edited ? 1 : 0, snap.editor || '',
        snap.updated_at || Date.now(), keyVal);
    } else {
      await db.run(
        `INSERT INTO announcements (uid, title, content, author, file_url, file_name, file_type, file_size,
                category, edited, editor, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        keyVal, snap.title, snap.content || '', snap.author || '', snap.file_url || '',
        snap.file_name || '', snap.file_type || '', snap.file_size || 0,
        snap.category || '通知公告', snap.edited ? 1 : 0, snap.editor || '',
        snap.created_at || Date.now(), snap.updated_at || Date.now());
    }
    return;
  }

  // announcement_versions：按 uid 幂等插入（只增不改），delete 忽略
  if (table === 'announcement_versions') {
    if (ev.op === 'delete') return;
    const exists = await db.get('SELECT id FROM announcement_versions WHERE uid=?', keyVal);
    if (exists) return;
    await db.run(
      `INSERT INTO announcement_versions (uid, ann_uid, title, content, category, file_url, file_name, file_type, file_size, editor, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      keyVal, snap.ann_uid || '', snap.title || '', snap.content || '',
      snap.category || '通知公告', snap.file_url || '', snap.file_name || '',
      snap.file_type || '', snap.file_size || 0, snap.editor || '',
      snap.created_at || Date.now());
    return;
  }

  // announcement_reads：按 uid 幂等插入；重复 ann_uid+device_uid 跳过
  if (table === 'announcement_reads') {
    if (ev.op === 'delete') return;
    const exists = await db.get('SELECT id FROM announcement_reads WHERE uid=?', keyVal);
    if (exists) return;
    const dup = await db.get(
      'SELECT id FROM announcement_reads WHERE ann_uid=? AND device_uid=?',
      snap.ann_uid || '', snap.device_uid || '');
    if (dup) return;
    await db.run(
      `INSERT INTO announcement_reads (uid, ann_uid, device_uid, created_at) VALUES (?,?,?,?)`,
      keyVal, snap.ann_uid || '', snap.device_uid || '', snap.created_at || Date.now());
    return;
  }

  // front_messages：upsert LWW + 软删（字段齐全）
  if (table === 'front_messages') {
    if (ev.op === 'delete') {
      await db.run('UPDATE front_messages SET deleted=1, updated_at=? WHERE uid=?',
        snap.updated_at || Date.now(), keyVal);
      return;
    }
    if (local) {
      await db.run(
        `UPDATE front_messages SET title=?, content=?, file_url=?, file_name=?, file_type=?, file_size=?,
                device_uid=?, device_name=?, is_read=?, read_at=?, read_by=?, updated_at=?, deleted=0 WHERE uid=?`,
        snap.title || '', snap.content || '', snap.file_url || '', snap.file_name || '',
        snap.file_type || '', snap.file_size || 0,
        snap.device_uid || '', snap.device_name || '',
        snap.is_read ? 1 : 0, snap.read_at || null, snap.read_by || '',
        snap.updated_at || Date.now(), keyVal);
    } else {
      await db.run(
        `INSERT INTO front_messages (uid, title, content, file_url, file_name, file_type, file_size,
                device_uid, device_name, is_read, read_at, read_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        keyVal, snap.title || '', snap.content || '', snap.file_url || '', snap.file_name || '',
        snap.file_type || '', snap.file_size || 0,
        snap.device_uid || '', snap.device_name || '',
        snap.is_read ? 1 : 0, snap.read_at || null, snap.read_by || '',
        snap.created_at || Date.now(), snap.updated_at || Date.now());
    }
    return;
  }

  // rank_snapshots：按 kind+period_index 幂等 upsert，payload 原样
  if (table === 'rank_snapshots') {
    if (ev.op === 'delete') return;
    const rsKind = snap.kind || '';
    const rsIdx = Number(snap.period_index || 0);
    const existRow = await db.get(
      'SELECT uid FROM rank_snapshots WHERE kind=? AND period_index=?', rsKind, rsIdx);
    if (existRow) {
      await db.run(
        'UPDATE rank_snapshots SET period_start=?, period_end=?, payload=?, created_at=? WHERE kind=? AND period_index=?',
        snap.period_start || 0, snap.period_end || 0, String(snap.payload || '{}'),
        snap.created_at || Date.now(), rsKind, rsIdx);
    } else {
      await db.run(
        `INSERT INTO rank_snapshots (uid, kind, period_index, period_start, period_end, payload, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        keyVal, rsKind, rsIdx, snap.period_start || 0, snap.period_end || 0,
        String(snap.payload || '{}'), snap.created_at || Date.now());
    }
    return;
  }

  // activation_codes：按 uid upsert/软删
  if (table === 'activation_codes') {
    if (ev.op === 'delete') {
      await db.run(`UPDATE activation_codes SET deleted=1 WHERE uid=?`, keyVal);
      return;
    }
    if (local) {
      await db.run(
        `UPDATE activation_codes SET code=?, label=?, created_by=?, used=?, used_at=?, used_by=?, used_ip=?, updated_at=?, deleted=0 WHERE uid=?`,
        snap.code, snap.label || '', snap.created_by || '', snap.used ? 1 : 0,
        snap.used_at || null, snap.used_by || '', snap.used_ip || '',
        snap.updated_at || Date.now(), keyVal);
    } else {
      await db.run(
        `INSERT INTO activation_codes (uid, code, label, created_by, used, used_at, used_by, used_ip, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        keyVal, snap.code, snap.label || '', snap.created_by || '', snap.used ? 1 : 0,
        snap.used_at || null, snap.used_by || '', snap.used_ip || '',
        snap.created_at || Date.now(), snap.updated_at || Date.now());
    }
    return;
  }

  // device_tokens：按 uid upsert/软删（token 唯一，B 端签发的整行进入 A 端）
  if (table === 'device_tokens') {
    if (ev.op === 'delete') {
      await db.run(`UPDATE device_tokens SET deleted=1 WHERE uid=?`, keyVal);
      return;
    }
    if (local) {
      await db.run(
        `UPDATE device_tokens SET token=?, device_uuid=?, fingerprint=?, device_name=?, ip=?, ua=?,
                activation_code=?, is_master=?, last_seen=?, updated_at=?, deleted=0
         WHERE uid=?`,
        snap.token || '', snap.device_uuid || '', snap.fingerprint || '', snap.device_name || '',
        snap.ip || '', snap.ua || '', snap.activation_code || '', snap.is_master ? 1 : 0,
        snap.last_seen || Date.now(), snap.updated_at || Date.now(), keyVal);
    } else {
      await db.run(
        `INSERT INTO device_tokens (uid, token, device_uuid, fingerprint, device_name, ip, ua, activation_code, is_master, last_seen, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        keyVal, snap.token || '', snap.device_uuid || '', snap.fingerprint || '', snap.device_name || '',
        snap.ip || '', snap.ua || '', snap.activation_code || '', snap.is_master ? 1 : 0,
        snap.last_seen || Date.now(), snap.created_at || Date.now(), snap.updated_at || Date.now());
    }
    return;
  }

  // admin_users：按 uid upsert/软删
  if (table === 'admin_users') {
    if (ev.op === 'delete') {
      await db.run(`UPDATE admin_users SET deleted=1 WHERE uid=?`, keyVal);
      return;
    }
    if (local) {
      await db.run(
        `UPDATE admin_users SET password_hash=?, password_salt=?, role=?, display_name=?, updated_at=?, deleted=0 WHERE uid=?`,
        snap.password_hash || '', snap.password_salt || '', snap.role || 'teacher',
        snap.display_name || snap.username || '', snap.updated_at || Date.now(), keyVal);
    } else {
      await db.run(
        `INSERT INTO admin_users (uid, username, password_hash, password_salt, role, display_name, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        keyVal, snap.username || '', snap.password_hash || '', snap.password_salt || '',
        snap.role || 'teacher', snap.display_name || snap.username || '',
        snap.created_at || Date.now(), snap.updated_at || Date.now());
    }
    return;
  }

  // admin_config：按 key upsert
  if (table === 'admin_config') {
    if (ev.op === 'delete') {
      await db.run(`DELETE FROM admin_config WHERE key=?`, keyVal);
      return;
    }
    await db.run(`INSERT OR REPLACE INTO admin_config (key, value, updated_at) VALUES (?,?,?)`,
      keyVal, String(snap.value ?? ''), snap.updated_at || Date.now());
    return;
  }

  // system_announcements：系统公告，upsert LWW + 软删
  if (table === 'system_announcements') {
    if (ev.op === 'delete') {
      await db.run('UPDATE system_announcements SET deleted=1, updated_at=? WHERE uid=?',
        snap.updated_at || Date.now(), keyVal);
      return;
    }
    if (local) {
      await db.run(
        `UPDATE system_announcements SET title=?, content=?, created_by=?, is_active=?, updated_at=?, deleted=0 WHERE uid=?`,
        snap.title || '', snap.content || '', snap.created_by || '',
        snap.is_active != null ? (snap.is_active ? 1 : 0) : 1,
        snap.updated_at || Date.now(), keyVal);
    } else {
      await db.run(
        `INSERT INTO system_announcements (uid, title, content, created_by, is_active, created_at, updated_at, deleted)
         VALUES (?,?,?,?,?,?,?,?)`,
        keyVal, snap.title || '', snap.content || '', snap.created_by || '',
        snap.is_active != null ? (snap.is_active ? 1 : 0) : 1,
        snap.created_at || Date.now(), snap.updated_at || Date.now(), 0);
    }
    return;
  }

  // login_logs / audit_logs：按 uid 幂等插入（已存在跳过）
  if (table === 'login_logs' || table === 'audit_logs') {
    if (ev.op === 'delete') return;
    const exists = await db.get(`SELECT id FROM ${table} WHERE uid=?`, keyVal);
    if (exists) return;
    if (table === 'login_logs') {
      await db.run(
        `INSERT INTO login_logs (uid, username, role, ip, ua, success, created_at) VALUES (?,?,?,?,?,?,?)`,
        keyVal, snap.username || '', snap.role || '', snap.ip || '', snap.ua || '',
        snap.success ? 1 : 0, snap.created_at || Date.now());
    } else {
      await db.run(
        `INSERT INTO audit_logs (uid, operator, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)`,
        keyVal, snap.operator || '', snap.action || '', snap.target || '',
        snap.detail || '', snap.ip || '', snap.created_at || Date.now());
    }
    return;
  }
}

export async function replayEvent(db, ev) {
  const tbl = ev.tbl;
  if (tbl === 'point_records') {
    const snap = parseSnap(ev.snapshot);
    if (!snap.uid) return;
    const exists = await db.get('SELECT id FROM point_records WHERE uid=?', snap.uid);
    if (exists) return;
    const sidRow = await db.get('SELECT id FROM students WHERE uid=?', snap.student_uid);
    const sid = sidRow ? sidRow.id : null;
    const t = snap.created_at || Date.now();
    await db.run(
      `INSERT INTO point_records (uid, student_id, student_uid, student_name, group_name, type, reason, points, operator, apply, hidden, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      snap.uid, sid, snap.student_uid, snap.student_name || '', snap.group_name || '',
      snap.type || 'add', snap.reason || '', snap.points || 0, snap.operator || '', 1,
      snap.hidden ? 1 : 0, t);
    if (ev.apply_delta === 1 && sid) {
      const stu = await db.get('SELECT points FROM students WHERE id=?', sid);
      if (stu) {
        let next = Number(stu.points || 0);
        if (snap.type === 'add') next += Number(snap.points || 0);
        else if (snap.type === 'sub') next -= Number(snap.points || 0);
        else if (snap.type === 'set') next = Number(snap.points || 0);
        await db.run('UPDATE students SET points=?, updated_at=? WHERE id=?', next, t, sid);
      }
    }
    return;
  }

  const opts = tbl === 'admin_config' ? { keyCol: 'key' } : {};
  await applyUpsert(db, ev, tbl, opts);
}
