import { z } from 'zod';
import { api, requireUser, clientIp } from '@/lib/auth';
import { query, notifyChange } from '@/lib/db';
import { audit } from '@/lib/audit';
const S = z.object({
  photo_mandatory: z.boolean().optional(),
  high_downtime_pct: z.coerce.number().min(10).max(100).optional(),
  plant_name: z.string().trim().min(1).max(60).optional(),
  oee_target: z.coerce.number().min(0.1).max(1).optional(),
  oee_bands: z.object({ low: z.coerce.number().min(0).max(1), high: z.coerce.number().min(0).max(1) }).optional(),
  max_photo_mb: z.coerce.number().min(1).max(50).optional(),
});
export const GET = api(async () => { await requireUser(); return Object.fromEntries((await query<{ key: string; value: unknown }>('SELECT key, value FROM settings')).map((r) => [r.key, r.value])); });
export const POST = api(async (req: Request) => {
  const user = await requireUser('master.edit');
  const b = S.parse(await req.json());
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    const old = await query('SELECT value FROM settings WHERE key = $1', [k]);
    await query('INSERT INTO settings (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()', [k, JSON.stringify(v), user.uid]);
    await audit(null, { entity: 'setting', entityId: k, action: 'update', userId: user.uid, oldValue: old[0]?.value ?? null, newValue: v, ip: await clientIp() });
  }
  await notifyChange(null, { type: 'master', what: 'settings' });
  return { ok: true };
});
