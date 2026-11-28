import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  cookieFingerprint,
  parseCookieValues,
  setSessionCookie,
  startGuestSession,
  userFromCookieHeader,
  userFromRequest,
  SESSION_COOKIE,
} from './auth.js';
import { listGames } from './games/registry.js';
import * as matches from './matches.js';
import { AppError } from './errors.js';
import {
  addFeedback,
  countFeedback,
  deleteSession,
  findAccountByUsername,
  normalizeUsername,
  renameUser,
  sanitizeName,
  upgradeToAccount,
  usernameTaken,
  createSession,
} from './db.js';
import { hashPassword, verifyPassword } from './password.js';
import { config } from './config.js';
import { getPlayerProfile } from './profiles.js';

const createMatchBody = z.object({
  gameId: z.string().min(1).max(32),
  visibility: z.enum(['public', 'private']).default('public'),
  options: z.record(z.union([z.string(), z.array(z.string())])).optional(),
});

const feedbackBody = z.object({
  gameId: z.string().max(32).optional(),
  category: z.enum(['bug', 'confusing', 'idea', 'other']).default('other'),
  message: z.string().min(1).max(2000),
  contact: z.string().max(120).optional(),
  matchId: z.string().max(64).optional(),
});

/** 反馈限流：按 IP，每分钟最多 5 条 */
const feedbackAttempts = new Map<string, { count: number; resetAt: number }>();

const optionValueSchema = z.union([z.string(), z.array(z.string())]);
const updateOptionsBody = z.object({
  options: z.record(optionValueSchema),
});

const nameBody = z.object({ name: z.string().min(1).max(32) });

const authBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
  name: z.string().max(64).optional(),
});

/** 登录失败限流：按 IP，5 分钟最多 10 次 */
const LOGIN_WINDOW_MS = 5 * 60_000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function allowLoginAttempt(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}

/** 账号不存在时也跑一次 scrypt，避免用响应时间探测用户名 */
const DUMMY_HASH = hashPassword('not-a-real-password-42');

export async function registerHttp(app: FastifyInstance): Promise<void> {
  // 允许 Content-Type: application/json 但 body 为空（加入/重开等无参数 POST）
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : '';
    if (!raw) return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.get('/api/me', async (request, reply) => {
    const user = userFromRequest(request, reply);
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    reply.header('Pragma', 'no-cache');
    return { user };
  });

  const debugSession = async (request: FastifyRequest) => {
    const cookies = parseCookieValues(request.headers.cookie, SESSION_COOKIE);
    const user = userFromCookieHeader(request.headers.cookie);
    return {
      user: user ? { id: user.id.slice(0, 6) } : null,
      cookieCount: cookies.length,
      cookieFingerprints: cookies.map(cookieFingerprint),
      headerFingerprint: cookieFingerprint(request.headers.cookie),
    };
  };
  app.get('/api/debug/session', debugSession);
  app.post('/api/debug/session', debugSession);

  app.post('/api/me/name', async (request, reply) => {
    const user = userFromRequest(request, reply);
    const body = nameBody.parse(request.body ?? {});
    const clean = sanitizeName(body.name);
    if (!clean) throw new AppError('invalid_name', '名字不能为空，最多 16 个字符', 400);
    return { user: renameUser(user.id, clean) };
  });


  /* ------------------------------ 账号 ------------------------------ */

  app.post('/api/auth/register', async (request, reply) => {
    const current = userFromRequest(request, reply);
    const body = authBody.parse(request.body ?? {});
    const username = normalizeUsername(body.username);
    if (!username) {
      throw new AppError('invalid_username', '用户名需以字母开头，3-24 位字母、数字或下划线', 400);
    }
    if (body.password.length < 8) {
      throw new AppError('invalid_password', '密码至少 8 位', 400);
    }
    if (current.username) {
      throw new AppError('already_registered', '当前身份已经是注册账号，请先退出再注册', 409);
    }
    if (usernameTaken(username)) {
      throw new AppError('username_taken', '这个用户名已经被占用了', 409);
    }
    const user = upgradeToAccount(
      current.id,
      username,
      hashPassword(body.password),
      body.name,
    );
    return { user };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = authBody.parse(request.body ?? {});
    if (!allowLoginAttempt(request.ip)) {
      throw new AppError('too_many_attempts', '尝试次数过多，请 5 分钟后再试', 429);
    }
    const username = normalizeUsername(body.username);
    const account = username ? findAccountByUsername(username) : null;
    const ok = verifyPassword(body.password, account?.password_hash ?? DUMMY_HASH) && Boolean(account);
    if (!account || !ok) {
      throw new AppError('invalid_credentials', '用户名或密码不正确', 401);
    }
    // 登录后换发新 session，避免会话固定攻击
    const oldSid = request.cookies[SESSION_COOKIE];
    if (oldSid) deleteSession(oldSid);
    const sid = createSession(account.id, config.sessionTtlMs);
    setSessionCookie(reply, sid);
    return { user: { id: account.id, name: account.name, username: account.username } };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const sid = request.cookies[SESSION_COOKIE];
    if (sid) deleteSession(sid);
    return { user: startGuestSession(reply) };
  });

  app.get('/api/games', async () => ({ games: listGames() }));

  app.get('/api/feedback/count', async (request) => {
    const { gameId } = request.query as { gameId?: string };
    return { count: countFeedback(typeof gameId === 'string' && gameId ? gameId.slice(0, 32) : undefined) };
  });

  app.post('/api/feedback', async (request, reply) => {
    const ip = request.ip ?? 'unknown';
    const now = Date.now();
    const entry = feedbackAttempts.get(ip);
    if (!entry || entry.resetAt <= now) feedbackAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    else if (entry.count >= 5) throw new AppError('feedback_rate_limited', '反馈太频繁，请稍后再试', 429);
    else entry.count += 1;

    const parsed = feedbackBody.safeParse(request.body);
    if (!parsed.success) throw new AppError('invalid_feedback', '反馈内容不合法', 400);
    const message = parsed.data.message
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/\r\n/g, '\n')
      .trim();
    if (!message) throw new AppError('invalid_feedback', '反馈内容不能为空', 400);
    const user = userFromRequest(request, reply);
    const id = addFeedback({
      gameId: parsed.data.gameId ?? 'seasons',
      category: parsed.data.category,
      message: message.slice(0, 2000),
      contact: parsed.data.contact?.trim().slice(0, 120) ?? null,
      userId: user?.id ?? null,
      matchId: parsed.data.matchId?.slice(0, 64) ?? null,
    });
    return { ok: true, id };
  });


  app.get('/api/users/:id', async (request) => {
    const { id } = request.params as { id: string };
    const viewer = userFromCookieHeader(request.headers.cookie);
    return getPlayerProfile(id, viewer?.id ?? null);
  });

  app.get('/api/matches', async (request) => {
    const query = request.query as { status?: string };
    const status =
      query.status === 'active' || query.status === 'all' || query.status === 'waiting'
        ? query.status
        : 'all';
    return { matches: matches.listMatches(status) };
  });

  app.post('/api/matches', async (request, reply) => {
    const user = userFromRequest(request, reply);
    const body = createMatchBody.parse(request.body ?? {});
    const summary = matches.createMatch(body.gameId, user, body.visibility, body.options ?? {});
    return { match: summary };
  });

  app.patch('/api/matches/:id/options', async (request, reply) => {
    const user = userFromRequest(request, reply);
    const { id } = request.params as { id: string };
    const body = updateOptionsBody.parse(request.body ?? {});
    return { match: matches.updateMatchOptions(id, user, body.options) };
  });

  app.get('/api/matches/:id', async (request) => {
    const { id } = request.params as { id: string };
    const summary = matches.getSummary(id);
    if (!summary) throw new AppError('match_not_found', '房间不存在', 404);
    return { match: summary };
  });

  app.post('/api/matches/:id/join', async (request, reply) => {
    const user = userFromRequest(request, reply);
    const { id } = request.params as { id: string };
    return { match: matches.joinMatch(id, user) };
  });

  app.post('/api/matches/:id/start', async (request, reply) => {
    const user = userFromRequest(request, reply);
    const { id } = request.params as { id: string };
    return { match: matches.startMatch(id, user) };
  });

  app.post('/api/matches/:id/abort', async (request, reply) => {
    const user = userFromRequest(request, reply);
    const { id } = request.params as { id: string };
    return { match: matches.abortMatch(id, user) };
  });

  app.post('/api/matches/:id/rematch', async (request, reply) => {
    const user = userFromRequest(request, reply);
    const { id } = request.params as { id: string };
    return { matchId: matches.rematch(id, user) };
  });

  app.get('/api/matches/:id/chat', async (request) => {
    const { id } = request.params as { id: string };
    if (!matches.getMatchRow(id)) throw new AppError('match_not_found', '房间不存在', 404);
    return { messages: matches.listChat(id) };
  });
}
