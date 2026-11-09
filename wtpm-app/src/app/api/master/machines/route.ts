import { z } from 'zod';
import { api, requireUser, clientIp, HttpError } from '@/lib/auth';
import { query, queryOne, notifyChange } from '@/lib/db';
import { audit, diff } from '@/lib/audit';

const M = z.object({
  id: z.number().int().optional(),
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(80),
  line: z.string().trim().max(30).default(''),
  category: z.string().trim().max(10).default('NFM'),
  sort_order: z.coerce.number().int().default(0),
  active: z.boolean().default(true),
});

export const GET = api(async () => {
  await requireUser();
  return query(`SELECT m.*, (SELECT count(*)::int FROM part_master p WHERE p.machine_id = m.id) AS parts,
    (SELECT max(prod_date)::text FROM production_entries e WHERE e.machine_id = m.id AND e.deleted_at IS NULL) AS last_entry FROM machines m ORDER BY sort_order, id`);
});

export const POST = api(async (req: Request) => {
  const user = await requireUser('master.edit');
  const b = M.parse(await req.json());
  const dup = await queryOne('SELECT id FROM machines WHERE lower(code) = lower($1) AND id <> COALESCE($2, -1)', [b.code, b.id ?? null]);
  if (dup) throw new HttpError(422, `Machine code ${b.code} already exists`);
  if (b.id) {
    const old = await queryOne('SELECT code, name, line, category, sort_order, active FROM machines WHERE id = $1', [b.id]);
    if (!old) throw new HttpError(404, 'Machine not found');
    await query('UPDATE machines SET code=$2, name=$3, line=$4, category=$5, sort_order=$6, active=$7, updated_at=now() WHERE id=$1', [b.id, b.code, b.name, b.line, b.category, b.sort_order, b.active]);
    await audit(null, { entity: 'machine', entityId: b.id, action: 'update', userId: user.uid, oldValue: old, newValue: { ...b, changes: diff(old, b) }, ip: await clientIp() });
  } else {
    const [r] = await query<{ id: number }>('INSERT INTO machines (code, name, line, category, sort_order, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [b.code, b.name, b.line, b.category, b.sort_order || 999, b.active]);
    await audit(null, { entity: 'machine', entityId: r.id, action: 'create', userId: user.uid, newValue: b, ip: await clientIp() });
  }
  await notifyChange(null, { type: 'master', what: 'machines' });
  return { ok: true };
});
