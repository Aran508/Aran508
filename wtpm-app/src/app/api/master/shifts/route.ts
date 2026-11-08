import { z } from 'zod';
import { api, requireUser, clientIp } from '@/lib/auth';
import { query, queryOne, notifyChange } from '@/lib/db';
import { audit } from '@/lib/audit';
export const GET = api(async () => { await requireUser(); return query('SELECT * FROM shifts ORDER BY id'); });
export const POST = api(async (req: Request) => {
  const user = await requireUser('master.edit');
  const b = z.object({ id: z.number().int(), timings: z.string().trim().min(1), total_minutes: z.coerce.number().min(1).max(1440), lunch_minutes: z.coerce.number().min(0), tea_minutes: z.coerce.number().min(0), tpm_minutes: z.coerce.number().min(0), reason: z.string().trim().min(3, 'Reason required') }).parse(await req.json());
  const old = await queryOne('SELECT * FROM shifts WHERE id = $1', [b.id]);
  await query('UPDATE shifts SET timings=$2, total_minutes=$3, lunch_minutes=$4, tea_minutes=$5, tpm_minutes=$6, updated_at=now() WHERE id=$1', [b.id, b.timings, b.total_minutes, b.lunch_minutes, b.tea_minutes, b.tpm_minutes]);
  await audit(null, { entity: 'shift', entityId: b.id, action: 'update', userId: user.uid, oldValue: old, newValue: b, reason: b.reason, ip: await clientIp() });
  await notifyChange(null, { type: 'master', what: 'shifts' });
  return { ok: true };
});
