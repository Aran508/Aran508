import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { queryOne } from './db';
import { readSession, SESSION_COOKIE, type SessionPayload } from './session';
import { can, type Permission } from './roles';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Current user, re-checked against the database (deactivated users are logged out at once). */
export async function currentUser(): Promise<SessionPayload | null> {
  const store = await cookies();
  const s = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const u = await queryOne<{ active: boolean; token_version: number; role: SessionPayload['role']; full_name: string }>(
    'SELECT active, token_version, role, full_name FROM users WHERE id = $1',
    [s.uid],
  );
  if (!u || !u.active || u.token_version !== s.tv) return null;
  return { ...s, role: u.role, name: u.full_name };
}

export async function requireUser(perm?: Permission): Promise<SessionPayload> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, 'Please log in');
  if (perm && !can(u.role, perm)) throw new HttpError(403, 'You do not have permission for this action');
  return u;
}

export async function clientIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || null;
}

/** Wrap an API handler: JSON errors, auth errors, validation errors. */
export function api<A extends unknown[]>(fn: (...args: A) => Promise<Response | unknown>) {
  return async (...args: A): Promise<Response> => {
    try {
      const out = await fn(...args);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
      if (e && typeof e === 'object' && 'issues' in e) {
        const issues = (e as { issues: { path: (string | number)[]; message: string }[] }).issues;
        return NextResponse.json({ error: 'Please check the highlighted fields', details: issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, { status: 422 });
      }
      console.error(e);
      return NextResponse.json({ error: 'Server error — the data was not saved. Please try again.' }, { status: 500 });
    }
  };
}
