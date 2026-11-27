import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRow } from './db.js';
import { createHash } from 'node:crypto';
import { createSession, createUser, deleteSession, sessionUser } from './db.js';
import { config } from './config.js';

export const SESSION_COOKIE = 'bgx_sid';

export function setSessionCookie(reply: FastifyReply, sid: string): void {
  reply.setCookie(SESSION_COOKIE, sid, {
    path: config.basePath,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });
}

/** 新建一个游客身份并写入会话 Cookie */
export function startGuestSession(reply: FastifyReply): UserRow {
  const user = createUser();
  const sid = createSession(user.id, config.sessionTtlMs);
  setSessionCookie(reply, sid);
  return user;
}

export function userFromRequest(request: FastifyRequest, reply: FastifyReply): UserRow {
  const candidates = parseCookieValues(request.headers.cookie, SESSION_COOKIE);
  for (const sid of candidates) {
    const user = sessionUser(sid);
    if (user) return user;
  }
  for (const sid of candidates) deleteSession(sid);
  return startGuestSession(reply);
}

export function userFromCookieHeader(header: string | undefined): UserRow | null {
  const candidates = parseCookieValues(header, SESSION_COOKIE);
  for (const sid of candidates) {
    const user = sessionUser(sid);
    if (user) return user;
  }
  return null;
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  return Object.fromEntries(
    readCookiePairs(header),
  );
}

function* readCookiePairs(header: string | undefined): Generator<[string, string]> {
  if (!header) return;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      yield [key, decodeURIComponent(part.slice(eq + 1).trim())];
    } catch {
      yield [key, part.slice(eq + 1).trim()];
    }
  }
}

/** A browser may send several same-name cookies for different historical paths. */
export function parseCookieValues(header: string | undefined, name: string): string[] {
  return [...readCookiePairs(header)]
    .filter(([key]) => key === name)
    .map(([, value]) => value);
}

export function cookieFingerprint(value: string | undefined): string {
  return createHash('sha256')
    .update(value ?? '')
    .digest('hex')
    .slice(0, 12);
}
