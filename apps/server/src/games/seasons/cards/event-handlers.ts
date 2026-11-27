import type { SeasonsCardDef } from '@bgx/protocol/games/seasons';
import type { CardInstance, SeasonsPlayerState, SeasonsState } from '../engine.js';
import { cardById } from './registry.js';
import { energySum } from '../rules/play.js';
import { printedCardType } from '../rules/state.js';

export type TurnEndHandler = (
  context: EventContext,
  card: CardInstance,
) => TurnEndResult;

export interface TurnEndResult {
  crystals?: number;
  energy?: number;
  /** 修改对手水晶，返回完整玩家列表。 */
  players?: SeasonsPlayerState[];
  /** 先存档，再由引擎暂停并让玩家做一次选择。 */
  pending?: {
    kind: string;
    key: string;
    options: Record<string, unknown>;
  };
  /** 条件不满足时本卡失效。 */
  sacrifice?: boolean;
  log?: string;
}

export type SeasonChangeHandler = (
  context: EventContext,
  card: CardInstance,
) => SeasonChangeResult;

export interface SeasonChangeResult {
  selfCrystals?: number;
  opponentCrystals?: number;
  pending?: {
    kind: string;
    key: string;
    options: Record<string, unknown>;
  };
  log?: string;
}

export interface ScoreContext {
  player: SeasonsPlayerState;
  players: readonly SeasonsPlayerState[];
  reserveTotal: (player: SeasonsPlayerState) => number;
}

export type ScoreHandler = (
  context: ScoreContext,
  def: SeasonsCardDef,
  card: CardInstance,
) => number;

export interface EventContext {
  state: SeasonsState;
  seat: number;
  me: SeasonsPlayerState;
  reserveTotal: (player: SeasonsPlayerState) => number;
}

function countType(player: SeasonsPlayerState, type: string): number {
  return player.played.filter((card) => printedCardType(player, card) === type).length;
}

function hasMoreType(
  player: SeasonsPlayerState,
  rivals: readonly SeasonsPlayerState[],
  type: string,
): boolean {
  const own = countType(player, type);
  return own > 0 && rivals.some((rival) => own > countType(rival, type));
}

export const TURN_END_HANDLERS: Readonly<Record<string, TurnEndHandler>> = {
  cursed_relic: (context) => {
    const lost = Math.min(3, context.me.crystals);
    return lost > 0
      ? { crystals: -lost, log: '「奥尼斯的受诅咒灵魂」：水晶 -3' }
      : {};
  },

  turn_flat_reward: (_context, card) => {
    const gain = cardById(card.i)?.effect?.crystals ?? 0;
    return gain > 0
      ? {
          crystals: gain,
          log: `「${cardById(card.i)?.nameZh ?? '?'}」：水晶 +${gain}`,
        }
      : {};
  },

  turn_condition_reward: (context, card) => {
    const me = context.me;
    const def = cardById(card.i);
    const effect = def?.effect;
    if (!def || !effect) return {};
    let ok = false;
    if (typeof effect.minCards === 'number') ok = me.played.length >= effect.minCards;
    else if (typeof effect.minMagic === 'number') ok = countType(me, 'magic_item') >= effect.minMagic;
    else if (typeof effect.minFamiliar === 'number') {
      ok = countType(me, 'familiar') >= effect.minFamiliar;
    } else if (typeof effect.maxReserve === 'number') {
      ok = context.reserveTotal(me) <= effect.maxReserve;
    }
    if (!ok) return {};
    const crystals = effect.crystals ?? 0;
    const energy = effect.energy ?? 0;
    return {
      crystals,
      energy,
      log: `「${def.nameZh}」：${
        [crystals > 0 ? `水晶 +${crystals}` : '', energy > 0 ? `能量 +${energy}` : '']
          .filter(Boolean)
          .join('，')
      }`,
    };
  },

  titus: (context) => {
    const opponents = context.state.players.filter((player) => player.seat !== context.seat);
    if (opponents.some((player) => player.crystals <= 0)) {
      return {
        sacrifice: true,
        log: '深凝视的提图斯：对手无法支付，被牺牲',
      };
    }
    let crystals = 0;
    const players = context.state.players.map((player) => {
      if (player.seat === context.seat) return player;
      crystals += 1;
      return { ...player, crystals: player.crystals - 1 };
    });
    return {
      crystals,
      players,
      log: '深凝视的提图斯：每位对手给 1 水晶',
    };
  },

  // --- 魔法王国 / 命运之路：回合结束与换季 ---------------------------------

  /** 51 邪神之心：回合末只把牌上封存的土元素交回储备。 */
  heart_of_argos: () => ({}),

  /** 52 丰沛号角：必须弃 1 能量；土元素（或凛冬权杖生效时）给 5 水晶。 */
  horn_of_plenty: (context) => {
    if (energySum(context.me.energies) === 0) {
      return { log: '丰沛号角：没有能量可弃，未获得水晶' };
    }
    return {
      pending: {
        kind: 'element_pick',
        key: 'horn_of_plenty',
        options: {
          title: '丰沛号角：选择弃掉 1 个能量',
          amount: 1,
          label: '弃掉',
        },
      },
    };
  },

  /** 56 麦瑟迪的魔灯：固定 3 水晶，储备上限已由卡牌能力声明。 */
  mesodaes_lantern: () => ({ crystals: 3, log: '麦瑟迪的魔灯：水晶 +3' }),

  /** 75 艾塞尔的喷泉：本地第六次修订牌表 D12 的最新值为 3 水晶。 */
  ethiels_fountain: (context) =>
    context.me.hand.length === 0
      ? { crystals: 3, log: '艾塞尔的喷泉：没有手牌，水晶 +3' }
      : {},

  /** 53 仙女巨石：回合末可选把储备区 1 个能量放到牌上。 */
  fairy_monolith: (context, card) => {
    if (energySum(context.me.energies) === 0) return {};
    return {
      pending: {
        kind: 'element_pick',
        key: 'fairy_monolith_store',
        options: {
          title: '仙女巨石：选择 1 个能量放到牌上（可放弃）',
          amount: 1,
          label: '放上',
          cardUid: card.u,
          optional: true,
        },
      },
    };
  },

  /** 77 永恒圣杯：回合末可选把 1 个储备能量存到杯上。 */
  chalice_of_eternity: (context, card) => {
    if (energySum(context.me.energies) === 0) return {};
    return {
      pending: {
        kind: 'element_pick',
        key: 'chalice_of_eternity_store',
        options: {
          title: '永恒圣杯：选择 1 个能量放在杯上（可放弃）',
          amount: 1,
          label: '放上',
          cardUid: card.u,
          optional: true,
        },
      },
    };
  },

  /** 76 科洛夫的日晷：回合末可重骰尚未被任何人选择的季节骰。 */
  dial_of_colof: (context, card) => {
    const me = context.me;
    const rivals = context.state.players.filter((player) => player.seat !== context.seat);
    if (!rivals.some((rival) => me.played.length > rival.played.length)) {
      return {};
    }
    const unpicked = context.state.season?.dice.filter((die) => die.pickedBy === null) ?? [];
    if (unpicked.length === 0) return {};
    return {
      pending: {
        kind: 'branch',
        key: 'dial_of_colof',
        options: {
          title: '科洛夫的日晷：重骰本回合尚未被选取的季节骰',
          cardUid: card.u,
          branches: [
            { id: 'reroll', label: `重骰剩余的 ${unpicked.length} 颗骰子` },
            { id: 'skip', label: '不重骰' },
          ],
        },
      },
    };
  },

  /** 84 食肉树：只有储备为空时查看弃牌堆顶，然后二选一。 */
  carnivora_strombosea: (context) => {
    if (context.reserveTotal(context.me) !== 0) return {};
    const top = context.state.discard[context.state.discard.length - 1];
    if (!top) return {};
    return {
      pending: {
        kind: 'branch',
        key: 'carnivora_strombosea',
        options: {
          title: `食肉树：弃牌堆顶是「${cardById(top.i)?.nameZh ?? top.i}」`,
          card: top,
          branches: [
            { id: 'deck', label: '放回摸牌堆顶' },
            { id: 'hand', label: '加入手牌，召唤等级 -1' },
          ],
        },
      },
    };
  },
};

/**
 * Round-end effects run only after every seat has completed its action for
 * the current round. Keeping this separate from TURN_END_HANDLERS prevents a
 * player who ends first from scoring before the remaining players act.
 */
export const ROUND_END_HANDLERS: Readonly<Record<string, TurnEndHandler>> = {
  wondrous_chest: (context) =>
    context.reserveTotal(context.me) >= 4
      ? { crystals: 3, log: '奇迹宝箱：水晶 +3' }
      : {},
};

export const SEASON_CHANGE_HANDLERS: Readonly<Record<string, SeasonChangeHandler>> = {
  /** 57 女神雕像：换季时二选一。 */
  statue_of_eolis: () => ({
    pending: {
      kind: 'branch',
      key: 'statue_of_eolis',
      options: {
        title: '女神雕像：选择获得 1 个能量，或 2 水晶',
        branches: [
          { id: 'energy', label: '获得 1 个任意能量' },
          { id: 'crystals', label: '获得 2 水晶' },
        ],
      },
    },
  }),

  /** 82 时光魔环：本回合季节指示物前进至少 3 格时可二选一。 */
  chrono_ring: (context) => {
    const moved = context.state.monthStepsThisRound?.[context.seat] ?? 0;
    if (moved < 3) return {};
    return {
      pending: {
        kind: 'branch',
        key: 'chrono_ring',
        options: {
          title: '时光魔环：本回合前进至少 3 格，选择奖励',
          branches: [
            { id: 'crystals', label: '获得 4 水晶' },
            { id: 'energy', label: '获得 1 个任意能量' },
          ],
        },
      },
    };
  },
  figrim: (context) => {
    let gained = 0;
    for (const other of context.state.players) {
      if (other.seat === context.seat) continue;
      if (other.crystals > 0) gained += 1;
    }
    return {
      selfCrystals: gained,
      opponentCrystals: 1,
      log: gained > 0 ? `贪婪的菲格里姆：水晶 +${gained}` : undefined,
    };
  },

  season_opponent_tax: (context, card) => {
    const def = cardById(card.i);
    const amount = typeof def?.effect?.amount === 'number' ? def.effect.amount : 1;
    let gained = 0;
    for (const other of context.state.players) {
      if (other.seat !== context.seat) gained += Math.min(amount, other.crystals);
    }
    return {
      selfCrystals: gained,
      opponentCrystals: amount,
      log: gained > 0 ? `「${def?.nameZh ?? '?'}」：每位对手给 ${amount} 水晶` : undefined,
    };
  },
};

export const SCORE_HANDLERS: Readonly<Record<string, ScoreHandler>> = {
  ragfields_helm: (context) => {
    const opponents = context.players.filter((other) => other.seat !== context.player.seat);
    return opponents.length > 0 &&
      opponents.every((other) => other.played.length < context.player.played.length)
      ? 20
      : 0;
  },

  score_per_energy: (context, def) =>
    context.reserveTotal(context.player) * (def.effect?.amount ?? 0),

  sealed_chest: (context) =>
    context.player.played.some((card) => printedCardType(context.player, card) === 'familiar') ? 0 : 20,

  jewel_of_the_ancients: (context, def, card) => {
    const mark = context.player.cardMarks?.[card.u];
    const jewels = mark?.jewels ?? 0;
    return jewels >= 3 ? 35 : -10;
  },

  // 其它 score 卡（如简单的卡面分）已在 finishGame 的 cardPoints 中统一计算，
  // 不能重复登记；未在此表登记的 score key 视为没有额外水晶。
};

export function handlerKey(def: SeasonsCardDef): string {
  return def.effect ? (def.effect.typeKey ?? def.effect.type) : '';
}
