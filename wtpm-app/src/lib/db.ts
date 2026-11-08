import pg, { Pool, type PoolClient, type QueryResultRow } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __wtpmPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!global.__wtpmPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
    global.__wtpmPool = new Pool({ connectionString, max: Number(process.env.DB_POOL_MAX || 20) });
  }
  return global.__wtpmPool;
}

pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // NUMERIC
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // BIGINT
pg.types.setTypeParser(1082, (v) => v); // DATE stays 'YYYY-MM-DD'

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Broadcast a change to every open browser (tablets and PCs) through PostgreSQL NOTIFY. */
export async function notifyChange(c: PoolClient | null, payload: Record<string, unknown>) {
  const text = JSON.stringify({ ...payload, at: new Date().toISOString() }).slice(0, 7900);
  if (c) await c.query('SELECT pg_notify($1, $2)', ['wtpm_changes', text]);
  else await getPool().query('SELECT pg_notify($1, $2)', ['wtpm_changes', text]);
}
