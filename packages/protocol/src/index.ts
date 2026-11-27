import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* 核心协议：这里只放与具体游戏无关的传输/对局结构                        */
/* 具体游戏（视图、动作、校验）放在 ./games/<id>.ts，由游戏模块自带       */
/* ------------------------------------------------------------------ */

/** 游戏 id 是开放字符串；框架不维护白名单，注册表负责发现。 */
export type GameId = string;

export interface GameMeta {
  id: GameId;
  name: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
}

/** 一个“开局选项”的候选值。 */
export interface GameOptionChoice {
  value: string;
  label: string;
  description?: string;
  /** 该候选值暂时不可选；用于尚未完成规则实现的实验选项。 */
  disabled?: boolean;
}

/**
 * 游戏开局选项定义。
 *
 * 第一版只有 N 选一（下拉框）；以后要加开关/数字，可以在这里扩展 type。
 * 框架只负责展示、校验、保存和下发，不解释某个选项对规则意味着什么。
 */
export interface GameOptionDefinition {
  id: string;
  label: string;
  description?: string;
  /** select = N 选一；multi = N 选多（checkbox）。缺省按 select 处理。 */
  type?: 'select' | 'multi';
  choices: GameOptionChoice[];
  /** 默认值必须是 choices 里的 value；multi 时是 value 数组 */
  default: string | string[];
}

/** 一局当前选中的选项值：optionId -> choice.value（multi 时为数组） */
export type GameOptionValue = string | string[];
export type GameOptionValues = Record<string, GameOptionValue>;

/** 大厅展示用的目录信息；游戏协议模块导出这个对象。 */
export interface GameCatalog extends GameMeta {
  description: string;
  rules: string[];
  /** 开局选项；没有选项的游戏给空数组。 */
  options: GameOptionDefinition[];
}

/* ------------------------------------------------------------------ */
/* 对局视图（前端只读；服务端按玩家裁剪后下发）                          */
/* ------------------------------------------------------------------ */

export type MatchStatus = 'waiting' | 'active' | 'finished';
export type Visibility = 'public' | 'private';

export interface PlayerInfo {
  seat: number;
  userId: string;
  name: string;
  isYou: boolean;
}

/**
 * 框架注入的随机源。
 *
 * 对局创建时会生成随机种子并持久化；引擎在 setup() 里用同一个种子得到
 * 可复现的随机序列（洗牌、发牌、随机先手等）。种子不会下发给客户端。
 */
export interface RandomSource {
  /** [0, 1) 的浮点数 */
  next(): number;
  /** [0, maxExclusive) 的整数 */
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  /** 返回新数组，不修改入参 */
  shuffle<T>(items: readonly T[]): T[];
}

/** 游戏视图由各游戏自行定义；框架只透传，不在核心层解释。 */
export type GameView = unknown;

export interface MatchView<V = GameView> {
  matchId: string;
  gameId: GameId;
  gameName: string;
  status: MatchStatus;
  visibility: Visibility;
  seq: number;
  version: number;
  players: PlayerInfo[];
  hostId: string;
  minPlayers: number;
  maxPlayers: number;
  /** 本局选中的开局选项值 */
  options: GameOptionValues;
  you: { userId: string; seat: number | null; spectator: boolean };
  /** 当前该谁行动（seat 下标）；无先后手/等待中为 null */
  currentSeat: number | null;
  winner: number | null;
  /** 房主中止；与平局区分 */
  aborted: boolean;
  /** 当前查看者现在是否可以认输 */
  canResign: boolean;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  /** waiting 阶段不创建引擎状态，因此为 null */
  game: V | null;
}

export interface MatchSummary {
  id: string;
  gameId: GameId;
  gameName: string;
  status: MatchStatus;
  visibility: Visibility;
  hostId: string;
  hostName: string;
  playerCount: number;
  minPlayers: number;
  maxPlayers: number;
  players: { seat: number; userId: string; name: string }[];
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface ChatMessage {
  id: number;
  matchId: string;
  userId: string;
  name: string;
  body: string;
  createdAt: number;
}

export interface PublicUser {
  id: string;
  name: string;
  /** 已注册账号的用户名；游客为 null */
  username: string | null;
}

export interface MeResponse {
  user: PublicUser;
}

/* ------------------------------------------------------------------ */
/* 玩家主页                                                             */
/* ------------------------------------------------------------------ */

export type ProfileResult = 'win' | 'loss' | 'draw' | 'playing' | 'waiting';

export interface ProfileMatch {
  matchId: string;
  gameId: GameId;
  gameName: string;
  status: MatchStatus;
  visibility: Visibility;
  /** 该玩家在这局里的座位 */
  mySeat: number;
  result: ProfileResult;
  winner: number | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  /** 已执行的动作数（含布阵/落子/开炮） */
  moveCount: number;
  players: { seat: number; userId: string; name: string }[];
  opponentName: string | null;
}

export interface PlayerProfile {
  user: PublicUser & { createdAt: number };
  stats: {
    total: number;
    wins: number;
    losses: number;
    draws: number;
    /** 正在进行中的对局数 */
    active: number;
  };
  matches: ProfileMatch[];
}

export interface GameEvent {
  type: string;
  /** info 为常规事件，major 为开局/结束等需要高亮或归档的事件 */
  level?: 'info' | 'major';
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* 动作与实时消息                                                       */
/* ------------------------------------------------------------------ */

/**
 * 动作在传输层是 unknown：具体形状由各游戏的 actionSchema 校验。
 * 框架（matches/realtime）不感知 move/place/fire 等具体动作。
 */
export type GameAction = unknown;

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('join'), matchId: z.string().min(1).max(64) }),
  z.object({
    t: z.literal('action'),
    matchId: z.string().min(1).max(64),
    actionId: z.string().min(1).max(64),
    action: z.unknown(),
  }),
  z.object({
    t: z.literal('chat'),
    matchId: z.string().min(1).max(64),
    text: z.string().min(1).max(200),
  }),
  z.object({ t: z.literal('leave'), matchId: z.string().min(1).max(64) }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ServerMessage =
  | { t: 'snapshot'; view: MatchView }
  | { t: 'update'; view: MatchView; events: GameEvent[] }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'rematch'; matchId: string }
  | { t: 'error'; code: string; message: string; actionId?: string };
