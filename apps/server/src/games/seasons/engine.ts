import type { GameEvent, RandomSource } from '@bgx/protocol';
import {
  ELEMENTS,
  type CardRef,
  type Element,
  type SeasonsAction,
  type SeasonsCardCost,
  type SeasonsCardDef,
  type SeasonsCardView,
  type SeasonsDieRewards,
  type SeasonsDieView,
  type SeasonsElementSource,
  type SeasonsGameView,
  type SeasonsLogEntry,
  type SeasonsOptions,
  type SeasonsPlayerScore,
  type SeasonsPlayerView,
  type SeasonsResultView,
  type SeasonsSeasonView,
} from '@bgx/protocol/games/seasons';
import type { GameEngine, ReduceResult } from '../types.js';
import { BASE_CARDS, CARD_BY_ID, SEASONS_CARDS } from './cards/base.js';
import { validateCardPool } from './cards/support.js';
import { cardById } from './cards/registry.js';
import {
  ACTIVATION_HANDLERS,
  keyOf as activationKeyOfCard,
  type ActivationHandler,
  type ActivationRequest as RegisteredActivationRequest,
} from './cards/activation-handlers.js';
import {
  ROUND_END_HANDLERS,
  SCORE_HANDLERS,
  SEASON_CHANGE_HANDLERS,
  TURN_END_HANDLERS,
  handlerKey,
} from './cards/event-handlers.js';
import { randInt } from './rules/random.js';
import {
  runSummonEffect,
  summonChoiceFor,
  type SummonChoiceRequest,
} from './cards/effects.js';
import {
  BADGE_PENALTY,
  BASE_MAX_ENERGY,
  CARDS_PER_PLAYER,
  COPIES_PER_CARD,
  DRAFT_ROUNDS,
  HAND_PENALTY,
  MAX_BADGES,
  MONTHS_PER_SEASON,
  MONTHS_PER_YEAR,
  SEASONS,
  SEASONS_PER_YEAR,
  TOTAL_MONTHS,
  TRANSMUTE_VALUE,
} from './rules/const.js';
import {
  abilitiesOf,
  abilityAmount,
  addEnergyCapped,
  affordable,
  ELEMENT_NAME_ZH,
  energySum,
  resolveCost,
} from './rules/play.js';
import { randIntAt, shuffleWithSeed } from './rules/random.js';
import { crystalsAfterGain, drawOne, drawToHand, patchPlayer, printedCardType, pushLog, seatName, winterStaffActive } from './rules/state.js';
import { parseCardList, parseElementAlloc } from './rules/choice.js';
import { DICE_BY_ELEMENT } from './rules/dice.js';

/* ------------------------------------------------------------------ */
/* 状态                                                                */
/* ------------------------------------------------------------------ */

/** 场上的卡：CardRef + 公开的动态信息。 */
export interface CardInstance extends CardRef {
  /** 存在卡上的能量（水晶球等） */
  stored?: Partial<Record<Element, number>>;
  /** 灵活费用卡实际支付的元素 */
  paid?: Element[];
  /** 伊欧的复制仪生成的复制牌。 */
  generated?: true;
}

export interface SeasonsDieState {
  id: number;
  letter: string;
  face: number;
  pip: number;
  rewards: SeasonsDieRewards;
  pickedBy: number | null;
}

export interface SeasonsSeasonState {
  index: number;
  dice: SeasonsDieState[];
}

export interface SeasonsPendingChoiceState {
  kind: string;
  key: string;
  choosingSeat: number;
  options: Record<string, unknown>;
  /** Private card candidates belonging to this decision, when any. */
  cards?: CardRef[];
  branches?: readonly { id: string; label: string }[];
}

/** Persistent marks created by an extension card. All values are JSON-safe. */
export interface SeasonsCardMarks {
  /** Raven target instance uid. */
  ravenTarget?: number;
  ravenOriginalId?: number;
  /** Argosian lock source instance uid. */
  lockSource?: number;
  lockSources?: number[];
  /** Urmian one-shot trap is still armed. */
  trapArmed?: boolean;
  /** Urmian response is waiting and the cage has fired. */
  trapPending?: boolean;
  /** Summoned card has entered play but its printed effect has not resolved. */
  summonEffectPending?: boolean;
  summonOrigin?: 'normal' | 'freeEffect' | 'otus';
  /** Heart of Argos can produce at most one Earth token per turn. */
  heartChargedThisTurn?: boolean;
  /** Stand-in for an energy token on an extension card. */
  storedEarth?: number;
  storedWater?: number;
  storedAir?: number;
  storedFire?: number;
  /** Persistent jewel tokens, independent of which element was sealed. */
  jewels?: number;
}

export interface SeasonsPlayerState {
  seat: number;
  /** 第 1 年手牌 */
  hand: CardRef[];
  /** 第 2 / 3 年牌库 */
  library2: CardRef[];
  library3: CardRef[];
  played: CardInstance[];
  energies: Record<Element, number>;
  crystals: number;
  gauge: number;
  maxEnergy: number;
  /** 终局按 BADGE_PENALTY 扣分 */
  badgesUsed: number;
    /** Die upgraded by badge 4 for the current action only. */
    badgeDrawDieId: number | null;
  /** 徽章升级后摸 2 选 1 的待选牌（仅本人可见） */
  badgeDraw: CardRef[] | null;
  /** 轮抽阶段的手牌（会左右传递） */
  draftHand: CardRef[];
  /** 已轮抽到的 9 张牌 */
  drafted: CardRef[];
  organizeYear1: number[];
  organizeYear2: number[];
  organizeDone: boolean;
  canTransmute: boolean;
  /** Badge 2 crystallisation bonus earned this action round; cleared at turn end. */
  transmuteBonus: number;
  /** Whether this player used Io's Transmuter during the current round. */
  transmutedThisTurn: boolean;
  /** 本回合已激活的能力："<uid>:<abilityKey>" */
  activatedThisTurn: string[];
  /** Extension-card persistent state, keyed by card instance uid. */
  cardMarks?: Record<number, SeasonsCardMarks>;
}

export interface SeasonsState {
  version: 1;
  rulesVersion?: 'seasons-90-v2';
  /** Monotonic successful-action counter used by summon events and their continuations. */
  actionSeq: number;
  rngSeed: number;
  rngCursor: number;
  phase: 'draft' | 'organize' | 'play' | 'ended';
  /** 已完成的轮抽轮数，0–9 */
  draftRound: number;
  players: SeasonsPlayerState[];
  deck: CardRef[];
  discard: CardRef[];
  /** 0–35 */
  month: number;
  year: number;
  seasonIdx: number;
  season: SeasonsSeasonState | null;
  startPlayer: number;
  currentPicker: number | null;
  turnOwner: number | null;
  /** 本月已行动完的座位 */
  pickedThisSeason: number[];
  /** 本月选骰顺序（决定行动顺序） */
  dicePicked: number[];
  pendingChoice: SeasonsPendingChoiceState | null;
  /** 同一时机排队等待的选择（花瓶、时光沙漏等被动），前一个结算后自动接上。 */
  pendingQueue: SeasonsPendingChoiceState[];
  /** 待选择卡牌（仅选择者可见）：抽 N 留 1 等弹窗。 */
  pendingCards: CardRef[] | null;
  result: SeasonsResultView | null;
  resignedSeat: number | null;
  log: SeasonsLogEntry[];
  /** Per-player number of months moved by effects during the current round. */
  monthStepsThisRound?: number[];
  /** Otus central candidates, shared by all players. */
  otusPool?: CardRef[];
  otusUsed?: number[];
  /** Per player Otus use count in the current action round. */
  otusUsedThisRound?: number[];
  /** Remaining stock of generated Replica cards. */
  replicaDeck?: number;
  /** Replica supply visible to players. */
  replicaSupply?: number;
  /** Completed battlefield instances during the current common-round settlement. */
  roundEndResolved?: number[];
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function fail(code: string, message: string): ReduceResult<SeasonsState> {
  return { ok: false, code, message };
}

function promoteQueued(state: SeasonsState): SeasonsState {
  if (state.pendingChoice || state.pendingQueue.length === 0) return state;
  let queue = state.pendingQueue;
  while (queue.length > 0) {
    const [next, ...rest] = queue;
    if (!next) break;
    if (next.kind === 'finish_turn') {
      const result = finishEndTurn({ ...state, pendingQueue: rest }, next.choosingSeat);
      return result.ok ? promoteQueued(result.state) : state;
    }
    if (next.kind === 'finish_game') return finishGame({ ...state, month: TOTAL_MONTHS, pendingQueue: rest });
    if (next.kind === 'round_end_card') {
      let settled = applyRoundEndCard(
        { ...state, pendingQueue: [] }, next.choosingSeat, Number(next.options.cardUid),
      );
      settled = reconcileArgosianLocks(state, reconcileRavens(settled));
      settled = normalizeReserve(state, settled);
      return promoteQueued({ ...settled, pendingQueue: [...settled.pendingQueue, ...rest] });
    }
    if (next.kind === 'finish_round') {
      return promoteQueued(finishRound({ ...state, pendingQueue: rest }, next.choosingSeat));
    }
    if (next.kind === 'energy_swap') {
      const player = state.players[next.choosingSeat];
      if (!player) { queue = rest; continue; }
      const incoming = (next.options.incoming ?? {}) as Partial<Record<Element, number>>;
      const pool = energySum(player.energies) + energySum(incoming as Record<Element, number>);
      if (pool <= player.maxEnergy) {
        state = patchPlayer(state, player.seat, (item) => ({
          energies: addEnergyCapped(item.energies, incoming, item.maxEnergy),
        }));
        queue = rest;
        continue;
      }
      return { ...state, pendingChoice: { ...next, options: { ...next.options,
        current: { ...player.energies }, pool, total: player.maxEnergy,
        discardAmount: pool - player.maxEnergy,
        title: `储备区超上限：弃置 ${pool - player.maxEnergy} 个元素`, label: '弃置所选',
      } }, pendingQueue: rest, pendingCards: next.cards ?? null };
    }
    // 过期的弃置选择：排队之后储备可能已被其他效果清空，此时无需再弃。
    if (next.kind === 'energy_discard') {
      const player = state.players[next.choosingSeat];
      if (!player || (next.key === 'energy_discard' && energySum(player.energies) <= player.maxEnergy)) {
        queue = rest;
        continue;
      }
    }
    return {
      ...state,
      pendingChoice: next,
      pendingQueue: rest,
      pendingCards: next.cards ?? null,
    };
  }
  return queue.length === state.pendingQueue.length
    ? state
    : { ...state, pendingQueue: queue, pendingCards: queue[0]?.cards ?? null };
}

/**
 * A cage may interrupt a summon before the summoned card's effects resolve.
 * The choice is intentionally resolved by the summoner, not by the cage owner.
 */
function queueUrmianTrap(
  state: SeasonsState,
  summonerSeat: number,
  summoned: CardRef,
  origin: SummonOrigin,
): SeasonsState {
  const cages = state.players.flatMap((player) =>
    player.played
      .filter((card) => {
        const key = cardById(card.i)?.effect?.typeKey ?? cardById(card.i)?.effect?.type;
        return (
          key === 'urmian_psychic_cage' &&
          !lockedOut(player, card) &&
          card.u !== summoned.u &&
          player.cardMarks?.[card.u]?.trapArmed === true
        );
      })
      .map((card) => ({ player, card })),
  );
  if (cages.length === 0) return state;

  let next = state;
  for (const { player, card } of cages) {
    next = patchPlayer(next, player.seat, (owner) => {
      const marks = { ...(owner.cardMarks ?? {}) };
      marks[card.u] = {
        ...(marks[card.u] ?? {}),
        trapArmed: false,
        trapPending: true,
      };
      return { cardMarks: marks };
    });
    next = queueChoice(next, {
      kind: 'branch',
      key: 'urmian_psychic_cage',
      choosingSeat: summonerSeat,
      options: {
        title: `心灵囚笼：${seatName(summonerSeat)} 召唤了「${
          cardById(summoned.i)?.nameZh ?? `#${summoned.i}`
        }」。弃掉它且不结算效果，或牺牲一张其他魔法牌。`,
        label: '确认',
        cageSeat: player.seat,
        cageUid: card.u,
        summoned,
        summonedUid: summoned.u,
        origin,
        summonerSeat,
        branches: [
          { id: 'discard_summoned', label: '弃掉刚召唤的牌，不结算效果' },
          { id: 'sacrifice_other', label: '牺牲另一张合法牌，正常结算' },
        ],
      },
    });
    next = {
      ...next,
      log: pushLog(
        next.log,
        'effect',
        `${seatName(summonerSeat)} 的召唤触发「心灵囚笼」`,
      ),
    };
  }
  return next;
}

function clearArgosianLocks(state: SeasonsState, removedUids: readonly number[]): SeasonsState {
  if (removedUids.length === 0) return state;
  const removed = new Set(removedUids);
  return {
    ...state,
    players: state.players.map((player) => {
      const marks = { ...(player.cardMarks ?? {}) };
      let changed = false;
      const played = player.played.map((card) => {
        const mark = marks[card.u];
        const sources = mark?.lockSources ?? (mark?.lockSource ? [mark.lockSource] : []);
        if (!mark || !sources.some((source) => removed.has(source))) return card;
        changed = true;
        const remaining = sources.filter((source) => !removed.has(source));
        marks[card.u] = { ...mark, lockSource: remaining[0], lockSources: remaining.length ? remaining : undefined };
        if (remaining.length) return card;
        return card;
      });
      if (!changed) return player;
      const updated = { ...player, played, cardMarks: marks };
      return { ...updated, maxEnergy: Math.max(0,
        player.maxEnergy + reserveCapacityBonus(updated) - reserveCapacityBonus(player)) };
    }),
  };
}

/**
 * Locks reference live battlefield instances, not card definitions. A source
 * that leaves its owner or changes controller can no longer suppress the target.
 */
function reconcileArgosianLocks(
  prev: SeasonsState,
  state: SeasonsState,
): SeasonsState {
  const sourceOwners = new Map<number, number>();
  for (const player of state.players) {
    for (const card of player.played) sourceOwners.set(card.u, player.seat);
  }
  const invalidSources = new Set<number>();
  for (const player of state.players) {
    for (const mark of Object.values(player.cardMarks ?? {})) {
      for (const source of mark.lockSources ?? (mark.lockSource ? [mark.lockSource] : [])) {
        if (!sourceOwners.has(source)) invalidSources.add(source);
      }
    }
  }
  for (const player of prev.players) {
    for (const card of player.played) {
      if (sourceOwners.get(card.u) !== player.seat) invalidSources.add(card.u);
    }
  }
  return clearArgosianLocks(state, [...invalidSources]);
}

function lockedOut(owner: SeasonsPlayerState, card: CardRef): boolean {
  return Boolean(owner.cardMarks?.[card.u]?.lockSource);
}

/** 已经提升为 pendingChoice 的弃置选择，若储备已不超上限则直接作废。 */
function clearStaleDiscard(state: SeasonsState): SeasonsState {
  const pending = state.pendingChoice;
  if (!pending || pending.kind !== 'energy_discard' || pending.key !== 'energy_discard') return state;
  const player = state.players[pending.choosingSeat];
  if (player && energySum(player.energies) > player.maxEnergy) return state;
  return promoteQueued({ ...state, pendingChoice: null, pendingCards: null });
}

function queueChoice(
  state: SeasonsState,
  choice: SeasonsPendingChoiceState,
): SeasonsState {
  return { ...state, pendingQueue: [...state.pendingQueue, choice] };
}

function continueAfterChoice(
  state: SeasonsState,
  next: SeasonsState,
): SeasonsState {
  const pendingCards = next.pendingCards ?? state.pendingCards ?? null;
  return promoteQueued({
    ...next,
    pendingChoice: null,
    pendingCards,
    pendingQueue: [...state.pendingQueue, ...next.pendingQueue].map((queued) =>
      queued.cards || !pendingCards ? queued : { ...queued, cards: pendingCards },
    ),
  });
}

/** 超出容量的新元素暂存于选择中，玩家只需弃置超出的部分。 */
function addReserveEnergy(
  state: SeasonsState,
  seat: number,
  incoming: Partial<Record<Element, number>>,
  label: string,
): SeasonsState {
  const player = state.players[seat];
  if (!player) return state;
  const amount = ELEMENTS.reduce(
    (sum, element) => sum + Math.max(0, incoming[element] ?? 0),
    0,
  );
  if (amount === 0) return state;
  const current = energySum(player.energies);
  if (current + amount <= player.maxEnergy) {
    return patchPlayer(state, seat, (item) => ({
      energies: addEnergyCapped(item.energies, incoming, item.maxEnergy),
    }));
  }
  return queueChoice(state, {
    kind: 'energy_swap',
    key: 'energy_swap',
    choosingSeat: seat,
    options: {
      title: `${label}：弃置 ${current + amount - player.maxEnergy} 个元素`,
      amount,
      total: player.maxEnergy,
      pool: current + amount,
      current: { ...player.energies },
      incoming,
    },
  });
}

function finish(
  prev: SeasonsState,
  res: ReduceResult<SeasonsState>,
): ReduceResult<SeasonsState> {
  if (!res.ok) return res;
  let next = reconcileRavens(res.state);
  next = normalizeReserve(prev, next);
  next = skipEmptyCardChoice(next);
  next = reconcileArgosianLocks(prev, next);
  return { ...res, state: promoteQueued(next) };
}

/**
 * 牌堆见底时可能一张牌都抽不到；此时「选 1 张保留」之类的选择没有候选，
 * 直接作废，避免玩家卡在一个无解弹窗上（小卡池 / 长时间对局里会真实发生）。
 */
function skipEmptyCardChoice(state: SeasonsState): SeasonsState {
  const pending = state.pendingChoice;
  if (!pending) return state;
  if (pending.kind !== 'card_pick' && pending.kind !== 'card_list') return state;
  if (pending.options.purpose === 'discard') return state;
  if ((state.pendingCards?.length ?? 0) > 0) return state;
  return { ...state, pendingChoice: null, pendingCards: null };
}

/**
 * 储备上限可能因卡牌离场而降低；超出的能量必须由本人选择弃掉。
 * 放在 finish 统一收口，任何改动上限的路径都不会漏（也让新增卡牌不必各自处理）。
 */
function normalizeReserve(prev: SeasonsState, state: SeasonsState): SeasonsState {
  let next = state;
  for (const player of state.players) {
    const before = prev.players.find((item) => item.seat === player.seat);
    if (!before) continue;
    if (player.maxEnergy >= before.maxEnergy &&
      energySum(player.energies) <= energySum(before.energies)) continue;
    const overflow = energySum(player.energies) - player.maxEnergy;
    if (overflow <= 0) continue;
    const queued =
      (next.pendingChoice?.key === 'energy_discard' &&
        next.pendingChoice.choosingSeat === player.seat) ||
      next.pendingQueue.some(
        (choice) => choice.key === 'energy_discard' && choice.choosingSeat === player.seat,
      );
    if (queued) continue;
    const available = { ...player.energies };
    next = queueChoice(next, {
      kind: 'energy_discard',
      key: 'energy_discard',
      choosingSeat: player.seat,
      options: {
        title: `储备上限变为 ${player.maxEnergy}，请弃掉 ${overflow} 个能量`,
        amount: overflow,
        available,
        label: '弃掉',
      },
    });
  }
  return next;
}

function newPlayer(seat: number): SeasonsPlayerState {
  return {
    seat,
    hand: [],
    library2: [],
    library3: [],
    played: [],
    energies: { water: 0, air: 0, fire: 0, earth: 0 },
    crystals: 0,
    gauge: 0,
    maxEnergy: BASE_MAX_ENERGY,
    badgesUsed: 0,
      badgeDrawDieId: null,
    badgeDraw: null,
    draftHand: [],
    drafted: [],
    organizeYear1: [],
    organizeYear2: [],
    organizeDone: false,
    canTransmute: false,
    transmuteBonus: 0,
    transmutedThisTurn: false,
    activatedThisTurn: [],
  };
}

function cardView(ref: CardRef, extra?: Partial<SeasonsCardView>): SeasonsCardView {
  const view: SeasonsCardView = { i: ref.i, u: ref.u };
  if (extra?.stored) view.stored = extra.stored;
  if (extra?.used) view.used = true;
  if (extra?.paid) view.paid = extra.paid;
  if (extra?.usedAbilityKeys) view.usedAbilityKeys = extra.usedAbilityKeys;
  if (extra?.jewels) view.jewels = extra.jewels;
  if (extra?.trapArmed) view.trapArmed = true;
  if (extra?.lockedBy) view.lockedBy = extra.lockedBy;
  if (extra?.copyOf) view.copyOf = extra.copyOf;
  if (extra?.printedId) view.printedId = extra.printedId;
  if (extra?.copySourceUid) view.copySourceUid = extra.copySourceUid;
  return view;
}

function usedKeys(player: SeasonsPlayerState, uid: number): string[] {
  return player.activatedThisTurn.filter(
    (key) => key === String(uid) || key.startsWith(`${uid}:`),
  );
}


function playerView(
  state: SeasonsState,
  player: SeasonsPlayerState,
  viewerSeat: number | null,
): SeasonsPlayerView {
  const self = viewerSeat === player.seat;
  const organized = new Set([...player.organizeYear1, ...player.organizeYear2]);
  const organizeRemaining = player.drafted.filter((card) => !organized.has(card.u));
  return {
    seat: player.seat,
    isYou: self,
    handCount: player.hand.length,
    hand: self ? player.hand.map((card) => cardView(card)) : null,
    played: player.played.map((card) => {
      const keys = usedKeys(player, card.u);
      const mark = player.cardMarks?.[card.u];
      return cardView(card, {
        stored: card.stored,
        used: keys.length > 0,
        usedAbilityKeys: keys,
        paid: card.paid,
        jewels: mark?.jewels,
        trapArmed: mark?.trapArmed,
        lockedBy: mark?.lockSource,
        copyOf: mark?.ravenOriginalId ? card.i : undefined,
        printedId: mark?.ravenOriginalId,
        copySourceUid: mark?.ravenTarget,
      });
    }),
    libraryCount: player.library2.length + player.library3.length,
    library2Count: player.library2.length,
    library3Count: player.library3.length,
    library2: self ? player.library2.map((card) => cardView(card)) : null,
    library3: self ? player.library3.map((card) => cardView(card)) : null,
    otusPool: (state.otusPool ?? []).map((card) => cardView(card)),
    otusOffer:
      viewerSeat !== null && viewerSeat === state.turnOwner && !state.pendingChoice
        ? (state.otusPool ?? []).map((card) => cardView(card))
        : null,
    energies: { ...player.energies },
    crystals: player.crystals,
    gauge: player.gauge,
    maxEnergy: player.maxEnergy,
    canTransmute: player.canTransmute,
    transmuteBonus: player.transmuteBonus,
    badgesUsed: player.badgesUsed,
      badgeDrawDieId: player.badgeDrawDieId,
    badgeDraw: self ? (player.badgeDraw ? player.badgeDraw.map((card) => cardView(card)) : null) : null,
    draftPicked: player.drafted.length > state.draftRound,
    draftHandCount: player.draftHand.length,
    draftHand: self ? player.draftHand.map((card) => cardView(card)) : null,
    draftedCount: player.drafted.length,
    drafted: self ? player.drafted.map((card) => cardView(card)) : null,
    organizeDone: player.organizeDone,
    organizeYear1: self ? [...player.organizeYear1] : null,
    organizeYear2: self ? [...player.organizeYear2] : null,
    organizeCards1: self ? player.organizeYear1.map((uid) => cardView({ i: 0, u: uid })) : null,
    organizeCards2: self ? player.organizeYear2.map((uid) => cardView({ i: 0, u: uid })) : null,
    organizeRemaining: self ? organizeRemaining.map((card) => cardView(card)) : null,
  };
}

function seasonView(state: SeasonsState): SeasonsSeasonView | null {
  if (!state.season) return null;
  const def = SEASONS[state.season.index];
  if (!def) return null;
  return {
    name: def.nameZh,
    nameEn: def.nameEn,
    element: def.element,
    letter: def.letter,
    index: state.season.index,
  };
}

function dieViews(state: SeasonsState, season: SeasonsSeasonView | null): SeasonsDieView[] {
  if (!state.season) return [];
  return state.season.dice.map((die) => ({
    id: die.id,
    letter: die.letter,
    face: die.face,
    pip: die.pip,
    rewards: { ...die.rewards },
    picked: die.pickedBy !== null,
    pickedBy: die.pickedBy,
  }));
}

/* ------------------------------------------------------------------ */
/* setup                                                               */
/* ------------------------------------------------------------------ */

/** 组池：自定义 id 列表优先，否则使用标准基础卡池。 */
/** 卡池条目：一张卡的实例份数（标准池 2 份，五福季节 20 份）。 */
type PoolEntry = { def: SeasonsCardDef; copies: number };

/** 五福季节：空气 / 火焰 / 大地 / 流水 / 元素护符，每种 20 张。 */
export const FIVE_FORTUNES_IDS: readonly number[] = [1, 2, 3, 4, 31];
export const FIVE_FORTUNES_COPIES = 20;

/** 骰子季节：100 张恶意之骰（id 15）。 */
export const DICE_SEASON_ID = 15;
export const DICE_SEASON_COPIES = 100;

function poolEntries(options: SeasonsOptions): PoolEntry[] {
  const extensions = options.extensions ?? ['base'];
  if (!extensions.includes('base')) throw new Error('基础卡包（base）是必选项');
  if (options.customDeck && options.customDeck.trim().length > 0) {
    const ids = [
      ...new Set(
        options.customDeck
          .split(',')
          .map((item) => Number(item.trim()))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    const cards: PoolEntry[] = [];
    const missing: number[] = [];
    for (const id of ids) {
      const def = cardById(id);
      if (def) cards.push({ def, copies: COPIES_PER_CARD });
      else missing.push(id);
    }
    if (missing.length > 0) {
      throw new Error(`未知卡牌 id：${missing.join(', ')}`);
    }
    return cards;
  }
  if (options.pool === 'five_fortunes') {
    const entries: PoolEntry[] = [];
    const missing: number[] = [];
    for (const id of FIVE_FORTUNES_IDS) {
      const def = cardById(id);
      if (def) entries.push({ def, copies: FIVE_FORTUNES_COPIES });
      else missing.push(id);
    }
    if (missing.length > 0) {
      throw new Error(`五福季节卡池缺少卡牌 id：${missing.join(', ')}`);
    }
    return entries;
  }
  if (options.pool === 'dice_season') {
    const def = cardById(DICE_SEASON_ID);
    if (!def) throw new Error(`骰子季节卡池缺少卡牌 id：${DICE_SEASON_ID}`);
    return [{ def, copies: DICE_SEASON_COPIES }];
  }
  return SEASONS_CARDS
    .filter((def) => extensions.includes(def.extension ?? 'base'))
    .map((def) => ({ def, copies: COPIES_PER_CARD }));
}

/** 开局前校验卡池：id 唯一、数值合法、效果 key 都已登记。 */
function assertCardPool(cards: readonly SeasonsCardDef[]): void {
  const issues = validateCardPool(cards);
  if (issues.length > 0) {
    const detail = issues
      .map((issue) => `#${issue.cardId ?? '?'} ${issue.message}`)
      .join('；');
    throw new Error(`卡池校验失败：${detail}`);
  }
}

function buildDeck(entries: readonly PoolEntry[], playerCount: number): CardRef[] {
  const deck: CardRef[] = [];
  let uid = 1;
  for (const entry of entries) {
    for (let copy = 0; copy < entry.copies; copy++) {
      deck.push({ i: entry.def.id, u: uid });
      uid++;
    }
  }
  const needed = playerCount * DRAFT_ROUNDS;
  if (deck.length < needed) {
    throw new Error(`卡池只有 ${deck.length} 张牌，至少需要 ${needed} 张才能发牌`);
  }
  return deck;
}

function setup(
  playerCount: number,
  options: SeasonsOptions,
  rng: RandomSource,
): SeasonsState {
  if (playerCount < 2) throw new Error('四季物语至少需要 2 名玩家');
  if (playerCount > 4) throw new Error('四季物语最多支持 4 名玩家');

  const seed = rng.int(0x7fffffff);
  let cursor = 0;

  const entries = poolEntries(options);
  assertCardPool(entries.map((entry) => entry.def));
  const deck = buildDeck(entries, playerCount);
  cursor = shuffleWithSeed(deck, seed, cursor);

  const players = Array.from({ length: playerCount }, (_, seat) => newPlayer(seat));
  // 与旧引擎一致：逐张从牌堆顶发牌，每人 9 张。
  for (let round = 0; round < CARDS_PER_PLAYER; round++) {
    for (const player of players) {
      const card = deck.pop();
      if (card) player.draftHand.push(card);
    }
  }

  return {
    version: 1,
    rulesVersion: 'seasons-90-v2',
    actionSeq: 0,
    rngSeed: seed,
    rngCursor: cursor,
    phase: 'draft',
    draftRound: 0,
    players,
    deck,
    discard: [],
    month: 0,
    year: 1,
    seasonIdx: 0,
    season: null,
    startPlayer: 0,
    currentPicker: 0,
    turnOwner: null,
    pickedThisSeason: [],
    dicePicked: [],
    pendingChoice: null,
    pendingQueue: [],
    pendingCards: null,
    result: null,
    resignedSeat: null,
    log: [{ t: 'draft', msg: '轮抽开始：每人 9 张牌' }],
  };
}

/* ------------------------------------------------------------------ */
/* 阶段：轮抽 / 组牌                                                    */
/* ------------------------------------------------------------------ */

function draftPick(
  state: SeasonsState,
  seat: number,
  cardUid: number,
): ReduceResult<SeasonsState> {
  if (state.phase !== 'draft') return fail('bad_phase', '当前不是轮抽阶段');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  if (me.drafted.length !== state.draftRound) {
    return fail('already_picked', '你已选择过本轮，请等待其他玩家');
  }

  const index = me.draftHand.findIndex((card) => card.u === cardUid);
  if (index < 0) return fail('card_not_in_hand', '所选牌不在轮抽手牌中');
  const card = me.draftHand[index];
  if (!card) return fail('card_not_in_hand', '所选牌不在轮抽手牌中');

  let players = state.players.map((player) =>
    player.seat === seat
      ? {
          ...player,
          draftHand: player.draftHand.filter((_, i) => i !== index),
          drafted: [...player.drafted, card],
        }
      : player,
  );

  let draftRound = state.draftRound;
  let phase: SeasonsState['phase'] = state.phase;
  let log = state.log;
  const events: GameEvent[] = [
    { type: 'draft_pick', seat, cardUid, cardId: card.i },
  ];

  if (players.every((player) => player.drafted.length === state.draftRound + 1)) {
    draftRound = state.draftRound + 1;
    if (draftRound >= DRAFT_ROUNDS) {
      phase = 'organize';
      log = pushLog(log, 'draft', '轮抽完成，进入组牌阶段');
      events.push({ type: 'draft_complete' });
    } else {
      // 手牌传向左边：第 i 位拿到第 i-1 位的手牌。
      const hands = players.map((player) => player.draftHand);
      players = players.map((player, i) => ({
        ...player,
        draftHand: hands[(i - 1 + players.length) % players.length] ?? [],
      }));
      events.push({ type: 'draft_round', round: draftRound });
    }
  }

  return {
    ok: true,
    state: phase === 'organize'
      ? prepareDraftTwists({ ...state, players, draftRound, phase, log })
      : { ...state, players, draftRound, phase, log },
    events,
  };
}

function prepareDraftTwists(state: SeasonsState): SeasonsState {
  if (![...state.deck, ...state.players.flatMap((player) => player.drafted)].some((card) => card.i === 73)) return state;
  let next: SeasonsState = { ...state, deck: state.deck.filter((card) => card.i !== 73) };
  next = { ...next, rngCursor: shuffleWithSeed(next.deck, next.rngSeed, next.rngCursor) };
  for (const player of state.players) {
    const twists = player.drafted.filter((card) => card.i === 73);
    if (!twists.length) continue;
    next = patchPlayer(next, player.seat, (owner) => ({ drafted: owner.drafted.filter((card) => card.i !== 73) }));
    for (const twist of twists) {
      const cards: CardRef[] = [];
      for (let index = 0; index < 2; index++) {
        const [drawnState, card] = drawOne(next); next = drawnState;
        if (card) cards.push(card);
      }
      if (cards.length) next = queueChoice(next, { kind: 'card_pick', key: 'draft_twist',
        choosingSeat: player.seat, cards, options: { title: '天命不凡：保留一张替换牌', cardUid: twist.u, label: '保留' } });
    }
  }
  return next;
}

/** 开始新的一个月：换季、从当季 5 颗骰子里洗出「人数 + 1」颗并掷面。 */
function startMonth(state: SeasonsState): SeasonsState {
  const seasonIdx =
    Math.floor(state.month / MONTHS_PER_SEASON) % SEASONS_PER_YEAR;
  const def = SEASONS[seasonIdx];
  if (!def) throw new Error(`非法月份：${state.month}`);

  const pool = [...DICE_BY_ELEMENT[def.element]];
  const count = Math.min(state.players.length + 1, pool.length);
  let cursor = shuffleWithSeed(pool, state.rngSeed, state.rngCursor);

  const dice: SeasonsDieState[] = [];
  for (const die of pool.slice(0, count)) {
    const faceIndex = randIntAt(state.rngSeed, cursor, die.faces.length);
    cursor++;
    const face = die.faces[faceIndex];
    if (!face) continue;
    dice.push({
      id: die.id,
      letter: def.letter,
      face: face.roll,
      pip: face.pip,
      rewards: { ...face.rewards },
      pickedBy: null,
    });
  }

  const year = Math.floor(state.month / MONTHS_PER_YEAR) + 1;
  const monthOfSeason = (state.month % MONTHS_PER_SEASON) + 1;
  return {
    ...state,
    rngCursor: cursor,
    year,
    seasonIdx,
    season: { index: seasonIdx, dice },
    currentPicker: state.startPlayer,
    turnOwner: null,
    pickedThisSeason: [],
    dicePicked: [],
    otusUsedThisRound: state.players.map(() => 0),
    pendingChoice: null,
    pendingQueue: [],
    pendingCards: null,
    log: pushLog(
      state.log,
      'month',
      `第 ${year} 年 · ${def.nameZh}季 · 第 ${monthOfSeason} 月 · 起始玩家：${seatName(state.startPlayer)}`,
    ),
  };
}

function startTournament(state: SeasonsState): SeasonsState {
  return startMonth({ ...state, phase: 'play' });
}

function organize(
  state: SeasonsState,
  seat: number,
  cardUids: readonly [number, number, number],
): ReduceResult<SeasonsState> {
  if (state.phase !== 'organize') return fail('bad_phase', '当前不是组牌阶段');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  if (me.organizeDone) return fail('organize_done', '你已完成组牌');

  if (new Set(cardUids).size !== cardUids.length) {
    return fail('duplicate_card', '所选牌重复');
  }
  for (const uid of cardUids) {
    if (!me.drafted.some((card) => card.u === uid)) {
      return fail('card_not_drafted', '所选牌不在已轮抽的牌中');
    }
  }

  let players = state.players;
  let log = state.log;
  const events: GameEvent[] = [
    { type: 'organize', seat, step: me.organizeYear1.length === 0 ? 1 : 2 },
  ];

  if (me.organizeYear1.length === 0) {
    players = state.players.map((player) =>
      player.seat === seat ? { ...player, organizeYear1: [...cardUids] } : player,
    );
  } else {
    const allUids = new Set([...me.organizeYear1, ...cardUids]);
    const byUid = new Map(me.drafted.map((card) => [card.u, card]));
    const year1 = me.organizeYear1
      .map((uid) => byUid.get(uid))
      .filter((card): card is CardRef => card !== undefined);
    const year2 = cardUids
      .map((uid) => byUid.get(uid))
      .filter((card): card is CardRef => card !== undefined);
    const year3 = me.drafted.filter((card) => !allUids.has(card.u));
    players = state.players.map((player) =>
      player.seat === seat
        ? {
            ...player,
            organizeYear2: [...cardUids],
            hand: year1,
            library2: year2,
            library3: year3,
            organizeDone: true,
          }
        : player,
    );
    log = pushLog(log, 'organize', `${seatName(seat)} 完成组牌`);
    events.push({ type: 'organize_complete', seat });
  }

  let next: SeasonsState = { ...state, players, log };
  if (next.players.every((player) => player.organizeDone)) {
    next = startTournament(next);
    events.push({ type: 'tournament_start' });
  }
  return { ok: true, state: next, events };
}

function organizeReset(state: SeasonsState, seat: number): ReduceResult<SeasonsState> {
  if (state.phase !== 'organize') return fail('bad_phase', '当前不是组牌阶段');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  if (me.organizeDone) return fail('organize_done', '你已完成组牌，不能撤回');
  const players = state.players.map((player) =>
    player.seat === seat
      ? { ...player, organizeYear1: [], organizeYear2: [] }
      : player,
  );
  return { ok: true, state: { ...state, players }, events: [{ type: 'organize_reset', seat }] };
}

/** 场上「恶意之骰」这类可重掷骰子的能力：每张牌每回合各提供一次。 */
function dieRerollOf(
  player: SeasonsPlayerState,
): { crystals: number; name: string; count: number } | null {
  let count = 0;
  let crystals = 2;
  let name = '恶意之骰';
  for (const card of player.played) {
    if (lockedOut(player, card)) continue;
    const def = cardById(card.i);
    if (!def) continue;
    const ability = abilitiesOf(def, 'dice_reroll')[0];
    if (!ability) continue;
    count += 1;
    crystals = typeof ability.crystals === 'number' ? ability.crystals : 2;
    name = def.nameZh;
  }
  if (count === 0) return null;
  return { crystals, name, count };
}

/** 构造一次「是否重掷」选择；remaining 表示还能重掷几次（含本次）。 */
function maliceChoice(
  reroll: { crystals: number; name: string },
  remaining: number,
): SeasonsState['pendingChoice'] {
  return {
    kind: 'branch',
    key: 'die_of_malice',
    choosingSeat: -1,
    options: {
      title: `${reroll.name}：是否重掷本回合的骰子？（剩余 ${remaining} 次）`,
      crystals: reroll.crystals,
      remaining,
      branches: [
        { id: 'normal', label: '不再重掷，结算骰面' },
        { id: 'alternative', label: `重掷骰子并得 ${reroll.crystals} 水晶` },
      ],
    },
  };
}

/** 玩家开始行动：先问是否用「恶意之骰」重掷（场上有 N 张就能重掷 N 次），再结算骰面奖励。 */
function beginTurn(state: SeasonsState, seat: number): ReduceResult<SeasonsState> {
  const player = state.players[seat];
  const reroll = player ? dieRerollOf(player) : null;
  if (!reroll) return { ok: true, state: resolveDieRewards(state, seat), events: [] };
  const pending = maliceChoice(reroll, reroll.count);
  return {
    ok: true,
    state: {
      ...state,
      pendingChoice: pending ? { ...pending, choosingSeat: seat } : null,
    },
    events: [],
  };
}

/** 行动阶段开始：结算该玩家骰面奖励（旧引擎 resolveDieEffects 的简化版）。 */
function resolveDieRewards(state: SeasonsState, seat: number, skipSteadfast = false): SeasonsState {
  const die = state.season?.dice.find((item) => item.pickedBy === seat);
  if (!die) return state;
  if (!skipSteadfast && state.players[seat]!.played.some((card) => card.i === 64 && !lockedOut(state.players[seat]!, card))) {
    return queueChoice(state, { kind: 'branch', key: 'steadfast_die', choosingSeat: seat,
      options: { title: '坚定骰子：选择本行动轮奖励', branches: [
        { id: 'normal', label: '执行季节骰奖励' }, { id: 'gauge', label: '召唤等级 +1' },
        { id: 'energy', label: '获得 1 个能量' }, { id: 'transmute', label: '获得晶化权' },
      ] } });
  }
  // 与旧引擎一致：每回合开始先失去转换能力，只有骰面奖励能重新给。
  let next = patchPlayer(state, seat, () => ({ canTransmute: false }));
  const parts: string[] = [];
  const me = (): SeasonsPlayerState => next.players[seat] as SeasonsPlayerState;

  if (die.rewards.summon) {
    next = patchPlayer(next, seat, (player) => ({ gauge: player.gauge + 1 }));
    parts.push('召唤等级+1');
  }
  if (die.rewards.crystals) {
    next = patchPlayer(next, seat, (player) => ({
      crystals: player.crystals + (die.rewards.crystals ?? 0),
    }));
    parts.push(`💎${die.rewards.crystals}`);
    if (me().played.some((card) => card.i === 59 && !lockedOut(me(), card))) {
      next = patchPlayer(next, seat, () => ({ canTransmute: true }));
    }
  }
  if (die.rewards.card) {
    const badgeUpgraded = me().badgeDrawDieId === die.id;
    const count = badgeUpgraded ? 2 : 1;
    const drawn: CardRef[] = [];
    for (let i = 0; i < count; i++) {
      const [drawnState, card] = drawOne(next);
      next = drawnState;
      if (card) drawn.push(card);
    }
    if (drawn.length > 0) {
      // The draw reward is a private decision. The candidate cards never enter
      // the public log or the hand until the player keeps them.
      next = queueChoice(next, {
        kind: 'card_list',
        key: 'die_draw',
        choosingSeat: seat,
        options: {
          amount: drawn.length,
          keep: 1,
          title: badgeUpgraded
            ? '抽牌徽章：摸 2 张，选择保留 1 张'
            : '骰面抽牌：选择保留或弃置',
          label: badgeUpgraded ? '保留' : '保留此牌',
          source: 'die',
        },
        cards: drawn,
      });
      parts.push(badgeUpgraded ? '抽牌×2（待选择）' : '抽牌×1（待选择）');
    }
  }
  if (die.rewards.transmute) {
    next = patchPlayer(next, seat, () => ({ canTransmute: true }));
    parts.push('获得转换能力');
  }

  const incoming = {
    water: die.rewards.water,
    air: die.rewards.air,
    fire: die.rewards.fire,
    earth: die.rewards.earth,
  };
  const incomingTotal = ELEMENTS.reduce((sum, element) => sum + (incoming[element] ?? 0), 0);
  if (incomingTotal > 0) {
    const now = me();
    const room = Math.max(0, now.maxEnergy - energySum(now.energies));
    if (incomingTotal <= room) {
      const before = energySum(now.energies);
      next = patchPlayer(next, seat, (player) => ({
        energies: addEnergyCapped(player.energies, incoming, player.maxEnergy),
      }));
      const added = energySum(me().energies) - before;
      parts.push(added > 0 ? `能量+${added}` : '能量已满');
    } else {
      // 与旧引擎一致：装不下时让玩家在「当前储备 + 新获得」里挑，总量保持上限。
      next = queueChoice(next, {
        kind: 'energy_swap',
        key: 'energy_swap',
        choosingSeat: seat,
        options: {
          title: `储备区将超上限 — 骰子奖励 ${incomingTotal} 个能量，从 ${
            energySum(now.energies) + incomingTotal
          } 个中保留 ${now.maxEnergy} 个`,
          amount: incomingTotal,
          total: now.maxEnergy,
          pool: energySum(now.energies) + incomingTotal,
          current: { ...now.energies },
          incoming,
        },
      });
      parts.push(`能量${incomingTotal}（储备区将超上限，待分配）`);
    }
  }

  return {
    ...next,
    log: pushLog(
      next.log,
      'effect',
      `${seatName(seat)} 行动·骰子效果（点数 ${die.pip}）→ ${parts.join('，') || '无奖励'}`,
    ),
  };
}

/** 选骰：按 currentPicker 顺序挑选当月的骰子。 */
function draftDice(
  state: SeasonsState,
  seat: number,
  dieIndex: number,
): ReduceResult<SeasonsState> {
  if (state.phase !== 'play') return fail('bad_phase', '现在不是对局阶段');
  if (state.pendingChoice) return fail('pending_choice', '请先完成当前选择');
  if (state.turnOwner !== null) return fail('action_phase', '还有玩家在行动中');
  if (state.currentPicker !== seat) return fail('not_your_turn', '还没轮到你选骰子');

  const season = state.season;
  if (!season) return fail('bad_state', '本月骰子尚未掷出');
  const die = season.dice[dieIndex];
  if (!die) return fail('invalid_die', '无效的骰子');
  if (die.pickedBy !== null) return fail('die_taken', '这颗骰子已被选走');

  const dice = season.dice.map((item, index) =>
    index === dieIndex ? { ...item, pickedBy: seat } : item,
  );
  const dicePicked = [...state.dicePicked, seat];
  const events: GameEvent[] = [
    { type: 'draft_dice', seat, dieIndex, pip: die.pip },
  ];

  let next: SeasonsState = {
    ...state,
    season: { ...season, dice },
    dicePicked,
    log: pushLog(
      state.log,
      'effect',
      `${seatName(seat)} 选定骰子（点数 ${die.pip}）`,
    ),
  };

  if (dicePicked.length >= state.players.length) {
    const first = dicePicked[0] ?? state.startPlayer;
    next = { ...next, currentPicker: first, turnOwner: first, pickedThisSeason: [] };
    events.push({ type: 'action_phase', seat: first });
    // 行动阶段开始：先结算首位玩家骰面奖励（可能先问恶意之骰重掷）；其余玩家在 end-turn 时结算。
    const begun = beginTurn(next, first);
    if (!begun.ok) return begun;
    next = begun.state;
  } else {
    next = { ...next, currentPicker: (seat + 1) % state.players.length };
  }

  return { ok: true, state: next, events };
}

/** 召唤一张手牌：校验召唤等级/费用，扣能量与水晶，进入场上。 */
/** 召唤时的被动能力：春之杖（水晶）与对手的奥术水蛭。 */
type SummonOrigin = 'normal' | 'freeEffect' | 'otus';

function applyPassiveSummonEffects(state: SeasonsState, seat: number): SeasonsState {
  let next = state;
  const me = state.players[seat];
  if (!me) return state;

  let crystalsGain = 0;
  for (const card of me.played) {
    if (lockedOut(me, card)) continue;
    const def = cardById(card.i);
    if (def) crystalsGain += abilityAmount(def, 'on_summon_crystal');
  }
  if (crystalsGain > 0) {
    next = patchPlayer(next, seat, (player) => ({
      crystals: player.crystals + crystalsGain,
    }));
    next = {
      ...next,
      log: pushLog(next.log, 'effect', `春之杖：水晶 +${crystalsGain}`),
    };
  }

  // 扩展包「对手召唤时」奖励（皇家书记官等）：按 triggerKind 过滤。
  const extraDraws: number[] = [];
  const withRewards = next.players.map((player) => {
    if (player.seat === seat) return player;
    let crystals = player.crystals;
    for (const card of player.played) {
      if (lockedOut(player, card)) continue;
      const effect = cardById(card.i)?.effect;
      if (!effect || (effect.typeKey ?? effect.type) !== 'opponent_action_reward') continue;
      if (effect.triggerKind && effect.triggerKind !== 'opponent_summon') continue;
      if (effect.crystals) crystals += effect.crystals;
      if (effect.draw) extraDraws.push(player.seat);
    }
    return crystals === player.crystals ? player : {
      ...player, crystals: crystalsAfterGain(player, crystals - player.crystals),
    };
  });
  const crystalsChanged = withRewards.some((player, index) => player !== next.players[index]);
  if (crystalsChanged || extraDraws.length > 0) {
    next = { ...next, players: withRewards };
    if (crystalsChanged) {
      next = { ...next, log: pushLog(next.log, 'effect', '对手召唤奖励：水晶已结算') };
    }
  }
  for (const ownerSeat of extraDraws) {
    const [drawnState, drawn] = drawOne(next);
    next = drawnState;
    if (drawn) {
      next = patchPlayer(next, ownerSeat, (player) => ({ hand: [...player.hand, drawn] }));
      next = { ...next, log: pushLog(next.log, 'effect', '对手召唤奖励：抽 1 张牌') };
    }
  }

  let summonerCrystals = next.players[seat]?.crystals ?? 0;
  let stolen = 0;
  const players = next.players.map((player) => {
    if (player.seat === seat) return player;
    let crystals = player.crystals;
    for (const card of player.played) {
      if (lockedOut(player, card)) continue;
      const def = cardById(card.i);
      if (!def?.effect) continue;
      if ((def.effect.typeKey ?? def.effect.type) !== 'arcano_leech') continue;
      if (summonerCrystals <= 0) continue;
      summonerCrystals -= 1;
      crystals += 1;
      stolen += 1;
    }
    return crystals === player.crystals ? player : {
      ...player, crystals: crystalsAfterGain(player, crystals - player.crystals),
    };
  });
  if (stolen > 0) {
    next = {
      ...next,
      players: players.map((player) =>
        player.seat === seat ? { ...player, crystals: summonerCrystals } : player,
      ),
      log: pushLog(next.log, 'effect', `奥术水蛭：对手获得 ${stolen} 水晶`),
    };
  }
  return next;
}

/** 公共的召唤后结算：正常召唤与效果免费召唤共用。 */
function settleSummonedCard(
  state: SeasonsState,
  seat: number,
  card: CardInstance,
  origin: SummonOrigin,
): SeasonsState {
  const def = cardById(card.i);
  if (!def) return state;

  let next = runSummonEffect(state, seat, card);
  next = applyPassiveSummonEffects(next, seat);
  next = applyMagmaCoreForOpponentSummon(next, seat, card, origin);
  return {
    ...next,
    log: pushLog(
      next.log,
      'summon',
      `${seatName(seat)} ${origin === 'freeEffect' ? '免费' : ''}召唤「${def.nameZh}」`,
    ),
  };
}

/**
 * 熔岩核只响应对手完成的普通召唤。自己召唤、被效果免费召唤以及失败的
 * 召唤都不触发；固定火元素自动入账，仅溢出时要求弃置。
 */
function applyMagmaCoreForOpponentSummon(
  state: SeasonsState,
  summonerSeat: number,
  summoned: CardRef,
  origin: SummonOrigin,
): SeasonsState {
  if (origin !== 'normal') return state;
  let next = state;
  for (const player of state.players) {
    if (player.seat === summonerSeat) continue;
    const cores = player.played.filter(
      (card) =>
        !lockedOut(player, card) &&
        cardById(card.i)?.effect?.typeKey === 'magma_core',
    );
    if (cores.length === 0) continue;

    for (const core of cores) {
      next = addReserveEnergy(next, player.seat, { fire: 1 }, '熔岩核');
      next = {
        ...next,
        log: pushLog(
          next.log,
          'effect',
          `${seatName(player.seat)}「熔岩核」#${summoned.i}（UID ${summoned.u}）：${
            seatName(summonerSeat)
          } 召唤「${cardById(summoned.i)?.nameZh ?? `#${summoned.i}`}」，获得 1 个火元素`,
        ),
      };
    }
  }
  return next;
}

/** 把召唤效果产生的选择接到公共待答队列，正常和免费召唤共用。 */
function openSummonChoice(
  state: SeasonsState,
  seat: number,
  card: CardRef,
  request: SummonChoiceRequest,
): SeasonsState {
  const options: Record<string, unknown> = { ...request, cardUid: card.u };
  let next = state;
  let pendingCards: CardRef[] | null = request.cards ? [...request.cards] : null;
  if (request.key === 'selenias_codex') {
    pendingCards = (pendingCards ?? []).filter((item) => item.u !== card.u);
    if (!pendingCards.length) return state;
  }
  const drawCount =
    typeof request.draw === 'number'
      ? request.draw
      : request.kind === 'card_list'
        ? (request.amount ?? 0)
        : 0;
  if (drawCount > 0 && !pendingCards) {
    const drawn: CardRef[] = [];
    for (let index = 0; index < drawCount; index += 1) {
      const [drawnState, cardRef] = drawOne(next);
      next = drawnState;
      if (cardRef) drawn.push(cardRef);
    }
    pendingCards = drawn;
  }

  const keepCount =
    typeof request.keep === 'number'
      ? request.keep
      : request.kind === 'card_list'
        ? 1
        : 0;
  if (request.kind === 'card_list' && (pendingCards?.length ?? 0) <= keepCount) {
    const drawn = pendingCards ?? [];
    return {
      ...next,
      players: next.players.map((player) =>
        player.seat === seat ? { ...player, hand: [...player.hand, ...drawn] } : player,
      ),
      pendingCards: null,
      log: pushLog(
        next.log,
        'choice',
        `${seatName(seat)} 抽到的牌不足以舍弃，全部保留`,
      ),
    };
  }

  const choice: SeasonsPendingChoiceState = {
    kind: request.kind,
    key: request.key,
    choosingSeat:
      request.kind === 'multi_player_pick' &&
      Array.isArray(request.players) &&
      request.players.length > 0
        ? request.players[0]!
        : seat,
    options,
    ...(pendingCards ? { cards: pendingCards } : {}),
  };
  if (next.pendingChoice) {
    return {
      ...next,
      pendingQueue: [...next.pendingQueue, choice],
    };
  }
  return promoteQueued({
    ...next,
    pendingQueue: [...next.pendingQueue, choice],
  });
}

/** 场上永久卡提供的召唤费用减免总量（幸运之手等）。 */
function costReductionOf(me: SeasonsPlayerState): number {
  return me.played.reduce((sum, item) => {
    const def = cardById(item.i);
    if (!def || lockedOut(me, item)) return sum;
    return (
      sum +
      abilitiesOf(def, 'cost_reduction').reduce(
        (inner, ability) => inner + (ability.amount ?? 0),
        0,
      )
    );
  }, 0);
}

/** 按当前能量/水晶还差多少点能量才能支付；水晶不够视为付不起。 */
function energyGap(player: SeasonsPlayerState, cost: SeasonsCardCost, earthWild = false): number {
  if ((cost.crystal ?? 0) > player.crystals) return Number.POSITIVE_INFINITY;
  if (earthWild) {
    const nonEarth = ELEMENTS.filter((element) => element !== 'earth');
    const missing = nonEarth.reduce((sum, element) =>
      sum + Math.max(0, cost[element] - reserveElementCount(player, element)), 0);
    const remaining = reserveTotal(player) - nonEarth.reduce((sum, element) =>
      sum + Math.min(cost[element], reserveElementCount(player, element)), 0);
    return missing + Math.max(0, cost.earth - remaining);
  }
  return ELEMENTS.reduce(
    (sum, element) => sum + Math.max(0, (cost[element] ?? 0) - reserveElementCount(player, element)),
    0,
  );
}

/** 是否存在某种减费分配，能让这张牌真的付得起。 */
function affordableAfterReduction(
  player: SeasonsPlayerState,
  cost: SeasonsCardCost,
  reducible: number,
  earthWild = false,
): boolean {
  if ((cost.crystal ?? 0) > player.crystals) return false;
  const elements = ELEMENTS.filter((element) => (cost[element] ?? 0) > 0);
  let found = false;
  const walk = (index: number, left: number, reduced: Partial<Record<Element, number>>) => {
    if (found) return;
    if (index === elements.length) {
      const test: SeasonsCardCost = { ...cost };
      for (const element of elements) {
        test[element] = (cost[element] ?? 0) - (reduced[element] ?? 0);
      }
      if (
        test.crystal <= player.crystals &&
        energyGap(player, test, earthWild) === 0
      ) {
        found = true;
      }
      return;
    }
    const element = elements[index]!;
    const cap = Math.min(cost[element] ?? 0, left);
    for (let take = 0; take <= cap; take += 1) {
      walk(index + 1, left - take, { ...reduced, [element]: take });
      if (found) return;
    }
  };
  walk(0, reducible, {});
  return found;
}

function summon(
  state: SeasonsState,
  seat: number,
  cardUid: number,
  paidElements: Element[] | undefined,
  paidSources: SeasonsElementSource[] | undefined,
  costOverride?: Partial<Record<Element, number>>,
  fromOtus = false,
): ReduceResult<SeasonsState> {
  if (state.phase !== 'play') return fail('bad_phase', '现在不是对局阶段');
  if (state.pendingChoice) return fail('pending_choice', '请先完成当前选择');
  if (state.turnOwner !== seat) return fail('not_your_turn', '还没轮到你行动');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');

  const card = fromOtus
    ? (state.otusPool ?? []).find((item) => item.u === cardUid)
    : me.hand.find((item) => item.u === cardUid);
  if (!card) {
    return fail(
      fromOtus ? 'card_not_in_otus' : 'card_not_in_hand',
      fromOtus ? '所选牌不在猫头鹰贤者的中央候选中' : '所选牌不在手牌中',
    );
  }
  if (me.gauge <= me.played.length) {
    return fail('gauge_low', '召唤等级必须大于已打出的卡牌数');
  }
  const def = cardById(card.i);
  if (!def) return fail('unknown_card', '未知卡牌');
  if (fromOtus) {
    if ((state.otusUsedThisRound?.[seat] ?? 0) >= 1) {
      return fail('otus_already_used', '本行动轮已从猫头鹰贤者处召唤过一张牌');
    }
  }

  let cost = resolveCost(def, state.players.length);
  if (costOverride) {
    cost = { ...cost, ...costOverride };
  } else if (!def.costFlexible) {
    // 幸运之手等：费用减 N 个任意能量，总能量费用不低于 1；只有一种可减元素时自动减。
    const reducible = Math.min(
      costReductionOf(me),
      Math.max(0, energySum(cost) - 1),
    );
    if (reducible > 0) {
      // 减费只能「帮到」本来差一点的能量；差得比可减量还多时直接判付不起，
      // 不弹一个注定 cant_afford 的选择。
      const gap = energyGap(me, cost, winterStaffActive(state, me));
      if (
        !Number.isFinite(gap) ||
        reducible < gap ||
        !affordableAfterReduction(me, cost, reducible, winterStaffActive(state, me))
      ) {
        return fail('cant_afford', '能量或水晶不足');
      }
      const elements = ELEMENTS.filter((element) => (cost[element] ?? 0) > 0);
      const only = elements.length <= 1 ? elements[0] : undefined;
      if (paidSources?.length) {
        const chosen = Object.fromEntries(ELEMENTS.map((element) =>
          [element, paidSources.filter((source) => source.element === element).length])) as Record<Element, number>;
        if (energySum(chosen) !== energySum(cost) - reducible ||
          (winterStaffActive(state, me)
            ? chosen.earth > cost.earth || ELEMENTS.filter((element) => element !== 'earth')
              .reduce((sum, element) => sum + Math.max(0, chosen[element] - cost[element]), 0) > cost.earth - chosen.earth
            : ELEMENTS.some((element) => chosen[element] > cost[element]))) {
          return fail('invalid_payment', '支付的能量必须符合减免后的费用');
        }
        cost = { ...cost, ...chosen };
      } else if (only) {
        cost = { ...cost, [only]: cost[only] - reducible };
      } else {
        return {
          ok: true,
          state: {
            ...state,
            pendingChoice: {
              kind: 'element_alloc',
              key: 'cost_reduce',
              choosingSeat: seat,
              options: {
                title: `选择费用减 ${reducible} 个能量（总费用不低于 1）`,
                amount: reducible,
                maxPerElement: Object.fromEntries(
                  elements.map((element) => [element, cost[element]]),
                ),
                label: '减免',
                then: 'summon_cost',
                cardUid,
                paidElements: paidElements ?? [],
                paidSources: paidSources ?? [],
                fromOtus,
                cost,
              },
            },
          },
          events: [],
        };
      }
    }
  }
  // 储备区与 reserve_slot 卡上的能量视为同一池（用户确认的语义）：
  // 召唤费用、减费、激活费用都从这里扣，先扣储备区、再扣卡上。
  let payer: SeasonsPlayerState = me;
  let paid: Element[] | undefined;

  if (def.costFlexible) {
    const flex = def.costFlexible;
    const max = Math.min(flex.max || 4, ELEMENTS.length);
    const min = Math.max(flex.min || 1, 1);
    const chosenSources = paidSources?.length
      ? paidSources
      : (paidElements ?? []).map((element) => ({ element, source: 'reserve' as const }));
    if (chosenSources.length < min || chosenSources.length > max) {
      return fail('flex_cost_count', `本卡需支付 ${min}~${max} 种能量`);
    }
    const maxPer = flex.maxPerType || 1;
    const counts: Partial<Record<Element, number>> = {};
    for (const source of chosenSources) {
      counts[source.element] = (counts[source.element] ?? 0) + 1;
    }
    for (const element of ELEMENTS) {
      if ((counts[element] ?? 0) > maxPer) {
        return fail('flex_cost_duplicate', '每种能量支付数量超出上限');
      }
    }
    const payment = payElementSources(payer, { ...cost, crystal: 0 }, chosenSources, undefined, true);
    if (!payment.ok) return fail(payment.code, payment.message);
    payer = payment.player;
    paid = payment.paid;
  } else {
    const payment = payElementSources(payer, cost, paidSources, paidElements, false, winterStaffActive(state, me));
    if (!payment.ok) return fail(payment.code, payment.message);
    payer = payment.player;
    paid = payment.paid.length > 0 ? payment.paid : undefined;
  }

  let maxEnergy = me.maxEnergy + enteringCapacityBonus(me, def);
  if (def.effect?.type === 'max_energy' && typeof def.effect.amount === 'number') {
    maxEnergy = def.effect.amount;
  }

  // 需要弹窗的召唤效果：已接入的进入 pendingChoice；未接入的在扣费前拒绝。
  const summonChoice = summonChoiceFor(def, paid ?? [], state, seat);
  if (summonChoice === 'unimplemented') {
    return fail(
      'effect_not_implemented',
      `「${def.nameZh}」的召唤效果需要选择，尚未实现（T2.2b-2）`,
    );
  }

  const playedCard: CardInstance = { i: card.i, u: card.u };
  if (paid) playedCard.paid = paid;

  const players = state.players.map((player) =>
    player.seat === seat
      ? {
          ...payer,
          hand: fromOtus
            ? payer.hand
            : payer.hand.filter((item) => item.u !== card.u),
          played: [...payer.played, playedCard],
          maxEnergy,
        }
      : player,
  );

  let next: SeasonsState = { ...state, players };
  if (fromOtus) {
    next = {
      ...next,
      otusPool: (next.otusPool ?? []).filter((item) => item.u !== card.u),
      otusUsed: [...(next.otusUsed ?? []), card.u],
      otusUsedThisRound: (next.otusUsedThisRound ?? state.players.map(() => 0)).map(
        (count, index) => (index === seat ? count + 1 : count),
      ),
    };
  }
  {
    next = patchPlayer(next, seat, (player) => ({
      cardMarks: {
        ...(player.cardMarks ?? {}),
        [card.u]: {
          ...(player.cardMarks?.[card.u] ?? {}),
          summonEffectPending: true,
           summonOrigin: fromOtus ? 'otus' : 'normal',
        },
      },
    }));
  }
  const trapNext = queueUrmianTrap(next, seat, card, fromOtus ? 'otus' : 'normal');
  if (trapNext !== next) {
    return {
      ok: true,
      state: {
        ...trapNext,
        log: pushLog(trapNext.log, 'summon', `${seatName(seat)} 召唤「${def.nameZh}」，等待心灵囚笼结算`),
      },
      events: [
        {
          type: 'summon',
          seat,
          summonerSeat: seat,
          cardUid: card.u,
          cardId: card.i,
          origin: fromOtus ? 'otus' : 'normal',
          actionSeq: state.actionSeq + 1,
        },
      ],
    };
  }
  // 召唤效果、被动、熔岩核事件与日志统一由公共结算入口处理。
  {
    next = patchPlayer(next, seat, (player) => {
      const marks = { ...(player.cardMarks ?? {}) };
      const mark = { ...(marks[card.u] ?? {}) };
      delete mark.summonEffectPending;
      delete mark.summonOrigin;
      if (Object.keys(mark).length === 0) delete marks[card.u];
      else marks[card.u] = mark;
      return { cardMarks: marks };
    });
  }
  next = settleSummonedCard(next, seat, playedCard, fromOtus ? 'otus' : 'normal');
  if (summonChoice) {
    next = openSummonChoice(next, seat, card, summonChoice);
  }
  // 「扬被遗忘的花瓶」等永久被动：每次召唤后获得 N 个任意能量（旧引擎 applyPermanentOnSummon，排除本次召唤的牌）。
  const meAfter = next.players[seat];
  if (meAfter) {
    let bonus = 0;
    let source = '';
    for (const item of meAfter.played) {
      if (item.u === playedCard.u) continue;
      const itemDef = cardById(item.i);
      if (!itemDef) continue;
      const amount = abilityAmount(itemDef, 'on_summon_energy');
      if (amount > 0) {
        bonus += amount;
        source = itemDef.nameZh;
      }
    }
    if (bonus > 0) {
      next = queueChoice(next, {
        kind: 'element_alloc',
        key: 'on_summon_energy',
        choosingSeat: seat,
        options: {
          title: `「${source}」被动：选择获得 ${bonus} 个能量`,
          amount: bonus,
          target: 'reserve',
          label: '获得',
        },
      });
    }
  }

  return {
    ok: true,
    state: next,
    events: [
      {
        type: 'summon',
        seat,
        summonerSeat: seat,
        cardUid: card.u,
        cardId: card.i,
        origin: fromOtus ? 'otus' : 'normal',
        actionSeq: state.actionSeq + 1,
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* 弹窗选择                                                            */
/* ------------------------------------------------------------------ */

function addStoredEnergy(
  card: CardInstance,
  alloc: Record<Element, number>,
): CardInstance {
  const stored: Partial<Record<Element, number>> = { ...(card.stored ?? {}) };
  for (const element of ELEMENTS) {
    const add = alloc[element];
    if (add > 0) stored[element] = (stored[element] ?? 0) + add;
  }
  return { ...card, stored };
}

function resolveElementAlloc(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const amount =
    typeof pending.options.amount === 'number' ? pending.options.amount : 0;
  const target = pending.options.target === 'card' ? 'card' : 'reserve';
  const maxPerElement = pending.options.maxPerElement as
    | Partial<Record<Element, number>>
    | undefined;
  let alloc: Record<Element, number>;
  if (pending.options.allowPartial === true) {
    if (!choice || typeof choice !== 'object') {
      return fail('invalid_choice', '能量分配不合法');
    }
    alloc = { water: 0, air: 0, fire: 0, earth: 0 };
    let total = 0;
    for (const element of ELEMENTS) {
      const raw = (choice as Record<string, unknown>)[element];
      if (raw === undefined) continue;
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
        return fail('invalid_choice', '能量分配不合法');
      }
      const cap = maxPerElement?.[element] ?? amount;
      if (raw > cap) return fail('choice_over_limit', '超出可复制数量');
      alloc[element] = raw;
      total += raw;
    }
    if (total > amount) return fail('choice_over_limit', '超出可复制数量');
  } else {
    const allocation = pending.options.mode === 'pay' && choice && typeof choice === 'object'
      ? Object.fromEntries(Object.entries(choice).filter(([key]) => key !== 'paidSources')) : choice;
    const parsed = parseElementAlloc(allocation, amount, maxPerElement);
    if (typeof parsed === 'string') {
      return fail(parsed, '能量分配不合法');
    }
    alloc = parsed;
  }

  // 费用减免（幸运之手）：把选择结果折算成新费用后重跑召唤。
  if (pending.options.then === 'summon_cost' && pending.key === 'cost_reduce') {
    const base = pending.options.cost as Partial<Record<Element, number>> | undefined;
    const cardUid =
      typeof pending.options.cardUid === 'number' ? pending.options.cardUid : 0;
    if (!base || cardUid <= 0) return fail('invalid_choice', '缺少费用减免信息');
    const reduced: Partial<Record<Element, number>> = {};
    for (const element of ELEMENTS) {
      reduced[element] = Math.max(0, (base[element] ?? 0) - alloc[element]);
    }
    const paid = Array.isArray(pending.options.paidElements)
      ? (pending.options.paidElements as Element[])
      : undefined;
    const paidSources = Array.isArray(pending.options.paidSources)
      ? (pending.options.paidSources as SeasonsElementSource[])
      : undefined;
    return summon(
      { ...state, pendingChoice: null },
      seat,
      cardUid,
      paid,
      paidSources,
      reduced,
      pending.options.fromOtus === true,
    );
  }

  const payMode = pending.options.mode === 'pay';
  let paidPlayer: SeasonsPlayerState | undefined;
  if (payMode) {
    const me = state.players[seat];
    if (!me) return fail('bad_seat', '座位不存在');
    let paid = me;
    const sources = choice && typeof choice === 'object' && Array.isArray((choice as { paidSources?: unknown }).paidSources)
      ? (choice as { paidSources: SeasonsElementSource[] }).paidSources : undefined;
    if (sources) {
      if (pending.options.reserveOnly === true && sources.some((source) => source.source !== 'reserve')) {
        return fail('invalid_source', '此效果只能支付储备槽中的元素');
      }
      const payment = payElementSources(me, { ...alloc, crystal: 0 }, sources, undefined, false);
      if (!payment.ok) return fail(payment.code, payment.message);
      paid = payment.player;
    } else for (const element of ELEMENTS) {
      const count = alloc[element];
      if (count <= 0) continue;
      const after = takeElementEnergy(paid, element, count);
      if (!after) {
        return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足`);
      }
      paid = after;
    }
    paidPlayer = paid;
  }

  // 无后续链路的储备能量获取：装不下时同样交给玩家分配（与骰面奖励一致）。
  const gainTotal = ELEMENTS.reduce((sum, element) => sum + alloc[element], 0);
  const swapThen = pending.options.then;
  const swapAfter =
    swapThen === 'discard_pending'
      ? ({ kind: swapThen } as const)
      : undefined;
  if (
    !payMode &&
    target === 'reserve' &&
    (swapThen === undefined || swapAfter !== undefined) &&
    gainTotal > 0
  ) {
    const me = state.players[seat];
    if (!me) return fail('bad_seat', '座位不存在');
    const room = Math.max(0, me.maxEnergy - energySum(me.energies));
    if (gainTotal > room) {
      let queued: SeasonsState = {
        ...state,
        pendingChoice: null,
        log: pushLog(
          state.log,
          'choice',
          `${seatName(seat)} 选择：获得 ${gainTotal} 个能量（储备区将超上限，待分配）`,
        ),
      };
      if (typeof pending.options.actId === 'string') {
        queued = markActivated(queued, seat, pending.options.actId);
      }
      queued = queueChoice(queued, {
        kind: 'energy_swap',
        key: 'energy_swap',
        choosingSeat: seat,
        options: {
          title: `储备区将超上限 — 获得 ${gainTotal} 个能量，从 ${
            energySum(me.energies) + gainTotal
          } 个中保留 ${me.maxEnergy} 个`,
          amount: gainTotal,
          total: me.maxEnergy,
          pool: energySum(me.energies) + gainTotal,
          current: { ...me.energies },
          incoming: alloc,
          cards: [...(state.pendingCards ?? [])],
          ...(swapAfter ? { after: swapAfter } : {}),
        },
      });
      return { ok: true, state: queued, events: [] };
    }
  }

  const players =
    target === 'card'
      ? state.players.map((player) =>
          player.seat === seat
            ? {
                ...player,
                played: player.played.map((item) =>
                  item.u === pending.options.cardUid
                    ? addStoredEnergy(item, alloc)
                    : item,
                ),
              }
            : player,
        )
      : state.players.map((player) =>
          player.seat === seat
            ? payMode && paidPlayer
              ? paidPlayer
              : {
                  ...player,
                  energies: addEnergyCapped(player.energies, alloc, player.maxEnergy),
                }
            : player,
        );

  const detail =
    ELEMENTS.filter((element) => alloc[element] > 0)
      .map((element) => `${ELEMENT_NAME_ZH[element]}×${alloc[element]}`)
      .join('、') || '无';

  let nextState: SeasonsState = {
    ...state,
    players,
    pendingChoice: null,
    log: pushLog(state.log, 'choice', `${seatName(seat)} 选择：${detail}`),
  };
  if (typeof pending.options.actId === 'string') {
    nextState = markActivated(nextState, seat, pending.options.actId);
  }
  if (pending.options.then === 'dream_summon') {
    const cards = [...nextState.players[seat]!.hand];
    return { ok: true, state: { ...nextState, pendingCards: cards,
      pendingChoice: { kind: 'card_pick', key: 'potion_dreams', choosingSeat: seat,
        options: { title: '选择要免费召唤的手牌', label: '召唤', actId: pending.options.actId } },
    }, events: [] };
  }
  if (pending.options.then === 'pay_energy_reward') {
    const reward = pending.options.reward as
      | {
          crystals?: number;
          energy?: number;
          draw?: number;
          opponentCrystals?: number;
        }
      | undefined;
    let paidState: SeasonsState = nextState;
    const me = paidState.players[seat];
    if (!me) return fail('bad_seat', '座位不存在');
    if (reward?.crystals) {
      paidState = patchPlayer(paidState, seat, (player) => ({
        crystals: crystalsAfterGain(player, reward.crystals ?? 0),
      }));
    }
    if (reward?.opponentCrystals) {
      const amount = reward.opponentCrystals;
      paidState = {
        ...paidState,
        players: paidState.players.map((player) =>
          player.seat === seat
            ? player
            : { ...player, crystals: player.crystals - Math.min(amount, player.crystals) },
        ),
      };
    }
    if (reward?.draw) {
      paidState = drawToHand(paidState, seat, reward.draw);
    }
    if (reward?.energy) {
      paidState = queueChoice(paidState, {
        kind: 'element_alloc',
        key: 'pay_energy_reward_energy',
        choosingSeat: seat,
        options: {
          title: `选择获得 ${reward.energy} 个能量`,
          amount: reward.energy,
          target: 'reserve',
          label: '获得',
        },
        ...(state.pendingCards ? { cards: state.pendingCards } : {}),
      });
    }
    paidState = {
      ...paidState,
      log: pushLog(paidState.log, 'effect', `${seatName(seat)} 支付能量并结算激活奖励`),
    };
    return { ok: true, state: paidState, events: [] };
  }
  if (pending.options.then === 'finish_end_turn') {
    return finishEndTurn(nextState, seat);
  }
  if (pending.options.then === 'discard_pending') {
    const dropped = pending.cards ?? state.pendingCards ?? [];
    const continued = promoteQueued({
      ...nextState,
      pendingChoice: null,
      pendingCards: null,
      discard: [...nextState.discard, ...dropped],
      log: pushLog(
        nextState.log,
        'effect',
        `弃掉 ${dropped.length} 张牌`,
      ),
    });
    return {
      ok: true,
      state: continued,
      events: [],
    };
  }
  if (pending.options.then === 'free_summon') {
    const card = pending.options.card as CardRef | undefined;
    if (!card) return fail('invalid_choice', '缺少牌堆顶信息');
    const result = freeSummonCard(nextState, seat, card);
    if (!result.ok) return result;
    return { ok: true, state: result.state, events: result.events };
  }
  return { ok: true, state: nextState, events: [] };
}

function resolveCardList(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const cards = state.pendingCards;
  if (!cards) return fail('no_pending_choice', '当前没有待选择的卡牌');
  if (pending.options.orderOnly === true) {
    const order = parseCardList(choice, cards.map((card) => card.u), cards.length);
    if (typeof order === 'string') return fail(order, '请为所有候选牌排序');
    const ordered = order.map((uid) => cards.find((card) => card.u === uid)!);
    const ids = new Set(ordered.map((card) => card.u));
    return { ok: true, state: {
      ...markActivated(state, seat, String(pending.options.actId)),
      deck: [...state.deck.filter((card) => !ids.has(card.u)), ...ordered.reverse()],
      pendingChoice: null, pendingCards: null,
    }, events: [] };
  }
  if (pending.key === 'die_draw' && Array.isArray(choice) && choice.length === 0) {
    return { ok: true, state: { ...state, discard: [...state.discard, ...cards],
      pendingChoice: null, pendingCards: null }, events: [] };
  }
  const keep = typeof pending.options.keep === 'number' ? pending.options.keep : 1;
  const kept = parseCardList(
    choice,
    cards.map((card) => card.u),
    keep,
  );
  if (typeof kept === 'string') return fail(kept, '卡牌选择不合法');

  const keptSet = new Set(kept);
  const gained = cards.filter((card) => keptSet.has(card.u));
  const dropped = cards.filter((card) => !keptSet.has(card.u));
  const distribute = pending.options.distribute === true || pending.options.distribute === 'choose';
  const opponents = state.players.filter((player) => player.seat !== seat);
  if (distribute && dropped.length > 0 && opponents.length > 0) {
    // 娜莉亚：由召唤者逐张指定每张牌交给哪位对手（每位对手各 1 张）。
    const targets = opponents.map((player) => player.seat);
    let queued: SeasonsState = {
      ...state,
      players: state.players.map((player) =>
        player.seat === seat ? { ...player, hand: [...player.hand, ...gained] } : player,
      ),
      pendingCards: dropped,
      pendingChoice: null,
      log: pushLog(
        state.log,
        'choice',
        `${seatName(seat)} 保留 1 张，开始分配其余 ${dropped.length} 张`,
      ),
    };
    const first = targets[0];
    if (first !== undefined) {
      queued = queueChoice(queued, {
        kind: 'card_pick',
        key: 'naria_distribute',
        choosingSeat: seat,
        options: {
          purpose: 'distribute',
          targets,
          title: `选择交给 ${seatName(first)} 的牌`,
        },
        cards: dropped,
      });
    }
    return { ok: true, state: queued, events: [] };
  }
  const players = state.players.map((player) =>
    player.seat === seat ? { ...player, hand: [...player.hand, ...gained] } : player,
  );
  const after: { kind?: string } | undefined =
    pending.options.after && typeof pending.options.after === 'object'
      ? (pending.options.after as { kind?: string })
      : undefined;
  const discardAfter = after?.kind === 'discard_pending';
  const next = promoteQueued({
    ...state,
    players,
    discard:
      distribute || discardAfter
        ? state.discard
        : [...state.discard, ...dropped],
    pendingChoice: null,
    pendingCards: null,
    log: pushLog(
      state.log,
      'choice',
      `${seatName(seat)} 保留 ${gained.length} 张，弃置 ${dropped.length} 张`,
    ),
  });
  return {
    ok: true,
    state: next,
    events: [],
  };
}

function resolveSacrificeCards(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const raw = Array.isArray(choice) ? choice[0] : choice;
  const value =
    typeof raw === 'object' && raw !== null && 'uid' in raw
      ? (raw as { uid?: unknown }).uid
      : raw;
  const uid = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(uid)) return fail('invalid_choice', '请选择一张在场卡');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const fromHandOnly = pending.options.source === 'hand_or_play';
  const inPlay = me.played.find((item) => item.u === uid);
  const inHand = fromHandOnly ? me.hand.find((item) => item.u === uid) : undefined;
  const card = inPlay ?? inHand;
  if (!card) {
    return fail(
      'invalid_choice',
      fromHandOnly ? '这张牌不在手牌或场上' : '这张牌不在场上',
    );
  }

  if (pending.options.cageResolution === true) {
    const summonerSeat = Number(pending.options.summonerSeat);
    const summonedUid = Number(pending.options.summonedUid);
    const summoner = state.players[summonerSeat];
    if (
      seat !== summonerSeat ||
      !summoner ||
      uid === summonedUid ||
      !summoner.played.some((item) => item.u === summonedUid)
    ) {
      return fail('invalid_choice', '心灵囚笼：必须牺牲刚召唤牌之外的场牌');
    }
    let next = patchPlayer(
      {
        ...state,
        pendingChoice: null,
        pendingCards: null,
        discard: [...state.discard, printedCard(me, card)],
      },
      summonerSeat,
      (player) => ({
        ...cardSacrificed(
          { ...player, played: player.played.filter((item) => item.u !== uid) },
          card,
        ),
      }),
    );
    next = clearCardMark(next, Number(pending.options.cageSeat), Number(pending.options.cageUid), [
      'trapArmed',
      'trapPending',
    ]);
    next = {
      ...next,
      log: pushLog(
        next.log,
        'effect',
        `心灵囚笼：${seatName(summonerSeat)} 牺牲「${
          cardById(card.i)?.nameZh ?? card.i
        }」`,
      ),
    };
    next = settlePendingSummon(next, summonerSeat, summonedUid);
    return { ok: true, state: promoteQueued(next), events: [] };
  }

  const chosen = Array.isArray(pending.options.chosen)
    ? (pending.options.chosen as number[])
    : [];
  const remaining =
    typeof pending.options.remaining === 'number'
      ? pending.options.remaining - 1
      : 0;
  const def = cardById(card.i);
  const name = def?.nameZh ?? `#${card.i}`;
  const isNecrotic = pending.options.then === 'necrotic_energy';
  if (isNecrotic && printedCardType(me, card) !== 'familiar') {
    return fail('invalid_choice', '死灵匕首只能弃置或牺牲随从');
  }
  const logLine = isNecrotic
    ? inHand
      ? `死灵匕首：弃掉手牌「${name}」`
      : `死灵匕首：牺牲「${name}」`
    : `龙之头骨：牺牲「${name}」`;
  let next: SeasonsState = {
    ...state,
    players: state.players.map((player) => {
      if (player.seat !== seat) return player;
      if (inHand) {
        // 手牌随从只是弃掉：不从场上移除，也不触发离场上限恢复。
        return { ...player, hand: player.hand.filter((item) => item.u !== uid) };
      }
      return cardSacrificed(
        { ...player, played: player.played.filter((item) => item.u !== uid) },
        card,
      );
    }),
    discard: [...state.discard, printedCard(me, card)],
    log: pushLog(state.log, 'effect', logLine),
  };
  if (def?.effect?.typeKey === 'shield_of_zira') {
    next = patchPlayer(next, seat, (player) => ({
      crystals: player.crystals + 10,
    }));
    next = {
      ...next,
      log: pushLog(next.log, 'effect', '席拉之盾：代替牺牲，水晶 +10'),
    };
  }

  if (remaining > 0) {
    next = {
      ...next,
      pendingChoice: {
        ...pending,
        options: { ...pending.options, remaining, chosen: [...chosen, uid] },
      },
    };
    return { ok: true, state: next, events: [] };
  }

  const actId =
    typeof pending.options.actId === 'string'
      ? pending.options.actId
      : String(pending.options.cardUid ?? uid);
  if (isNecrotic) {
    // 续接：获得 4 个任意能量（元素分配选择，完成时再标记已激活）。
    next = {
      ...next,
      pendingChoice: {
        kind: 'element_alloc',
        key: 'necrotic_kriss',
        choosingSeat: seat,
        options: {
          amount: 4,
          title: '选择获得 4 个能量',
          label: '获得',
          target: 'reserve',
          actId,
        },
      },
    };
    return { ok: true, state: next, events: [] };
  }
  next = patchPlayer(next, seat, (player) => ({
    crystals: player.crystals + 15,
  }));
  next = markActivated(next, seat, actId);
  next = {
    ...next,
    pendingChoice: null,
    log: pushLog(next.log, 'effect', '龙之头骨：水晶 +15'),
  };
  return { ok: true, state: next, events: [] };
}

function freeSummonCard(
  state: SeasonsState,
  seat: number,
  ref: CardRef,
): ReduceResult<SeasonsState> {
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  if (!(me.gauge > me.played.length)) {
    return fail('gauge_low', '召唤等级不足，无法免费召唤');
  }
  const def = cardById(ref.i);
  if (!def) return fail('invalid_choice', '未知卡牌');
  if (abilitiesOf(def, 'no_free_summon').length > 0) return fail('no_free_summon', '这张牌不能免费召唤');
  const summonChoice = summonChoiceFor(def, [], state, seat);
  if (summonChoice === 'unimplemented') {
    return fail('effect_not_implemented', `「${def.nameZh}」的免费召唤效果尚未实现`);
  }
  let next: SeasonsState = {
    ...state,
    players: state.players.map((player) =>
      player.seat === seat
        ? { ...player, played: [...player.played, { i: ref.i, u: ref.u }],
            maxEnergy: player.maxEnergy + enteringCapacityBonus(player, def),
            cardMarks: { ...player.cardMarks, [ref.u]: { summonEffectPending: true, summonOrigin: 'freeEffect' } } }
        : player,
    ),
  };
  const trapped = queueUrmianTrap(next, seat, ref, 'freeEffect');
  if (trapped !== next) return { ok: true, state: trapped, events: [] };
  next = clearCardMark(next, seat, ref.u, ['summonEffectPending', 'summonOrigin']);
  next = settleSummonedCard(next, seat, ref, 'freeEffect');
  if (summonChoice) {
    next = openSummonChoice(next, seat, ref, summonChoice);
  }
  return {
    ok: true,
    state: next,
    events: [
      {
        type: 'summon',
        seat,
        summonerSeat: seat,
        cardUid: ref.u,
        cardId: ref.i,
        origin: 'freeEffect',
          actionSeq: state.actionSeq + 1,
      },
    ],
  };
}

function resolveMonthAdvance(
  state: SeasonsState,
  _seat: number,
  _pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  if (!choice || typeof choice !== 'object') {
    return fail('invalid_choice', '需要选择方向与步数');
  }
  const direction = (choice as { direction?: unknown }).direction;
  const steps = (choice as { steps?: unknown }).steps;
  if (direction !== 'forward' && direction !== 'backward') {
    return fail('invalid_choice', '方向不合法');
  }
  if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 1 || steps > 3) {
    return fail('invalid_choice', '步数需为 1–3');
  }
  const delta = direction === 'backward' ? -steps : steps;
  const next = advanceMonth(
    { ...state, pendingChoice: null, pendingCards: null },
    delta,
    false,
  );
  return { ok: true, state: next, events: [] };
}

function resolveMultiPlayerPick(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const queue = Array.isArray(pending.options.players)
    ? (pending.options.players as number[])
    : [];
  if (queue.length === 0) return fail('invalid_choice', '没有待选择的玩家');
  const current = queue[0];
  if (current !== seat) return fail('not_your_choice', '还没轮到你选择');
  const raw =
    typeof choice === 'number'
      ? choice
      : choice && typeof choice === 'object' && 'uid' in choice
        ? (choice as { uid?: unknown }).uid
        : Array.isArray(choice)
          ? choice[0]
          : undefined;
  const uid = typeof raw === 'number' ? raw : NaN;
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const card = me.played.find((item) => item.u === uid);
  if (!card) return fail('invalid_choice', '无效的卡牌');
  const purpose = pending.options.purpose;
  const def = cardById(card.i);
  let player: SeasonsPlayerState;
  let detail: string;
  if (purpose === 'return') {
    if (printedCardType(me, card) !== 'magic_item') {
      return fail('invalid_choice', '只能收回魔法物品');
    }
    player = cardLeavingPlay(
      {
        ...me,
        played: me.played.filter((item) => item.u !== uid),
        hand: [...me.hand, printedCard(me, card)],
      },
      card,
    );
    detail = `${seatName(seat)} 收回「${def?.nameZh ?? card.i}」`;
  } else if (purpose === 'sacrifice') {
    player = cardSacrificed(
      { ...me, played: me.played.filter((item) => item.u !== uid) },
      card,
    );
    detail = `${seatName(seat)} 牺牲「${def?.nameZh ?? card.i}」`;
  } else {
    return fail('invalid_choice', '选择类型不合法');
  }

  let next: SeasonsState = {
    ...state,
    players: state.players.map((item) => (item.seat === seat ? player : item)),
    discard:
      purpose === 'sacrifice' ? [...state.discard, printedCard(me, card)] : state.discard,
    log: pushLog(state.log, 'effect', detail),
  };

  const rest = queue.slice(1);
  if (rest.length > 0) {
    next = {
      ...next,
      pendingChoice: {
        ...pending,
        choosingSeat: rest[0]!,
        options: { ...pending.options, players: rest },
      },
    };
    return { ok: true, state: next, events: [] };
  }
  next = { ...next, pendingChoice: null };
  if (typeof pending.options.actId === 'string') {
    next = markActivated(next, seat, pending.options.actId);
  }
  return { ok: true, state: next, events: [] };
}

/** 元素护符（风）：从自己手牌里弃 1 张。 */
function resolveHandDiscard(
  state: SeasonsState,
  seat: number,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const raw =
    typeof choice === 'number'
      ? choice
      : choice && typeof choice === 'object' && 'uid' in choice
        ? (choice as { uid?: unknown }).uid
        : Array.isArray(choice)
          ? choice[0]
          : undefined;
  const uid = typeof raw === 'number' ? raw : NaN;
  const picked = me.hand.find((card) => card.u === uid);
  if (!picked) return fail('invalid_choice', '无效的卡牌');
  return {
    ok: true,
    state: {
      ...state,
      players: state.players.map((player) =>
        player.seat === seat
          ? { ...player, hand: player.hand.filter((card) => card.u !== uid) }
          : player,
      ),
      pendingChoice: null,
      pendingCards: null,
      discard: [...state.discard, picked],
      log: pushLog(state.log, 'effect', `${seatName(seat)} 弃掉 1 张手牌（元素护符·风）`),
    },
    events: [],
  };
}

function reconcileRavens(state: SeasonsState): SeasonsState {
  let next = state;
  for (let pass = 0; pass < state.players.flatMap((player) => player.played).length; pass++) {
    const live = new Set(next.players.flatMap((player) => player.played.map((card) => card.u)));
    let changed = false;
    for (const player of next.players) {
      for (const card of player.played) {
        const mark = player.cardMarks?.[card.u];
        if (!mark?.ravenTarget || live.has(mark.ravenTarget)) continue;
        changed = true;
        next = patchPlayer(
          { ...next, discard: [...next.discard, { i: 68, u: card.u }] },
          player.seat,
          (owner) => cardLeavingPlay({
            ...owner, played: owner.played.filter((item) => item.u !== card.u),
          }, card),
        );
      }
    }
    if (!changed) break;
  }
  return next;
}

/** Explicit extension continuations. No unknown choice can fall into free summon. */
function resolveExtensionChoice(
  state: SeasonsState,
  seat: number,
  pending: SeasonsPendingChoiceState,
  choice: unknown,
): ReduceResult<SeasonsState> | null {
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const options = pending.options;
  const record = choice && typeof choice === 'object' && !Array.isArray(choice)
    ? choice as Record<string, unknown> : {};
  const id = typeof choice === 'string' ? choice : String(record.id ?? '');
  const uid = Number(record.uid ?? (Array.isArray(choice) ? choice[0] : choice));
  const sourceUid = Number(options.cardUid);
  const clear = (): SeasonsState => ({ ...state, pendingChoice: null, pendingCards: null });
  const done = (next: SeasonsState): ReduceResult<SeasonsState> =>
    ({ ok: true, state: next, events: [] });
  const activated = (next: SeasonsState) =>
    typeof options.actId === 'string' && !me.activatedThisTurn.includes(options.actId)
      ? markActivated(next, seat, options.actId) : next;
  const gain = (next: SeasonsState, amount: number) => queueChoice(next, {
    kind: 'element_alloc', key: 'extension_energy', choosingSeat: seat,
    options: { amount, title: `选择获得 ${amount} 个能量`, target: 'reserve', label: '获得' },
  });
  const discardCard = (next: SeasonsState, card: CardRef, fromPlay: boolean): SeasonsState => {
    const owner = next.players[seat]!;
    const updated = fromPlay
      ? cardSacrificed({ ...owner, played: owner.played.filter((item) => item.u !== card.u) }, card)
      : { ...owner, hand: owner.hand.filter((item) => item.u !== card.u) };
    return { ...next, players: next.players.map((p) => p.seat === seat ? updated : p),
      discard: [...next.discard, { i: owner.cardMarks?.[card.u]?.ravenOriginalId ?? card.i, u: card.u }] };
  };

  if (pending.key === 'draft_twist') {
    const selected = (state.pendingCards ?? []).find((card) => card.u === uid);
    if (!selected) return fail('invalid_choice', '请选择替换天命不凡的牌');
    return done(patchPlayer(clear(), seat, (player) => ({
      drafted: [...player.drafted, selected],
    })));
  }
  if (pending.key === 'steadfast_die') {
    if (id === 'normal') return done(resolveDieRewards(clear(), seat, true));
    if (!['gauge', 'energy', 'transmute'].includes(id)) return fail('invalid_choice', '无效的骰子替代行动');
    let next = clear();
    if (id === 'energy') next = gain(next, 1);
    else next = patchPlayer(next, seat, (player) => id === 'gauge'
      ? { gauge: player.gauge + 1 } : { canTransmute: true });
    return done(next);
  }
  if (pending.key === 'selenias_codex') {
    if (choice === 'skip' || choice === null) return done(clear());
    const card = me.played.find((item) => item.u === uid);
    const def = card && cardById(card.i);
    if (!card || !def || printedCardType(me, card) !== 'magic_item' || card.u === sourceUid ||
      (!def.costFlexible && !ELEMENTS.some((element) => def.cost[element] > 0))) {
      return fail('invalid_choice', '只能取回有能量费用的其他魔器');
    }
    return done(patchPlayer(clear(), seat, (player) => cardLeavingPlay({
      ...player, played: player.played.filter((item) => item.u !== uid),
      hand: [...player.hand, { i: player.cardMarks?.[uid]?.ravenOriginalId ?? card.i, u: card.u }],
    }, card)));
  }
  if (pending.key === 'throne_of_renewal') {
    const card = me.hand.find((item) => item.u === uid);
    if (!card) return fail('invalid_choice', '请选择手牌');
    let next = discardCard(clear(), card, false);
    next = drawToHand(next, seat, 1);
    return done(patchPlayer(next, seat, (player) => ({ badgesUsed: Math.max(0, player.badgesUsed - 1) })));
  }
  if (pending.key === 'arcane_telescope') {
    // Handled by the ordered-card resolver.
    return null;
  }
  if (pending.key === 'potion_of_resurrection' || pending.key === 'sepulchral_amulet') {
    const pool = state.pendingCards ?? [];
    const card = pool.find((item) => item.u === uid);
    if (!card) return fail('invalid_choice', '请选择候选牌');
    const rest = pool.filter((item) => item.u !== uid);
    const poolIds = new Set(pool.map((item) => item.u));
    let next = { ...clear(), discard: state.discard.filter((item) => !poolIds.has(item.u)) };
    if (pending.key === 'potion_of_resurrection') {
      next = { ...next, discard: [...rest.reverse(), ...next.discard] };
      return done(activated(patchPlayer(next, seat, (player) => ({ hand: [...player.hand, card] }))));
    }
    if (options.stage === 'top') {
      next = { ...next, deck: [...rest, ...next.deck, card] };
      return done(next);
    }
    next = patchPlayer(next, seat, (player) => ({ hand: [...player.hand, card] }));
    if (rest.length) next = {
      ...next, pendingChoice: { ...pending, cards: rest,
        options: { ...options, stage: 'top', title: '选择放到摸牌堆顶的牌' } }, pendingCards: rest,
    };
    return done(next);
  }
  if (pending.key === 'amulet_of_time' && pending.kind === 'element_alloc') {
    const result = resolveElementAlloc(state, seat, pending, choice);
    if (!result.ok) return result;
    const cards = result.state.players[seat]!.hand;
    return done(queueChoice(result.state, { kind: 'card_list', key: 'time_discard',
      choosingSeat: seat, cards, options: { title: '选择弃掉并重抽的手牌', keep: cards.length,
        variable: true, label: '换牌' } }));
  }
  if (pending.key === 'time_discard') {
    if (!Array.isArray(choice) || choice.some((u) => typeof u !== 'number') ||
      new Set(choice).size !== choice.length || choice.some((u) => !me.hand.some((c) => c.u === u))) {
      return fail('invalid_choice', '请选择不重复的手牌');
    }
    const selected = me.hand.filter((card) => choice.includes(card.u));
    let next = clear();
    for (const card of selected) next = discardCard(next, card, false);
    return done(drawToHand(next, seat, selected.length));
  }
  if (['scroll_of_ishtar', 'familiar_catcher', 'scroll_of_ishtar_result', 'familiar_catcher_result'].includes(pending.key)) {
    const key = pending.key.replace('_result', '');
    const element = (options.element ?? id) as Element;
    const resultStep = pending.key.endsWith('_result');
    if (key === 'scroll_of_ishtar' && !ELEMENTS.includes(element)) return fail('invalid_choice', '请选择元素');
    if (resultStep && id !== 'keep' && id !== 'discard') return fail('invalid_choice', '请选择保留或继续寻找');
    let next = clear();
    const current = state.pendingCards?.[0];
    if (resultStep && current) {
      if (id === 'keep') return done(patchPlayer(next, seat, (player) => ({ hand: [...player.hand, current] })));
      next = { ...next, discard: [...next.discard, current] };
    }
    const revealed: CardRef[] = [];
    const limit = next.deck.length + next.discard.length;
    let found: CardRef | null = null;
    for (let index = 0; index < limit; index++) {
      const [drawnState, card] = drawOne(next);
      next = drawnState;
      if (!card) break;
      const def = cardById(card.i);
      if (def && (key === 'familiar_catcher' ? def.type === 'familiar'
        : def.type === 'magic_item' && (def.cost[element] > 0 || Boolean(def.costFlexible)))) {
        found = card; break;
      }
      revealed.push(card);
    }
    next = { ...next, discard: [...next.discard, ...revealed] };
    if (!found) return done(next);
    if (resultStep) return done(patchPlayer(next, seat, (player) => ({ hand: [...player.hand, found!] })));
    return done({ ...next, pendingCards: [found], pendingChoice: {
      kind: 'branch', key: `${key}_result`, choosingSeat: seat, cards: [found],
      options: { title: '保留这张牌，或弃掉并再寻找一次', element,
        branches: [{ id: 'keep', label: '保留' }, { id: 'discard', label: '弃掉并继续寻找' }] },
    } });
  }
  if (pending.key === 'warden_of_argos') {
    if (!['energy', 'cards'].includes(id)) return fail('invalid_choice', '请选择狱犬效果');
    let next = clear();
    for (const player of state.players) {
      const amount = id === 'energy' ? Math.min(4, energySum(player.energies)) : Math.min(1, player.hand.length);
      if (!amount) continue;
      next = queueChoice(next, { kind: id === 'energy' ? 'energy_discard' : 'card_pick',
        key: 'warden_discard', choosingSeat: player.seat,
        ...(id === 'cards' ? { cards: player.hand } : {}),
        options: { title: id === 'energy' ? `冥界狱犬：弃掉 ${amount} 个储备能量` : '冥界狱犬：弃掉一张手牌',
          amount, available: player.energies, label: '弃掉' },
      });
    }
    return done(next);
  }
  if (pending.key === 'warden_discard' && pending.kind === 'card_pick') {
    const card = me.hand.find((item) => item.u === uid);
    return card ? done(discardCard(clear(), card, false)) : fail('invalid_choice', '请选择手牌');
  }
  if (pending.key === 'ratty_nightshade' || pending.key === 'ratty_steal') {
    if (pending.key === 'ratty_nightshade') return fail('invalid_choice', '缺少偷取来源');
    const targetSeat = Number(options.targetSeat);
    const target = state.players[targetSeat];
    if (!target || targetSeat === seat) return fail('invalid_choice', '无效的来源玩家');
    const total = ELEMENTS.reduce((sum, element) => sum + Number(record[element] ?? 0), 0);
    if (!Number.isInteger(total) || total < 0 || total > Number(options.amount)) {
      return fail('invalid_choice', '至多拿取两个储备能量');
    }
    const alloc = parseElementAlloc(choice, total, target.energies);
    if (typeof alloc === 'string') return fail(alloc, '请选择来源储备中的能量');
    let next = patchPlayer(clear(), targetSeat, () => ({
      energies: Object.fromEntries(ELEMENTS.map((e) => [e, target.energies[e] - alloc[e]])) as Record<Element, number>,
    }));
    return done(addReserveEnergy(next, seat, alloc, '贼头鼠'));
  }
  if (pending.key === 'fairy_monolith_store' || pending.key === 'chalice_of_eternity_store' ||
      pending.key === 'horn_of_plenty') {
    if ((choice === null || id === 'skip') && options.optional === true) return done(clear());
    const element = (typeof choice === 'string' ? choice : record.element) as Element;
    if (!ELEMENTS.includes(element) || me.energies[element] < 1) return fail('energy_low', '请选择储备中的能量');
    if (Array.isArray(record.paidSources)) {
      const sources = record.paidSources as SeasonsElementSource[];
      if (sources.length !== 1 || sources[0]?.source !== 'reserve' || sources[0]?.element !== element) {
        return fail('invalid_source', '只能选择实际储备区中的一个元素');
      }
      const payment = payElementSources(me, { water: 0, air: 0, earth: 0, fire: 0, crystal: 0, [element]: 1 },
        sources, undefined, false);
      if (!payment.ok) return fail(payment.code, payment.message);
    }
    let next = patchPlayer(clear(), seat, (player) => ({
      energies: { ...player.energies, [element]: player.energies[element] - 1 },
      played: player.played.map((card) => card.u === sourceUid
        ? { ...card, stored: { ...card.stored, [element]: (card.stored?.[element] ?? 0) + 1 } } : card),
    }));
    if (pending.key === 'horn_of_plenty' && (element === 'earth' || winterStaffActive(state, me))) {
      next = patchPlayer(next, seat, (player) => ({ crystals: player.crystals + 5 }));
    }
    return done(next);
  }
  if (pending.key === 'fairy_monolith') {
    const card = me.played.find((item) => item.u === sourceUid);
    const alloc = record as Partial<Record<Element, number>>;
    if (!card || !ELEMENTS.every((e) => Number.isInteger(alloc[e] ?? 0) && (alloc[e] ?? 0) >= 0 &&
      (alloc[e] ?? 0) <= (card.stored?.[e] ?? 0)) || ELEMENTS.reduce((sum, e) => sum + (alloc[e] ?? 0), 0) === 0) return fail('invalid_choice', '请选择巨石上的能量');
    const next = patchPlayer(clear(), seat, (player) => ({
      played: player.played.map((item) => item.u === sourceUid ? { ...item,
        stored: Object.fromEntries(ELEMENTS.map((e) => [e, (item.stored?.[e] ?? 0) - (alloc[e] ?? 0)])),
      } : item),
    }));
    return done(addReserveEnergy(activated(next), seat, alloc as Record<Element, number>, '仙女巨石'));
  }
  if (pending.key === 'staff_of_winter' || pending.key === 'arus_mimicry') {
    const inHand = me.hand.find((card) => card.u === uid);
    const inPlay = me.played.find((card) => card.u === uid);
    const shield = inPlay?.i === 63;
    const card = inHand ?? (pending.key === 'arus_mimicry' || shield ? inPlay : undefined);
    if (!card || (pending.key === 'staff_of_winter' && !shield && cardById(card.i)?.type !== 'magic_item')) {
      return fail('invalid_choice', '请选择合法的弃牌或牺牲来源');
    }
    let next = discardCard(clear(), card, Boolean(inPlay));
    if (shield) next = patchPlayer(next, seat, (player) => ({ crystals: player.crystals + 10 }));
    return done(pending.key === 'staff_of_winter' ? gain(activated(next), 3)
      : patchPlayer(next, seat, (player) => ({ crystals: player.crystals + 12 })));
  }
  if (pending.key === 'potion_of_the_ancients') {
    const used = Array.isArray(options.selected) ? options.selected as string[] : [];
    if (!['transmute', 'draw', 'gauge', 'energy'].includes(id) || used.includes(id)) {
      return fail('invalid_choice', '请选择尚未使用的药剂效果');
    }
    let next = activated(clear());
    if (used.length === 0) next = { ...next, pendingQueue: [{
      ...pending, options: { ...options, selected: [id],
        branches: (options.branches as { id: string; label: string }[]).filter((branch) => branch.id !== id) },
    }, ...next.pendingQueue] };
    if (id === 'energy') return done({ ...gain({ ...next, pendingQueue: [] }, 4),
      pendingQueue: [...gain({ ...next, pendingQueue: [] }, 4).pendingQueue, ...next.pendingQueue] });
    if (id === 'gauge') return done(patchPlayer(next, seat, (player) => ({ gauge: player.gauge + 2 })));
    if (id === 'transmute') return done({ ...next, pendingChoice: {
      kind: 'element_alloc', key: 'ancient_transmute', choosingSeat: seat,
      options: { title: '选择全部储备元素进行晶化', label: '晶化', mode: 'pay',
        amount: energySum(me.energies), maxPerElement: { ...me.energies }, reserveOnly: true,
        then: 'pay_energy_reward', reward: { crystals: energySum(me.energies) * 4 } },
    } });
    const drawn: CardRef[] = [];
    for (let i = 0; i < 2; i++) { const [s, card] = drawOne(next); next = s; if (card) drawn.push(card); }
    return done({ ...next, pendingCards: drawn, pendingChoice: drawn.length ? {
      kind: 'card_list', key: 'ancient_draw', choosingSeat: seat, cards: drawn,
      options: { title: '保留一张牌', keep: 1, label: '保留' },
    } : null });
  }
  if (pending.key === 'lewis') {
    const opponent = state.players.find((player) => String(player.seat) === id && player.seat !== seat);
    if (!opponent) return fail('invalid_choice', '请选择一位对手');
    const copied = Object.fromEntries(ELEMENTS.map((element) =>
      [element, reserveElementCount(opponent, element)])) as Record<Element, number>;
    return done(addReserveEnergy(clear(), seat, copied, '灰脸路易斯'));
  }
  if (pending.key === 'statue_of_eolis' || pending.key === 'chrono_ring') {
    if (!['energy', 'crystals'].includes(id)) return fail('invalid_choice', '请选择奖励');
    let next = clear();
    if (id === 'energy') return done(gain(next, 1));
    next = patchPlayer(next, seat, (player) => ({ crystals: player.crystals + (pending.key === 'chrono_ring' ? 4 : 2) }));
    const top = next.deck.at(-1);
    if (pending.key === 'statue_of_eolis' && top) next = queueChoice(next, {
      kind: 'branch', key: 'peek_close', choosingSeat: seat, cards: [top],
      options: { title: '摸牌堆顶', branches: [{ id: 'close', label: '确认' }] },
    });
    return done(next);
  }
  if (pending.key === 'peek_close') return id === 'close' ? done(clear()) : fail('invalid_choice', '请确认');
  if (pending.key === 'shield_substitute') {
    const shieldUid = id === 'sacrifice' ? -1 : Number(id.replace(/^shield:/, ''));
    if (id !== 'sacrifice' && (!id.startsWith('shield:') ||
      !me.played.some((card) => card.u === shieldUid && card.i === 63 && !lockedOut(me, card)))) {
      return fail('invalid_choice', '请选择实际的席拉之盾');
    }
    return activate(clear(), seat, sourceUid,
      typeof options.abilityKey === 'string' ? options.abilityKey : undefined, shieldUid);
  }
  if (pending.key === 'carnivora_strombosea') {
    const top = state.discard.at(-1);
    if (!top || !['deck', 'hand'].includes(id)) return fail('invalid_choice', '弃牌堆顶已变化');
    let next = { ...clear(), discard: state.discard.slice(0, -1) };
    if (id === 'deck') next = { ...next, deck: [...next.deck, top] };
    else next = patchPlayer(next, seat, (player) => ({ hand: [...player.hand, top], gauge: Math.max(0, player.gauge - 1) }));
    return done(next);
  }
  if (pending.key === 'dial_of_colof') {
    if (id === 'skip') return done(clear());
    if (id !== 'reroll') return fail('invalid_choice', '无效的重骰选择');
    let next = clear();
    const dice = next.season!.dice.map((die) => {
      if (die.pickedBy !== null) return die;
      const def = DICE_BY_ELEMENT[SEASONS[next.seasonIdx]!.element].find((item) => item.id === die.id)!;
      const index = randIntAt(next.rngSeed, next.rngCursor++, def.faces.length);
      const face = def.faces[index]!;
      return { ...die, face: face.roll, pip: face.pip, rewards: { ...face.rewards } };
    });
    return done({ ...next, season: { ...next.season!, dice } });
  }
  if (pending.key === 'raven_the_usurper' || pending.key === 'raven_payment') {
    const targetUid = pending.key === 'raven_payment' ? Number(options.targetUid) : uid;
    const targetOwner = state.players.find((player) => player.seat !== seat &&
      player.played.some((card) => card.u === targetUid));
    const target = targetOwner?.played.find((card) => card.u === targetUid);
    const def = target && cardById(target.i);
    const raven = me.played.find((card) => card.u === sourceUid);
    if (!target || !targetOwner || !def || printedCardType(targetOwner, target) !== 'magic_item' || !raven) return fail('invalid_choice', '请选择对手魔器');
    const paidSources = Array.isArray(record.paidSources) ? record.paidSources as SeasonsElementSource[] : undefined;
    const paidElements = Array.isArray(record.paidElements) ? record.paidElements as Element[] : undefined;
    const cost = resolveCost(def, state.players.length);
    if (pending.key === 'raven_the_usurper') return done({ ...clear(), pendingChoice: {
      kind: 'element_alloc', key: 'raven_payment', choosingSeat: seat, options: {
        title: `篡夺渡鸦：支付「${def.nameZh}」的费用${cost.crystal ? `及 ${cost.crystal} 水晶` : ''}`,
        label: '复制', cardUid: sourceUid, targetUid, mode: 'pay',
        amount: def.costFlexible?.min ?? energySum(cost),
        maxAmount: def.costFlexible?.max ?? energySum(cost),
        maxPerElement: def.costFlexible ? undefined : cost,
        flexible: def.costFlexible,
      },
    } });
    if (def.costFlexible) {
      const elements = paidSources?.map((source) => source.element) ?? paidElements ?? [];
      const flex = def.costFlexible;
      if (elements.length < flex.min || elements.length > flex.max ||
        ELEMENTS.some((element) => elements.filter((item) => item === element).length > (flex.maxPerType ?? 1))) {
        return fail('flex_cost_count', '请选择符合灵活费用的能量');
      }
    }
    const payment = payElementSources(me, cost, paidSources, paidElements, Boolean(def.costFlexible), winterStaffActive(state, me));
    if (!payment.ok) return fail(payment.code, payment.message);
    let next = patchPlayer(clear(), seat, () => ({
      ...payment.player, maxEnergy: payment.player.maxEnergy + enteringCapacityBonus(payment.player, def),
      played: payment.player.played.map((card) => card.u === sourceUid ? { ...card, i: target.i, paid: payment.paid } : card),
      cardMarks: { ...me.cardMarks, [sourceUid]: { ravenTarget: targetUid, ravenOriginalId: 68 } },
    }));
    const copied = next.players[seat]!.played.find((card) => card.u === sourceUid)!;
    next = runSummonEffect(next, seat, copied);
    const request = summonChoiceFor(def, payment.paid, next, seat);
    if (request && request !== 'unimplemented') next = openSummonChoice(next, seat, copied, request);
    return done(next);
  }
  return null;
}

function resolveCardPick(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const extension = resolveExtensionChoice(state, seat, pending, choice);
  if (extension) return extension;
  if (pending.key === 'dragonsoul' || pending.key === 'throne_of_renewal') {
    return resolveBranch(state, seat, pending, choice);
  }

  if (pending.key === 'urmian_psychic_cage') {
    const id = typeof choice === 'string' ? choice : '';
    const summonerSeat = Number(pending.options.summonerSeat);
    const summonedUid = Number(pending.options.summonedUid);
    const summoner = state.players[summonerSeat];
    const summoned = summoner?.played.find((card) => card.u === summonedUid);
    if (!summoner || !summoned) {
      return finishUrmianBranch(
        state,
        pending,
        '心灵囚笼：召唤牌已离开场上，陷阱失效且不再结算',
      );
    }
    if (id === 'discard_summoned') {
      const discarded: SeasonsState = {
        ...state,
        players: state.players.map((player) =>
          player.seat === summonerSeat
            ? cardLeavingPlay({
                ...player,
                played: player.played.filter((card) => card.u !== summonedUid),
              }, summoned)
            : player,
        ),
        discard: [...state.discard, { i: summoned.i, u: summoned.u }],
        pendingChoice: null,
        pendingCards: null,
        log: pushLog(
          state.log,
          'effect',
          `${seatName(summonerSeat)} 的「${cardById(summoned.i)?.nameZh ?? summoned.i}」被心灵囚笼弃掉，不结算效果`,
        ),
      };
      return finishUrmianBranch(discarded, pending, '心灵囚笼：召唤已被终止');
    }
    if (id !== 'sacrifice_other') {
      return fail('invalid_choice', '无效的心灵囚笼选择');
    }
    const legal = summoner.played.filter((card) => card.u !== summonedUid);
    if (legal.length === 0) {
      return fail('invalid_choice', '没有可牺牲的其他场牌');
    }
    return {
      ok: true,
      state: {
        ...state,
        pendingChoice: {
          ...pending,
          kind: 'sacrifice_cards',
          options: {
            ...pending.options,
            title: '心灵囚笼：选择一张其他场牌牺牲',
            label: '牺牲',
            remaining: 0,
            cageResolution: true,
            summonerSeat,
            summonedUid,
            cageSeat: Number(pending.options.cageSeat),
            cageUid: Number(pending.options.cageUid),
          },
          branches: undefined,
        },
        pendingCards: [...legal],
        log: pushLog(state.log, 'choice', `心灵囚笼：${seatName(summonerSeat)} 必须牺牲另一张场牌`),
      },
      events: [],
    };
  }

  if (pending.key === 'argosian_tangleweed') {
    if (choice === null || choice === undefined || choice === false || choice === 'skip') {
      return {
        ok: true,
        state: {
          ...state,
          pendingChoice: null,
          pendingCards: null,
          log: pushLog(state.log, 'effect', '亚苟斯的纠缠：未选择神仆，锁结未放置'),
        },
        events: [],
      };
    }
    const choiceRecord =
      choice && typeof choice === 'object' ? (choice as Record<string, unknown>) : null;
    const rawUid =
      choiceRecord && 'uid' in choiceRecord
        ? choiceRecord.uid
        : Array.isArray(choice)
          ? choice[0]
          : choice;
    const targetUid = typeof rawUid === 'number' ? rawUid : Number(rawUid);
    const targetOwnerSeat =
      choiceRecord && 'seat' in choiceRecord
        ? Number(choiceRecord.seat)
        : Number.NaN;
    const sourceUid = Number(pending.options.cardUid);
    const sourceSeat = Number(pending.options.sourceSeat ?? seat);
    const sourceCard = state.players[sourceSeat]?.played.find(
      (item) => item.u === sourceUid,
    );
    if (
      !sourceCard ||
      (cardById(sourceCard.i)?.effect?.typeKey ??
        cardById(sourceCard.i)?.effect?.type) !== 'argosian_tangleweed'
    ) {
      return fail('card_not_in_play', '亚苟斯的纠缠已不在场上');
    }
    const targetOwner = state.players[targetOwnerSeat];
    const targetCard = targetOwner?.played.find(
      (item) =>
        item.u === targetUid &&
        targetOwnerSeat !== sourceSeat &&
        printedCardType(targetOwner!, item) === 'familiar',
    );
    if (!targetOwner || !targetCard) {
      return fail('invalid_choice', '请选择一名对手场上的神仆');
    }
    if (
      (cardById(targetCard.i)?.effect?.typeKey ??
        cardById(targetCard.i)?.effect?.type) === 'argosian_tangleweed'
    ) {
      return {
        ok: true,
        state: {
          ...clearArgosianLocks(state, [targetUid]),
          pendingChoice: null,
          pendingCards: null,
          log: pushLog(
            state.log,
            'effect',
            `${seatName(seat)} 的「亚苟斯的纠缠」解除目标纠缠原先放置的锁结`,
          ),
        },
        events: [],
      };
    }
    const marks = { ...(targetOwner.cardMarks ?? {}) };
    const lockSources = [...new Set([...(marks[targetCard.u]?.lockSources ??
      (marks[targetCard.u]?.lockSource ? [marks[targetCard.u]!.lockSource!] : [])), sourceUid])];
    marks[targetCard.u] = {
      ...(marks[targetCard.u] ?? {}),
      lockSource: lockSources[0],
      lockSources,
    };
    const next: SeasonsState = {
      ...state,
      players: state.players.map((player) =>
        player.seat === targetOwnerSeat
          ? { ...player, cardMarks: marks, maxEnergy: Math.max(0, player.maxEnergy +
              reserveCapacityBonus({ ...player, cardMarks: marks }) - reserveCapacityBonus(player)) }
          : player,
      ),
      pendingChoice: null,
      pendingCards: null,
      log: pushLog(
        state.log,
        'effect',
        `${seatName(seat)} 的「亚苟斯的纠缠」锁住了${seatName(targetOwnerSeat)} 的「${
          cardById(targetCard.i)?.nameZh ?? targetCard.i
        }」`,
      ),
    };
    return { ok: true, state: next, events: [] };
  }

  if (pending.options.purpose === 'discard') {
    return resolveHandDiscard(state, seat, choice);
  }
  if (pending.options.purpose === 'distribute') {
    const remaining = state.pendingCards ?? [];
    if (remaining.length === 0) return fail('no_pending_choice', '当前没有待分配的卡牌');
    const targets = Array.isArray(pending.options.targets)
      ? (pending.options.targets as number[])
      : [];
    const target = targets[0];
    if (target === undefined) return fail('invalid_choice', '缺少分配目标');
    const rawUid =
      typeof choice === 'number'
        ? choice
        : choice && typeof choice === 'object' && 'uid' in choice
          ? (choice as { uid?: unknown }).uid
          : Array.isArray(choice)
            ? choice[0]
            : undefined;
    const uid = typeof rawUid === 'number' ? rawUid : NaN;
    const picked = remaining.find((card) => card.u === uid);
    if (!picked) return fail('invalid_choice', '无效的卡牌');
    const rest = remaining.filter((card) => card.u !== uid);
    let next: SeasonsState = {
      ...state,
      players: state.players.map((player) =>
        player.seat === target ? { ...player, hand: [...player.hand, picked] } : player,
      ),
      pendingCards: rest.length > 0 ? rest : null,
      pendingChoice: null,
      log: pushLog(
        state.log,
        'choice',
        `${seatName(seat)} 把 1 张牌交给 ${seatName(target)}`,
      ),
    };
    const nextTarget = targets[1];
    if (nextTarget !== undefined && rest.length > 0) {
      next = queueChoice(next, {
        kind: 'card_pick',
        key: 'naria_distribute',
        choosingSeat: seat,
        options: {
          purpose: 'distribute',
          targets: targets.slice(1),
          title: `选择交给 ${seatName(nextTarget)} 的牌`,
        },
        cards: rest,
      });
    }
    return { ok: true, state: next, events: [] };
  }
  const cards = state.pendingCards;
  if (!cards) return fail('no_pending_choice', '当前没有待选择的卡牌');
  const raw =
    typeof choice === 'number'
      ? choice
      : choice && typeof choice === 'object' && 'uid' in choice
        ? (choice as { uid?: unknown }).uid
        : Array.isArray(choice)
          ? choice[0]
          : undefined;
  const uid = typeof raw === 'number' ? raw : NaN;
  const picked = cards.find((card) => card.u === uid);
  if (!picked) return fail('invalid_choice', '无效的卡牌');

  const rest = cards.filter((card) => card.u !== uid);
  let next: SeasonsState = {
    ...state,
    players: state.players.map((player) =>
      player.seat === seat
        ? { ...player, hand: player.hand.filter((card) => card.u !== uid) }
        : player,
    ),
    pendingCards: null,
    pendingChoice: null,
    discard:
      pending.options.discardRest === true
        ? [...state.discard, ...rest]
        : state.discard,
    log: pushLog(state.log, 'choice', `${seatName(seat)} 选择免费召唤一张手牌`),
  };
  if (typeof pending.options.actId === 'string') {
    next = markActivated(next, seat, pending.options.actId);
  }
  if (!['potion_dreams', 'divine_chalice', 'chalice_of_eternity'].includes(pending.key)) {
    return fail('invalid_choice', '该选择不允许免费召唤');
  }
  const result = freeSummonCard(next, seat, picked);
  return result;
}

function resolveBranch(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const extension = resolveExtensionChoice(state, seat, pending, choice);
  if (extension) return extension;
  if (pending.key === 'urmian_psychic_cage') {
    const value = typeof choice === 'object' && choice !== null && 'id' in choice
      ? (choice as { id: unknown }).id : choice;
    return resolveCardPick(state, seat, pending, value);
  }
  const raw =
    typeof choice === 'string'
      ? choice
      : choice && typeof choice === 'object' && 'id' in choice
        ? (choice as { id?: unknown }).id
        : undefined;
  const id = typeof raw === 'string' ? raw : '';
  const branches = Array.isArray(pending.options.branches)
    ? (pending.options.branches as { id: string; enabled?: boolean }[])
    : [];
  const branch = branches.find((item) => item.id === id);
  const specializedChoice =
    pending.key === 'dragonsoul' ||
    pending.key === 'throne_of_renewal' ||
    pending.key === 'servant_of_ragfield' ||
    pending.key === 'urmian_psychic_cage' ||
    pending.key === 'crafty_nightshade' ||
    pending.key === 'jewel_of_the_ancients' ||
    pending.key === 'magma_core_shield';
  if (!specializedChoice && pending.key !== 'ios_minion') {
    if (!branch) return fail('invalid_choice', '无效的选项');
    if (branch.enabled === false) return fail('invalid_choice', '该选项当前不可用');
  }

  const actId =
    typeof pending.options.actId === 'string'
      ? pending.options.actId
      : String(pending.options.cardUid ?? '');

  if (pending.key === 'vampiric_crown') {
    const top = pending.options.card as CardRef | undefined;
    if (!top) return fail('invalid_choice', '缺少牌堆顶信息');
    if (id !== 'draw' && id !== 'discard') return fail('invalid_choice', '无效的选项');
    const points = typeof pending.options.points === 'number' ? pending.options.points : 0;
    const toHand = id === 'draw';
    let next: SeasonsState = {
      ...state,
      deck: state.deck.filter((card) => card.u !== top.u),
      pendingChoice: null,
      discard: toHand ? state.discard : [...state.discard, top],
      players: toHand
        ? state.players.map((player) =>
            player.seat === seat ? { ...player, hand: [...player.hand, top] } : player,
          )
        : state.players,
      log: pushLog(
        state.log,
        'effect',
        `${seatName(seat)} 吸血鬼王冠：${toHand ? '抽入手牌' : '弃掉'}「${
          cardById(top.i)?.nameZh ?? top.i
        }」`,
      ),
    };
    if (points > 0) {
      next = queueChoice(next, {
        kind: 'element_alloc',
        key: 'vampiric_crown_energy',
        choosingSeat: seat,
        options: {
          title: `吸血鬼王冠：选择获得 ${points} 个能量`,
          amount: points,
          target: 'reserve',
          label: '获得',
        },
      });
    }
    return { ok: true, state: next, events: [] };
  }

  if (pending.key === 'magma_core_shield') {
    if (id !== 'sacrifice' && id !== 'shield') {
      return fail('invalid_choice', '请选择熔岩核的牺牲来源');
    }
    const coreUid = Number(pending.options.cardUid);
    const shieldUid = Number(pending.options.shieldUid);
    const me = state.players[seat];
    const core = me?.played.find((item) => item.u === coreUid);
    const shield = me?.played.find((item) => item.u === shieldUid);
    if (!me || !core) return fail('card_not_in_play', '熔岩核已不在场上');
    if (id === 'shield' && !shield) {
      return fail('invalid_choice', '席拉之盾已不在场上');
    }
    const sacrificed = id === 'shield' ? shield! : core;
    let next: SeasonsState = patchPlayer(
      {
        ...state,
        pendingChoice: null,
        discard: [...state.discard, printedCard(me, sacrificed)],
      },
      seat,
      (player) => ({
        ...cardSacrificed(
          { ...player, played: player.played.filter((item) => item.u !== sacrificed.u) },
          sacrificed,
        ),
        crystals: crystalsAfterGain(player, id === 'shield' ? 10 : 0),
      }),
    );
    next = addReserveEnergy(next, seat, { fire: 3 }, '熔岩核');
    next = markActivated(next, seat, actId);
    return {
      ok: true,
      state: {
        ...next,
        log: pushLog(
          next.log,
          'effect',
          id === 'shield'
            ? '席拉之盾代替熔岩核牺牲：盾离场、水晶 +10，获得 3 火'
            : '熔岩核：牺牲自身，获得 3 火',
        ),
      },
      events: [],
    };
  }

  if (pending.key === 'dragonsoul') {
    const rawUid =
      choice && typeof choice === 'object' && 'uid' in choice
        ? (choice as { uid?: unknown }).uid
        : Array.isArray(choice)
          ? choice[0]
          : choice;
    const targetUid = typeof rawUid === 'number' ? rawUid : Number(rawUid);
    const meNow = state.players[seat];
    const target = meNow?.played.find(
      (item) =>
        item.u === targetUid &&
        item.u !== Number(pending.options.cardUid) &&
        usedKeys(meNow, item.u).length > 0,
    );
    if (!meNow || !target) {
      return fail('invalid_choice', '请选择一张本回合已使用的其他场牌');
    }
    let next = patchPlayer(state, seat, (player) => ({
      activatedThisTurn: player.activatedThisTurn.filter(
        (key) => key !== String(targetUid) && !key.startsWith(`${targetUid}:`),
      ),
    }));
    next = markActivated(next, seat, actId);
    return {
      ok: true,
      state: {
        ...next,
        pendingChoice: null,
        pendingCards: null,
        log: pushLog(
          next.log,
          'effect',
          `龙魂：支付 1 水晶，重置「${cardById(target.i)?.nameZh ?? target.i}」`,
        ),
      },
      events: [],
    };
  }

  if (pending.key === 'throne_of_renewal') {
    const rawUid =
      choice && typeof choice === 'object' && 'uid' in choice
        ? (choice as { uid?: unknown }).uid
        : Array.isArray(choice)
          ? choice[0]
          : choice;
    const discardUid = typeof rawUid === 'number' ? rawUid : Number(rawUid);
    const meNow = state.players[seat];
    const discarded = meNow?.hand.find((item) => item.u === discardUid);
    if (!meNow || !discarded) return fail('invalid_choice', '请选择一张手牌弃掉');
    const [drawnState, drawn] = drawOne({
      ...state,
      players: state.players.map((player) =>
        player.seat === seat
          ? { ...player, hand: player.hand.filter((item) => item.u !== discardUid) }
          : player,
      ),
      discard: [...state.discard, discarded],
    });
    let next = patchPlayer(drawnState, seat, (player) => ({
      badgesUsed: Math.max(0, player.badgesUsed - 1),
      hand: drawn ? [...player.hand, drawn] : player.hand,
    }));
    next = markActivated(next, seat, actId);
    return {
      ok: true,
      state: {
        ...next,
        pendingChoice: null,
        pendingCards: null,
        log: pushLog(
          next.log,
          'effect',
          `复生王座：弃掉「${cardById(discarded.i)?.nameZh ?? discarded.i}」，抽 1 张，徽章使用数 -1`,
        ),
      },
      events: [],
    };
  }

  if (pending.key === 'jewel_of_the_ancients') {
    const element = (
      choice && typeof choice === 'object' && 'element' in choice
        ? (choice as { element?: unknown }).element
        : choice
    ) as Element;
    if (!ELEMENTS.includes(element)) return fail('invalid_choice', '请选择一种能量');
    const meNow = state.players[seat];
    if (!meNow || (winterStaffActive(state, meNow)
      ? reserveTotal(meNow) < 3 : reserveElementCount(meNow, element) < 3)) {
      return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足 3 个`);
    }
    let payer = meNow;
    const sources = choice && typeof choice === 'object' && Array.isArray((choice as { paidSources?: unknown }).paidSources)
      ? (choice as { paidSources: SeasonsElementSource[] }).paidSources : undefined;
    if (sources) {
      if (sources.length !== 3) return fail('invalid_choice', '请选择三个能量');
      const cost = winterStaffActive(state, meNow)
        ? { water: 0, air: 0, fire: 0, earth: 3, crystal: 0 }
        : { water: 0, air: 0, earth: 0, fire: 0, crystal: 0, [element]: 3 };
      const payment = payElementSources(meNow, cost, sources, undefined, false, winterStaffActive(state, meNow));
      if (!payment.ok) return fail(payment.code, payment.message);
      payer = payment.player;
    } else for (let index = 0; index < 3; index += 1) {
      const after = takeElementEnergy(payer, element, 1);
      if (!after) return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足 3 个`);
      payer = after;
    }
    const marks = { ...(payer.cardMarks ?? {}) };
    const cardUid = Number(pending.options.cardUid);
    marks[cardUid] = {
      ...(marks[cardUid] ?? {}),
      jewels: (marks[cardUid]?.jewels ?? 0) + 1,
      [`stored${element[0]!.toUpperCase()}${element.slice(1)}`]: 1,
    } as SeasonsCardMarks;
    let next: SeasonsState = {
      ...state,
      players: state.players.map((player) =>
        player.seat === seat ? { ...payer, cardMarks: marks } : player,
      ),
      pendingChoice: null,
      pendingCards: null,
      log: pushLog(
        state.log,
        'effect',
        `远古珠宝：封存 1 个${ELEMENT_NAME_ZH[element]}能量，弃掉另外 2 个`,
      ),
    };
    next = markActivated(next, seat, actId);
    return { ok: true, state: next, events: [] };
  }

  if (pending.key === 'ios_minion') {
    if (id !== 'transfer') return fail('invalid_choice', '请选择传递伊欧的爪牙');
    const meNow = state.players[seat];
    const cardUid = Number(pending.options.cardUid);
    const passed = meNow?.played.find((item) => item.u === cardUid);
    if (!meNow || !passed || reserveElementCount(meNow, 'air') < 1) {
      return fail('energy_low', '需要 1 个风能量');
    }
    const sources = Array.isArray(pending.options.paidSources)
      ? pending.options.paidSources as SeasonsElementSource[] : undefined;
    const payment = sources ? payElementSources(meNow,
      { water: 0, air: 1, earth: 0, fire: 0, crystal: 0 }, sources, undefined, false) : null;
    if (payment && !payment.ok) return fail(payment.code, payment.message);
    const paid = payment?.ok ? payment.player : takeElementEnergy(meNow, 'air', 1);
    if (!paid) return fail('energy_low', '需要 1 个风能量');
    const targetSeat = (seat + 1) % state.players.length;
    let next: SeasonsState = {
      ...state,
      players: state.players.map((player) => {
        if (player.seat === seat) {
          return {
            ...paid,
            played: paid.played.filter((item) => item.u !== cardUid),
          };
        }
        if (player.seat === targetSeat) {
          return {
            ...player,
            played: [...player.played, passed],
          };
        }
        return player;
      }),
      pendingChoice: null,
      pendingCards: null,
      log: pushLog(
        state.log,
        'effect',
        `伊欧的爪牙：弃掉 1 风，传给${seatName(targetSeat)}`,
      ),
    };
    next = markActivated(next, seat, actId);
    return { ok: true, state: next, events: [] };
  }

  if (pending.key === 'servant_of_ragfield') {
    if (id !== 'keep' && id !== 'discard') {
      return fail('invalid_choice', '请选择保留或弃掉刚摸到的牌');
    }
    const drawn = pending.options.card as CardRef | undefined;
    if (!drawn) return fail('invalid_choice', '缺少摸到的牌');
    let next = state;
    next = {
      ...next,
      players: next.players.map((player) =>
        player.seat === seat && id === 'keep'
          ? { ...player, hand: [...player.hand, drawn] }
          : player,
      ),
      pendingChoice: null,
      pendingCards: null,
      discard:
        id === 'discard' ? [...next.discard, drawn] : next.discard,
      log: pushLog(
        next.log,
        'effect',
        id === 'keep'
          ? `拉格菲尔德的仆从：${seatName(seat)} 保留 1 张牌`
          : `拉格菲尔德的仆从：${seatName(seat)} 弃掉「${cardById(drawn.i)?.nameZh ?? drawn.i}」`,
      ),
    };
    return { ok: true, state: promoteQueued(next), events: [] };
  }

  if (pending.key === 'crafty_nightshade') {
    const stage =
      typeof pending.options.stage === 'string' ? pending.options.stage : '';
    if (stage === 'target') {
      const targetSeat = Number(id);
      const meNow = state.players[seat];
      const target = state.players[targetSeat];
      const rivals = state.players.filter((player) => player.seat !== seat);
      const fewest = Math.min(...rivals.map((player) => player.played.length));
      if (
        !meNow ||
        !target ||
        target.seat === seat ||
        target.played.length !== fewest ||
        meNow.hand.length === 0
      ) {
        return fail('invalid_choice', '请选择场上魔法牌最少的对手');
      }
      return {
        ok: true,
        state: {
          ...state,
          pendingChoice: {
            ...pending,
            options: {
              ...pending.options,
              stage: 'card',
              targetSeat,
              title: '诈欺狼：选择一张手牌交给对手',
            },
          },
          pendingCards: [...meNow.hand],
        },
        events: [],
      };
    }
    if (stage === 'card') {
      const rawUid =
        choice && typeof choice === 'object' && 'uid' in choice
          ? (choice as { uid?: unknown }).uid
          : choice;
      const cardUid = typeof rawUid === 'number' ? rawUid : Number(rawUid);
      const meNow = state.players[seat];
      const targetSeat = Number(pending.options.targetSeat);
      const chosen = meNow?.hand.find((item) => item.u === cardUid);
      const target = state.players[targetSeat];
      if (!meNow || !target || !chosen || targetSeat === seat) {
        return fail('invalid_choice', '请选择一张手牌');
      }
      let next = markActivated(state, seat, actId);
      next = {
        ...next,
        players: next.players.map((player) => {
          if (player.seat === seat) {
            return {
              ...player,
              hand: player.hand.filter((item) => item.u !== cardUid),
            };
          }
          if (player.seat === targetSeat) {
            return { ...player, hand: [...player.hand, chosen] };
          }
          return player;
        }),
        pendingChoice: null,
        pendingCards: null,
        log: pushLog(
          next.log,
          'effect',
          `诈欺狼：将「${cardById(chosen.i)?.nameZh ?? chosen.i}」交给${seatName(targetSeat)}`,
        ),
      };
      return { ok: true, state: next, events: [] };
    }
    return fail('invalid_choice', '诈欺狼选择阶段异常');
  }

  if (pending.key === 'die_of_malice') {
    const player = state.players[seat];
    if (!player) return fail('bad_seat', '座位不存在');
    if (id === 'normal') {
      return {
        ok: true,
        state: resolveDieRewards({ ...state, pendingChoice: null }, seat),
        events: [],
      };
    }
    if (id !== 'alternative') return fail('invalid_choice', '无效的选项');
    const season = state.season;
    if (!season) return fail('invalid_choice', '没有可重掷的骰子');
    const seasonElement = SEASONS[season.index]?.element;
    if (!seasonElement) return fail('invalid_choice', '没有可重掷的骰子');
    const dieDef = DICE_BY_ELEMENT[seasonElement].find(
      (item) => item.id === season.dice.find((die) => die.pickedBy === seat)?.id,
    );
    const current = season.dice.find((die) => die.pickedBy === seat);
    if (!dieDef || !current) return fail('invalid_choice', '没有可重掷的骰子');
    const [faceIndex, rngState] = randInt(state, dieDef.faces.length);
    const face = dieDef.faces[faceIndex];
    if (!face) return fail('invalid_choice', '骰面数据异常');
    const dice = season.dice.map((die) =>
      die.pickedBy === seat
        ? { ...die, face: face.roll, pip: face.pip, rewards: face.rewards }
        : die,
    );
    const crystals = typeof pending.options.crystals === 'number' ? pending.options.crystals : 2;
    const remaining =
      (typeof pending.options.remaining === 'number' ? pending.options.remaining : 1) - 1;
    const reroll = dieRerollOf(player);
    let next: SeasonsState = {
      ...state,
      ...rngState,
      season: { ...season, dice },
      pendingChoice: null,
    };
    next = patchPlayer(next, seat, (item) => ({ crystals: item.crystals + crystals }));
    next = {
      ...next,
      log: pushLog(
        next.log,
        'effect',
        `${seatName(seat)} 使用「恶意之骰」：重掷骰子（${face.pip} 点）+ 水晶 ${crystals}`,
      ),
    };
    if (remaining > 0 && reroll) {
      const choice = maliceChoice(reroll, remaining);
      return { ok: true, state: { ...next, pendingChoice: choice ? { ...choice, choosingSeat: seat } : null }, events: [] };
    }
    return { ok: true, state: resolveDieRewards(next, seat), events: [] };
  }

  if (pending.key === 'mirror_of_seasons') {
    const step = typeof pending.options.step === 'string' ? pending.options.step : '';
    const actId =
      typeof pending.options.actId === 'string' ? pending.options.actId : '';
    const me = state.players[seat];
    if (!me) return fail('bad_seat', '座位不存在');
    if (step === 'source') {
      const element = id as Element;
      if (!ELEMENTS.includes(element)) return fail('invalid_choice', '未知能量类型');
      const count = reserveElementCount(me, element);
      const maxX = Math.min(me.crystals, count);
      if (maxX < 1) return fail('energy_low', '能量或水晶不足');
      const selectedSources = choice && typeof choice === 'object' &&
        Array.isArray((choice as { paidSources?: unknown }).paidSources)
        ? (choice as { paidSources: SeasonsElementSource[] }).paidSources : undefined;
      const selectedAmount = selectedSources?.length;
      if (selectedSources) {
        if (!selectedAmount || selectedAmount > maxX) return fail('invalid_choice', '转换数量不合法');
        const payment = payElementSources(me,
          { water: 0, air: 0, fire: 0, earth: 0, crystal: 0, [element]: selectedAmount },
          selectedSources, undefined, false);
        if (!payment.ok) return fail(payment.code, payment.message);
      }
      const proceed = (amount: number): ReduceResult<SeasonsState> => ({
        ok: true,
        state: {
          ...state,
          pendingChoice: {
            kind: 'branch',
            key: 'mirror_of_seasons',
            choosingSeat: seat,
            options: {
              step: 'target',
              source: element,
              amount,
              ...(selectedSources ? { paidSources: selectedSources } : {}),
              title: '四季之镜 — 选择目标能量类型',
              branches: ELEMENTS.filter((item) => item !== element).map((item) => ({
                id: item,
                label: `转为${ELEMENT_NAME_ZH[item]}能量`,
              })),
              actId,
            },
          },
        },
        events: [],
      });
      if (selectedAmount) return proceed(selectedAmount);
      if (maxX === 1) return proceed(1);
      return {
        ok: true,
        state: {
          ...state,
          pendingChoice: {
            kind: 'branch',
            key: 'mirror_of_seasons',
            choosingSeat: seat,
            options: {
              step: 'amount',
              source: element,
              max: maxX,
              title: '四季之镜 — 选择转换数量',
              branches: Array.from({ length: maxX }, (_, index) => ({
                id: String(index + 1),
                label: `转换 ${index + 1} 个（付 ${index + 1} 水晶）`,
              })),
              actId,
            },
          },
        },
        events: [],
      };
    }
    if (step === 'amount') {
      const source = pending.options.source as Element;
      const amount = Number(id);
      const max = typeof pending.options.max === 'number' ? pending.options.max : 0;
      if (!Number.isInteger(amount) || amount < 1 || amount > max) {
        return fail('invalid_choice', '转换数量不合法');
      }
      return {
        ok: true,
        state: {
          ...state,
          pendingChoice: {
            kind: 'branch',
            key: 'mirror_of_seasons',
            choosingSeat: seat,
            options: {
              step: 'target',
              source,
              amount,
              ...(choice && typeof choice === 'object' && Array.isArray((choice as { paidSources?: unknown }).paidSources)
                ? { paidSources: (choice as { paidSources: SeasonsElementSource[] }).paidSources } : {}),
              title: '四季之镜 — 选择目标能量类型',
              branches: ELEMENTS.filter((item) => item !== source).map((item) => ({
                id: item,
                label: `转为${ELEMENT_NAME_ZH[item]}能量`,
              })),
              actId,
            },
          },
        },
        events: [],
      };
    }
    if (step === 'target') {
      const source = pending.options.source as Element;
      const amount = typeof pending.options.amount === 'number' ? pending.options.amount : 0;
      const target = id as Element;
      if (!ELEMENTS.includes(target) || target === source) {
        return fail('invalid_choice', '目标能量类型不合法');
      }
      let player = me;
      const sources = pending.options.paidSources as SeasonsElementSource[] | undefined;
      const payment = sources ? payElementSources(player,
        { water: 0, air: 0, fire: 0, earth: 0, crystal: 0, [source]: amount },
        sources, undefined, false) : null;
      if (payment && !payment.ok) return fail(payment.code, payment.message);
      const after = payment?.ok ? payment.player : takeElementEnergy(player, source, amount);
      if (!after) return fail('energy_low', '能量不足');
      player = after;
      player = {
        ...player,
        crystals: player.crystals - amount,
        energies: addEnergyCapped(player.energies, { [target]: amount }, player.maxEnergy),
      };
      let next: SeasonsState = {
        ...state,
        players: state.players.map((item) => (item.seat === seat ? player : item)),
        pendingChoice: null,
        log: pushLog(
          state.log,
          'effect',
          `四季之镜：${ELEMENT_NAME_ZH[source]}×${amount} → ${ELEMENT_NAME_ZH[target]}×${amount}`,
        ),
      };
      next = markActivated(next, seat, actId);
      return { ok: true, state: next, events: [] };
    }
    return fail('invalid_choice', '四季之镜状态异常');
  }

  if (pending.key === 'crystal_orb' && id === 'keep') {
    const card = pending.options.card as CardRef | undefined;
    if (!card) return fail('invalid_choice', '缺少牌堆顶信息');
    let next: SeasonsState = {
      ...state,
      deck: [...state.deck, card],
      pendingChoice: null,
      log: pushLog(state.log, 'effect', '水晶球：把牌堆顶放回'),
    };
    next = markActivated(next, seat, actId);
    return { ok: true, state: next, events: [] };
  }

  if (pending.key === 'crystal_orb' && id === 'summon') {
    const card = pending.options.card as CardRef | undefined;
    if (!card) return fail('invalid_choice', '缺少牌堆顶信息');
    return {
      ok: true,
      state: {
        ...state,
        pendingChoice: {
          kind: 'element_alloc',
          key: 'crystal_orb',
          choosingSeat: seat,
          options: {
            amount: 4,
            title: '选择弃掉 4 个能量',
            label: '弃掉',
            then: 'free_summon',
            mode: 'pay',
            card,
            actId,
          },
        },
      },
      events: [],
    };
  }

  return fail('not_implemented', '该选项尚未接入');
}

/** 弃置仅使用实际储备槽，不能从卡上的封存或可支付元素代扣。 */
function resolveEnergyDiscard(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const amount = typeof pending.options.amount === 'number' ? pending.options.amount : 0;
  const available = (pending.options.available ?? {}) as Partial<Record<Element, number>>;
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
    return fail('invalid_choice', '能量弃置不合法');
  }
  const alloc: Record<Element, number> = { water: 0, air: 0, fire: 0, earth: 0 };
  let total = 0;
  for (const element of ELEMENTS) {
    const raw = (choice as Record<string, unknown>)[element];
    if (raw === undefined) continue;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      return fail('invalid_choice', '能量弃置不合法');
    }
    if (raw > (available[element] ?? 0)) {
      return fail('choice_over_limit', '弃置数量超过可用能量');
    }
    alloc[element] = raw;
    total += raw;
  }
  if (total !== amount) {
    return fail('choice_amount_mismatch', `应弃掉 ${amount} 个能量，实际选择 ${total} 个`);
  }
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const sources = (choice as { paidSources?: SeasonsElementSource[] }).paidSources;
  if (sources !== undefined && !Array.isArray(sources)) return fail('invalid_source', '无效的元素槽选择');
  if (sources) {
    if (sources.some((source) => source.source !== 'reserve')) return fail('invalid_source', '只能弃置储备区的元素');
    const payment = payElementSources(me, { ...alloc, crystal: 0 }, sources, undefined, false);
    if (!payment.ok) return fail(payment.code, payment.message);
  }
  let player = me;
  for (const element of ELEMENTS) {
    const need = alloc[element];
    if (need <= 0) continue;
    if (player.energies[element] < need) return fail('choice_over_limit', '弃置数量超过可用储备能量');
    player = { ...player, energies: { ...player.energies, [element]: player.energies[element] - need } };
  }
  const discarded = ELEMENTS.filter((element) => alloc[element] > 0)
    .map((element) => `${ELEMENT_NAME_ZH[element]}×${alloc[element]}`)
    .join('、');
  const next: SeasonsState = {
    ...state,
    players: state.players.map((item) => (item.seat === seat ? player : item)),
    pendingChoice: null,
    log: pushLog(state.log, 'effect', `${seatName(seat)} 弃掉 ${discarded}`),
  };
  return { ok: true, state: next, events: [] };
}

function resolveEnergySwap(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  if (!choice || typeof choice !== 'object') return fail('invalid_choice', '能量分配不合法');
  const total = typeof pending.options.total === 'number' ? pending.options.total : me.maxEnergy;
  const record = choice as { discard?: unknown; paidSources?: SeasonsElementSource[] };
  if (record.paidSources !== undefined && !Array.isArray(record.paidSources)) return fail('invalid_source', '无效的元素槽选择');
  if (record.discard !== undefined) {
    const current = pending.options.current as Partial<Record<Element, number>>;
    const incoming = pending.options.incoming as Partial<Record<Element, number>>;
    const pool = Object.fromEntries(ELEMENTS.map((element) =>
      [element, (current[element] ?? 0) + (incoming[element] ?? 0)])) as Record<Element, number>;
    const discarded = parseElementAlloc(record.discard, energySum(pool) - total, pool);
    if (typeof discarded === 'string') return fail(discarded, '请选择超出上限的元素弃置');
    if (record.paidSources) {
      if (record.paidSources.some((source) => source.source !== 'reserve')) return fail('invalid_source', '只能弃置储备区的元素');
      const payment = payElementSources({ ...me, energies: pool }, { ...discarded, crystal: 0 },
        record.paidSources, undefined, false);
      if (!payment.ok) return fail(payment.code, payment.message);
    }
    choice = Object.fromEntries(ELEMENTS.map((element) => [element, pool[element] - discarded[element]]));
  }
  const alloc: Record<Element, number> = { water: 0, air: 0, fire: 0, earth: 0 };
  let sum = 0;
  for (const element of ELEMENTS) {
    const raw = (choice as Record<string, unknown>)[element];
    if (raw === undefined || raw === 0) continue;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      return fail('invalid_choice', '能量分配不合法');
    }
    alloc[element] = raw;
    sum += raw;
  }
  if (sum !== total) {
    return fail('choice_amount_mismatch', `应保留 ${total} 个能量，实际选择 ${sum} 个`);
  }
  const current = pending.options.current as Partial<Record<Element, number>> | undefined;
  const incoming = pending.options.incoming as Partial<Record<Element, number>> | undefined;
  for (const element of ELEMENTS) {
    const cap = (current?.[element] ?? me.energies[element]) + (incoming?.[element] ?? 0);
    if (alloc[element] > cap) return fail('choice_over_limit', '不能保留未获得的能量');
  }
  const beforeText =
    ELEMENTS.filter((element) => me.energies[element] > 0)
      .map((element) => `${me.energies[element]}${ELEMENT_NAME_ZH[element]}`)
      .join(' ') || '无';
  const afterText =
    ELEMENTS.filter((element) => alloc[element] > 0)
      .map((element) => `${alloc[element]}${ELEMENT_NAME_ZH[element]}`)
      .join(' ') || '无';
  const swapped: SeasonsState = {
    ...patchPlayer(state, seat, (player) => ({ energies: { ...alloc } })),
    pendingChoice: null,
    log: pushLog(state.log, 'effect', `${seatName(seat)} 储备区将超上限，重新分配能量：${beforeText} → ${afterText}`),
  };
  const after = pending.options.after as { kind?: string } | undefined;
  if (after?.kind === 'discard_pending') {
    const dropped = Array.isArray(pending.options.cards)
      ? (pending.options.cards as CardRef[])
      : (state.pendingCards ?? []);
    return {
      ok: true,
      state: {
        ...swapped,
        pendingCards: null,
        discard: [...swapped.discard, ...dropped],
        log: pushLog(swapped.log, 'effect', `弃掉 ${dropped.length} 张牌`),
      },
      events: [],
    };
  }
  return { ok: true, state: swapped, events: [] };
}

function resolveChoice(
  state: SeasonsState,
  seat: number,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const pending = state.pendingChoice;
  if (!pending) return fail('no_pending_choice', '当前没有待选择的事项');
  if (pending.choosingSeat !== seat) return fail('not_your_choice', '不是你的选择');
  const extension = resolveExtensionChoice(state, seat, pending, choice);
  if (extension) return extension;

  switch (pending.kind) {
    case 'element_alloc':
      return resolveElementAlloc(state, seat, pending, choice);
    case 'card_list':
      return resolveCardList(state, seat, pending, choice);
    case 'card_pick':
      return resolveCardPick(state, seat, pending, choice);
    case 'multi_player_pick':
      return resolveMultiPlayerPick(state, seat, pending, choice);
    case 'month_advance':
      return resolveMonthAdvance(state, seat, pending, choice);
    case 'element_pick':
      return pending.key === 'jewel_of_the_ancients'
        ? resolveBranch(state, seat, pending, choice)
        : resolveElementPick(state, seat, pending, choice);
    case 'element_multi':
      return resolveElementMulti(state, seat, pending, choice);
    case 'sacrifice_cards':
      return resolveSacrificeCards(state, seat, pending, choice);
    case 'branch':
      return resolveBranch(state, seat, pending, choice);
    case 'energy_discard':
      return finish(state, resolveEnergyDiscard(state, seat, pending, choice));
    case 'energy_swap':
      return resolveEnergySwap(state, seat, pending, choice);
    default:
      return fail('not_implemented', `选择类型 ${pending.kind} 尚未接入`);
  }
}

/* ------------------------------------------------------------------ */
/* 回合内的动作：转换能量                                              */
/* ------------------------------------------------------------------ */

function transmute(
  state: SeasonsState,
  seat: number,
  element: Element,
  paidSources?: SeasonsElementSource[],
): ReduceResult<SeasonsState> {
  if (state.phase !== 'play') return fail('wrong_phase', '当前不是行动阶段');
  if (state.turnOwner !== seat) return fail('not_your_turn', '还没轮到你行动');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const pickedDie = state.season?.dice.find((item) => item.pickedBy === seat);
  const hasTransmuter = me.played.some(
    (item) => !lockedOut(me, item) && cardById(item.i)?.effect?.typeKey === 'transmute_on_crystal_die',
  );
  if (!me.canTransmute && !(hasTransmuter && (pickedDie?.rewards.crystals ?? 0) > 0)) {
    return fail('no_transmute', '本回合没有转换能力');
  }

  // 储备区与卡上能量（流水护符等）都可用于转换；贪吃锅的封印能量除外。
  const payment = paidSources ? payElementSources(me,
    { water: 0, air: 0, fire: 0, earth: 0, crystal: 0, [element]: 1 },
    paidSources, undefined, false, winterStaffActive(state, me)) : null;
  if (payment && !payment.ok) return fail(payment.code, payment.message);
  const afterPay = payment?.ok ? payment.player : takeElementEnergy(me, element, 1);
  if (!afterPay) return fail('energy_low', `没有可用的${ELEMENT_NAME_ZH[element]}能量`);
  const energies = afterPay.energies;
  const played = afterPay.played;

  let bonus = 0;
  for (const card of played) {
    if (lockedOut(me, card)) continue;
    const def = cardById(card.i);
    if (def) bonus += abilityAmount(def, 'transmute_bonus');
  }
  const value =
    (TRANSMUTE_VALUE[element][seasonIndexForMonth(state.month)] ?? 0) +
    bonus +
    me.transmuteBonus;
  const players = state.players.map((player) =>
    player.seat === seat
      ? {
          ...player,
          energies,
          played,
          crystals: crystalsAfterGain(player, value),
          transmuteBonus: player.transmuteBonus,
          transmutedThisTurn: true,
        }
      : player,
  );
  return {
    ok: true,
    state: {
      ...state,
      players,
      log: pushLog(
        state.log,
        'transmute',
        `${seatName(seat)} 转换 1${ELEMENT_NAME_ZH[element]} → ${value} 水晶${bonus > 0 ? `（加成 +${bonus}）` : ''}`,
      ),
    },
    events: [],
  };
}

/* ------------------------------------------------------------------ */
/* 结束回合 / 月份与年份推进                                           */
/* ------------------------------------------------------------------ */

/** 终局特殊计分（对应旧引擎 card-effects.js 的 score 注册表，返回值是额外水晶）。 */
function scoreEffectCrystals(player: SeasonsPlayerState, players: readonly SeasonsPlayerState[]): number {
  let extra = 0;
  for (const card of player.played) {
    if (lockedOut(player, card)) continue;
    const def = cardById(card.i);
    const effect = def?.effect;
    if (!effect) continue;
    const handler = SCORE_HANDLERS[handlerKey(def)];
    if (handler) extra += handler({ player, players, reserveTotal }, def, card);
  }
  return extra;
}

/** 终局计分（水晶 + 卡面分 + 特殊计分 - 手牌与徽章惩罚）。 */
function finishGame(state: SeasonsState): SeasonsState {
  const players: SeasonsPlayerScore[] = state.players.map((player) => {
    const cardPoints = player.played.reduce(
      (total, card) => total + (cardById(player.cardMarks?.[card.u]?.ravenOriginalId ?? card.i)?.points ?? 0),
      0,
    );
    const effectPoints = scoreEffectCrystals(player, state.players);
    const handPenalty = player.hand.length * HAND_PENALTY;
    const badgePenalty = BADGE_PENALTY[player.badgesUsed] ?? 0;
    return {
      seat: player.seat,
      crystals: player.crystals,
      cardPoints,
      effectPoints,
      handSize: player.hand.length,
      handPenalty,
      badgesUsed: player.badgesUsed,
      badgePenalty,
      cardsInPlay: player.played.length,
      energyLeft: energySum(player.energies),
      score: player.crystals + cardPoints + effectPoints - handPenalty - badgePenalty,
    };
  });
  players.sort((a, b) => b.score - a.score);
  const best = players[0];
  const second = players[1];
  const draw = !!best && !!second && best.score === second.score;
  const winner = draw ? null : (best?.seat ?? null);
  return {
    ...state,
    phase: 'ended',
    result: { players, winner, draw },
    log: pushLog(
      state.log,
      'score',
      draw
        ? '终局：平局'
        : `终局：${winner === null ? '?' : seatName(winner)} 获胜（${best?.score ?? 0} 分）`,
    ),
  };
}

/** 有效储备总量：储备区 + 「视为储备」卡（附魔魔典）上的能量。 */
function reserveElementCount(player: SeasonsPlayerState, element: Element): number {
  let total = player.energies[element];
  for (const card of player.played) {
    const def = cardById(card.i);
    if (!def || !card.stored) continue;
    if (lockedOut(player, card) || abilitiesOf(def, 'reserve_slot').length === 0 ||
      abilitiesOf(def, 'sealed_energy').length > 0) continue;
    total += card.stored[element] ?? 0;
  }
  return total;
}

function reserveTotal(player: SeasonsPlayerState): number {
  let total = energySum(player.energies);
  for (const card of player.played) {
    const def = cardById(card.i);
    if (!def || !card.stored) continue;
    if (lockedOut(player, card) || abilitiesOf(def, 'reserve_slot').length === 0 ||
      abilitiesOf(def, 'sealed_energy').length > 0) continue;
    total += Object.values(card.stored).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  }
  return total;
}

/** Re-evaluate one live card after all earlier round-end choices have resolved. */
function applyRoundEndCard(state: SeasonsState, seat: number, uid: number): SeasonsState {
  const me = state.players[seat];
  if (!me) return state;
  const card = me.played.find((item) => item.u === uid);
  if (!card || lockedOut(me, card) || state.roundEndResolved?.includes(uid)) return state;
  const def = cardById(card.i);
  if (!def?.effect) return state;
  const key = handlerKey(def);
  const markDone = (next: SeasonsState): SeasonsState => ({
    ...next, roundEndResolved: [...(next.roundEndResolved ?? []), uid],
  });
  if (key === 'beggars_horn') {
    if (reserveTotal(me) > 1) return state;
    return queueChoice(markDone(state), { kind: 'element_alloc', key, choosingSeat: seat,
      options: { amount: 1, target: 'reserve', title: '乞丐之角：获得 1 个能量', label: '获得' } });
  }
  if (key === 'heart_of_argos') {
    if (!card.stored?.earth) return state;
    return addReserveEnergy(patchPlayer(markDone(state), seat, (player) => ({
      played: player.played.map((item) => item.u === uid ? { ...item, stored: {} } : item),
    })), seat, { earth: card.stored.earth }, '邪神之心');
  }
  if (key === 'transmute_on_crystal_die') {
    if (!me.transmutedThisTurn) return state;
    const next = patchPlayer(markDone(state), seat, (player) => ({
      crystals: crystalsAfterGain(player, 2),
    }));
    return { ...next, log: pushLog(next.log, 'effect', '伊欧的晶化魔盘：本行动轮使用晶化，水晶 +2') };
  }
  if (!def.effect.triggers.some((trigger) => trigger === 'turn_end' || trigger === 'round_end')) return state;
  const handler = ROUND_END_HANDLERS[key] ?? TURN_END_HANDLERS[key];
  if (!handler) return state;
  const result = handler({ state, seat, me, reserveTotal }, card);
  if (!result.pending && !result.log && !result.crystals && !result.energy && !result.sacrifice) return state;
  let next = markDone({
    ...state, players: result.players ?? state.players,
  });
  if (result.crystals) {
    next = patchPlayer(next, seat, (player) => ({
      crystals: Math.max(0, crystalsAfterGain(player, result.crystals!)),
    }));
  }
  if (result.sacrifice) {
    next = patchPlayer({
      ...next, discard: [...next.discard, printedCard(me, card)],
    }, seat, (player) => cardSacrificed({
      ...player, played: player.played.filter((item) => item.u !== uid),
    }, card));
  }
  if (result.log) next = { ...next, log: pushLog(next.log, 'effect', result.log) };
  if (result.pending) next = queueChoice(next, { ...result.pending, choosingSeat: seat });
  if ((result.energy ?? 0) > 0) {
    next = queueChoice(next, {
      kind: 'element_alloc', key: 'turn_end_energy', choosingSeat: seat,
      options: { title: `回合结束：选择获得 ${result.energy} 个能量`,
        amount: result.energy, target: 'reserve', label: '获得' },
    });
  }
  return next;
}

function queueRoundEndEffects(state: SeasonsState, lastSeat: number): SeasonsState {
  const order = [76, 50, 75, 84, 14, 51, 39, 13, 56, 59, 53, 77, 52];
  const steps: SeasonsPendingChoiceState[] = [];
  for (let offset = 0; offset < state.players.length; offset++) {
    const seat = (state.startPlayer + offset) % state.players.length;
    const player = state.players[seat]!;
    const sorted = [...player.played].sort((a, b) =>
      (order.indexOf(a.i) < 0 ? 99 : order.indexOf(a.i)) -
      (order.indexOf(b.i) < 0 ? 99 : order.indexOf(b.i)));
    const append = (card: CardInstance) => steps.push({
      kind: 'round_end_card', key: 'round_end_card', choosingSeat: seat, options: { cardUid: card.u },
    });
    for (const card of sorted) {
      append(card);
      // A later payment/storage can make a previously ineligible empty-reserve card eligible.
      if ([51, 53, 77, 52].includes(card.i)) {
        for (const candidate of sorted.filter((item) => [84, 14].includes(item.i))) append(candidate);
      }
    }
  }
  steps.push({ kind: 'finish_round', key: 'finish_round', choosingSeat: lastSeat, options: {} });
  return promoteQueued({
    ...state, roundEndResolved: [], pendingQueue: [...steps, ...state.pendingQueue],
  });
}

/** 换季效果：贪婪的菲格里姆 / 魔法法师（对手税）、命运小径（抽牌）、时光沙漏（得能量）。 */
function applySeasonChangeEffects(state: SeasonsState): SeasonsState {
  const players = state.players.map((player) => ({
    ...player,
    energies: { ...player.energies },
    played: [...player.played],
  }));
  const logs: string[] = [];
  const choices: SeasonsPendingChoiceState[] = [];
  for (const player of players) {
    for (const card of player.played) {
      if (lockedOut(player, card)) continue;
      const def = cardById(card.i);
      if (!def?.effect) continue;
      const isSeason = def.effect.triggers.includes('season_change');
      if (!isSeason) continue;
      const handler = SEASON_CHANGE_HANDLERS[handlerKey(def)];
      if (!handler) continue;
      const result = handler(
        { state: { ...state, players }, seat: player.seat, me: player, reserveTotal },
        card,
      );
      player.crystals = crystalsAfterGain(player, result.selfCrystals ?? 0);
      if (result.opponentCrystals) {
        for (const other of players) {
          if (other.seat === player.seat) continue;
          other.crystals = Math.max(0, other.crystals - result.opponentCrystals);
        }
      }
      if (result.log) logs.push(result.log);
      if (result.pending) choices.push({ ...result.pending, choosingSeat: player.seat });
    }
  }
  let next: SeasonsState = { ...state, players, pendingQueue: [...state.pendingQueue, ...choices] };
  for (const msg of logs) next = { ...next, log: pushLog(next.log, 'effect', msg) };
  // 「命运小径」：换季时抽 N 张牌（按座位顺序）。
  for (const player of players) {
    let drawCount = 0;
    for (const card of player.played) {
      if (lockedOut(player, card)) continue;
      const def = cardById(card.i);
      if (def?.effect?.type !== 'season_draw') continue;
      drawCount += typeof def.effect.amount === 'number' ? def.effect.amount : 1;
    }
    if (drawCount <= 0) continue;
    let hand: CardRef[] = next.players[player.seat]?.hand ?? [];
    for (let index = 0; index < drawCount; index += 1) {
      const [drawnState, drawn] = drawOne(next);
      next = drawnState;
      if (drawn) hand = [...hand, drawn];
    }
    next = {
      ...next,
      players: next.players.map((item) =>
        item.seat === player.seat ? { ...item, hand } : item,
      ),
    };
    next = { ...next, log: pushLog(next.log, 'effect', `「命运小径」：抽 ${drawCount} 张牌`) };
  }
  // 「时光沙漏」：换季时获得 1 个任意能量（每位持有者各自选择，按座位顺序排队）。
  for (const player of players) {
    let amount = 0;
    for (const card of player.played) {
      if (lockedOut(player, card)) continue;
      const def = cardById(card.i);
      if (!def?.effect) continue;
      if (def.effect.type !== 'on_season_change_energy') continue;
      if (typeof def.effect.amount === 'number') amount += def.effect.amount;
    }
    if (amount > 0) {
      next = queueChoice(next, {
        kind: 'element_alloc',
        key: 'on_season_change_energy',
        choosingSeat: player.seat,
        options: {
          title: `「时光沙漏」：选择获得 ${amount} 个能量`,
          amount,
          target: 'reserve',
          label: '获得',
        },
      });
    }
  }
  return next;
}

function advanceMonth(state: SeasonsState, months: number, reroll = true): SeasonsState {
  const oldSeasonIdx = seasonIndexForMonth(state.month);
  let month = state.month + months;
  if (month < 0) month = 0;
  if (month >= TOTAL_MONTHS) return state.pendingChoice || state.pendingQueue.length
    ? queueChoice(state, { kind: 'finish_game', key: 'finish_game', choosingSeat: 0, options: {} })
    : finishGame({ ...state, month: TOTAL_MONTHS });

  let next: SeasonsState = { ...state, month,
    monthStepsThisRound: state.players.map((_, index) =>
      (state.monthStepsThisRound?.[index] ?? 0) + Math.max(0, months)),
  };
  const newYear = Math.floor(month / MONTHS_PER_YEAR) + 1;
  if (newYear > state.year) {
    next = {
      ...next,
      year: newYear,
      players: next.players.map((player) => {
        let hand = player.hand;
        let library2 = player.library2;
        let library3 = player.library3;
        if (newYear === 2 && library2.length > 0) {
          hand = [...hand, ...library2];
          library2 = [];
        }
        if (newYear === 3 && library3.length > 0) {
          hand = [...hand, ...library3];
          library3 = [];
        }
        return { ...player, hand, library2, library3 };
      }),
    };
    next = {
      ...next,
      log: pushLog(next.log, 'season', `第 ${newYear} 年：取回组牌阶段的第 ${newYear} 年手牌`),
    };
  }

  const newSeasonIdx = seasonIndexForMonth(month);
  if (newSeasonIdx !== oldSeasonIdx) {
    const pendingBefore = next.pendingChoice;
    const cardsBefore = next.pendingCards;
    next = {
      ...next,
      log: pushLog(
        next.log,
        'season',
        `换季：${SEASONS[oldSeasonIdx]!.nameZh}季 → ${SEASONS[newSeasonIdx]!.nameZh}季`,
      ),
    };
    next = applySeasonChangeEffects(next);
    if (pendingBefore) {
      next = {
        ...next,
        pendingChoice: pendingBefore,
        pendingCards: cardsBefore,
      };
    }
  }
  next = {
    ...(reroll ? startMonth(next) : { ...next, seasonIdx: newSeasonIdx }),
    pendingChoice: next.pendingChoice,
    pendingQueue: next.pendingQueue,
    pendingCards: next.pendingCards,
  };
  return promoteQueued(next);
}

function useBadge(
  state: SeasonsState,
  seat: number,
  action:
    | { type: 'use-badge'; badgeType: 1; fromElements: [Element, Element]; toElements: [Element, Element]; paidSources?: SeasonsElementSource[] }
    | { type: 'use-badge'; badgeType: 2; element?: Element }
    | { type: 'use-badge'; badgeType: 3 }
    | { type: 'use-badge'; badgeType: 4; dieId: number },
): ReduceResult<SeasonsState> {
  if (state.phase !== 'play') return fail('wrong_phase', '当前不是行动阶段');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const myPick = state.turnOwner === null && state.currentPicker === seat;
  if (state.turnOwner !== seat && !myPick) return fail('not_your_turn', '还没轮到你');
  if (me.badgeDraw) return fail('pending_badge', '请先选择保留的卡牌');
  if (me.badgesUsed >= MAX_BADGES) return fail('badge_used_up', '徽章已用完');

  let player: SeasonsPlayerState = me;
  let message = '';
  if (action.badgeType === 1) {
    const from = action.fromElements;
    const to = action.toElements;
    const fromCount: Partial<Record<Element, number>> = {};
    for (const element of from) fromCount[element] = (fromCount[element] ?? 0) + 1;
    for (const element of ELEMENTS) {
      const needed = fromCount[element] ?? 0;
      if (needed > reserveElementCount(player, element)) {
        return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足`);
      }
    }
    if (action.paidSources) {
      const payment = payElementSources(player, { water: 0, air: 0, fire: 0, earth: 0, crystal: 0, ...fromCount },
        action.paidSources, undefined, false);
      if (!payment.ok) return fail(payment.code, payment.message);
      player = payment.player;
    } else for (const element of ELEMENTS) {
      const needed = fromCount[element] ?? 0;
      if (needed === 0) continue;
      const taken = takeElementEnergy(player, element, needed);
      if (!taken) return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足`);
      player = taken;
    }
    const incoming: Partial<Record<Element, number>> = {};
    for (const element of to) incoming[element] = (incoming[element] ?? 0) + 1;
    player = { ...player, energies: addEnergyCapped(player.energies, incoming, player.maxEnergy) };
    const label = (list: readonly Element[]) =>
      list.map((element) => ELEMENT_NAME_ZH[element]).join('+');
    message = `徽章：${label(from)} → ${label(to)}`;
  } else if (action.badgeType === 2) {
    player = { ...player, transmuteBonus: player.transmuteBonus + 1, canTransmute: true };
    message = '徽章：本行动轮获得晶化权，每枚晶化元素额外 +1';
  } else if (action.badgeType === 3) {
    player = { ...player, gauge: player.gauge + 1 };
    message = '徽章：召唤等级 +1';
  } else if (action.badgeType === 4) {
    if (state.turnOwner !== seat) {
      return fail('not_your_turn', '只能在行动阶段升级本次抽牌骰');
    }
    const die = state.season?.dice.find(
      (item) => item.id === action.dieId && item.pickedBy === seat,
    );
    if (!die) {
      return fail('invalid_die', '只能升级本行动轮自己选中的骰子');
    }
    if (!die.rewards.card) {
      return fail('die_has_no_draw', '所选骰面没有抽牌图标');
    }
    if (state.pendingChoice?.key !== 'die_draw' || state.pendingChoice.choosingSeat !== seat) {
      return fail('draw_already_resolved', '本次骰面抽牌已处理，不能再升级');
    }
    if (player.badgeDrawDieId !== null) {
      return fail('badge_draw_used', '本次行动轮已经升级过抽牌骰');
    }
    player = { ...player, badgeDrawDieId: die.id };
    message = '徽章：本次抽牌骰改为摸 2 选 1';
  }

  let next = patchPlayer(state, seat, () => ({
    ...player,
    badgesUsed: player.badgesUsed + 1,
  }));
  if (action.badgeType === 4) {
    const [drawnState, extra] = drawOne(next);
    const cards = [...(next.pendingCards ?? []), ...(extra ? [extra] : [])];
    next = { ...drawnState, pendingCards: cards, pendingChoice: {
      ...next.pendingChoice!, cards, options: { ...next.pendingChoice!.options, keep: 1,
        title: '抽牌徽章：摸 2 张，选择保留 1 张' },
    } };
  }
  return {
    ok: true,
    state: { ...next, log: pushLog(next.log, 'badge', `${seatName(seat)} ${message}`) },
    events: [{ type: 'badge', seat }],
  };
}

function keepBadge(
  state: SeasonsState,
  seat: number,
  cardUid: number,
): ReduceResult<SeasonsState> {
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const pending = me.badgeDraw;
  if (!pending || pending.length !== 2) return fail('no_badge_draw', '没有待选的卡牌');
  const keep = pending.find((card) => card.u === cardUid);
  if (!keep) return fail('card_not_in_hand', '所选牌不在待选中');
  const discard = pending.filter((card) => card.u !== cardUid);
  return {
    ok: true,
    state: {
      ...state,
      discard: [...state.discard, ...discard],
      players: state.players.map((player) =>
        player.seat === seat
          ? { ...player, hand: [...player.hand, keep], badgeDraw: null }
          : player,
      ),
      log: pushLog(
        state.log,
        'badge',
        `${seatName(seat)} 保留 1 张牌，弃掉 1 张牌`,
      ),
    },
    events: [{ type: 'badge-keep', seat }],
  };
}

function endTurn(state: SeasonsState, seat: number): ReduceResult<SeasonsState> {
  if (state.phase !== 'play') return fail('wrong_phase', '当前不是行动阶段');
  if (state.turnOwner !== seat) return fail('not_your_turn', '还没轮到你行动');

  const next = queueChoice(state, { kind: 'finish_turn', key: 'finish_turn', choosingSeat: seat, options: {} });
  return { ok: true, state: promoteQueued(next), events: [] };
}

/** 结束回合的后半段：轮到下一位，或推进月份。 */
function finishEndTurn(state: SeasonsState, seat: number): ReduceResult<SeasonsState> {
  state = patchPlayer(state, seat, (player) => ({
    canTransmute: false, badgeDrawDieId: null, transmuteBonus: 0,
    activatedThisTurn: [],
  }));
  const pickedThisSeason = state.pickedThisSeason.includes(seat)
    ? state.pickedThisSeason
    : [...state.pickedThisSeason, seat];
  const nextSeat = state.dicePicked.find((item) => !pickedThisSeason.includes(item));

  if (nextSeat !== undefined) {
    let next: SeasonsState = {
      ...state,
      pickedThisSeason,
      turnOwner: nextSeat,
      currentPicker: nextSeat,
      log: pushLog(state.log, 'effect', `${seatName(seat)} 结束回合`),
    };
    // 下一位玩家开始行动时结算他的骰面奖励（旧引擎 startPlayerAction），可能先问恶意之骰。
    return beginTurn(next, nextSeat);
  }

  return { ok: true, state: queueRoundEndEffects({ ...state, pickedThisSeason }, seat), events: [] };
}

function finishRound(state: SeasonsState, seat: number): SeasonsState {
  let completedRound: SeasonsState = { ...state, roundEndResolved: undefined, players: state.players.map((player) => ({
    ...player, transmutedThisTurn: false,
    cardMarks: Object.fromEntries(Object.entries(player.cardMarks ?? {}).map(([uid, mark]) =>
      [uid, { ...mark, heartChargedThisTurn: false }])),
  })) };
  // 全员行动完毕：起始玩家顺时针轮转，按剩余骰子的点数推进月份。
  const nextStart = (completedRound.startPlayer + 1) % completedRound.players.length;
  const leftover = completedRound.season?.dice.find((die) => die.pickedBy === null);
  const steps = leftover?.pip ?? 1;
  if ((completedRound.monthStepsThisRound?.[0] ?? 0) + steps >= 3) {
    for (const player of completedRound.players) {
      for (const card of player.played.filter((item) => item.i === 82 && !lockedOut(player, item))) {
        completedRound = queueChoice(completedRound, { kind: 'branch', key: 'chrono_ring',
          choosingSeat: player.seat, options: { title: '时光魔环：选择本回合奖励', cardUid: card.u,
            branches: [{ id: 'crystals', label: '获得 4 水晶' }, { id: 'energy', label: '获得 1 个能量' }] } });
      }
    }
  }
  const advancedMonth = advanceMonth(
    { ...completedRound, startPlayer: nextStart, monthStepsThisRound: state.players.map(() => 0) },
    steps,
  );
  const advanced = { ...advancedMonth, monthStepsThisRound: state.players.map(() => 0) };
  return {
      ...advanced,
      log: pushLog(advanced.log, 'effect', `${seatName(seat)} 结束回合，月份前进 ${steps}`),
  };
}

/* ------------------------------------------------------------------ */
/* 认输                                                                */
/* ------------------------------------------------------------------ */

function resign(state: SeasonsState, seat: number): ReduceResult<SeasonsState> {
  if (state.phase === 'ended') return fail('game_over', '这局已经结束了');
  if (state.players.length !== 2) return fail('resign_not_allowed', '多人局不能认输');
  const winner = seat === 0 ? 1 : 0;
  const log = pushLog(state.log, 'score', `${seatName(seat)} 认输`);
  return {
    ok: true,
    state: {
      ...state,
      phase: 'ended',
      resignedSeat: seat,
      // 分数明细由 T2.5 的计分器补齐；认输时只需要胜者。
      result: { players: [], winner, draw: false },
      log,
    },
    events: [
      { type: 'resign', seat },
      { type: 'game_over', winner },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* 激活                                                                */
/* ------------------------------------------------------------------ */

function isActivatable(def: SeasonsCardDef): boolean {
  const effect = def.effect;
  if (!effect) return false;
  return effect.trigger === 'activation' || effect.triggers.includes('activation');
}

function activationKeyOf(def: SeasonsCardDef): string {
  return activationKeyOfCard(def);
}

function countPlayedType(player: SeasonsPlayerState, type: string): number {
  return player.played.filter((card) => printedCardType(player, card) === type).length;
}

/** Multiple Grimoires share one +3; Lantern/Statue penalties still stack. */
function reserveCapacityBonus(player: SeasonsPlayerState): number {
  let grimoire = false;
  let bonus = 0;
  for (const card of player.played) {
    if (lockedOut(player, card)) continue;
    const def = cardById(card.i);
    if (!def) continue;
    if (def.id === 18) {
      if (grimoire) continue;
      grimoire = true;
    }
    bonus += abilityAmount(def, 'max_energy_plus');
  }
  return bonus;
}

function enteringCapacityBonus(player: SeasonsPlayerState, def: SeasonsCardDef): number {
  if (def.id === 18 && player.played.some((card) => card.i === 18 && !lockedOut(player, card))) return 0;
  return abilityAmount(def, 'max_energy_plus');
}

function printedCard(player: SeasonsPlayerState, card: CardRef): CardRef {
  return { i: player.cardMarks?.[card.u]?.ravenOriginalId ?? card.i, u: card.u };
}

function cardLeavingPlay(
  player: SeasonsPlayerState,
  card: { i: number; u?: number },
): SeasonsPlayerState {
  const before = player.played.some((item) => item.u === card.u) ? player
    : { ...player, played: [...player.played, { i: card.i, u: card.u ?? -1 }] };
  const after = { ...player, played: player.played.filter((item) => item.u !== card.u) };
  const bonus = reserveCapacityBonus(before) - reserveCapacityBonus(after);
  const marks = { ...player.cardMarks };
  if (card.u) delete marks[card.u];
  return {
    ...player,
    maxEnergy: Math.max(0, player.maxEnergy - bonus),
    cardMarks: marks,
    activatedThisTurn: player.activatedThisTurn.filter((key) =>
      key !== String(card.u) && !key.startsWith(`${card.u}:`)),
  };
}

/** 牺牲离场：除上限恢复外，还触发 on_sacrifice（诅咒典籍：清空储备）。 */
function cardSacrificed(
  player: SeasonsPlayerState,
  card: { i: number; u?: number },
): SeasonsPlayerState {
  const def = cardById(card.i);
  const key = def?.effect ? def.effect.typeKey ?? def.effect.type : '';
  const next = cardLeavingPlay(player, card);
  if (key === 'cursed_treatise' && !(card.u && player.cardMarks?.[card.u]?.lockSource)) {
    return { ...next, energies: { water: 0, air: 0, fire: 0, earth: 0 } };
  }
  return next;
}

/** 从储备区优先扣能量，不足时再从场上卡牌的 stored 里扣。 */
function takeElementEnergy(
  player: SeasonsPlayerState,
  element: Element,
  amount: number,
): SeasonsPlayerState | null {
  let left = amount;
  const energies = { ...player.energies };
  const fromReserve = Math.min(energies[element], left);
  energies[element] -= fromReserve;
  left -= fromReserve;
  if (left === 0) return { ...player, energies };
  const played = player.played.map((card) => {
    if (left === 0) return card;
    const cardDef = cardById(card.i);
    if (!cardDef || lockedOut(player, card) ||
      abilitiesOf(cardDef, 'reserve_slot').length === 0 ||
      abilitiesOf(cardDef, 'sealed_energy').length > 0) return card;
    const have = card.stored?.[element] ?? 0;
    if (have === 0) return card;
    const take = Math.min(have, left);
    left -= take;
    return { ...card, stored: { ...(card.stored ?? {}), [element]: have - take } };
  });
  if (left > 0) return null;
  return { ...player, energies, played };
}

type PaymentSource = SeasonsElementSource & {
  kind: 'reserve' | 'card';
  uid?: number;
};

type PaymentResolution =
  | { ok: true; player: SeasonsPlayerState; paid: Element[] }
  | { ok: false; code: string; message: string };

/**
 * 将前端提交的实际 token 来源解析为一次性扣费。
 * 兼容旧客户端：没有 paidSources 时按元素种类优先从储备扣，
 * 但绝不在来源不足时静默改扣别的卡。
 */
function payElementSources(
  player: SeasonsPlayerState,
  cost: SeasonsCardCost,
  paidSources: readonly SeasonsElementSource[] | undefined,
  paidElements: readonly Element[] | undefined,
  flexible: boolean,
  earthWild = false,
): PaymentResolution {
  let next = player;
  const requested: SeasonsElementSource[] = paidSources?.length
    ? [...paidSources]
    : flexible
      ? (paidElements ?? []).map((element) => ({ element, source: 'reserve' as const }))
      : [];

  if (requested.length === 0) {
    if (flexible) return { ok: false, code: 'flex_cost_count', message: '请选择要支付的元素' };
    const paid: Element[] = [];
    for (const element of [...ELEMENTS.filter((item) => item !== 'earth'), 'earth' as const]) {
      const need = cost[element] ?? 0;
      if (need <= 0) continue;
      if (earthWild && element === 'earth') {
        let left = need;
        for (const sourceElement of ELEMENTS) {
          const count = Math.min(left, reserveElementCount(next, sourceElement));
          if (!count) continue;
          const taken = takeElementEnergy(next, sourceElement, count);
          if (!taken) return { ok: false, code: 'cant_afford', message: '能量不足' };
          next = taken;
          paid.push(...Array<Element>(count).fill(sourceElement));
          left -= count;
        }
        if (left) return { ok: false, code: 'cant_afford', message: '能量不足' };
        continue;
      }
      if (reserveElementCount(next, element) < need) {
        return { ok: false, code: 'cant_afford', message: '能量或水晶不足' };
      }
      const taken = takeElementEnergy(next, element, need);
      if (!taken) {
        return { ok: false, code: 'cant_afford', message: '能量或水晶不足' };
      }
      next = taken;
      for (let index = 0; index < need; index += 1) paid.push(element);
    }
    if ((cost.crystal ?? 0) > next.crystals) {
      return { ok: false, code: 'cant_afford', message: '水晶不足' };
    }
    return {
      ok: true,
      player: { ...next, crystals: next.crystals - cost.crystal },
      paid,
    };
  }

  const seen = new Set<string>();
  const counts: Partial<Record<Element, number>> = {};
  for (const source of requested) {
    if (!source || typeof source !== 'object' || !['reserve', 'card'].includes(source.source)) {
      return { ok: false, code: 'invalid_source', message: '无效的支付来源' };
    }
    if (!ELEMENTS.includes(source.element)) {
      return { ok: false, code: 'invalid_choice', message: '未知能量类型' };
    }
    const key =
      source.source === 'card'
        ? `card:${source.cardUid ?? ''}:${source.slot ?? 0}:${source.element}`
        : `reserve:${source.slot ?? 0}:${source.element}`;
    if (seen.has(key)) {
      return { ok: false, code: 'choice_duplicate', message: '同一能量槽不能重复支付' };
    }
    seen.add(key);
    const originalCard = source.source === 'card' ? player.played.find((card) => card.u === source.cardUid) : null;
    const available = source.source === 'reserve' ? player.energies[source.element] : originalCard?.stored?.[source.element] ?? 0;
    if (source.slot !== undefined && (!Number.isInteger(source.slot) || source.slot < 0 || source.slot >= available)) {
      return { ok: false, code: 'invalid_source', message: '支付来源槽位不存在' };
    }
    counts[source.element] = (counts[source.element] ?? 0) + 1;
  }

  const paid: Element[] = [];
  for (const source of requested) {
    const element = source.element;
    if (source.source === 'reserve') {
      if ((next.energies[element] ?? 0) < 1) {
        return { ok: false, code: 'energy_low', message: `${ELEMENT_NAME_ZH[element]}能量不足` };
      }
      next = {
        ...next,
        energies: { ...next.energies, [element]: next.energies[element] - 1 },
      };
      paid.push(element);
      continue;
    }

    const cardUid = source.cardUid;
    if (typeof cardUid !== 'number') {
      return { ok: false, code: 'invalid_choice', message: '卡牌能量缺少实例 UID' };
    }
    const cardIndex = next.played.findIndex((card) => card.u === cardUid);
    if (cardIndex < 0) {
      return { ok: false, code: 'card_not_in_play', message: '支付来源卡不在场上' };
    }
    const card = next.played[cardIndex]!;
    const cardDef = cardById(card.i);
    if (!cardDef || lockedOut(player, card) || abilitiesOf(cardDef, 'sealed_energy').length > 0 ||
      abilitiesOf(cardDef, 'reserve_slot').length === 0) {
      return { ok: false, code: 'invalid_source', message: '这张牌不能作为能量来源' };
    }
    if ((card.stored?.[element] ?? 0) < 1) {
      return { ok: false, code: 'energy_low', message: `${ELEMENT_NAME_ZH[element]}能量不足` };
    }
    const stored = { ...(card.stored ?? {}), [element]: (card.stored?.[element] ?? 0) - 1 };
    next = {
      ...next,
      played: next.played.map((item, index) =>
        index === cardIndex ? { ...item, stored } : item,
      ),
    };
    paid.push(element);
  }

  if (!flexible) {
    if (earthWild) {
      if (requested.length !== energySum(cost) || ELEMENTS.some((element) =>
        element !== 'earth' && (counts[element] ?? 0) < cost[element])) {
        return { ok: false, code: 'choice_amount_mismatch', message: '支付元素类型不正确' };
      }
    } else {
    for (const element of ELEMENTS) {
      if ((counts[element] ?? 0) !== (cost[element] ?? 0)) {
        return { ok: false, code: 'choice_amount_mismatch', message: '支付元素类型不正确' };
      }
    }
    }
  }
  if ((cost.crystal ?? 0) > next.crystals) {
    return { ok: false, code: 'cant_afford', message: '水晶不足' };
  }
  return { ok: true, player: { ...next, crystals: next.crystals - cost.crystal }, paid };
}

/**
 * 激活请求与结算由 cards/activation-handlers.ts 的注册表提供。
 * 这里只保留需要查看牌堆顶、多步分支或通用弹窗外壳的处理器。
 */
function activationHandlerFor(def: SeasonsCardDef): ActivationHandler | undefined {
  return ACTIVATION_HANDLERS[activationKeyOf(def)];
}

function activationRequest(
  def: SeasonsCardDef,
  state: SeasonsState,
  seat: number,
  cardUid: number,
  abilityKey?: string,
): RegisteredActivationRequest | null | 'unimplemented' {
  const handler = activationHandlerFor(def);
  if (!handler) return 'unimplemented';
  // 牺牲自身后再询问效果时，牌已经从 played 中移除；请求仍可仅凭
  // 卡牌定义与实例 uid 构造。
  const card =
    state.players[seat]?.played.find((item) => item.u === cardUid)
    ?? { i: def.id, u: cardUid };
  const context = {
    state,
    seat,
    cardUid,
    card,
    def,
    key: activationKeyOf(def),
    abilityKey,
  };
  if (handler.canRequest && !handler.canRequest(context)) return 'unimplemented';
  return handler.request(context);
}

function applyActivationEffect(
  state: SeasonsState,
  seat: number,
  cardUid: number,
  key: string,
  element?: Element,
  choice?: unknown,
): SeasonsState {
  const playedCard = state.players[seat]?.played.find((item) => item.u === cardUid);
  const def = playedCard
    ? cardById(playedCard.i)
    : cardById(
        state.players[seat]?.hand.find((item) => item.u === cardUid)?.i ??
          state.discard.find((item) => item.u === cardUid)?.i ??
          -1,
      );
  const card = playedCard ?? (def ? { i: def.id, u: cardUid } : undefined);
  const handler = ACTIVATION_HANDLERS[key];
  if (!def || !card || !handler || handler.deferred) return state;
  return handler.resolve({ state, seat, cardUid, card, def, key }, element, choice);
}

function clearCardMark(
  state: SeasonsState,
  seat: number,
  cardUid: number,
  keys: readonly (keyof SeasonsCardMarks)[],
): SeasonsState {
  return patchPlayer(state, seat, (player) => {
    const marks = { ...(player.cardMarks ?? {}) };
    const mark = marks[cardUid];
    if (!mark) return player;
    const nextMark = { ...mark };
    for (const key of keys) delete nextMark[key];
    if (Object.keys(nextMark).length === 0) delete marks[cardUid];
    else marks[cardUid] = nextMark;
    return { cardMarks: marks };
  });
}

/** Resolve the summon effect that was paused while the cage choice was open. */
function settlePendingSummon(
  state: SeasonsState,
  seat: number,
  cardUid: number,
): SeasonsState {
  const card = state.players[seat]?.played.find((item) => item.u === cardUid);
  const mark = state.players[seat]?.cardMarks?.[cardUid];
  if (!card || !mark?.summonEffectPending || state.pendingQueue.some((pending) =>
    pending.key === 'urmian_psychic_cage' && pending.options.summonedUid === cardUid)) return state;
  let next = clearCardMark(state, seat, cardUid, ['summonEffectPending', 'summonOrigin']);
  if (card.generated) return next;
  next = settleSummonedCard(next, seat, card, mark.summonOrigin ?? 'normal');
  const def = cardById(card.i);
  const summonChoice = def ? summonChoiceFor(def, card.paid ?? [], next, seat) : null;
  if (summonChoice && summonChoice !== 'unimplemented') {
    next = openSummonChoice(next, seat, card, summonChoice);
  }
  return next;
}

function finishUrmianBranch(
  state: SeasonsState,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  message: string,
): ReduceResult<SeasonsState> {
  const cageSeat = Number(pending.options.cageSeat);
  const cageUid = Number(pending.options.cageUid);
  let next = clearCardMark(
    { ...state, pendingChoice: null, pendingCards: null },
    cageSeat,
    cageUid,
    ['trapArmed', 'trapPending'],
  );
  next = {
    ...next,
    log: pushLog(next.log, 'effect', message),
  };
  return { ok: true, state: promoteQueued(next), events: [] };
}

function markActivated(
  state: SeasonsState,
  seat: number,
  actId: string,
): SeasonsState {
  if (state.players[seat]?.activatedThisTurn.includes(actId)) return state;
  let next = patchPlayer(state, seat, (player) => ({
    activatedThisTurn: [...player.activatedThisTurn, actId],
  }));
  next = patchPlayer(next, seat, (player) => ({
    played: player.played.map((card) => card.i === 51 && !lockedOut(player, card) &&
      !player.cardMarks?.[card.u]?.heartChargedThisTurn ? { ...card, stored: { earth: 1 } } : card),
    cardMarks: { ...player.cardMarks, ...Object.fromEntries(player.played
      .filter((card) => card.i === 51 && !lockedOut(player, card))
      .map((card) => [card.u, { ...player.cardMarks?.[card.u], heartChargedThisTurn: true }])) },
  }));
  return applyOpponentActivateEffects(next, seat);
}

/** 扩展包「对手激活时」奖励（小仙灵 / 命运守望者）：给持有者水晶或抽牌。 */
function applyOpponentActivateEffects(state: SeasonsState, seat: number): SeasonsState {
  const draws: number[] = [];
  let stolenTotal = 0;
  const players = state.players.map((player) => {
    if (player.seat === seat) return player;
    let crystals = player.crystals;
    for (const card of player.played) {
      if (lockedOut(player, card)) continue;
      const effect = cardById(card.i)?.effect;
      if (!effect) continue;
      const key = effect.typeKey ?? effect.type;
      if (key === 'thieving_fairies') {
        // 偷窃妖精：对手激活时前进 2 格（1 来自其水晶，1 额外）；对方没水晶时只拿额外 1。
        const have = (state.players[seat]?.crystals ?? 0) - stolenTotal;
        if (have > 0) {
          stolenTotal += 1;
          crystals += 2;
        } else {
          crystals += 1;
        }
        continue;
      }
      if (key !== 'opponent_action_reward') continue;
      if (effect.triggerKind && effect.triggerKind !== 'opponent_activate') continue;
      if (effect.crystals) crystals += effect.crystals;
      if (effect.draw) draws.push(player.seat);
    }
    return crystals === player.crystals ? player : {
      ...player, crystals: crystalsAfterGain(player, crystals - player.crystals),
    };
  });
  if (stolenTotal > 0) {
    const activator = players.find((player) => player.seat === seat);
    if (activator) {
      players[players.indexOf(activator)] = {
        ...activator,
        crystals: activator.crystals - stolenTotal,
      };
    }
  }
  let next: SeasonsState = { ...state, players };
  if (stolenTotal > 0) {
    next = {
      ...next,
      log: pushLog(next.log, 'effect', `偷窃妖精：对手激活，水晶 +${stolenTotal + 1}`),
    };
  }
  if (draws.length > 0) {
    next = { ...next, log: pushLog(next.log, 'effect', '对手激活奖励：结算') };
  }
  for (const ownerSeat of draws) {
    const [drawnState, drawn] = drawOne(next);
    next = drawnState;
    if (drawn) {
      next = patchPlayer(next, ownerSeat, (player) => ({ hand: [...player.hand, drawn] }));
    }
  }
  return next;
}

function activate(
  state: SeasonsState,
  seat: number,
  cardUid: number,
  abilityKey?: string,
  sacrificeUid?: number,
  paidSources?: SeasonsElementSource[],
): ReduceResult<SeasonsState> {
  if (state.phase !== 'play') return fail('wrong_phase', '当前不是行动阶段');
  if (state.turnOwner !== seat) return fail('not_your_turn', '还没轮到你行动');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const card = me.played.find((item) => item.u === cardUid);
  if (!card) return fail('card_not_in_play', '这张牌不在场上');
  if (lockedOut(me, card)) return fail('card_locked', '这张神仆被锁结封印');
  const def = cardById(card.i);
  if (!def || !isActivatable(def)) return fail('not_activatable', '这张牌不可激活');

  const actId = abilityKey ? `${cardUid}:${abilityKey}` : String(cardUid);
  const used = me.activatedThisTurn.some(
    (key) => key === actId || key === String(cardUid),
  );
  if (used) return fail('already_activated', '这张牌本回合已激活过');
  if (card.i === 53 && Object.values(card.stored ?? {}).reduce((sum, n) => sum + (n ?? 0), 0) === 0) return fail('energy_low', '仙女巨石上没有能量');
  if (card.i === 61 && state.discard.length === 0) return fail('discard_empty', '弃牌堆为空');
  if (card.i === 66 && (me.crystals < 2 || state.deck.length === 0)) return fail('cant_afford', '需要 2 水晶及非空摸牌堆');
  if (card.i === 71 && !me.played.some((item) => item.u !== cardUid && usedKeys(me, item.u).length > 0)) {
    return fail('invalid_choice', '没有可重置的其他场牌');
  }
  if (card.i === 77 && Object.values(card.stored ?? {}).reduce((sum, n) => sum + (n ?? 0), 0) < 4) return fail('energy_low', '永恒圣杯需要 4 个封存能量');
  const selfSacrifice = ACTIVATION_HANDLERS[activationKeyOf(def)]?.sacrifice && activationKeyOf(def) !== 'magma_core';
  const shields = me.played.filter((item) => item.i === 63 && item.u !== cardUid && !lockedOut(me, item));
  if (selfSacrifice && sacrificeUid === undefined && shields.length) return {
    ok: true, state: { ...state, pendingChoice: {
      kind: 'branch', key: 'shield_substitute', choosingSeat: seat, options: {
        title: `选择「${def.nameZh}」的牺牲来源`, cardUid, abilityKey,
        branches: [{ id: 'sacrifice', label: '牺牲本牌' },
          ...shields.map((shield) => ({ id: `shield:${shield.u}`, label: '牺牲席拉之盾，获得 10 水晶' }))],
      },
    } }, events: [],
  };

  // 激活费用（如诅咒圣物：1 水）
  let payer: SeasonsPlayerState = me;
  const declaredCost = abilitiesOf(def, 'activation_cost');
  if (paidSources && declaredCost.length) {
    const cost = { water: 0, air: 0, earth: 0, fire: 0, crystal: 0 };
    for (const ability of declaredCost) {
      if (ELEMENTS.includes(ability.element as Element)) cost[ability.element as Element] += ability.amount ?? 1;
    }
    const payment = payElementSources(me, cost, paidSources, undefined, false);
    if (!payment.ok) return fail(payment.code, payment.message);
    payer = payment.player;
  }
  for (const ability of abilitiesOf(def, 'activation_cost')) {
    if (paidSources) continue;
    const element = ability.element as Element | undefined;
    const amount = ability.amount ?? 1;
    if (!element || !ELEMENTS.includes(element)) continue;
    const paid = takeElementEnergy(payer, element, amount);
    if (!paid) {
      return fail(
        'cant_afford',
        `激活需要 ${amount} 个${ELEMENT_NAME_ZH[element]}`,
      );
    }
    payer = paid;
  }
  const paidState: SeasonsState = {
    ...state,
    players: state.players.map((player) => (player.seat === seat ? payer : player)),
  };

  // 光之树 A：先弃 3 水晶
  let costed: SeasonsState = paidState;
  if (
    activationKeyOf(def) === 'tree_of_light' &&
    abilityKey === 'crystal_to_energy'
  ) {
    const payer2 = costed.players[seat];
    if (!payer2 || payer2.crystals < 3) {
      return fail('cant_afford', '水晶不足 3，无法激活光之树');
    }
    costed = patchPlayer(costed, seat, (player) => ({
      crystals: player.crystals - 3,
    }));
  }

  // 需要牺牲自身的药剂先离场；死灵匕首的支付目标另行选择。
  const activationHandler = ACTIVATION_HANDLERS[activationKeyOf(def)];
  // Magma Core must announce its choice before sacrificing. Its activation
  // registry entry is only a legacy direct-effect fallback.
  if (
    activationHandler?.sacrifice &&
    activationKeyOf(def) !== 'magma_core'
  ) {
    const meNow = costed.players[seat];
    const removedUid = sacrificeUid !== undefined && sacrificeUid >= 0 ? sacrificeUid : cardUid;
    const removed = meNow?.played.find((item) => item.u === removedUid);
    if (removedUid !== cardUid && !shields.some((shield) => shield.u === removedUid)) {
      return fail('invalid_choice', '席拉之盾已不在场上');
    }
    if (removed) {
      costed = patchPlayer(
        {
          ...costed,
          discard: [...costed.discard, { i: meNow?.cardMarks?.[removed.u]?.ravenOriginalId ?? removed.i, u: removed.u }],
        },
        seat,
        (player) => ({
          ...cardSacrificed(player, removed),
          played: player.played.filter((item) => item.u !== removedUid),
          crystals: player.crystals + (removedUid !== cardUid ? 10 : 0),
        }),
      );
    }
    costed = {
      ...costed,
      log: pushLog(costed.log, 'activate', `${seatName(seat)} 牺牲「${def.nameZh}」`),
    };
  }

  // 梦境药水：先在储备槽确认全部费用，再免费召唤一张手牌。
  if (activationKeyOf(def) === 'potion_dreams') {
    const player = costed.players[seat]!;
    if (player.hand.length === 0) return fail('hand_empty', '手牌为空，无法选择召唤');
    return { ok: true, state: { ...costed, pendingChoice: {
      kind: 'element_alloc', key: 'dream_payment', choosingSeat: seat,
      options: { title: '梦境药剂：选择全部储备元素弃置', label: '支付', mode: 'pay',
        amount: energySum(player.energies), maxPerElement: { ...player.energies }, reserveOnly: true,
        then: 'dream_summon', actId, cardUid },
    } }, events: [] };
  }

  // 水晶球：先看牌堆顶，再让玩家选择放回或免费召唤。
  if (activationKeyOf(def) === 'crystal_orb') {
    if (abilityKey === 'discard') {
      const meNow = costed.players[seat];
      if (!meNow || meNow.crystals < 3) {
        return fail('cant_afford', '水晶不足 3，无法弃掉牌堆顶');
      }
      const paidCrystals = patchPlayer(costed, seat, (player) => ({
        crystals: player.crystals - 3,
      }));
      const [drawnState, drawn] = drawOne(paidCrystals);
      if (!drawn) return fail('deck_empty', '牌堆为空');
      return {
        ok: true,
        state: markActivated(
          {
            ...drawnState,
            discard: [...drawnState.discard, drawn],
            log: pushLog(
              drawnState.log,
              'effect',
              `水晶球：弃掉牌堆顶「${cardById(drawn.i)?.nameZh ?? drawn.i}」`,
            ),
          },
          seat,
          abilityKey ? `${cardUid}:${abilityKey}` : String(cardUid),
        ),
        events: [],
      };
    }
    if (abilityKey !== 'summon') {
      return fail('invalid_choice', '水晶球需要指定能力：summon 或 discard');
    }
    const [peekState, peeked] = drawOne(costed);
    if (!peeked) return fail('deck_empty', '牌堆为空');
    const peekDef = cardById(peeked.i);
    const meNow = peekState.players[seat];
    const summonReq = peekDef ? summonChoiceFor(peekDef, [], peekState, seat) : 'unimplemented';
    const canSummon =
      !!meNow &&
      meNow.gauge > meNow.played.length &&
      energySum(meNow.energies) >= 4 &&
      summonReq === null;
    return {
      ok: true,
      state: {
        ...peekState,
        pendingChoice: {
          kind: 'branch',
          key: 'crystal_orb',
          choosingSeat: seat,
          options: {
            title: `牌堆顶是「${peekDef?.nameZh ?? peeked.i}」`,
            branches: [
              { id: 'keep', label: '放回牌堆顶', enabled: true },
              { id: 'summon', label: '弃 4 能量免费召唤', enabled: canSummon },
            ],
            card: peeked,
            canSummon,
            cardUid,
            actId: abilityKey ? `${cardUid}:${abilityKey}` : String(cardUid),
          },
        },
        log: pushLog(peekState.log, 'activate', `${seatName(seat)} 激活「${def.nameZh}」`),
      },
      events: [],
    };
  }

  if (activationKeyOf(def) === 'mirror_of_seasons') {
    const meNow = costed.players[seat];
    if (!meNow || meNow.crystals < 1) {
      return fail('cant_afford', '水晶不足，无法激活四季之镜');
    }
    const available = ELEMENTS.filter(
      (element) =>
        reserveElementCount(meNow, element) > 0,
    );
    if (available.length === 0) {
      return fail('energy_low', '储备区无能量可转换');
    }
    return {
      ok: true,
      state: {
        ...costed,
        pendingChoice: {
          kind: 'branch',
          key: 'mirror_of_seasons',
          choosingSeat: seat,
          options: {
            step: 'source',
            title: '四季之镜 — 选择要转换的能量类型',
            branches: available.map((element) => ({
              id: element,
              label: `${ELEMENT_NAME_ZH[element]}能量`,
            })),
            cardUid,
            actId: abilityKey ? `${cardUid}:${abilityKey}` : String(cardUid),
          },
        },
        log: pushLog(costed.log, 'activate', `${seatName(seat)} 激活「${def.nameZh}」`),
      },
      events: [],
    };
  }

  if (activationKeyOf(def) === 'necrotic_kriss') {
    const actor = costed.players[seat];
    const hasFamiliar = [...(actor?.hand ?? []), ...(actor?.played ?? [])].some(
      (card) => actor && printedCardType(actor, card) === 'familiar',
    );
    if (!hasFamiliar) return fail('invalid_choice', '没有可弃置或牺牲的随从');
  }

  if (activationKeyOf(def) === 'eolis_replicator') {
    const meNow = costed.players[seat];
    if (!meNow) return fail('bad_seat', '座位不存在');
    if (!(meNow.gauge > meNow.played.length)) {
      return fail('gauge_low', '召唤等级不足，无法放置复制牌');
    }
    if ((costed.replicaDeck ?? 10) <= 0) {
      return fail('no_replica', '复制牌库存已用尽');
    }
    if (reserveElementCount(meNow, 'water') < 1) {
      return fail('cant_afford', '需要 1 个水能量');
    }
    const payment = paidSources ? payElementSources(meNow,
      { water: 1, air: 0, earth: 0, fire: 0, crystal: 0 }, paidSources, undefined, false) : null;
    if (payment && !payment.ok) return fail(payment.code, payment.message);
    const paid = payment?.ok ? payment.player : takeElementEnergy(meNow, 'water', 1);
    if (!paid) return fail('cant_afford', '需要 1 个水能量');
    const replicaDeck = Math.max(0, (costed.replicaDeck ?? 10) - 1);
    const replicaSupply = replicaDeck;
    const nextReplicaUid = Math.max(
      10_000,
      ...costed.players.flatMap((player) => player.played.map((item) => item.u + 1)),
      ...costed.discard.map((item) => item.u + 1),
      ...costed.deck.map((item) => item.u + 1),
      ...costed.players.flatMap((player) => [...player.hand, ...player.library2, ...player.library3].map((item) => item.u + 1)),
    );
    let next: SeasonsState = {
      ...costed,
      players: costed.players.map((player) =>
        player.seat === seat
          ? {
              ...paid,
              replicaSupply,
              played: [
                ...paid.played,
                {
                  i: 222,
                  u: nextReplicaUid,
                  generated: true,
                },
              ],
            }
          : player,
      ),
      replicaDeck,
      log: pushLog(costed.log, 'effect', '伊欧的复制仪：弃 1 水，生成一张复制魔法牌'),
    };
    next = markActivated(next, seat, actId);
    next = patchPlayer(next, seat, (player) => ({
      cardMarks: { ...player.cardMarks, [nextReplicaUid]: { summonEffectPending: true, summonOrigin: 'freeEffect' } },
    }));
    const trapped = queueUrmianTrap(next, seat, { i: 222, u: nextReplicaUid }, 'freeEffect');
    next = trapped === next
      ? clearCardMark(next, seat, nextReplicaUid, ['summonEffectPending', 'summonOrigin']) : trapped;
    return { ok: true, state: next, events: [] };
  }

  if (activationKeyOf(def) === 'jewel_of_the_ancients') {
    const player = costed.players[seat]!;
    if (!(winterStaffActive(costed, player) ? reserveTotal(player) >= 3
      : ELEMENTS.some((element) => reserveElementCount(player, element) >= 3))) {
      return fail('energy_low', '需要三个相同的可支付能量');
    }
    return {
      ok: true,
      state: {
        ...costed,
        pendingChoice: {
          kind: 'element_pick',
          key: 'jewel_of_the_ancients',
          choosingSeat: seat,
          options: {
            title: '远古珠宝：选择 3 个相同能量封存在牌上',
            amount: 3,
            label: '封存',
            cardUid,
            actId,
          },
        },
        log: pushLog(costed.log, 'activate', `${seatName(seat)} 激活「${def.nameZh}」`),
      },
      events: [],
    };
  }

  if (activationKeyOf(def) === 'dragonsoul') {
    const meNow = costed.players[seat];
    if (!meNow || meNow.crystals < 1) {
      return fail('cant_afford', '需要支付 1 水晶');
    }
    let next = patchPlayer(costed, seat, (player) => ({
      crystals: player.crystals - 1,
    }));
    next = {
      ...next,
      pendingChoice: {
        kind: 'card_pick',
        key: 'dragonsoul',
        choosingSeat: seat,
        options: {
          title: '龙魂：选择一张本回合已使用的其他牌重置',
          label: '重置',
          cardUid,
          actId,
        },
      },
      pendingCards: [
        ...meNow.played.filter(
          (item) =>
            item.u !== cardUid && usedKeys(meNow, item.u).length > 0,
        ),
      ],
      log: pushLog(costed.log, 'activate', `${seatName(seat)} 激活「${def.nameZh}」`),
    };
    return { ok: true, state: next, events: [] };
  }

  if (activationKeyOf(def) === 'ios_minion') {
    const meNow = costed.players[seat];
    if (!meNow || reserveElementCount(meNow, 'air') < 1) {
      return fail('cant_afford', '需要 1 个风能量');
    }
    return {
      ok: true,
      state: {
        ...costed,
        pendingChoice: {
          kind: 'branch',
          key: 'ios_minion',
          choosingSeat: seat,
          options: {
            title: '伊欧的爪牙：弃掉 1 个风元素并传给左手玩家',
            label: '传递',
            branches: [{ id: 'transfer', label: '传递给左手玩家' }],
            cardUid,
            actId,
            ...(paidSources ? { paidSources } : {}),
          },
        },
        log: pushLog(costed.log, 'activate', `${seatName(seat)} 激活「${def.nameZh}」`),
      },
      events: [],
    };
  }


  if (activationKeyOf(def) === 'magma_core') {
    const meNow = costed.players[seat];
    if (!meNow) return fail('bad_seat', '座位不存在');
    const shield = meNow.played.find(
      (item) => cardById(item.i)?.effect?.typeKey === 'shield_of_zira',
    );
    return {
      ok: true,
      state: {
        ...costed,
        pendingChoice: {
          kind: 'branch',
          key: 'magma_core_shield',
          choosingSeat: seat,
          options: {
            title: '熔岩核：牺牲自身获得 3 个火元素；或由席拉之盾代替牺牲',
            label: '确认',
            branches: [
              { id: 'sacrifice', label: '牺牲熔岩核，获得 3 个火元素' },
              ...(shield
                ? [{ id: 'shield', label: '席拉之盾代替：盾离场，水晶 +10，仍获得 3 火' }]
                : []),
            ],
            cardUid,
            shieldUid: shield?.u,
            actId,
          },
        },
        log: pushLog(costed.log, 'activate', `${seatName(seat)} 激活「${def.nameZh}」`),
      },
      events: [],
    };
  }

  if (card.i === 66) costed = patchPlayer(costed, seat, (player) => ({ crystals: player.crystals - 2 }));
  let request = activationRequest(def, costed, seat, cardUid, abilityKey);
  if (request === 'unimplemented') {
    return fail(
      'effect_not_implemented',
      `「${def.nameZh}」的激活效果尚未实现`,
    );
  }
  if (request) {
    if (request.kind === 'card_list' || request.kind === 'branch' || request.cards ||
      ['fairy_monolith', 'chalice_of_eternity'].includes(activationKeyOf(def))) {
      if (card.i === 77) {
        let remaining = 4;
        const stored = { ...card.stored };
        for (const element of ELEMENTS) {
          const removed = Math.min(stored[element] ?? 0, remaining);
          stored[element] = (stored[element] ?? 0) - removed; remaining -= removed;
        }
        costed = patchPlayer(costed, seat, (player) => ({
          played: player.played.map((item) => item.u === cardUid ? { ...item, stored } : item),
        }));
        const cards: CardRef[] = [];
        for (let i = 0; i < 4; i++) { const [s, c] = drawOne(costed); costed = s; if (c) cards.push(c); }
        request = { ...request, cards };
      }
      const cards = request.cards ?? [];
      return { ok: true, state: { ...costed, pendingCards: cards.length ? cards : null,
        pendingChoice: { kind: request.kind, key: activationKeyOf(def), choosingSeat: seat, cards,
          options: { ...request, keep: request.orderOnly ? cards.length : 1, cardUid, actId,
            ...(card.i === 53 ? { allowPartial: true, maxPerElement: card.stored } : {}),
            ...(card.i === 77 ? { discardRest: true } : {}),
          } },
      }, events: [] };
    }
    if (request.kind === 'card_pick') {
      const meNow = costed.players[seat];
      if (!meNow || meNow.hand.length === 0) {
        return fail('hand_empty', '手牌为空，无法选择召唤');
      }
      return {
        ok: true,
        state: {
          ...costed,
          pendingCards: [...meNow.hand],
          pendingChoice: {
            kind: 'card_pick',
            key: activationKeyOf(def),
            choosingSeat: seat,
            options: {
              title: request.title,
              label: request.label,
              actId: abilityKey ? `${cardUid}:${abilityKey}` : String(cardUid),
            },
          },
          log: pushLog(costed.log, 'activate', `${seatName(seat)} 激活「${def.nameZh}」`),
        },
        events: [],
      };
    }
    return {
      ok: true,
      state: {
        ...costed,
        pendingChoice: {
          kind: request.kind,
          key: activationKeyOf(def),
          choosingSeat: seat,
          options: {
            ...(request.kind === 'element_multi'
              ? { amount: request.amount, elements: request.elements }
              : { amount: request.amount }),
            title: request.title,
            label: request.label,
            cardUid,
            actId,
            ...('pay' in request && request.pay
              ? { mode: 'pay', then: 'pay_energy_reward', reward: request.reward }
              : {}),
            ...(request.kind === 'sacrifice_cards'
              ? {
                  remaining: request.amount,
                  chosen: [],
                  ...('source' in request && request.source ? { source: request.source } : {}),
                  ...('then' in request && request.then ? { then: request.then } : {}),
                }
              : {}),
          },
        },
        log: pushLog(
          costed.log,
          'activate',
          `${seatName(seat)} 激活「${def.nameZh}」`,
        ),
      },
      events: [],
    };
  }

  let next = applyActivationEffect(costed, seat, cardUid, activationKeyOf(def));
  next = markActivated(next, seat, actId);
  return {
    ok: true,
    state: {
      ...next,
      log: pushLog(next.log, 'activate', `${seatName(seat)} 激活「${def.nameZh}」`),
    },
    events: [],
  };
}

function resolveElementMulti(
  state: SeasonsState,
  seat: number,
  pending: SeasonsPendingChoiceState,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const entries = Array.isArray(pending.options.elements)
    ? (pending.options.elements as { element: Element; count: number }[])
    : [];
  const record = choice && typeof choice === 'object' && !Array.isArray(choice)
    ? choice as { elements?: unknown; paidSources?: SeasonsElementSource[] } : null;
  if (record?.paidSources !== undefined && !Array.isArray(record.paidSources)) return fail('invalid_source', '无效的元素槽选择');
  const list = record?.elements ?? choice;
  const values = Array.isArray(list)
    ? list.filter((item): item is Element => typeof item === 'string' && ELEMENTS.includes(item as Element))
    : [];
  if (!Array.isArray(list) || values.length !== list.length) {
    return fail('invalid_choice', '请提交能量类型列表');
  }
  const selected = [...new Set(values)];
  if (selected.length !== values.length) {
    return fail('invalid_choice', '同一种能量只能选择一次');
  }
  const available = new Map(entries.map((item) => [item.element, item.count]));
  if (selected.some((element) => !available.has(element))) {
    return fail('invalid_choice', '该元素没有可转换的能量');
  }
  if (selected.length !== available.size) {
    return fail('choice_amount_mismatch', '生命药剂必须晶化全部储备能量');
  }
  const me = state.players[seat];
  if (!me) {
    return fail('seat_not_found', '座位不存在');
  }
  let payer: SeasonsPlayerState = me;
  let count = 0;
  if (record?.paidSources) {
    const cost = Object.fromEntries(ELEMENTS.map((element) =>
      [element, selected.includes(element) ? available.get(element) ?? 0 : 0])) as Record<Element, number>;
    if (record.paidSources.length !== energySum(cost)) return fail('choice_amount_mismatch', '必须选择所选类型的全部元素');
    const payment = payElementSources(me, { ...cost, crystal: 0 }, record.paidSources, undefined, false);
    if (!payment.ok) return fail(payment.code, payment.message);
    payer = payment.player;
    count = payment.paid.length;
  } else {
  for (const element of selected) {
    const amount = available.get(element) ?? 0;
    if (amount <= 0) continue;
    const taken = takeElementEnergy(payer, element, amount);
    if (!taken) continue;
    payer = taken;
    count += amount;
  }
  }
  const crystals = count * 4;
  const actId =
    typeof pending.options.actId === 'string'
      ? pending.options.actId
      : String(pending.options.cardUid ?? 0);
  let next: SeasonsState = {
    ...state,
    players: state.players.map((player) =>
      player.seat === seat ? { ...payer, crystals: crystalsAfterGain(payer, crystals) } : player,
    ),
  };
  next = markActivated(next, seat, actId);
  const names = selected.map((element) => ELEMENT_NAME_ZH[element]).join('、') || '无';
  return {
    ok: true,
    state: {
      ...next,
      pendingChoice: null,
      log: pushLog(
        next.log,
        'effect',
        `生命药水：${names} 共 ${count} 个能量 → 水晶 +${crystals}`,
      ),
    },
    events: [],
  };
}

function resolveElementPick(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const raw =
    typeof choice === 'string'
      ? choice
      : choice && typeof choice === 'object' && 'element' in choice
        ? (choice as { element?: unknown }).element
        : undefined;
  if (typeof raw !== 'string' || !ELEMENTS.includes(raw as Element)) {
    return fail('invalid_choice', '请选择一种能量');
  }
  const element = raw as Element;
  const amount = typeof pending.options.amount === 'number' ? pending.options.amount : 1;
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const sources = choice && typeof choice === 'object' && Array.isArray((choice as { paidSources?: unknown }).paidSources)
    ? (choice as { paidSources: SeasonsElementSource[] }).paidSources : undefined;
  const sameAsEarth = winterStaffActive(state, me) &&
    ['balance_of_ishtar', 'estorian_harp'].includes(pending.key);
  const payment = sources ? payElementSources(me,
    { water: 0, air: 0, fire: 0, earth: 0, crystal: 0, [sameAsEarth ? 'earth' : element]: amount },
    sources, undefined, false, sameAsEarth) : null;
  if (payment && !payment.ok) return fail(payment.code, payment.message);
  const selectedPayer = payment?.ok ? payment.player : takeElementEnergy(me, element, amount);

  // 贪吃锅：放入 1 个能量；满 7 时牺牲、能量回储备并得 15 水晶。
  if (pending.key === 'glutton_cauldron') {
    const jarUid =
      typeof pending.options.cardUid === 'number' ? pending.options.cardUid : 0;
    const jar = me.played.find((item) => item.u === jarUid);
    if (!jar) return fail('card_not_in_play', '贪吃锅不在场上');
    const paid = selectedPayer;
    if (!paid) {
      return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足`);
    }
    let player: SeasonsPlayerState = {
      ...paid,
      played: paid.played.map((item) => {
        if (item.u !== jarUid) return item;
        const stored = { ...(item.stored ?? {}) };
        stored[element] = (stored[element] ?? 0) + 1;
        return { ...item, stored };
      }),
    };
    const updated = player.played.find((item) => item.u === jarUid);
    const storedTotal = ELEMENTS.reduce(
      (sum, key) => sum + (updated?.stored?.[key] ?? 0),
      0,
    );
    let next: SeasonsState = { ...state };
    let sacrificed = false;
    let returned: Partial<Record<Element, number>> | null = null;
    if (storedTotal >= 7) {
      const stored = updated?.stored ?? {};
      returned = stored;
      player = cardSacrificed(
        {
          ...player,
          played: player.played.filter((item) => item.u !== jarUid),
          crystals: crystalsAfterGain(player, 15),
        },
        jar,
      );
      const removed = { i: jar.i, u: jar.u };
      next = { ...state, discard: [...state.discard, removed] };
      sacrificed = true;
    }
    next = {
      ...next,
      players: state.players.map((item) =>
        item.seat === seat ? player : item,
      ),
      pendingChoice: null,
      log: pushLog(
        next.log,
        'effect',
        sacrificed
          ? `贪吃锅：${ELEMENT_NAME_ZH[element]}能量 +1，满 7 触发牺牲，水晶 +15`
          : `贪吃锅：${ELEMENT_NAME_ZH[element]}能量 +1`,
      ),
    };
    const actId =
      typeof pending.options.actId === 'string'
        ? pending.options.actId
        : String(jarUid);
    if (returned) next = addReserveEnergy(next, seat, returned, '贪吃锅返还能量');
    return { ok: true, state: markActivated(next, seat, actId), events: [] };
  }

  const paid = selectedPayer;
  if (!paid) {
    return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足（需要 ${amount}）`);
  }

  const cardUid = typeof pending.options.cardUid === 'number' ? pending.options.cardUid : 0;
  const card = paid.played.find((item) => item.u === cardUid);
  const def = card ? cardById(card.i) : undefined;
  if (!card || !def) return fail('card_not_in_play', '这张牌不在场上');

  let next: SeasonsState = {
    ...state,
    players: state.players.map((player) => (player.seat === seat ? paid : player)),
  };
  next = applyActivationEffect(next, seat, cardUid, pending.key, element);
  const actId =
    typeof pending.options.actId === 'string'
      ? pending.options.actId
      : String(cardUid);
  next = markActivated(next, seat, actId);
  return {
    ok: true,
    state: {
      ...next,
      pendingChoice: null,
      log: pushLog(
        next.log,
        'choice',
        `${seatName(seat)} 弃掉 ${amount} 个${ELEMENT_NAME_ZH[element]}`,
      ),
    },
    events: [],
  };
}

/* ------------------------------------------------------------------ */
/* 引擎                                                                */
/* ------------------------------------------------------------------ */

export const seasons: GameEngine<
  SeasonsState,
  SeasonsGameView,
  SeasonsAction,
  SeasonsOptions
> = {
  setup,

    reduce(state, seat, action, _ctx): ReduceResult<SeasonsState> {
    if (state.phase === 'ended') return fail('game_over', '这局已经结束了');
    if (!state.players[seat]) return fail('bad_seat', '座位不存在');
    state = clearStaleDiscard(state);
    if (
      state.pendingChoice &&
      action.type !== 'resolve-choice' &&
      action.type !== 'resign' &&
      action.type !== 'badge-keep' &&
      !(
        state.pendingChoice.key === 'die_draw' &&
        (action.type === 'end-turn' ||
          (action.type === 'use-badge' && action.badgeType === 4))
      )
    ) {
      return fail('pending_choice', '请先完成当前选择');
    }
    if (state.players[seat]?.badgeDraw && action.type !== 'badge-keep') {
      return fail('pending_badge', '请先选择保留的卡牌');
    }

    const result = (() => {
      switch (action.type) {
      case 'resign':
        return finish(state, resign(state, seat));
      case 'draft-pick':
        return finish(state, draftPick(state, seat, action.cardUid));
      case 'organize':
        return finish(state, organize(state, seat, action.cardUids));
      case 'organize-reset':
        return finish(state, organizeReset(state, seat));
      case 'draft-dice':
        return finish(state, draftDice(state, seat, action.dieIndex));
      case 'summon':
        return finish(
          state,
          summon(state, seat, action.cardUid, action.paidElements, action.paidSources),
        );
      case 'summon-otus':
        return finish(
          state,
          summon(
            state,
            seat,
            action.cardUid,
            action.paidElements,
            action.paidSources,
            undefined,
            true,
          ),
        );
      case 'resolve-choice':
        return finish(state, resolveChoice(state, seat, action.choice));
      case 'transmute':
        return finish(state, transmute(state, seat, action.element, action.paidSources));
      case 'end-turn':
        if (state.pendingChoice?.key === 'die_draw') {
          const dropped = state.pendingCards ?? [];
          const resumed = promoteQueued({
            ...state,
            pendingChoice: null,
            pendingCards: null,
            discard: [...state.discard, ...dropped],
            log: pushLog(state.log, 'effect', `${seatName(seat)} 放弃了骰面抽牌`),
          });
          if (resumed.pendingChoice) {
            return finish(resumed, { ok: true, state: resumed, events: [] });
          }
          return finish(resumed, endTurn(resumed, seat));
        }
        return finish(state, endTurn(state, seat));
      case 'activate':
        return finish(state, activate(state, seat, action.cardUid, action.abilityKey, undefined, action.paidSources));
      case 'use-badge':
        return finish(state, useBadge(state, seat, action));
      case 'badge-keep':
        return finish(state, keepBadge(state, seat, action.cardUid));
      default:
        return fail('not_implemented', '不支持的行动');
      }
    })();
    if (!result.ok) return result;
    return {
      ...result,
      state: { ...result.state, actionSeq: state.actionSeq + 1 },
    };
  },

  resignable(state, seat) {
    return (
      state.phase !== 'ended' &&
      state.players.length === 2 &&
      seat >= 0 &&
      seat < state.players.length
    );
  },

  view(state, viewerSeat): SeasonsGameView {
    const season = seasonView(state);
    const me = viewerSeat === null ? null : state.players[viewerSeat] ?? null;

    let myTurn = false;
    if (me && state.phase !== 'ended') {
      if (state.pendingChoice) {
        myTurn = state.pendingChoice.choosingSeat === me.seat;
      } else if (state.phase === 'draft') {
        myTurn = me.drafted.length === state.draftRound;
      } else if (state.phase === 'organize') {
        myTurn = !me.organizeDone;
      } else {
        myTurn =
          state.turnOwner === me.seat ||
          (state.turnOwner === null && state.currentPicker === me.seat);
      }
    }
    return {
      rulesVersion: state.rulesVersion,
      phase: state.phase,
      month: state.month,
      year: Math.min(3, Math.floor(state.month / 12) + 1),
      seasonIdx: state.seasonIdx,
      season,
      startPlayer: state.startPlayer,
      currentPicker: state.currentPicker,
      turnOwner: state.turnOwner,
      draftRound: state.draftRound,
      draftPickedThisRound: state.players
        .filter((player) => player.drafted.length > state.draftRound)
        .map((player) => player.seat),
      pickedThisSeason: [...state.pickedThisSeason],
      dice: dieViews(state, season),
      playerCount: state.players.length,
      players: state.players.map((player) => playerView(state, player, viewerSeat)),
      deckCount: state.deck.length,
      discardCount: state.discard.length,
      transmuteValues: ELEMENTS.map((element) => ({
        element,
        value: TRANSMUTE_VALUE[element][seasonIndexForMonth(state.month)] ?? 0,
      })),
      pendingChoice: state.pendingChoice
        ? state.pendingChoice.choosingSeat === viewerSeat
          ? {
              kind: state.pendingChoice.kind,
              key: state.pendingChoice.key,
              choosingSeat: state.pendingChoice.choosingSeat,
              options: state.pendingCards
                ? { ...state.pendingChoice.options, cards: state.pendingCards }
                : state.pendingChoice.options,
            }
          : {
              kind: state.pendingChoice.kind,
              key: state.pendingChoice.key,
              choosingSeat: state.pendingChoice.choosingSeat,
              // energy_swap 的当前储备与新获得属于私有信息，只发给应答者。
              options:
                state.pendingChoice.kind === 'energy_swap'
                  ? {
                      title: state.pendingChoice.options.title,
                      amount: state.pendingChoice.options.amount,
                      total: state.pendingChoice.options.total,
                      pool: state.pendingChoice.options.pool,
                    }
                  : state.pendingChoice.kind === 'energy_discard'
                    ? {
                        title: state.pendingChoice.options.title,
                        amount: state.pendingChoice.options.amount,
                      }
                    : state.pendingChoice.kind === 'branch' &&
                        state.pendingChoice.key === 'vampiric_crown'
                      ? {
                          title: state.pendingChoice.options.title,
                          branches: state.pendingChoice.options.branches,
                        }
                      : { title: '等待玩家完成选择' },
            }
        : null,
      pendingQueueCount: state.pendingQueue.length,
      myTurn,
      result: state.result,
      log: state.log.slice(-80),
      otusPool: state.otusPool ?? [],
      otusUsedThisRound: state.otusUsedThisRound ?? state.players.map(() => 0),
    };
  },

  finished(state) {
    return state.phase === 'ended';
  },

  winner(state) {
    return state.result?.winner ?? null;
  },

  turn(state) {
    if (state.phase !== 'play') return null;
    return state.turnOwner ?? state.currentPicker;
  },

  rankings(state) {
    if (state.phase !== 'ended') return [];
    const winner = state.result?.winner ?? null;
    const ranked = state.result?.players ?? [];
    // 有完整计分表时按总分降序，分数相同并列（competition ranking）。
    if (ranked.length > 0) {
      const bySeat = new Map(ranked.map((score) => [score.seat, score]));
      return state.players.map((player) => {
        const score = bySeat.get(player.seat);
        const rank = score ? ranked.filter((other) => other.score > score.score).length + 1 : 2;
        return { seat: player.seat, rank, score: score?.score };
      });
    }
    // 认输没有完整计分表，只按 winner 给出 1/2 名。
    return state.players.map((player) => ({
      seat: player.seat,
      rank: winner === null || player.seat === winner ? 1 : 2,
    }));
  },
};

/* ------------------------------------------------------------------ */
/* 调试/测试辅助                                                        */
/* ------------------------------------------------------------------ */

/** 当前季节索引（由 month 推导），供 Phase 2 使用。 */
export function seasonIndexForMonth(month: number): number {
  return Math.floor(month / MONTHS_PER_SEASON) % SEASONS_PER_YEAR;
}
