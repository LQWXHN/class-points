#!/usr/bin/env node
// ============================================================
// 班级积分系统 v4.0 数据迁移脚本
// 输入：wrangler d1 export 导出的旧库 SQL（旧 class-points-db）
// 输出：
//   1) --out-db  ：新 SQLite 库（家里 Node 主站 data/app.db）
//   2) --out-d1  ：新 D1 导入 SQL（wrangler d1 execute class-points-db-v4 --file）
// 规则：SPEC.md §9
//   - 每行回填确定性 UUIDv5（命名空间固定，家里库与 CF 库两次迁移结果一致）
//   - created_at/updated_at 由旧 'YYYY-MM-DD HH:MM:SS'(UTC) 转毫秒
//   - point_records 旧流水全部 apply=0；每个学生追加一条 type='set' 期初余额记录
//   - 不迁移 face_descriptors / 旧密码哈希；resend_api_key 丢弃
// 用法：
//   node scripts/migrate.mjs --input=scripts/tmp/old.sql --out-db=data/app.db --out-d1=scripts/tmp/new-d1.sql
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------- 参数 ----------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const inputPath = path.resolve(ROOT, args.input || 'scripts/tmp/old.sql');
const outDbAbs = path.resolve(ROOT, args['out-db'] || 'data/app.db');
const outD1Abs = path.resolve(ROOT, args['out-d1'] || 'scripts/tmp/new-d1.sql');
const DEFAULT_SCHEMA = path.join(ROOT, 'app/src/db/schema.sql');
const FALLBACK_SCHEMA = path.join(__dirname, 'fixtures/schema-reference.sql');
const schemaPath = args.schema
  ? path.resolve(ROOT, args.schema)
  : fs.existsSync(DEFAULT_SCHEMA)
    ? DEFAULT_SCHEMA
    : FALLBACK_SCHEMA;

// 统一基准毫秒常量（整个迁移只用这一个值，保证两份产物一致）
const BASELINE = args.baseline ? Number(args.baseline) : Date.now();

// 确定性 UUIDv5 命名空间（固定值，请勿更改——改了会导致两端 uid 对不上）
const UUID_NAMESPACE = '6f1e3a2c-7d9b-4a8e-9c5f-2b4d6e8a1c3f';
function uuidv5(name) {
  const ns = Buffer.from(UUID_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();
  const h = hash.subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------- 报告/警告 ----------------
const warnings = [];
const report = { in: {}, out: {}, discarded: [], baselineRecords: 0 };
const missingTables = [];
function needTable(name) {
  const has = Array.isArray(oldRows[name]);
  if (!has) missingTables.push(name);
  return has || false;
}

// ---------------- SQL 解析器（字符串字面量感知） ----------------
function* splitStatements(sql) {
  let i = 0;
  const n = sql.length;
  let start = 0;
  while (i < n) {
    const c = sql[i];
    if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === ';') {
      yield sql.slice(start, i);
      start = i + 1;
    }
    i++;
  }
  if (start < n) {
    const tail = sql.slice(start);
    if (tail.trim()) yield tail;
  }
}
function skipWs(s, i) { while (i < s.length && /\s/.test(s[i])) i++; return i; }

function parseLiteral(s, i) {
  i = skipWs(s, i);
  const c = s[i];
  if (c === "'") {
    let out = '';
    i++;
    while (i < s.length) {
      if (s[i] === "\\") {
        const n = s[i + 1];
        if (n === 'n') out += '\n';
        else if (n === 't') out += '\t';
        else if (n === 'r') out += '\r';
        else if (n === "'") out += "'";
        else if (n === "\\") out += "\\";
        else out += n ?? '';
        i += 2;
        continue;
      }
      if (s[i] === "'") {
        if (s[i + 1] === "'") { out += "'"; i += 2; continue; }
        i++;
        break;
      }
      out += s[i];
      i++;
    }
    return [out, i];
  }
  if ((c === 'X' || c === 'x') && s[i + 1] === "'") {
    let hex = '';
    i += 2;
    while (i < s.length && s[i] !== "'") { hex += s[i]; i++; }
    i++;
    return [Buffer.from(hex, 'hex'), i];
  }
  let j = i;
  while (j < s.length && /[A-Za-z0-9._+-]/.test(s[j])) j++;
  const tok = s.slice(i, j);
  const up = tok.toUpperCase();
  if (up === 'NULL') return [null, j];
  if (up === 'TRUE') return [1, j];
  if (up === 'FALSE') return [0, j];
  if (tok !== '' && !Number.isNaN(Number(tok))) return [Number(tok), j];
  return [tok, j];
}

// 解析一个值表达式：字面量 / 数字 / NULL / 函数调用（如 replace('x','\n',char(10))）
function parseExpression(s, i) {
  i = skipWs(s, i);
  const c = s[i];
  if (c === "'") return parseLiteral(s, i);
  if ((c === 'X' || c === 'x') && s[i + 1] === "'") return parseLiteral(s, i);
  if (/[0-9-]/.test(c)) return parseLiteral(s, i);
  // 标识符（函数名/关键字）
  let j = i;
  while (j < s.length && /[A-Za-z0-9_.]/.test(s[j])) j++;
  const word = s.slice(i, j);
  const up = word.toUpperCase();
  if (up === 'NULL') return [null, j];
  if (up === 'TRUE') return [1, j];
  if (up === 'FALSE') return [0, j];
  let k = skipWs(s, j);
  if (s[k] === '(') {
    // 消费到匹配的右括号（字符串字面量感知）
    const startWord = j;
    let depth = 1;
    k++;
    while (k < s.length && depth > 0) {
      if (s[k] === "'") {
        k++;
        while (k < s.length) {
          if (s[k] === "\\") { k += 2; continue; }
          if (s[k] === "'") { k++; break; }
          k++;
        }
        continue;
      }
      if (s[k] === '(') depth++;
      else if (s[k] === ')') depth--;
      k++;
    }
    const expr = s.slice(startWord, k);
    // replace('...', '\n', char(10)) → 取第一个字符串参数
    const m = expr.match(/^replace\(\s*'((?:[^'\\]|\\.)*)'\s*,/);
    if (m) {
      let v = m[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      return [v, k];
    }
    return [null, k];
  }
  if (word !== '' && !Number.isNaN(Number(word))) return [Number(word), j];
  return [word, j];
}

function parseValuesList(s, start) {
  const rows = [];
  let i = start;
  for (;;) {
    i = skipWs(s, i);
    if (s[i] !== '(') break;
    i++;
    const row = [];
    for (;;) {
      i = skipWs(s, i);
      const [v, ni] = parseExpression(s, i);
      row.push(v);
      i = ni;
      i = skipWs(s, i);
      if (s[i] === ',') { i++; continue; }
      if (s[i] === ')') { i++; break; }
      throw new Error('INSERT 值列表解析失败，附近文本：' + JSON.stringify(s.slice(i, i + 60)));
    }
    rows.push(row);
    i = skipWs(s, i);
    if (s[i] === ',') { i++; continue; }
    break;
  }
  return [rows, i];
}

function parseCreateTable(stmt) {
  const m = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([\s\S]*)\)/i);
  if (!m) return null;
  const body = m[2];
  const colTokens = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    if (ch === "'") { inStr = !inStr; cur += ch; continue; }
    if (!inStr && ch === '(') depth++;
    if (!inStr && ch === ')') depth--;
    if (!inStr && depth === 0 && ch === ',') { colTokens.push(cur); cur = ''; continue; }
    cur += ch;
  }
  colTokens.push(cur);
  const colNames = [];
  for (let c of colTokens) {
    c = c.replace(/--.*$/gm, '').trim(); // 剥掉行内注释（注释可能跨行粘到下一列）
    const fm = c.match(/^[`"]?(\w+)[`"]?/);
    if (!fm) continue;
    if (/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)$/i.test(fm[1])) continue;
    colNames.push(fm[1]);
  }
  return { name: m[1], colNames };
}

function parseInsert(stmt) {
  const m = stmt.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+[`"]?(\w+)[`"]?\s*(?:\(([^)]*)\))?\s*VALUES\s*/i);
  if (!m) return null;
  const table = m[1];
  const cols = m[2] ? m[2].split(',').map((s) => s.trim().replace(/[`"]/g, '')) : null;
  const [rows] = parseValuesList(stmt, m.index + m[0].length);
  return { table, cols, rows };
}

// ---------------- 时间转换 ----------------
let tsFallbackCount = 0;
function toMs(v) {
  if (v == null || v === '' || v === 0 || v === '0') return null;
  if (typeof v === 'number') return Math.abs(v) > 1e12 ? v : v * 1000;
  const s = String(v).trim();
  if (!s || s === '0') return null;
  // 旧 datetime('now') 输出 'YYYY-MM-DD HH:MM:SS'（UTC）
  let t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z');
  if (!Number.isNaN(t)) return t;
  t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  return null;
}
function tsMs(v) {
  const t = toMs(v);
  if (t == null) { tsFallbackCount++; return BASELINE; }
  return t;
}

// 文件 URL 规范化：完整旧域名 → 剥 origin；%2F 编码 → 解码成新路由可直接打开的形式
// 新系统 GET /api/file/* 会自行 decodeURIComponent 一次，这里统一存解码后的相对路径
const urlStats = { avatarNormalized: 0, fileNormalized: 0, unrecognized: 0 };
function normalizeFileUrl(u) {
  if (u == null || u === '') return '';
  let s = String(u).trim();
  if (!s) return '';
  // 剥掉 https://host
  s = s.replace(/^https?:\/\/[^/]+/i, '');
  if (!s.startsWith('/')) { urlStats.unrecognized++; return String(u); }
  try { s = decodeURIComponent(s); } catch { /* 保留原样 */ }
  return s;
}

// ---------------- 读取旧库导出 ----------------
if (!fs.existsSync(inputPath)) {
  console.error(`[错误] 找不到旧库导出文件：${inputPath}`);
  console.error('请先运行 scripts/export-old-d1.ps1（或 .sh）生成 old.sql，步骤见 scripts/export-old-d1.md');
  process.exit(2);
}
// 分段读取（避免一次性把超大文件吃进内存），但语句仍按完整字符串处理
const sqlChunks = [];
{
  const fd = fs.openSync(inputPath, 'r');
  const buf = Buffer.alloc(1 << 20); // 1MB
  let pending = '';
  for (;;) {
    const rd = fs.readSync(fd, buf, 0, buf.length, null);
    if (rd === 0) break;
    sqlChunks.push(buf.subarray(0, rd).toString('utf8'));
  }
  fs.closeSync(fd);
}
const oldSql = sqlChunks.join('');

const oldCreate = {};
const oldRows = {};
for (const stmt of splitStatements(oldSql)) {
  const st = stmt.trim();
  if (!st) continue;
  const ct = parseCreateTable(st);
  if (ct) { oldCreate[ct.name] = ct.colNames; continue; }
  const ins = parseInsert(st);
  if (ins) {
    if (ins.table === 'sqlite_sequence') continue; // SQLite 自增序列表，无需迁移
    const cols = ins.cols || oldCreate[ins.table];
    if (!cols) { warnings.push(`INSERT INTO ${ins.table} 但该表无 CREATE TABLE 定义，已跳过`); continue; }
    for (const r of ins.rows) {
      const obj = {};
      cols.forEach((c, idx) => { obj[c] = r[idx]; });
      (oldRows[ins.table] ||= []).push(obj);
    }
  }
}

// ---------------- 读取新 schema ----------------
if (!fs.existsSync(schemaPath)) {
  console.error(`[错误] 找不到 schema 文件：${schemaPath}`);
  process.exit(2);
}
const newSchema = fs.readFileSync(schemaPath, 'utf8');
const newCreate = {};
for (const stmt of splitStatements(newSchema)) {
  const ct = parseCreateTable(stmt);
  if (ct) newCreate[ct.name] = new Set(ct.colNames);
}
function pickCols(table, rowObj) {
  const set = newCreate[table];
  if (!set) return [];
  return Object.keys(rowObj).filter((c) => set.has(c));
}

// ---------------- 逐表转换 ----------------
const nIn = (t) => (oldRows[t] || []).length;

// groups（先做，students 要引用）
needTable('groups');
const groupUidMap = {};
const groupLocalMap = {};
const newGroups = (oldRows['groups'] || []).map((g, i) => {
  const uid = uuidv5(`groups:${g.id}`);
  groupUidMap[g.id] = uid;
  groupLocalMap[g.id] = i + 1;
  return {
    uid,
    name: g.name ?? '',
    color: g.color ?? '#007aff',
    signature: g.signature ?? '',
    created_at: tsMs(g.created_at),
    updated_at: tsMs(g.updated_at ?? g.created_at),
    deleted: 0,
  };
});
report.in.groups = nIn('groups');
report.out.groups = newGroups.length;

// students
needTable('students');
const studentUidById = {};
const newStudents = (oldRows['students'] || []).map((s) => {
  const uid = uuidv5(`students:${s.id}`);
  studentUidById[s.id] = uid;
  // 新 schema 只有 avatar 字段：旧数据里完整 URL 可能在 avatar 或 avatar_url 列
  let avatar = s.avatar ?? '';
  const src = s.avatar_url || (avatar && /^https?:\/\//i.test(avatar) ? avatar : '');
  if (src) {
    const norm = normalizeFileUrl(src);
    if (norm && norm !== String(src).trim()) urlStats.avatarNormalized++;
    avatar = norm || avatar;
  }
  return {
    uid,
    name: s.name ?? '',
    student_no: s.student_no ?? '',
    group_id: s.group_id == null ? null : (groupLocalMap[s.group_id] ?? null),
    group_uid: s.group_id == null ? '' : (groupUidMap[s.group_id] ?? ''),
    points: Number(s.points) || 0,
    avatar,
    created_at: tsMs(s.created_at),
    updated_at: tsMs(s.updated_at ?? s.created_at),
    deleted: 0,
  };
});
report.in.students = nIn('students');
report.out.students = newStudents.length;

// point_rules
needTable('point_rules');
const newRules = (oldRows['point_rules'] || []).map((r) => ({
  uid: uuidv5(`point_rules:${r.id}`),
  type: r.type ?? 'add',
  reason: r.reason ?? '',
  points: Number(r.points) || 0,
  is_custom: Number(r.is_custom) || 0,
  created_at: tsMs(r.created_at),
  updated_at: tsMs(r.updated_at ?? r.created_at),
  deleted: 0,
}));
report.in.point_rules = nIn('point_rules');
report.out.point_rules = newRules.length;

// announcements
needTable('announcements');
const newAnnouncements = (oldRows['announcements'] || []).map((a) => {
  let fileUrl = a.file_url ?? '';
  if (fileUrl) {
    const norm = normalizeFileUrl(fileUrl);
    if (norm && norm !== fileUrl) urlStats.fileNormalized++;
    fileUrl = norm;
  }
  return {
    uid: uuidv5(`announcements:${a.id}`),
    title: a.title ?? '',
    content: a.content ?? '',
    author: '系统',
    file_url: fileUrl,
    file_name: a.file_name ?? '',
    file_type: a.file_type ?? '',
    file_size: Number(a.file_size) || 0,
    created_at: tsMs(a.created_at),
    updated_at: tsMs(a.updated_at ?? a.created_at),
    deleted: 0,
  };
});
report.in.announcements = nIn('announcements');
report.out.announcements = newAnnouncements.length;

// admin_config（白名单）
needTable('admin_config');
const KEEP_KEYS = new Set([
  'site_title',
  'avatar_frame_leaderboard',
  'avatar_frame_cards',
  'avatar_frame_tier',
  'resend_from',
  'notify_email',
  'rescue_email',
]);
const KEEP_PREFIX = ['notify_on_', 'auto_backup_'];
const DROP_KEYS = {
  resend_api_key: '安全原因丢弃（邮件发信密钥不迁移，请在后台重新填写）',
  password_hash: '旧密码哈希不迁移（teacher/admin 首次设密）',
  password_salt: '旧密码盐不迁移（首次设密）',
  smtp_pass: '邮件密码丢弃（同 resend_api_key）',
  face_enabled: '人脸功能整体下线',
  device_activation_code: '旧单激活码已转为 activation_codes 表一行',
  device_activation_codes: '旧激活码 JSON 已转为 activation_codes 表多行',
};
const cfgRows = oldRows['admin_config'] || [];
const cfgMap = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
const newConfig = [];
let classNameSeen = null;
for (const r of cfgRows) {
  const k = r.key;
  if (KEEP_KEYS.has(k) || KEEP_PREFIX.some((p) => k.startsWith(p))) {
    newConfig.push({ uid: uuidv5(`admin_config:${k}`), key: k, value: r.value ?? '', created_at: BASELINE, updated_at: BASELINE, deleted: 0 });
  } else if (k === 'class_name') {
    classNameSeen = r.value;
  } else if (DROP_KEYS[k]) {
    report.discarded.push(`admin_config/${k}：${DROP_KEYS[k]}`);
  }
}
if (cfgMap['site_title'] == null && classNameSeen != null) {
  newConfig.push({ uid: uuidv5('admin_config:site_title'), key: 'site_title', value: classNameSeen, created_at: BASELINE, updated_at: BASELINE, deleted: 0 });
  warnings.push('旧库无 site_title，已用 class_name 值回填为 site_title');
}
if (!newConfig.some((r) => r.key === 'site_title')) {
  newConfig.push({ uid: uuidv5('admin_config:site_title'), key: 'site_title', value: '班级积分系统', created_at: BASELINE, updated_at: BASELINE, deleted: 0 });
}
report.in.admin_config = cfgRows.length;
report.out.admin_config = newConfig.length;

// activation_codes（由旧 admin_config 里的 JSON 转换）
let newCodes = [];
if (cfgMap['device_activation_codes']) {
  try {
    const arr = JSON.parse(cfgMap['device_activation_codes']);
    for (const c of arr) {
      if (!c || !c.code) continue;
      newCodes.push({
        uid: uuidv5(`activation_codes:${c.code}`),
        code: c.code,
        label: c.label ?? '',
        used: c.used ? 1 : 0,
        used_at: c.usedAt ? tsMs(c.usedAt) : null,
        used_by: c.usedBy ?? '',
        created_by: c.createdBy ?? '',
        created_at: c.createdAt ? tsMs(c.createdAt) : BASELINE,
        updated_at: BASELINE,
        deleted: 0,
      });
    }
  } catch {
    warnings.push('device_activation_codes JSON 解析失败，已跳过激活码迁移');
  }
}
if (cfgMap['device_activation_code']) {
  newCodes.push({
    uid: uuidv5(`activation_codes:${cfgMap['device_activation_code']}`),
    code: cfgMap['device_activation_code'],
    label: '（旧激活码）',
    used: 0,
    used_at: null,
    used_by: '',
    created_by: 'teacher',
    created_at: BASELINE,
    updated_at: BASELINE,
    deleted: 0,
  });
}
report.in.activation_codes = 0;
report.out.activation_codes = newCodes.length;

// device_tokens（旧 token 保留，设备无需重新激活；device_uuid 由 token 确定性生成）
needTable('device_tokens');
const newDevices = (oldRows['device_tokens'] || [])
  .filter((d) => d.token)
  .map((d) => ({
    uid: uuidv5(`device_tokens:${d.id}`),
    token: d.token,
    device_uuid: uuidv5(`device_uuid:${d.token}`),
    fingerprint: '',
    device_name: d.device_name ?? '',
    activation_code: d.activation_code ?? '',
    ip: d.ip ?? '',
    ua: d.ua ?? '',
    is_master: 0,
    last_seen: tsMs(d.last_seen ?? d.activated_at),
    created_at: tsMs(d.activated_at),
    updated_at: tsMs(d.last_seen ?? d.activated_at),
    deleted: 0,
  }));
report.in.device_tokens = nIn('device_tokens');
report.out.device_tokens = newDevices.length;

// login_logs
needTable('login_logs');
const newLoginLogs = (oldRows['login_logs'] || []).map((r) => ({
  uid: uuidv5(`login_logs:${r.id}`),
  username: r.username ?? '',
  role: r.role ?? '',
  ip: r.ip ?? '',
  ua: r.ua ?? '',
  country: r.country ?? '',
  city: r.city ?? '',
  success: Number(r.success) ? 1 : 0,
  created_at: tsMs(r.created_at),
  updated_at: BASELINE,
  deleted: 0,
}));
report.in.login_logs = nIn('login_logs');
report.out.login_logs = newLoginLogs.length;

// audit_logs
needTable('audit_logs');
const newAuditLogs = (oldRows['audit_logs'] || []).map((r) => ({
  uid: uuidv5(`audit_logs:${r.id}`),
  operator: r.operator ?? '',
  action: r.action ?? '',
  target: r.target ?? '',
  detail: r.detail ?? '',
  ip: r.ip ?? '',
  created_at: tsMs(r.created_at),
  updated_at: BASELINE,
  deleted: 0,
}));
report.in.audit_logs = nIn('audit_logs');
report.out.audit_logs = newAuditLogs.length;

// backup_log（新 schema 列名 storage_key）
needTable('backup_log');
const newBackupLogs = (oldRows['backup_log'] || []).map((r) => ({
  uid: uuidv5(`backup_log:${r.id}`),
  filename: r.filename ?? '',
  size: Number(r.size) || 0,
  type: r.type ?? 'manual',
  storage_key: r.r2_key ?? '',
  created_at: tsMs(r.created_at),
}));
report.in.backup_log = nIn('backup_log');
report.out.backup_log = newBackupLogs.length;

// point_records（旧流水 apply=0 + 期初余额 set 记录）
needTable('point_records');
const newRecords = (oldRows['point_records'] || []).map((r) => ({
  uid: uuidv5(`point_records:${r.id ?? `legacy-${r.student_id}-${r.created_at}-${r.reason}`}`),
  student_uid: studentUidById[r.student_id] ?? '',
  student_name: r.student_name ?? '',
  group_name: r.group_name ?? '',
  type: r.type ?? 'system',
  reason: r.reason ?? '',
  points: Number(r.points) || 0,
  operator: r.operator ?? 'system',
  apply: 0,
  created_at: tsMs(r.created_at),
}));
const baselineRecords = (oldRows['students'] || []).map((s) => ({
  uid: uuidv5(`point_records:baseline:${s.id}`),
  student_uid: studentUidById[s.id] ?? '',
  student_name: s.name ?? '',
  group_name: (oldRows['groups'] || []).find((g) => g.id === s.group_id)?.name ?? '',
  type: 'set',
  reason: '期初余额（数据迁移）',
  points: Number(s.points) || 0,
  operator: 'system',
  apply: 1,
  created_at: BASELINE,
  updated_at: BASELINE,
  deleted: 0,
}));
report.in.point_records = nIn('point_records');
report.out.point_records = newRecords.length + baselineRecords.length;
report.baselineRecords = baselineRecords.length;

// 丢弃的表
if (nIn('face_descriptors') > 0) report.discarded.push(`face_descriptors（${nIn('face_descriptors')} 行）：人脸功能整体下线，不迁移`);
if (nIn('admin_users') > 0) report.discarded.push(`admin_users（${nIn('admin_users')} 行）：旧密码哈希不迁移，teacher/admin 首次设密`);

// ---------------- SQL 输出 ----------------
function sqlValue(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`;
  return "'" + String(v).replace(/'/g, "''") + "'";
}
const tableData = [
  ['groups', newGroups],
  ['students', newStudents],
  ['point_rules', newRules],
  ['announcements', newAnnouncements],
  ['admin_config', newConfig],
  ['activation_codes', newCodes],
  ['device_tokens', newDevices],
  ['login_logs', newLoginLogs],
  ['audit_logs', newAuditLogs],
  ['backup_log', newBackupLogs],
  ['point_records', [...newRecords, ...baselineRecords]],
];
const allInsertStmts = [];
for (const [table, rows] of tableData) {
  if (!rows.length) continue;
  if (!newCreate[table]) { warnings.push(`新 schema 中没有表 ${table}，${rows.length} 行未写入`); continue; }
  const cols = pickCols(table, rows[0]);
  // admin_config 有种子行（site_title 默认值），用 OR REPLACE 避免主键冲突
  const verb = table === 'admin_config' ? 'INSERT OR REPLACE' : 'INSERT';
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const values = slice.map((r) => '(' + cols.map((c) => sqlValue(r[c])).join(', ') + ')').join(',\n');
    allInsertStmts.push(`${verb} INTO ${table} (${cols.join(', ')}) VALUES\n${values};`);
  }
}

// ---------------- 写 D1 SQL 文件 ----------------
{
  fs.mkdirSync(path.dirname(outD1Abs), { recursive: true });
  const ddl = newSchema.replace(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/gi, 'CREATE TABLE IF NOT EXISTS ');
  const header = [
    '-- 班级积分系统 v4.0 新 D1 导入脚本',
    '-- 由 scripts/migrate.mjs 生成',
    `-- 基准时间(ms) = ${BASELINE}`,
    '-- 用法：wrangler d1 execute class-points-db-v4 --file=<本文件路径> --remote',
    '',
  ].join('\n');
  fs.writeFileSync(outD1Abs, header + ddl + '\n\n' + allInsertStmts.join('\n\n') + '\n', 'utf8');
}

// ---------------- 写 SQLite 库 ----------------
if (args['skip-db']) {
  console.log('（--skip-db，跳过 SQLite 写盘）');
} else {
  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch {
    try {
      ({ default: Database } = await import(path.join(ROOT, 'app/node_modules/better-sqlite3/lib/index.js')));
    } catch {
      console.error('[错误] 未找到 better-sqlite3。请任选其一：');
      console.error('  1) 项目根执行：npm i better-sqlite3 --no-save');
      console.error('  2) scripts 目录执行：npm i better-sqlite3');
      process.exit(3);
    }
  }
  fs.mkdirSync(path.dirname(outDbAbs), { recursive: true });
  if (fs.existsSync(outDbAbs)) fs.rmSync(outDbAbs);
  const db = new Database(outDbAbs);
  db.exec(newSchema);
  for (const s of allInsertStmts) db.exec(s);
  db.close();
}

// ---------------- 迁移报告 ----------------
console.log('================ 迁移报告 ================');
console.log(`基准时间常量 BASELINE = ${BASELINE}（${new Date(BASELINE).toISOString()}）`);
console.log(`schema = ${schemaPath}`);
console.log('');
console.log('表              旧行数 -> 新行数');
for (const t of Object.keys(report.in)) {
  console.log(`${t.padEnd(14)} ${String(report.in[t]).padStart(6)} -> ${String(report.out[t] ?? 0).padStart(6)}`);
}
console.log('');
console.log(`期初余额(set)记录：${report.baselineRecords} 条`);
console.log(`时间戳缺失/异常已用基准时间回填：${tsFallbackCount} 处`);
console.log(`文件 URL 规范化：头像 ${urlStats.avatarNormalized} 条、附件 ${urlStats.fileNormalized} 条、无法识别 ${urlStats.unrecognized} 条`);
if (missingTables.length) {
  console.log('旧库中缺失（非致命，已按 0 行处理）：' + missingTables.join(', '));
}
if (report.discarded.length) {
  console.log('');
  console.log('丢弃项：');
  for (const d of report.discarded) console.log('  - ' + d);
}
if (warnings.length) {
  console.log('');
  console.log('警告：');
  for (const w of warnings) console.log('  ! ' + w);
}
console.log('');
console.log(`输出：${outDbAbs}`);
console.log(`输出：${outD1Abs}`);
console.log('=========================================');
