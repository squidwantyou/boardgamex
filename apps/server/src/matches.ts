import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  ChatMessage,
  GameEvent,
  GameOptionValues,
  MatchStatus,
  MatchSummary,
  MatchView,
  PlayerInfo,
  Visibility,
} from '@bgx/protocol';
import { db, tx, type UserRow } from './db.js';
import { getGame } from './games/registry.js';
import type { AnyGamePlugin } from './games/types.js';
import { createRng } from './random.js';
import { AppError } from './errors.js';

export interface MatchRow {
  id: string;
  game_id: string;
  host_id: string;
  status: MatchStatus;
  visibility: Visibility;
  options: string;
  seed: string;
  aborted: number;
  state: string;
  version: number;
  seq: number;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

export interface SeatRow {
  match_id: string;
  seat: number;
  user_id: string;
  name: string;
  joined_at: number;
}

/** 领域事件总线：socket 层订阅后按每个连接重新裁剪视图再推送 */
export const bus = new EventEmitter();

/** 未结束的对局超过一天没有任何动静，就当成废弃房间清掉。 */
export const STALE_MATCH_MS = 24 * 60 * 60 * 1000;

export function deleteStaleMatches(now = Date.now(), maxAgeMs = STALE_MATCH_MS): number {
  const cutoff = now - maxAgeMs;
  const result = db
    .prepare(
      `DELETE FROM matches
        WHERE status IN ('waiting', 'active')
          AND MAX(
            COALESCE((SELECT MAX(created_at) FROM match_events WHERE match_id = matches.id), 0),
            COALESCE((SELECT MAX(joined_at) FROM match_seats WHERE match_id = matches.id), 0),
            COALESCE((SELECT MAX(created_at) FROM chat_messages WHERE match_id = matches.id), 0),
            COALESCE(started_at, 0),
            created_at
          ) < ?`,
    )
    .run(cutoff);
  return Number(result.changes);
}

const newMatchId = () => randomBytes(6).toString('base64url');
/** 只保存在服务端；客户端只拿到由它派生出的状态，永远看不到种子。 */
const newSeed = () => randomBytes(16).toString('hex');

/** 事件分级：开局/结束/中止/设置变更属于 major，其余是 info。 */
const MAJOR_EVENTS = new Set(['match_started', 'game_over', 'match_aborted', 'options_changed']);
function withEventLevels(events: GameEvent[]): GameEvent[] {
  return events.map((event) => ({
    ...event,
    level: event.level ?? (MAJOR_EVENTS.has(event.type) ? 'major' : 'info'),
  }));
}

export function getMatchRow(id: string): MatchRow | null {
  const row = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as
    | (Record<string, unknown> & MatchRow)
    | undefined;
  return row ? toMatchRow(row) : null;
}

function toMatchRow(row: Record<string, unknown>): MatchRow {
  return {
    id: String(row.id),
    game_id: String(row.game_id),
    host_id: String(row.host_id),
    status: row.status as MatchStatus,
    visibility: row.visibility as Visibility,
    options: String(row.options ?? '{}'),
    seed: String(row.seed ?? ''),
    aborted: Number(row.aborted ?? 0),
    state: String(row.state),
    version: Number(row.version),
    seq: Number(row.seq),
    created_at: Number(row.created_at),
    started_at: row.started_at == null ? null : Number(row.started_at),
    ended_at: row.ended_at == null ? null : Number(row.ended_at),
  };
}

export function listSeats(matchId: string): SeatRow[] {
  return db
    .prepare('SELECT * FROM match_seats WHERE match_id = ? ORDER BY seat ASC')
    .all(matchId)
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        match_id: String(row.match_id),
        seat: Number(row.seat),
        user_id: String(row.user_id),
        name: String(row.name),
        joined_at: Number(row.joined_at),
      };
    });
}

export function seatOf(matchId: string, userId: string): SeatRow | null {
  const row = db
    .prepare('SELECT * FROM match_seats WHERE match_id = ? AND user_id = ?')
    .get(matchId, userId) as (Record<string, unknown> & SeatRow) | undefined;
  if (!row) return null;
  return {
    match_id: String(row.match_id),
    seat: Number(row.seat),
    user_id: String(row.user_id),
    name: String(row.name),
    joined_at: Number(row.joined_at),
  };
}

function optionInput(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** 校验并补全选项；未知选项/非法值直接 400。 */
export function validateOptions(engine: AnyGamePlugin, raw: unknown): GameOptionValues {
  const parsed = engine.optionSchema.safeParse({
    ...engine.defaultOptions,
    ...optionInput(raw),
  });
  if (!parsed.success) {
    throw new AppError('invalid_options', '对局设置不合法', 400);
  }
  return parsed.data as GameOptionValues;
}

/** 读取库里已存的选项；旧对局没有该字段时回落到默认值。 */
export function storedOptions(engine: AnyGamePlugin, row: MatchRow): GameOptionValues {
  try {
    return validateOptions(engine, JSON.parse(row.options));
  } catch {
    return { ...engine.defaultOptions };
  }
}

export function createMatch(
  gameId: string,
  host: UserRow,
  visibility: Visibility,
  rawOptions: unknown = {},
): MatchSummary {
  const engine = getGame(gameId);
  const options = validateOptions(engine, rawOptions);
  const now = Date.now();
  const id = newMatchId();
  const seed = newSeed();
  // waiting 阶段没有引擎状态；房主点开始后才按实际人数 setup。
  const state = 'null';

  tx(() => {
    db.prepare(
      `INSERT INTO matches
         (id, game_id, host_id, status, visibility, options, seed, state, version, seq, created_at)
       VALUES (?, ?, ?, 'waiting', ?, ?, ?, ?, 0, 0, ?)`,
    ).run(id, gameId, host.id, visibility, JSON.stringify(options), seed, state, now);
    db.prepare(
      'INSERT INTO match_seats (match_id, seat, user_id, name, joined_at) VALUES (?, 0, ?, ?, ?)',
    ).run(id, host.id, host.name, now);
  });

  return getSummary(id)!;
}

/** 房主在开局前修改选项；等待阶段没有引擎状态，只更新选项。 */
export function updateMatchOptions(
  matchId: string,
  user: UserRow,
  rawOptions: unknown,
): MatchSummary {
  const row = getMatchRow(matchId);
  if (!row) throw new AppError('match_not_found', '房间不存在', 404);
  if (row.host_id !== user.id) throw new AppError('not_host', '只有房主可以修改对局设置', 403);
  if (row.status !== 'waiting') {
    throw new AppError('options_locked', '对局已经开始，设置已锁定', 409);
  }

  const engine = getGame(row.game_id);
  const current = storedOptions(engine, row);
  const options = validateOptions(engine, { ...current, ...optionInput(rawOptions) });
  const nextSeq = row.seq + 1;
  const now = Date.now();

  tx(() => {
    db.prepare(
      'UPDATE matches SET options = ?, version = version + 1, seq = ? WHERE id = ?',
    ).run(JSON.stringify(options), nextSeq, matchId);
    db.prepare(
      'INSERT INTO match_events (match_id, seq, actor, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      matchId,
      nextSeq,
      0,
      'options_changed',
      JSON.stringify([{ type: 'options_changed', options }]),
      now,
    );
  });

  const event = withEventLevels([{ type: 'options_changed', options } satisfies GameEvent])[0];
  bus.emit('update', { matchId, events: [event], seq: nextSeq });
  return getSummary(matchId)!;
}

export function joinMatch(matchId: string, user: UserRow): MatchSummary {
  const row = getMatchRow(matchId);
  if (!row) throw new AppError('match_not_found', '房间不存在', 404);

  const existing = seatOf(matchId, user.id);
  if (existing) return getSummary(matchId)!;

  if (row.status === 'finished') throw new AppError('match_finished', '这局已经结束了', 409);
  if (row.status === 'active') throw new AppError('match_full', '对局已经开始，只能观战', 409);

  const engine = getGame(row.game_id);
  const seats = listSeats(matchId);
  if (seats.length >= engine.meta.maxPlayers) {
    throw new AppError('match_full', '房间已满', 409);
  }

  const now = Date.now();
  const seat = seats.length;

  tx(() => {
    db.prepare(
      'INSERT INTO match_seats (match_id, seat, user_id, name, joined_at) VALUES (?, ?, ?, ?, ?)',
    ).run(matchId, seat, user.id, user.name, now);
  });

  bus.emit('update', {
    matchId,
    events: [{ type: 'player_joined', seat } satisfies GameEvent],
    seq: row.seq,
  });
  return getSummary(matchId)!;
}

/**
 * 房主手动开局。入座人数达到 minPlayers 后才允许；
 * 开局时按实际人数重新 setup，因此 2-N 人的游戏能正确初始化。
 */
export function startMatch(matchId: string, user: UserRow): MatchSummary {
  const row = getMatchRow(matchId);
  if (!row) throw new AppError('match_not_found', '房间不存在', 404);
  if (row.status === 'finished') throw new AppError('match_finished', '这局已经结束了', 409);
  if (row.host_id !== user.id) throw new AppError('not_host', '只有房主可以开始对局', 403);
  if (row.status === 'active') return getSummary(matchId)!;

  const engine = getGame(row.game_id);
  const seats = listSeats(matchId);
  if (seats.length < engine.meta.minPlayers) {
    throw new AppError(
      'not_enough_players',
      `至少需要 ${engine.meta.minPlayers} 名玩家才能开始`,
      409,
    );
  }
  if (seats.length > engine.meta.maxPlayers) {
    throw new AppError('too_many_players', `最多 ${engine.meta.maxPlayers} 名玩家`, 409);
  }

  const options = storedOptions(engine, row);
  let initialState: unknown;
  try {
    initialState = engine.setup(seats.length, options, createRng(row.seed || row.id));
  } catch (error) {
    // A card-pool validation failure is a user-fixable room setting, not an
    // internal server failure. Keep unknown setup errors as 500.
    const detail = error instanceof Error ? error.message : '';
    if (detail.startsWith('卡池校验失败：')) {
      const firstUnsupported = detail.match(/#(\d+) 扩展卡「([^」]+)」效果尚未实现/);
      const example = firstUnsupported
        ? `（如 #${firstUnsupported[1]}「${firstUnsupported[2]}」）`
        : '';
      throw new AppError(
        'unsupported_card_pool',
        `当前牌池包含尚未完成规则实现的扩展卡${example}。请取消勾选扩展包，只保留“基础 50 张”后重试。`,
        409,
      );
    }
    throw error;
  }
  const state = JSON.stringify(initialState);
  const now = Date.now();
  const nextSeq = row.seq + 1;

  tx(() => {
    db.prepare(
      `UPDATE matches
          SET status = 'active', state = ?, aborted = 0, started_at = ?, version = version + 1, seq = ?
        WHERE id = ?`,
    ).run(state, now, nextSeq, matchId);
    db.prepare(
      'INSERT INTO match_events (match_id, seq, actor, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      matchId,
      nextSeq,
      0,
      'match_started',
      JSON.stringify([{ type: 'match_started' }]),
      now,
    );
  });

  const startedEvent = withEventLevels([{ type: 'match_started' } satisfies GameEvent])[0];
  bus.emit('update', { matchId, events: [startedEvent], seq: nextSeq });
  return getSummary(matchId)!;
}

/** 房主中止对局：结束但不判断胜负，与平局区分。 */
export function abortMatch(matchId: string, user: UserRow): MatchSummary {
  const row = getMatchRow(matchId);
  if (!row) throw new AppError('match_not_found', '房间不存在', 404);
  if (row.status === 'finished') throw new AppError('match_finished', '这局已经结束了', 409);
  if (row.status !== 'active') throw new AppError('match_not_active', '对局还没开始', 409);
  if (row.host_id !== user.id) throw new AppError('not_host', '只有房主可以中止对局', 403);

  const now = Date.now();
  const nextSeq = row.seq + 1;
  const event = withEventLevels([{ type: 'match_aborted', by: user.id } satisfies GameEvent])[0];

  tx(() => {
    db.prepare(
      `UPDATE matches
          SET status = 'finished', aborted = 1, ended_at = ?, version = version + 1, seq = ?
        WHERE id = ?`,
    ).run(now, nextSeq, matchId);
    db.prepare(
      'INSERT INTO match_events (match_id, seq, actor, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(matchId, nextSeq, 0, 'match_aborted', JSON.stringify([event]), now);
  });

  bus.emit('update', { matchId, events: [event], seq: nextSeq, winner: null });
  return getSummary(matchId)!;
}

export function applyAction(
  matchId: string,
  user: UserRow,
  action: unknown,
  actionId: string,
): { view: MatchView; events: GameEvent[] } {
  const row = getMatchRow(matchId);
  if (!row) throw new AppError('match_not_found', '房间不存在', 404);
  if (row.status === 'waiting') throw new AppError('match_not_started', '对局还没开始', 409);
  if (row.status === 'finished') throw new AppError('match_finished', '这局已经结束了', 409);

  const seat = seatOf(matchId, user.id);
  if (!seat) throw new AppError('not_a_player', '你不是这局的玩家', 403);

  // 幂等：网络重发不会执行两次
  const dup = db
    .prepare('SELECT seq FROM match_actions WHERE match_id = ? AND action_id = ?')
    .get(matchId, actionId);
  if (dup) {
    return { view: buildView(matchId, user.id), events: [] };
  }

  const engine = getGame(row.game_id);
  const parsed = engine.actionSchema.safeParse(action);
  if (!parsed.success) {
    throw new AppError('bad_action', '动作格式不正确', 400);
  }
  const state = JSON.parse(row.state);
  const nextSeq = row.seq + 1;
  if (engine.actionType(parsed.data) === 'resign' && !engine.resignable(state, seat.seat)) {
    throw new AppError('resign_not_allowed', '现在不能认输', 409);
  }
  const result = engine.reduce(state, seat.seat, parsed.data, {
    now: Date.now(),
    rng: createRng(`${row.seed || row.id}:${nextSeq}`),
  });
  if (!result.ok) {
    throw new AppError(result.code, result.message, 409);
  }

  const now = Date.now();
  const finished = engine.finished(result.state);
  const winner = finished ? engine.winner(result.state) : null;
  const status: MatchStatus = finished ? 'finished' : row.status;
  const events = withEventLevels(result.events);

  tx(() => {
    db.prepare(
      'INSERT INTO match_actions (match_id, action_id, seat, seq, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(matchId, actionId, seat.seat, nextSeq, JSON.stringify(parsed.data), now);
    db.prepare(
      'INSERT INTO match_events (match_id, seq, actor, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(matchId, nextSeq, seat.seat, engine.actionType(parsed.data), JSON.stringify(events), now);
    db.prepare(
      `UPDATE matches
          SET state = ?, version = version + 1, seq = ?, status = ?, aborted = 0, ended_at = ?
        WHERE id = ?`,
    ).run(
      JSON.stringify(result.state),
      nextSeq,
      status,
      finished ? now : null,
      matchId,
    );
    if (finished && engine.rankings) {
      const seatUsers = new Map(listSeats(matchId).map((seat) => [seat.seat, seat.user_id]));
      for (const entry of engine.rankings(result.state)) {
        const userId = seatUsers.get(entry.seat);
        if (!userId) continue;
        db.prepare(
          `INSERT OR REPLACE INTO match_rankings
             (match_id, user_id, seat, rank, score, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(matchId, userId, entry.seat, entry.rank, entry.score ?? null, now);
      }
    }
  });

  bus.emit('update', { matchId, events, seq: nextSeq, winner });
  return { view: buildView(matchId, user.id), events };
}

export function buildView(matchId: string, userId: string): MatchView {
  const row = getMatchRow(matchId);
  if (!row) throw new AppError('match_not_found', '房间不存在', 404);

  const engine = getGame(row.game_id);
  const state = JSON.parse(row.state);
  const seats = listSeats(matchId);
  const mine = seats.find((s) => s.user_id === userId) ?? null;
  const viewerSeat = mine ? mine.seat : null;
  const active = row.status === 'active';
  const started = active || row.status === 'finished';

  const players: PlayerInfo[] = seats.map((s) => ({
    seat: s.seat,
    userId: s.user_id,
    name: s.name,
    isYou: s.user_id === userId,
  }));

  return {
    matchId: row.id,
    gameId: row.game_id,
    gameName: engine.meta.name,
    status: row.status,
    visibility: row.visibility,
    seq: row.seq,
    version: row.version,
    players,
    hostId: row.host_id,
    minPlayers: engine.meta.minPlayers,
    maxPlayers: engine.meta.maxPlayers,
    you: { userId, seat: viewerSeat, spectator: viewerSeat === null },
    currentSeat: active ? engine.turn(state) : null,
    winner: started ? engine.winner(state) : null,
    aborted: row.aborted !== 0,
    canResign: active && viewerSeat !== null && engine.resignable(state, viewerSeat),
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    options: storedOptions(engine, row),
    game: started ? engine.view(state, viewerSeat, active) : null,
  };
}

export function getSummary(matchId: string): MatchSummary | null {
  const row = getMatchRow(matchId);
  if (!row) return null;
  const engine = getGame(row.game_id);
  const seats = listSeats(matchId);
  return {
    id: row.id,
    gameId: row.game_id,
    gameName: engine.meta.name,
    status: row.status,
    visibility: row.visibility,
    hostId: row.host_id,
    hostName: seats.find((s) => s.user_id === row.host_id)?.name ?? '—',
    playerCount: seats.length,
    minPlayers: engine.meta.minPlayers,
    maxPlayers: engine.meta.maxPlayers,
    players: seats.map((s) => ({ seat: s.seat, userId: s.user_id, name: s.name })),
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export function listMatches(status: 'waiting' | 'active' | 'all'): MatchSummary[] {
  const rows = (
    status === 'all'
      ? db
          .prepare(
            `SELECT id FROM matches
              WHERE visibility = 'public' AND status IN ('waiting', 'active')
              ORDER BY created_at DESC LIMIT 60`,
          )
          .all()
      : db
          .prepare(
            `SELECT id FROM matches
              WHERE visibility = 'public' AND status = ?
              ORDER BY created_at DESC LIMIT 60`,
          )
          .all(status)
  ) as { id: string }[];
  return rows.map((r) => getSummary(String(r.id))).filter((m): m is MatchSummary => m !== null);
}

export function rematch(matchId: string, user: UserRow): string {
  const row = getMatchRow(matchId);
  if (!row) throw new AppError('match_not_found', '房间不存在', 404);
  if (row.status !== 'finished') throw new AppError('match_not_finished', '对局还没结束', 409);
  if (!seatOf(matchId, user.id)) throw new AppError('not_a_player', '你不是这局的玩家', 403);

  const engine = getGame(row.game_id);
  const oldSeats = listSeats(matchId);
  const newId = newMatchId();
  const now = Date.now();
  const seed = newSeed();
  const options = storedOptions(engine, row);

  tx(() => {
    db.prepare(
      `INSERT INTO matches
         (id, game_id, host_id, status, visibility, options, seed, state, version, seq, created_at)
       VALUES (?, ?, ?, 'waiting', ?, ?, ?, ?, 0, 0, ?)`,
    ).run(
      newId,
      row.game_id,
      row.host_id,
      row.visibility,
      JSON.stringify(options),
      seed,
      'null',
      now,
    );
    for (const s of oldSeats) {
      db.prepare(
        'INSERT INTO match_seats (match_id, seat, user_id, name, joined_at) VALUES (?, ?, ?, ?, ?)',
      ).run(newId, s.seat, s.user_id, s.name, now);
    }
  });

  bus.emit('rematch', { oldMatchId: matchId, newMatchId: newId });
  return newId;
}

/* ------------------------------- chat ------------------------------ */

export function addChat(matchId: string, user: UserRow, body: string): ChatMessage {
  const text = body.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
  if (!text) throw new AppError('empty_message', '消息不能为空', 400);
  const now = Date.now();
  const result = db
    .prepare(
      'INSERT INTO chat_messages (match_id, user_id, name, body, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(matchId, user.id, user.name, text, now);
  return {
    id: Number(result.lastInsertRowid),
    matchId,
    userId: user.id,
    name: user.name,
    body: text,
    createdAt: now,
  };
}

export function listChat(matchId: string, limit = 50): ChatMessage[] {
  const rows = db
    .prepare(
      'SELECT * FROM chat_messages WHERE match_id = ? ORDER BY id DESC LIMIT ?',
    )
    .all(matchId, limit) as Record<string, unknown>[];
  return rows
    .map((r) => ({
      id: Number(r.id),
      matchId: String(r.match_id),
      userId: String(r.user_id),
      name: String(r.name),
      body: String(r.body),
      createdAt: Number(r.created_at),
    }))
    .reverse();
}
