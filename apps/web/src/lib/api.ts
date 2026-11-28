import type {
  ChatMessage,
  GameMeta,
  GameOptionValues,
  MatchSummary,
  MatchView,
  PlayerProfile,
} from '@bgx/protocol';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const API_ROOT = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(`${API_ROOT}${path}`, {
      credentials: 'same-origin',
      ...init,
      headers,
    });
  } catch {
    throw new ApiError('network_error', '网络连接失败，请稍后重试', 0);
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const body = data as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(
      body?.error?.code ?? 'http_error',
      body?.error?.message ?? `请求失败（HTTP ${res.status}）`,
      res.status,
    );
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: Me }>('/me'),
  debugSession: () => request<{
    user: { id: string } | null;
    cookieCount: number;
    cookieFingerprints: string[];
    headerFingerprint: string;
  }>('/debug/session'),
  rename: (name: string) =>
    request<{ user: Me }>('/me/name', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  register: (username: string, password: string) =>
    request<{ user: Me }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<{ user: Me }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ user: Me }>('/auth/logout', { method: 'POST' }),
  games: () => request<{ games: GameMeta[] }>('/games'),
  profile: (userId: string) =>
    request<PlayerProfile>(`/users/${encodeURIComponent(userId)}`),
  matches: () => request<{ matches: MatchSummary[] }>('/matches'),
  match: (id: string) => request<{ match: MatchSummary }>(`/matches/${encodeURIComponent(id)}`),
  createMatch: (
    gameId: string,
    visibility: 'public' | 'private',
    options: GameOptionValues = {},
  ) =>
    request<{ match: MatchSummary }>('/matches', {
      method: 'POST',
      body: JSON.stringify({ gameId, visibility, options }),
    }),
  updateOptions: (id: string, options: GameOptionValues) =>
    request<{ match: MatchSummary }>(`/matches/${encodeURIComponent(id)}/options`, {
      method: 'PATCH',
      body: JSON.stringify({ options }),
    }),
  joinMatch: (id: string) =>
    request<{ match: MatchSummary }>(`/matches/${encodeURIComponent(id)}/join`, { method: 'POST' }),
  startMatch: (id: string) =>
    request<{ match: MatchSummary }>(`/matches/${encodeURIComponent(id)}/start`, { method: 'POST' }),
  abortMatch: (id: string) =>
    request<{ match: MatchSummary }>(`/matches/${encodeURIComponent(id)}/abort`, { method: 'POST' }),
  rematch: (id: string) =>
    request<{ matchId: string }>(`/matches/${encodeURIComponent(id)}/rematch`, { method: 'POST' }),
  chat: (id: string) =>
    request<{ messages: ChatMessage[] }>(`/matches/${encodeURIComponent(id)}/chat`),
  feedback: (payload: {
    gameId?: string;
    category: string;
    message: string;
    contact?: string;
    matchId?: string;
  }) =>
    request<{ ok: boolean; id: number }>('/feedback', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  feedbackCount: (gameId?: string) =>
    request<{ count: number }>(
      `/feedback/count${gameId ? `?gameId=${encodeURIComponent(gameId)}` : ''}`,
    ),
};

export type Me = { id: string; name: string; username: string | null };

let meCache: Me | null = null;
let mePromise: Promise<Me> | null = null;

export function cachedMe(): Me | null {
  return meCache;
}

export function setCachedMe(me: Me): void {
  meCache = me;
  mePromise = Promise.resolve(me);
}

export function loadMe(options: { refresh?: boolean } = {}): Promise<Me> {
  if (meCache && !options.refresh) return Promise.resolve(meCache);
  if (options.refresh) {
    meCache = null;
    mePromise = null;
  }
  if (!mePromise) {
    mePromise = api
      .me()
      .then((res) => {
        meCache = res.user;
        return res.user;
      })
      .catch((err: unknown) => {
        mePromise = null;
        throw err;
      });
  }
  return mePromise;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return '出了点问题，请稍后再试';
}

/** 兼容非安全上下文（http 局域网调试）的随机 id */
export function uid(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type { ChatMessage, GameMeta, GameOptionValues, MatchSummary, MatchView, PlayerProfile };
