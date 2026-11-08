import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne, query } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { signSession, SESSION_COOKIE, SESSION_HOURS } from '@/lib/session';
import { api, HttpError, clientIp } from '@/lib/auth';
import { audit } from '@/lib/audit';

const attempts = new Map<string, { n: number; until: number }>();

export const POST = api(async (req: Request) => {
  const body = z.object({ username: z.string().trim().min(1), password: z.string().min(1) }).parse(await req.json());
  const ip = (await clientIp()) ?? 'local';
  const key = `${ip}|${body.username.toLowerCase()}`;
  const a = attempts.get(key);
  if (a && a.n >= 5 && a.until > Date.now()) throw new HttpError(429, 'Too many failed attempts. Wait 5 minutes and try again.');
  const u = await queryOne<{ id: number; username: string; full_name: string; role: 'operator'; password_hash: string; active: boolean; token_version: number }>(
    'SELECT id, username, full_name, role, password_hash, active, token_version FROM users WHERE lower(username) = lower($1)',
    [body.username],
  );
  if (!u || !u.active || !(await verifyPassword(body.password, u.password_hash))) {
    attempts.set(key, { n: (a?.n ?? 0) + 1, until: Date.now() + 5 * 60000 });
    throw new HttpError(401, 'Wrong username or password');
  }
  attempts.delete(key);
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
  await audit(null, { entity: 'user', entityId: u.id, action: 'login', userId: u.id, ip });
  const token = await signSession({ uid: u.id, username: u.username, name: u.full_name, role: u.role, tv: u.token_version });
  const res = NextResponse.json({ ok: true, role: u.role });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: SESSION_HOURS * 3600 });
  return res;
});
