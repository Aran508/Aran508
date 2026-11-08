import { z } from 'zod';
import { api, requireUser, clientIp, HttpError } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hashPassword, passwordProblem } from '@/lib/password';
import { audit } from '@/lib/audit';
export const GET = api(async () => {
  await requireUser('users.manage');
  return query(`SELECT u.id, u.username, u.full_name, u.role, u.active, u.last_login_at, u.created_at,
    (SELECT count(*)::int FROM production_entries e WHERE e.created_by = u.id AND e.deleted_at IS NULL) AS entries FROM users u ORDER BY u.active DESC, u.role, u.full_name`);
});
export const POST = api(async (req: Request) => {
  const admin = await requireUser('users.manage');
  const b = z.object({ username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore'), full_name: z.string().trim().min(2).max(80), role: z.enum(['operator', 'supervisor', 'management', 'admin']), password: z.string() }).parse(await req.json());
  const p = passwordProblem(b.password);
  if (p) throw new HttpError(422, p);
  if (await queryOne('SELECT 1 FROM users WHERE lower(username) = lower($1)', [b.username])) throw new HttpError(422, 'That username is already taken');
  const [r] = await query<{ id: number }>('INSERT INTO users (username, full_name, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING id', [b.username, b.full_name, b.role, await hashPassword(b.password)]);
  await audit(null, { entity: 'user', entityId: r.id, action: 'create', userId: admin.uid, newValue: { username: b.username, full_name: b.full_name, role: b.role }, ip: await clientIp() });
  return { id: r.id };
});
