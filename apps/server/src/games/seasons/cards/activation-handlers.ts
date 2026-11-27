import {
  ELEMENTS,
  type Element,
  type SeasonsCardDef,
  type SeasonsCardEffect,
} from '@bgx/protocol/games/seasons';
import type { CardRef } from '@bgx/protocol/games/seasons';
import type { CardInstance, SeasonsPlayerState, SeasonsState } from '../engine.js';
import { abilityAmount } from '../rules/play.js';
import { TRANSMUTE_VALUE } from '../rules/const.js';
import { crystalsAfterGain, drawToHand, patchPlayer, printedCardType, pushLog, winterStaffActive } from '../rules/state.js';
import { cardById } from './registry.js';

export interface ActivationRequest {
  kind:
    | 'element_pick'
    | 'element_alloc'
    | 'sacrifice_cards'
    | 'card_pick'
    | 'card_list'
    | 'element_multi'
    | 'branch';
  amount: number;
  title: string;
  label: string;
  elements?: { element: Element; count: number }[];
  branches?: { id: string; label: string; enabled?: boolean }[];
  cards?: CardRef[];
  orderOnly?: boolean;
  bottomRest?: boolean;
  source?: 'hand_or_play';
  then?: 'necrotic_energy';
  pay?: boolean;
  reward?: {
    crystals?: number;
    energy?: number;
    draw?: number;
    opponentCrystals?: number;
  };
}

export interface ActivationContext {
  state: SeasonsState;
  seat: number;
  cardUid: number;
  card: CardInstance;
  def: SeasonsCardDef;
  key: string;
  abilityKey?: string;
}

/**
 * 激活效果处理器。每种卡只负责自己的规则；支付、弹窗、行动权与
 * 「本回合已激活」仍由引擎统一处理。
 */
export interface ActivationHandler {
  request: (context: ActivationContext) => ActivationRequest | null | 'unimplemented';
  resolve: (
    context: ActivationContext,
    element?: Element,
    choice?: unknown,
  ) => SeasonsState;
  /** 激活时先牺牲本卡。 */
  sacrifice?: boolean;
  /** 光之树 A 的水晶前置费用。 */
  crystalCost?: number;
  /** 由主引擎完成最终结算（多步选择、目标选择等）。 */
  deferred?: boolean;
  /** 可在激活前直接判定不满足条件。 */
  canRequest?: (context: ActivationContext) => boolean;
  /** A null request is a rule rejection rather than a no-effect activation. */
  precheck?: boolean;
}

export function keyOf(def: SeasonsCardDef): string {
  return def.effect ? (def.effect.typeKey ?? def.effect.type) : '';
}

export function countPlayedType(player: SeasonsPlayerState, type: string): number {
  return player.played.filter((card) => printedCardType(player, card) === type).length;
}

function reserveElementCount(player: SeasonsPlayerState, element: Element): number {
  let total = player.energies[element] ?? 0;
  for (const card of player.played) {
    const def = cardById(card.i);
    if (!def || !card.stored) continue;
    if (player.cardMarks?.[card.u]?.lockSource ||
      def.effect?.abilities?.some((ability) => ability.kind === 'sealed_energy')) continue;
    if (!def.effect?.abilities?.some((ability) => ability.kind === 'reserve_slot')) continue;
    total += card.stored[element] ?? 0;
  }
  return total;
}

function elementAlloc(amount: number, title: string, label = '获得'): ActivationRequest {
  return { kind: 'element_alloc', amount, title, label };
}

function elementPick(amount: number, title: string, label: string): ActivationRequest {
  return { kind: 'element_pick', amount, title, label };
}

const POTION_HANDLERS: Readonly<Record<string, ActivationHandler>> = {
  potion_knowledge: {
    sacrifice: true,
    request: () => elementAlloc(5, '选择获得 5 个能量'),
    resolve: (context) => {
      const next = patchPlayer(context.state, context.seat, (player) => ({
        played: player.played.filter((card) => card.u !== context.cardUid),
      }));
      return next;
    },
  },
  necrotic_kriss: {
    request: () => ({
      kind: 'sacrifice_cards',
      amount: 1,
      title: '弃掉 1 张手牌随从，或牺牲 1 张在场随从',
      label: '选择',
      source: 'hand_or_play',
      then: 'necrotic_energy',
    }),
    resolve: (context) => context.state,
  },
  potion_life: {
    sacrifice: true,
    request: (context) => {
      const me = context.state.players[context.seat];
      const elements = (['water', 'air', 'fire', 'earth'] as const)
        .map((element) => ({
          element,
          count: me ? reserveElementCount(me, element) : 0,
        }))
        .filter((item) => item.count > 0);
      return {
        kind: 'element_multi',
        amount: elements.reduce((sum, item) => sum + item.count, 0),
        elements,
        title: '选择全部储备能量，每个元素晶化为 4 水晶',
        label: '转换',
      };
    },
    resolve: (context) => {
      const next = patchPlayer(context.state, context.seat, (player) => ({
        played: player.played.filter((card) => card.u !== context.cardUid),
        energies: { water: 0, air: 0, fire: 0, earth: 0 },
      }));
      return next;
    },
  },
  potion_dreams: {
    sacrifice: true,
    request: () => ({
      kind: 'card_pick',
      amount: 1,
      title: '选择要免费召唤的手牌',
      label: '召唤',
    }),
    resolve: (context) => context.state,
  },
  potion_power: {
    sacrifice: true,
    request: () => null,
    resolve: (context) => {
      const next = patchPlayer(context.state, context.seat, (player) => ({
        gauge: player.gauge + 2,
      }));
      return drawToHand(next, context.seat, 1);
    },
  },

  /** 61 复活药剂：弃牌堆顶 5 选 1，其余沉底。 */
  potion_of_resurrection: {
    sacrifice: true,
    request: (context) => {
      const cards = context.state.discard.filter((card) => card.u !== context.cardUid).slice(-5).reverse();
      if (cards.length === 0) return null;
      return {
        kind: 'card_pick',
        amount: 1,
        title: '复活药剂：从弃牌堆顶 5 张中选择 1 张加入手牌',
        label: '加入手牌',
        cards,
        bottomRest: true,
      };
    },
    resolve: (context) => context.state,
  },

  /** 66 神秘望远镜：支付 2 水晶，查看牌堆顶 3 张并调整顺序。 */
  arcane_telescope: {
    crystalCost: 2,
    request: (context) => ({
      kind: 'card_list',
      amount: Math.min(3, context.state.deck.length),
      title: '神秘望远镜：依次选择牌堆顶的顺序',
      label: '确认顺序',
      cards: context.state.deck.slice(-3).reverse(),
      orderOnly: true,
    }),
    resolve: (context) => context.state,
  },

  /** 74 远古药剂：牺牲后从四个效果中选两种。 */
  potion_of_the_ancients: {
    sacrifice: true,
    request: () => ({
      kind: 'branch',
      amount: 2,
      title: '远古药剂：选择两种效果',
      label: '确认',
      branches: [
        { id: 'transmute', label: '储备能量全部晶化，每个 4 水晶' },
        { id: 'draw', label: '抽 2 张，保留 1 张' },
        { id: 'gauge', label: '召唤等级 +2' },
        { id: 'energy', label: '获得 4 个任意能量' },
      ],
    }),
    resolve: (context) => context.state,
  },

  /** 78 凛冬权杖：弃手牌或牺牲一张在场魔器，获得 3 个任意能量。 */
  staff_of_winter: {
    request: (context) => {
      const me = context.state.players[context.seat];
      if (!me) return null;
      const cards = [...me.hand.filter((card) => cardById(card.i)?.type === 'magic_item'),
        ...me.played.filter((card) => card.i === 63)];
      const hasCards = cards.length > 0;
      if (!hasCards) return null;
      return {
        kind: 'card_pick',
        amount: 1,
        title: '凛冬权杖：弃一张手牌，或牺牲一张魔器',
        label: '确认',
        cards,
      };
    },
    resolve: (context) => context.state,
  },

  /** 67 远古鹰隼：牺牲自身，所有对手 -1 等级，自己 +6 水晶。 */
  argos_hawk: {
    sacrifice: true,
    request: () => null,
    resolve: (context) => {
      const players = context.state.players.map((player) => {
        if (player.seat === context.seat) return player;
        return { ...player, gauge: Math.max(0, player.gauge - 1), crystals: crystalsAfterGain(player, 6) };
      });
      return {
        ...context.state,
        players,
        log: pushLog(context.state.log, 'effect', '远古鹰隼：对手召唤等级 -1，水晶 +6'),
      };
    },
  },

  /** 72 熔岩核：牺牲自身，获得 3 火。 */
  magma_core: {
    sacrifice: true,
    request: () => null,
    resolve: (context) => {
      const next = patchPlayer(context.state, context.seat, (player) => ({
        energies: {
          ...player.energies,
          fire: player.energies.fire + 3,
        },
      }));
      return { ...next, log: pushLog(next.log, 'effect', '熔岩核：获得 3 火元素') };
    },
  },
};

export const ACTIVATION_HANDLERS: Readonly<Record<string, ActivationHandler>> = {
  ...POTION_HANDLERS,
  fairy_monolith: {
    deferred: true,
    request: (context) => ({
      kind: 'element_alloc', amount: Object.values(context.card.stored ?? {}).reduce((a, b) => a + (b ?? 0), 0),
      title: '选择从仙女巨石取回的能量', label: '取回',
    }),
    resolve: (context) => context.state,
  },
  chalice_of_eternity: {
    deferred: true,
    request: () => ({ kind: 'card_pick', amount: 1, title: '永恒圣杯：免费召唤一张牌', label: '召唤' }),
    resolve: (context) => context.state,
  },

  per_familiar_crystal: {
    request: () => null,
    resolve: (context) => {
      const me = context.state.players[context.seat];
      const amount = me ? countPlayedType(me, 'familiar') : 0;
      const next = patchPlayer(context.state, context.seat, (player) => ({
        crystals: player.crystals + amount,
      }));
      return {
        ...next,
        log: pushLog(next.log, 'effect', `随从偶像：水晶 +${amount}`),
      };
    },
  },

  balance_of_ishtar: {
    request: (context) => {
      const me = context.state.players[context.seat];
      if (
        !me ||
        !(winterStaffActive(context.state, me)
          ? ELEMENTS.reduce((sum, element) => sum + reserveElementCount(me, element), 0) >= 3
          : ELEMENTS.some((element) => reserveElementCount(me, element) >= 3))
      ) {
        return 'unimplemented';
      }
      return elementPick(3, '选择弃掉 3 个相同能量', '弃掉');
    },
    resolve: (context) => {
      const next = patchPlayer(context.state, context.seat, (player) => ({
        crystals: player.crystals + 9,
      }));
      return {
        ...next,
        log: pushLog(next.log, 'effect', '伊什塔尔天平：水晶 +9'),
      };
    },
  },

  eolis_replicator: {
    deferred: true,
    canRequest: (context) => {
      const me = context.state.players[context.seat];
      return Boolean(
        me &&
          me.gauge > me.played.length &&
          (context.state.replicaDeck ?? 10) > 0 &&
          reserveElementCount(me, 'water') >= 1,
      );
    },
    request: (context) => {
      const me = context.state.players[context.seat];
      if (!me) return 'unimplemented';
      if (reserveElementCount(me, 'water') < 1) return 'unimplemented';
      return {
        kind: 'element_pick',
        amount: 1,
        title: '伊欧的复制仪：弃掉 1 个水元素，生成复制魔法牌',
        label: '支付',
      };
    },
    resolve: (context) => context.state,
  },

  ios_minion: {
    deferred: true,
    canRequest: (context) => {
      const me = context.state.players[context.seat];
      return Boolean(me && reserveElementCount(me, 'air') >= 1);
    },
    request: () => {
      return {
        kind: 'branch',
        amount: 1,
        title: '伊欧的爪牙：弃掉 1 个风元素并传给左手玩家',
        label: '传递',
        branches: [{ id: 'transfer', label: '传递给左手玩家' }],
      };
    },
    resolve: (context) => context.state,
  },

  kairn: {
    request: () => elementPick(1, '选择弃掉 1 个能量', '弃掉'),
    resolve: (context) => {
      const players = context.state.players.map((player) =>
        player.seat === context.seat
          ? player
          : { ...player, crystals: Math.max(0, player.crystals - 4) },
      );
      return {
        ...context.state,
        players,
        log: pushLog(context.state.log, 'effect', '毁灭者凯恩：每位对手水晶 -4'),
      };
    },
  },

  tree_of_light: {
    crystalCost: 0,
    request: (context) => {
      if (context.abilityKey === 'crystal_to_energy') {
        return elementAlloc(1, '选择获得 1 个能量');
      }
      if (context.abilityKey === 'energy_to_crystal') {
        return elementPick(1, '选择要转换的 1 个能量', '转换');
      }
      return 'unimplemented';
    },
    resolve: (context, element) => {
      if (!element) return context.state;
      const bonus = (context.state.players[context.seat]?.played ?? []).reduce(
        (total, card) => {
          const def = cardById(card.i);
          return total + (def ? abilityAmount(def, 'transmute_bonus') : 0);
        },
        0,
      );
      const season = Math.floor(context.state.month / 3) % 4;
      const value = TRANSMUTE_VALUE[element][season] + bonus;
      const next = patchPlayer(context.state, context.seat, (player) => ({
        crystals: player.crystals + value,
      }));
      return {
        ...next,
        log: pushLog(next.log, 'effect', `光之树：转化能量 → 水晶 +${value}`),
      };
    },
  },

  pay_energy_reward: {
    request: (context) => {
      const effect = context.def.effect as SeasonsCardEffect;
      const cost = typeof effect.cost === 'number' ? effect.cost : 1;
      return {
        ...elementAlloc(cost, `弃 ${cost} 个任意能量`, '支付'),
        pay: true,
        reward: {
          crystals: effect.crystals,
          energy: effect.energy,
          draw: effect.draw,
          opponentCrystals: effect.opponentCrystals,
        },
      };
    },
    resolve: (context) => context.state,
  },

  cursed_relic: {
    request: () => null,
    resolve: (context) => {
      const targetSeat = (context.seat + 1) % context.state.players.length;
      const bonus = abilityAmount(context.def, 'max_energy_plus');
      const players = context.state.players.map((player) => {
        if (player.seat === context.seat) {
          return {
            ...player,
            played: player.played.filter((item) => item.u !== context.cardUid),
            maxEnergy: Math.max(0, player.maxEnergy - bonus),
          };
        }
        if (player.seat === targetSeat) {
          return {
            ...player,
            played: [...player.played, { i: context.card.i, u: context.card.u }],
            maxEnergy: player.maxEnergy + bonus,
          };
        }
        return player;
      });
      return {
        ...context.state,
        players,
        log: pushLog(
          context.state.log,
          'effect',
          '「奥尼斯的受诅咒灵魂」控制权转移给下一位玩家',
        ),
      };
    },
  },

  // --- 扩展包：自动激活 -------------------------------------------------------
  estorian_harp: {
    canRequest: (context) => {
      const me = context.state.players[context.seat];
      return Boolean(me && (winterStaffActive(context.state, me)
        ? ELEMENTS.reduce((sum, element) => sum + reserveElementCount(me, element), 0) >= 2
        : ELEMENTS.some((element) => reserveElementCount(me, element) >= 2)));
    },
    request: () => {
      return {
        kind: 'element_pick',
        amount: 2,
        title: '伊斯塔的竖琴：选择 2 个相同能量',
        label: '支付',
        pay: true,
        reward: {
          crystals: 3,
          energy: 0,
        },
      };
    },
    resolve: (context) => {
      const next = patchPlayer(context.state, context.seat, (player) => ({
        gauge: player.gauge + 1,
        crystals: player.crystals + 3,
      }));
      return {
        ...next,
        log: pushLog(next.log, 'effect', '伊斯塔的竖琴：召唤等级 +1，水晶 +3'),
      };
    },
  },

  dragonsoul: {
    deferred: true,
    request: (context) => {
      const me = context.state.players[context.seat];
      if (!me || me.crystals < 1) return 'unimplemented';
      const targets = me.played.filter(
        (card) =>
          card.u !== context.cardUid &&
          me.activatedThisTurn.some(
            (key) => key === String(card.u) || key.startsWith(`${card.u}:`),
          ),
      );
      if (targets.length === 0) return 'unimplemented';
      return {
        kind: 'card_pick',
        amount: 1,
        title: '龙魂：选择一张本回合已使用的其他牌重置',
        label: '重置',
        cards: targets,
      };
    },
    resolve: (context) => context.state,
  },

  // 需要先查看牌堆顶或进行多步选择，由引擎保留专门的状态机。
  crystal_orb: {
    deferred: true,
    request: () => null,
    resolve: (context) => context.state,
  },
  mirror_of_seasons: {
    deferred: true,
    request: () => null,
    resolve: (context) => context.state,
  },
  glutton_cauldron: {
    deferred: true,
    canRequest: (context) => {
      const me = context.state.players[context.seat];
      if (!me) return false;
      return (['water', 'air', 'fire', 'earth'] as const).some(
        (element) => reserveElementCount(me, element) > 0,
      );
    },
    request: () => elementPick(1, '选择放入贪吃锅的 1 个能量', '放入'),
    resolve: (context) => context.state,
  },
  dragon_skull: {
    deferred: true,
    request: () => ({
      kind: 'sacrifice_cards',
      amount: 3,
      title: '选择要牺牲的在场卡（共 3 张）',
      label: '牺牲',
    }),
    resolve: (context) => context.state,
  },
};

export function activationHandlerOf(def: SeasonsCardDef): ActivationHandler | undefined {
  return ACTIVATION_HANDLERS[keyOf(def)];
}

export function activationNeedsChoice(def: SeasonsCardDef): boolean {
  return activationHandlerOf(def) !== undefined;
}
