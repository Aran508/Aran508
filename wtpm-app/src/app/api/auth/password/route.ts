import { z } from 'zod';
import { api, requireUser, HttpError, clientIp } from '@/lib/auth';
import { queryOne, query } from '@/lib/db';
import { hashPassword, verifyPassword, passwordProblem } from '@/lib/password';
import { audit } from '@/lib/audit';
export const POST = api(async (req: Request) => {
  const u = await requireUser();
  const b = z.object({ current: z.string(), next: z.string() }).parse(await req.json());
  const row = await queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [u.uid]);
  if (!row || !(await verifyPassword(b.current, row.password_hash))) throw new HttpError(422, 'Current password is wrong');
  const p = passwordProblem(b.next);
  if (p) throw new HttpError(422, p);
  await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [u.uid, await hashPassword(b.next)]);
  await audit(null, { entity: 'user', entityId: u.uid, action: 'change_password', userId: u.uid, ip: await clientIp() });
  return { ok: true };
});
