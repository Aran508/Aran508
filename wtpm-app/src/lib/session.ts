import { SignJWT, jwtVerify } from 'jose';
import type { Role } from './roles';

export const SESSION_COOKIE = 'wtpm_session';
export const SESSION_HOURS = 12;

export interface SessionPayload {
  uid: number;
  username: string;
  name: string;
  role: Role;
  tv: number; // token version (bumped on password change / deactivation)
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET must be set to a long random string');
  return new TextEncoder().encode(s);
}

export async function signSession(p: SessionPayload) {
  return new SignJWT({ ...p })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
}

export async function readSession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
