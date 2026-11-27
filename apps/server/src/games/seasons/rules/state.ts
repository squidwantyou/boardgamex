import type { CardRef, SeasonsLogEntry } from '@bgx/protocol/games/seasons';
import type { SeasonsPlayerState, SeasonsState } from '../engine.js';
import { shuffleWithSeed } from './random.js';
import { cardById } from '../cards/registry.js';

/** 引擎内部的不可变状态工具；effect 与 engine 共用，避免两套状态改写逻辑。 */

export const LOG_LIMIT = 80;

export function pushLog(
  log: SeasonsLogEntry[],
  t: SeasonsLogEntry['t'],
  msg: string,
): SeasonsLogEntry[] {
  return [...log, { t, msg, seq: (log.at(-1)?.seq ?? log.length) + 1 }].slice(-LOG_LIMIT);
}

export function seatName(seat: number): string {
  return `座位 ${seat + 1}`;
}

/**
 * 公开日志里的玩家称呼。日志由引擎生成，不能知道房间昵称；这里
 * 只保留稳定的公开玩家标识，前端渲染时再把“玩家 N”替换为昵称。
 * 内部座位号不能直接出现在对局记录中。
 */
export function playerLogName(seat: number): string {
  return `玩家 ${seat + 1}`;
}

export function crystalsAfterGain(player: SeasonsPlayerState, amount: number): number {
  const blocked = amount > 0 && player.played.some((card) =>
    !player.cardMarks?.[card.u]?.lockSource && cardById(card.i)?.effect?.typeKey === 'ios_minion');
  return player.crystals + (blocked ? 0 : amount);
}

export function printedCardType(player: SeasonsPlayerState, card: CardRef): string | undefined {
  return cardById(player.cardMarks?.[card.u]?.ravenOriginalId ?? card.i)?.type;
}

export function winterStaffActive(state: SeasonsState, player: SeasonsPlayerState): boolean {
  return Math.floor(state.month / 3) % 4 === 0 && player.played.some((card) =>
    card.i === 78 && !player.cardMarks?.[card.u]?.lockSource);
}

export function patchPlayer(
  state: SeasonsState,
  seat: number,
  fn: (player: SeasonsPlayerState) => Partial<SeasonsPlayerState>,
): SeasonsState {
  return {
    ...state,
    players: state.players.map((player) => {
      if (player.seat !== seat) return player;
      const update = fn(player);
      return { ...player, ...update, ...(update.crystals !== undefined
        ? { crystals: crystalsAfterGain(player, update.crystals - player.crystals) } : {}) };
    }),
  };
}

/** 抽一张牌；牌堆空时把弃牌堆洗回牌堆（与旧引擎 drawFromDeck 一致）。 */
export function drawOne(state: SeasonsState): [SeasonsState, CardRef | null] {
  let deck = state.deck;
  let discard = state.discard;
  let rngCursor = state.rngCursor;
  // 先复制数组再 pop：deck 可能来自旧 state，原地 pop 会破坏调用方的不可变性。
  deck = [...deck];
  if (deck.length === 0) {
    if (discard.length === 0) return [state, null];
    deck = [...discard];
    rngCursor = shuffleWithSeed(deck, state.rngSeed, rngCursor);
    discard = [];
  }
  const card = deck.pop() ?? null;
  return [{ ...state, deck, discard, rngCursor }, card];
}

/** 给某位玩家抽 n 张牌（进手牌）。 */
export function drawToHand(state: SeasonsState, seat: number, count: number): SeasonsState {
  const drawn: CardRef[] = [];
  for (let i = 0; i < count; i++) {
    const [drawnState, card] = drawOne(state);
    state = drawnState;
    if (card) drawn.push(card);
  }
  if (drawn.length === 0) return state;
  return patchPlayer(state, seat, (player) => ({ hand: [...player.hand, ...drawn] }));
}
