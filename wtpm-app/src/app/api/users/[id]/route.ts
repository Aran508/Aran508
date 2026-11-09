import { z } from 'zod';
import { api, requireUser, clientIp, HttpError } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hashPassword, passwordProblem } from '@/lib/password';
import { audit } from '@/lib/audit';
export const PUT = api(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireUser('users.manage');
  const id = Number((await ctx.params).id);
  const b = z.object({ full_name: z.string().trim().min(2).max(80).optional(), role: z.enum(['operator', 'supervisor', 'management', 'admin']).optional(), active: z.boolean().optional(), password: z.string().optional() }).parse(await req.json());
  const old = await queryOne<{ full_name: string; role: string; active: boolean }>('SELECT full_name, role, active FROM users WHERE id = $1', [id]);
  if (!old) throw new HttpError(404, 'User not found');
  if (id === admin.uid && (b.active === false || (b.role && b.role !== 'admin'))) throw new HttpError(422, 'You cannot deactivate or demote your own administrator account');
  if (b.password) {
    const p = passwordProblem(b.password);
    if (p) throw new HttpError(422, p);
  }
  await query(
    `UPDATE users SET full_name = COALESCE($2, full_name), role = COALESCE($3, role), active = COALESCE($4, active),
       password_hash = COALESCE($5, password_hash), token_version = token_version + CASE WHEN $5::text IS NOT NULL OR $4 = false OR $3::text IS NOT NULL THEN 1 ELSE 0 END, updated_at = now() WHERE id = $1`,
    [id, b.full_name ?? null, b.role ?? null, b.active ?? null, b.password ? await hashPassword(b.password) : null],
  );
  await audit(null, { entity: 'user', entityId: id, action: b.password ? 'reset_password' : 'update', userId: admin.uid, oldValue: old, newValue: { ...b, password: b.password ? '••••' : undefined }, ip: await clientIp() });
  return { ok: true };
});
