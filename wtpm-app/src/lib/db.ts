import pg, { Pool, Client, type PoolClient, type QueryResultRow } from 'pg';

pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // NUMERIC → number
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // BIGINT
pg.types.setTypeParser(1082, (v) => v); // DATE stays 'YYYY-MM-DD'

declare global {
  // eslint-disable-next-line no-var
  var __wtpmPool: Promise<Pool> | undefined;
  // eslint-disable-next-line no-var
  var __wtpmUrl: string | undefined;
}

/**
 * DATABASE_URL may hold one connection string, or several separated by spaces/commas
 * (e.g. two candidate cloud pooler hosts). The first one that accepts a connection is used.
 */
function candidates(): string[] {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
  return raw.split(/[\s,]+/).filter(Boolean);
}

const sslFor = (url: string) => (/sslmode=require|supabase\.com|neon\.tech|render\.com/.test(url) ? { rejectUnauthorized: false } : undefined);

export async function resolveDatabaseUrl(): Promise<string> {
  if (global.__wtpmUrl) return global.__wtpmUrl;
  const list = candidates();
  if (list.length === 1) return (global.__wtpmUrl = list[0]);
  let last: unknown;
  for (const url of list) {
    const c = new Client({ connectionString: url, ssl: sslFor(url), connectionTimeoutMillis: 8000 });
    try {
      await c.connect();
      await c.query('SELECT 1');
      await c.end();
      return (global.__wtpmUrl = url);
    } catch (e) {
      last = e;
      await c.end().catch(() => undefined);
    }
  }
  throw last instanceof Error ? last : new Error('No database connection string worked');
}

export function getPool(): Promise<Pool> {
  if (!global.__wtpmPool) {
    global.__wtpmPool = resolveDatabaseUrl()
      .then((url) => new Pool({ connectionString: url, ssl: sslFor(url), max: Number(process.env.DB_POOL_MAX || 20) }))
      .catch((e) => {
        global.__wtpmPool = undefined;
        throw e;
      });
  }
  return global.__wtpmPool;
}

/** A dedicated client (used for LISTEN by the live-update stream). */
export async function newClient() {
  const url = await resolveDatabaseUrl();
  return new Client({ connectionString: url, ssl: sslFor(url) });
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await (await getPool()).query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await (await getPool()).connect();
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
  else await (await getPool()).query('SELECT pg_notify($1, $2)', ['wtpm_changes', text]);
}
