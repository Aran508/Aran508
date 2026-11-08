import { z } from 'zod';
import { api, requireUser, clientIp, HttpError } from '@/lib/auth';
import { query, queryOne, notifyChange } from '@/lib/db';
import { audit, diff } from '@/lib/audit';

export const GET = api(async (req: Request) => {
  await requireUser();
  const u = new URL(req.url);
  const q = u.searchParams.get('q')?.trim() || '';
  const machineId = Number(u.searchParams.get('machineId')) || null;
  const limit = Math.min(500, Number(u.searchParams.get('limit') || 100));
  const offset = Number(u.searchParams.get('offset') || 0);
  const rows = await query(
    `SELECT p.id, p.machine_id, m.name AS machine, m.code AS machine_code, p.part_number, p.cycle_time_min, p.bore, p.active, p.notes, p.updated_at, u.full_name AS updated_by_name,
       (SELECT count(*)::int FROM entry_lines l WHERE l.part_master_id = p.id) AS uses, count(*) OVER () AS total
     FROM part_master p JOIN machines m ON m.id = p.machine_id LEFT JOIN users u ON u.id = p.updated_by
     WHERE ($1 = '' OR p.part_number ILIKE '%' || $1 || '%') AND ($2::int IS NULL OR p.machine_id = $2)
     ORDER BY m.sort_order, p.part_number LIMIT ${limit} OFFSET ${offset}`,
    [q, machineId],
  );
  return { rows, total: Number((rows[0] as { total?: number })?.total ?? 0) };
});

const P = z.object({
  id: z.number().int().optional(),
  machine_id: z.coerce.number().int().min(1, 'Select a machine'),
  part_number: z.string().trim().min(1, 'Part number required').max(60),
  cycle_time_min: z.coerce.number().positive('Cycle time must be greater than 0').max(1440),
  bore: z.union([z.coerce.number().min(0), z.null()]).optional(),
  notes: z.string().max(500).optional().nullable(),
  active: z.boolean().default(true),
  reason: z.string().trim().max(500).optional().nullable(),
});

export const POST = api(async (req: Request) => {
  const user = await requireUser('master.edit');
  const b = P.parse(await req.json());
  const dup = await queryOne('SELECT id FROM part_master WHERE machine_id = $1 AND upper(part_number) = upper($2) AND id <> COALESCE($3, -1)', [b.machine_id, b.part_number, b.id ?? null]);
  if (dup) throw new HttpError(422, `Part ${b.part_number} already exists for this machine`);
  if (b.id) {
    const old = await queryOne<Record<string, unknown>>('SELECT machine_id, part_number, cycle_time_min, bore, notes, active FROM part_master WHERE id = $1', [b.id]);
    if (!old) throw new HttpError(404, 'Part not found');
    if (Number(old.cycle_time_min) !== b.cycle_time_min && !(b.reason && b.reason.length >= 3)) throw new HttpError(422, 'Enter the reason for changing the cycle time');
    await query('UPDATE part_master SET machine_id=$2, part_number=$3, cycle_time_min=$4, bore=$5, notes=$6, active=$7, updated_by=$8, updated_at=now() WHERE id=$1', [b.id, b.machine_id, b.part_number, b.cycle_time_min, b.bore ?? null, b.notes ?? null, b.active, user.uid]);
    const { reason, ...nv } = b;
    await audit(null, { entity: 'part_master', entityId: b.id, action: 'update', userId: user.uid, oldValue: old, newValue: { ...nv, changes: diff(old, nv) }, reason, ip: await clientIp() });
  } else {
    const [r] = await query<{ id: number }>('INSERT INTO part_master (machine_id, part_number, cycle_time_min, bore, notes, active, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id', [b.machine_id, b.part_number, b.cycle_time_min, b.bore ?? null, b.notes ?? null, b.active, user.uid]);
    await audit(null, { entity: 'part_master', entityId: r.id, action: 'create', userId: user.uid, newValue: b, reason: b.reason, ip: await clientIp() });
  }
  await notifyChange(null, { type: 'master', what: 'parts' });
  return { ok: true };
});
