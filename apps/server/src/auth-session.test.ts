import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

const state = vi.hoisted(() => ({
  sessions: new Map<string, string>(),
  users: new Map<string, string>(),
  createdGuests: 0,
}));

vi.mock('./db.js', () => ({
  createUser: () => {
    state.createdGuests += 1;
    const id = 'guest-' + state.createdGuests;
    state.users.set(id, 'Guest ' + state.createdGuests);
    return { id, name: state.users.get(id), username: null };
  },
  createSession: (userId: string) => {
    const sid = 'sid-' + userId + '-' + Date.now();
    state.sessions.set(sid, userId);
    return sid;
  },
  sessionUser: (sid: string) => {
    const userId = state.sessions.get(sid);
    if (!userId) return null;
    return { id: userId, name: state.users.get(userId), username: null };
  },
  deleteSession: (sid: string) => state.sessions.delete(sid),
  findAccountByUsername: () => null,
  normalizeUsername: () => null,
  renameUser: () => null,
  sanitizeName: (value: string) => value,
  upgradeToAccount: () => null,
  usernameTaken: () => false,
}));

vi.mock('./profiles.js', () => ({ getPlayerProfile: () => ({}) }));

import { registerHttp } from './http.js';
import { parseCookieHeader } from './auth.js';

describe('HTTP session selection', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    state.sessions.clear();
    state.users.clear();
    state.createdGuests = 0;
    app = Fastify();
    await app.register(cookie);
    await registerHttp(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('preserves complete cookie values and uses the last duplicate in generic parsing', () => {
    expect(parseCookieHeader('bgx_sid=first-long-session; x=a%20b; bgx_sid=second-session'))
      .toEqual({ bgx_sid: 'second-session', x: 'a b' });
  });

  it('uses the valid same-name cookie when an expired duplicate is sent last', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/me' });
    const sid = first.cookies[0]?.value;
    expect(sid).toBeTruthy();

    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: 'bgx_sid=expired-session; bgx_sid=' + sid },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.id).toBe('guest-1');
    expect(state.createdGuests).toBe(1);
  });
});
