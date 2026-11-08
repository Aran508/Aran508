import type { PoolClient } from 'pg';
import { getPool } from './db';

export async function audit(
  c: PoolClient | null,
  a: { entity: string; entityId: string | number; action: string; userId: number | null; oldValue?: unknown; newValue?: unknown; reason?: string | null; ip?: string | null },
) {
  const q = `INSERT INTO audit_log (entity, entity_id, action, reason, old_value, new_value, changed_by, ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;
  const p = [a.entity, String(a.entityId), a.action, a.reason ?? null, a.oldValue === undefined ? null : JSON.stringify(a.oldValue), a.newValue === undefined ? null : JSON.stringify(a.newValue), a.userId, a.ip ?? null];
  if (c) await c.query(q, p);
  else await (await getPool()).query(q, p);
}

/** Field-level differences between two records, for readable audit history. */
export function diff(oldV: Record<string, unknown>, newV: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of new Set([...Object.keys(oldV), ...Object.keys(newV)])) {
    const a = JSON.stringify(oldV[k] ?? null), b = JSON.stringify(newV[k] ?? null);
    if (a !== b) out[k] = { from: oldV[k] ?? null, to: newV[k] ?? null };
  }
  return out;
}
