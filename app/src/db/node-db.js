// Node 端 DB adapter（better-sqlite3）— 全异步接口，与 Worker 端 D1 对齐
// tx 语义：事务内只允许 db.run（收集），禁止 db.get/all；事务前先预载好数据
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function createNodeDb({ dataDir }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'app.db');
  const raw = new Database(dbPath);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  let collecting = null;

  async function run(sql, ...params) {
    if (collecting) {
      collecting.push({ sql, params });
      return { lastRowId: 0, changes: 1 };
    }
    const info = raw.prepare(sql).run(...params);
    return { lastRowId: Number(info.lastInsertRowid), changes: info.changes };
  }
  async function get(sql, ...params) {
    if (collecting) throw new Error('node-db: 禁止 tx 内 get（请在事务外预载）');
    return raw.prepare(sql).get(...params);
  }
  async function all(sql, ...params) {
    if (collecting) throw new Error('node-db: 禁止 tx 内 all（请在事务外预载）');
    return raw.prepare(sql).all(...params);
  }
  async function tx(fn) {
    collecting = [];
    try {
      await fn();
      let firstInsertRowId = 0;
      let totalChanges = 0;
      const t = raw.transaction(() => {
        for (const s of collecting) {
          const info = raw.prepare(s.sql).run(...s.params);
          totalChanges += info.changes;
          if (info && info.lastInsertRowid && !firstInsertRowId) {
            firstInsertRowId = Number(info.lastInsertRowid);
          }
        }
      });
      t();
      return { lastRowId: firstInsertRowId, changes: totalChanges };
    } finally {
      collecting = null;
    }
  }
  async function execSchema(sqlText) {
    raw.exec(sqlText);
  }

  return { run, get, all, tx, execSchema, dialect: 'node', raw };
}
