#!/usr/bin/env node
// ============================================================
// 迁移核对脚本：对比旧导出 SQL 与新 SQLite 库（或给出 D1 侧人工执行清单）
// 用法：
//   node scripts/verify-migration.mjs --old=scripts/tmp/old.sql --new-db=data/app.db
//   node scripts/verify-migration.mjs --old=scripts/tmp/old.sql --new-d1   # 打印 wrangler 人工查询
// 任一 ❌ 进程退出码为 1
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

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

// ------- 复用的精简 SQL 解析器 -------
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
        if (sql[i] === "'") { if (sql[i + 1] === "'") { i += 2; continue; } i++; break; }
        i++;
      }
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') { while (i < n && sql[i] !== '\n') i++; continue; }
    if (c === ';') { yield sql.slice(start, i); start = i + 1; }
    i++;
  }
  if (start < n) { const t = sql.slice(start); if (t.trim()) yield t; }
}
function skipWs(s, i) { while (i < s.length && /\s/.test(s[i])) i++; return i; }
function parseLiteral(s, i) {
  i = skipWs(s, i);
  const c = s[i];
  if (c === "'") {
    let out = ''; i++;
    while (i < s.length) {
      if (s[i] === "\\") {
        const n = s[i + 1];
        if (n === 'n') out += '\n';
        else if (n === 't') out += '\t';
        else if (n === "'") out += "'";
        else if (n === "\\") out += "\\";
        else out += n ?? '';
        i += 2; continue;
      }
      if (s[i] === "'") { if (s[i + 1] === "'") { out += "'"; i += 2; continue; } i++; break; }
      out += s[i]; i++;
    }
    return [out, i];
  }
  if ((c === 'X' || c === 'x') && s[i + 1] === "'") {
    let hex = ''; i += 2;
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
function parseExpression(s, i) {
  i = skipWs(s, i);
  const c = s[i];
  if (c === "'") return parseLiteral(s, i);
  if ((c === 'X' || c === 'x') && s[i + 1] === "'") return parseLiteral(s, i);
  if (/[0-9-]/.test(c)) return parseLiteral(s, i);
  let j = i;
  while (j < s.length && /[A-Za-z0-9_.]/.test(s[j])) j++;
  const word = s.slice(i, j);
  const up = word.toUpperCase();
  if (up === 'NULL') return [null, j];
  if (up === 'TRUE') return [1, j];
  if (up === 'FALSE') return [0, j];
  let k = skipWs(s, j);
  if (s[k] === '(') {
    const startWord = j;
    let depth = 1; k++;
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
    const m = expr.match(/^replace\(\s*'((?:[^'\\]|\\.)*)'\s*,/);
    if (m) return [m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'"), k];
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
      row.push(v); i = ni;
      i = skipWs(s, i);
      if (s[i] === ',') { i++; continue; }
      if (s[i] === ')') { i++; break; }
      throw new Error('parse error near: ' + s.slice(i, i + 40));
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
  let depth = 0, cur = '', inStr = false;
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
    c = c.replace(/--.*$/gm, '').trim();
    const fm = c.match(/^[`"]?(\w+)[`"]?/);
    if (!fm) continue;
    if (/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)$/i.test(fm[1])) continue;
    colNames.push(fm[1]);
  }
  return { name: m[1], colNames };
}

// ------- 读旧导出 -------
const oldPath = path.resolve(ROOT, args.old || 'scripts/tmp/old.sql');
if (!fs.existsSync(oldPath)) { console.error('找不到旧导出：' + oldPath); process.exit(2); }
const oldSql = fs.readFileSync(oldPath, 'utf8');
const oldCreate = {};
const oldRows = {};
for (const stmt of splitStatements(oldSql)) {
  const st = stmt.trim();
  if (!st) continue;
  const ct = parseCreateTable(st);
  if (ct) { oldCreate[ct.name] = ct.colNames; continue; }
  const m = st.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+[`"]?(\w+)[`"]?\s*(?:\(([^)]*)\))?\s*VALUES\s*/i);
  if (!m) continue;
  if (m[1] === 'sqlite_sequence') continue;
  const cols = m[2] ? m[2].split(',').map((s) => s.trim().replace(/[`"]/g, '')) : oldCreate[m[1]];
  if (!cols) continue;
  const [rows] = parseValuesList(st, m.index + m[0].length);
  for (const r of rows) {
    const obj = {};
    cols.forEach((c, i2) => { obj[c] = r[i2]; });
    (oldRows[m[1]] ||= []).push(obj);
  }
}
const nIn = (t) => (oldRows[t] || []).length;

// ------- D1 模式：打印人工执行清单 -------
if (args['new-d1']) {
  console.log('# 请在已导入 new-d1.sql 的 D1 上执行以下 wrangler 命令，人工核对：');
  console.log(`# 旧库统计：students=${nIn('students')} groups=${nIn('groups')} rules=${nIn('point_rules')} announcements=${nIn('announcements')} records=${nIn('point_records')}`);
  const q = [
    "SELECT COUNT(*) AS students FROM students WHERE deleted=0;",
    "SELECT COUNT(*) AS groups FROM groups WHERE deleted=0;",
    "SELECT COUNT(*) AS rules FROM point_rules WHERE deleted=0;",
    "SELECT COUNT(*) AS announcements FROM announcements WHERE deleted=0;",
    "SELECT COUNT(*) AS records FROM point_records;",
    "SELECT COUNT(*) AS baseline_set FROM point_records WHERE reason='期初余额（数据迁移）' AND apply=1;",
    "SELECT name, points FROM students WHERE deleted=0 ORDER BY name;",
    "SELECT name, color FROM groups WHERE deleted=0 ORDER BY name;",
    "SELECT key, value FROM admin_config WHERE deleted=0 ORDER BY key;",
  ];
  for (const s of q) console.log(`wrangler d1 execute class-points-db-v4 --remote --command "${s}"`);
  process.exit(0);
}

// ------- SQLite 模式 -------
const dbPath = path.resolve(ROOT, args['new-db'] || 'data/app.db');
if (!fs.existsSync(dbPath)) { console.error('找不到新库：' + dbPath); process.exit(2); }
let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  try {
    ({ default: Database } = await import(path.join(ROOT, 'app/node_modules/better-sqlite3/lib/index.js')));
  } catch {
    console.error('未找到 better-sqlite3，无法打开新库。');
    process.exit(3);
  }
}
const db = new Database(dbPath, { readonly: true });
const q1 = (sql, ...p) => db.prepare(sql).get(...p);
const qa = (sql, ...p) => db.prepare(sql).all(...p);

let fail = 0;
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${detail ? '  ' + detail : ''}`);
  if (!cond) fail++;
};

// 1. 数量核对
ok(q1('SELECT COUNT(*) c FROM students WHERE deleted=0').c === nIn('students'), 'students 行数', `新=${q1('SELECT COUNT(*) c FROM students WHERE deleted=0').c} 旧=${nIn('students')}`);
ok(q1('SELECT COUNT(*) c FROM groups WHERE deleted=0').c === nIn('groups'), 'groups 行数', `新=${q1('SELECT COUNT(*) c FROM groups WHERE deleted=0').c} 旧=${nIn('groups')}`);
ok(q1('SELECT COUNT(*) c FROM point_rules WHERE deleted=0').c === nIn('point_rules'), 'point_rules 行数', `新=${q1('SELECT COUNT(*) c FROM point_rules WHERE deleted=0').c} 旧=${nIn('point_rules')}`);
ok(q1('SELECT COUNT(*) c FROM announcements WHERE deleted=0').c === nIn('announcements'), 'announcements 行数', `新=${q1('SELECT COUNT(*) c FROM announcements WHERE deleted=0').c} 旧=${nIn('announcements')}`);

// 2. point_records 条数关系：旧条数 + 学生数 = 新条数
const newRecCount = q1('SELECT COUNT(*) c FROM point_records').c;
const expectRec = nIn('point_records') + nIn('students');
ok(newRecCount === expectRec, 'point_records 条数关系', `新=${newRecCount} 期望=${expectRec}（旧${nIn('point_records')}+学生${nIn('students')}）`);
ok(q1("SELECT COUNT(*) c FROM point_records WHERE reason='期初余额（数据迁移）' AND apply=1").c === nIn('students'), '期初余额 set 记录数', `=${q1("SELECT COUNT(*) c FROM point_records WHERE reason='期初余额（数据迁移）' AND apply=1").c}（应=学生数 ${nIn('students')}）`);

// 3. 每个学生 points 新旧一致（按确定性 uid 找新行）
const mismatches = [];
for (const s of oldRows['students'] || []) {
  const uid = uuidv5(`students:${s.id}`);
  const row = q1('SELECT name, points FROM students WHERE uid=? AND deleted=0', uid);
  if (!row) { mismatches.push(`${s.name}(id=${s.id}) 新库缺失`); continue; }
  if (Number(row.points) !== Number(s.points)) mismatches.push(`${row.name}: 新=${row.points} 旧=${s.points}`);
}
ok(mismatches.length === 0, '每个学生 points 新旧一致', mismatches.length ? '\n    ' + mismatches.join('\n    ') : `共 ${nIn('students')} 名学生全部一致`);

// 4. groups 名称/颜色一致
const groupMismatch = [];
for (const g of oldRows['groups'] || []) {
  const uid = uuidv5(`groups:${g.id}`);
  const row = q1('SELECT name, color FROM groups WHERE uid=? AND deleted=0', uid);
  if (!row) { groupMismatch.push(`${g.name}(id=${g.id}) 缺失`); continue; }
  if (row.name !== g.name || row.color !== g.color) groupMismatch.push(`${g.name}: 新=(${row.name},${row.color}) 旧=(${g.name},${g.color})`);
}
ok(groupMismatch.length === 0, 'groups 名称/颜色一致', groupMismatch.length ? '\n    ' + groupMismatch.join('\n    ') : `共 ${nIn('groups')} 组全部一致`);

// 5. config 白名单键值一致
const KEEP_KEYS = new Set(['site_title','avatar_frame_leaderboard','avatar_frame_cards','avatar_frame_tier','resend_from','notify_email','rescue_email']);
const cfgRows = oldRows['admin_config'] || [];
const cfgMap = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
const cfgMismatch = [];
let expectSiteTitle = cfgMap['site_title'] ?? cfgMap['class_name'] ?? null;
for (const [k, v] of Object.entries(cfgMap)) {
  if (!KEEP_KEYS.has(k) && !k.startsWith('notify_on_') && !k.startsWith('auto_backup_')) continue;
  const row = q1('SELECT value FROM admin_config WHERE key=?', k);
  if (!row) { cfgMismatch.push(`${k} 新库缺失`); continue; }
  if (String(row.value) !== String(v)) cfgMismatch.push(`${k}: 新=${row.value} 旧=${v}`);
}
if (expectSiteTitle != null && !cfgMap['site_title']) {
  const row = q1("SELECT value FROM admin_config WHERE key='site_title'");
  if (!row || String(row.value) !== String(cfgMap['class_name'])) cfgMismatch.push(`site_title(由 class_name 回填) 不一致`);
}
ok(cfgMismatch.length === 0, 'admin_config 白名单键值一致', cfgMismatch.length ? '\n    ' + cfgMismatch.join('\n    ') : `全部一致`);

// 6. device_tokens / 日志类行数（login_logs/audit_logs/backup_log 在新 schema 无 deleted 列）
ok(q1('SELECT COUNT(*) c FROM device_tokens WHERE deleted=0').c === nIn('device_tokens'), 'device_tokens 行数', `新=${q1('SELECT COUNT(*) c FROM device_tokens WHERE deleted=0').c} 旧=${nIn('device_tokens')}`);
ok(q1('SELECT COUNT(*) c FROM login_logs').c === nIn('login_logs'), 'login_logs 行数', `新=${q1('SELECT COUNT(*) c FROM login_logs').c} 旧=${nIn('login_logs')}`);
ok(q1('SELECT COUNT(*) c FROM audit_logs').c === nIn('audit_logs'), 'audit_logs 行数', `新=${q1('SELECT COUNT(*) c FROM audit_logs').c} 旧=${nIn('audit_logs')}`);
ok(q1('SELECT COUNT(*) c FROM backup_log').c === nIn('backup_log'), 'backup_log 行数', `新=${q1('SELECT COUNT(*) c FROM backup_log').c} 旧=${nIn('backup_log')}`);

console.log('');
if (fail === 0) {
  console.log('全部核对通过 ✅');
} else {
  console.log(`存在 ${fail} 项不一致 ❌`);
  process.exit(1);
}
