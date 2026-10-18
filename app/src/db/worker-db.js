// Worker 端 DB adapter（Cloudflare D1）— 全异步接口
// tx 语义同 node-db：事务内只允许 db.run（收集），禁止 get/all；结束后 await d1.batch
export function createWorkerDb(d1) {
  let collecting = null;

  async function run(sql, ...params) {
    if (collecting) {
      collecting.push({ sql, params });
      return { lastRowId: 0, changes: 1 };
    }
    const r = await d1.prepare(sql).bind(...params).run();
    return { lastRowId: Number(r.meta?.last_row_id ?? 0), changes: r.meta?.changes ?? 0 };
  }
  async function get(sql, ...params) {
    if (collecting) throw new Error('worker-db: 禁止 tx 内 get（请在事务外预载）');
    return (await d1.prepare(sql).bind(...params).first()) || undefined;
  }
  async function all(sql, ...params) {
    if (collecting) throw new Error('worker-db: 禁止 tx 内 all（请在事务外预载）');
    const r = await d1.prepare(sql).bind(...params).all();
    return r.results || [];
  }
  async function tx(fn) {
    collecting = [];
    try {
      await fn();
      if (!collecting.length) return { lastRowId: 0, changes: 0 };
      const results = await d1.batch(collecting.map(s => d1.prepare(s.sql).bind(...s.params)));
      let firstInsertRowId = 0;
      let totalChanges = 0;
      for (const r of results || []) {
        const m = r && r.meta;
        if (m) {
          totalChanges += m.changes || 0;
          if (m.last_row_id && !firstInsertRowId) firstInsertRowId = Number(m.last_row_id);
        }
      }
      return { lastRowId: firstInsertRowId, changes: totalChanges };
    } finally {
      collecting = null;
    }
  }
  async function execSchema(sqlText) {
    const stmts = splitStatements(sqlText);
    for (let i = 0; i < stmts.length; i += 20) {
      await d1.batch(stmts.slice(i, i + 20).map(s => d1.prepare(s)));
    }
  }
  return { run, get, all, tx, execSchema, dialect: 'worker', raw: d1 };
}

export function splitStatements(sqlText) {
  const lines = sqlText.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  return lines.split(';').map(s => s.trim()).filter(s => s.length > 0);
}
