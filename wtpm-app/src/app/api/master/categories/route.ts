import { z } from 'zod';
import { api, requireUser, clientIp } from '@/lib/auth';
import { query, notifyChange } from '@/lib/db';
import { audit } from '@/lib/audit';
/** Only display options are editable; the OEE flags follow the Excel formulas and are fixed. */
export const POST = api(async (req: Request) => {
  const user = await requireUser('master.edit');
  const b = z.object({ code: z.string(), is_common: z.boolean(), sort_order: z.coerce.number().int().optional() }).parse(await req.json());
  await query('UPDATE loss_categories SET is_common = $2, sort_order = COALESCE($3, sort_order) WHERE code = $1', [b.code, b.is_common, b.sort_order ?? null]);
  await audit(null, { entity: 'loss_category', entityId: b.code, action: 'update', userId: user.uid, newValue: b, ip: await clientIp() });
  await notifyChange(null, { type: 'master', what: 'categories' });
  return { ok: true };
});
