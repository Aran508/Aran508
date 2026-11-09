import './env';
import fs from 'node:fs';
import path from 'node:path';
import { getPool } from '../src/lib/db';

export async function migrate(log = console.log) {
  const pool = await getPool();
  // Only create the bookkeeping table when it is missing: a restricted app login (e.g. on a hosted
  // database where the schema was created by the owner) may not have CREATE rights on the schema.
  const exists = (await pool.query(`SELECT to_regclass('schema_migrations') IS NOT NULL AS ok`)).rows[0].ok;
  if (!exists) await pool.query(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const dir = path.resolve(__dirname, '../db/migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      log(`applied ${f}`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    } finally {
      c.release();
    }
  }
}

if (require.main === module) {
  migrate().then(() => { console.log('migrations up to date'); return getPool().then((p) => p.end()); }).catch((e) => { console.error(e); process.exit(1); });
}
