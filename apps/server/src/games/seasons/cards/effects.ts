import type {
  CardRef,
  Element,
  SeasonsCardDef,
  SeasonsCardEffect,
} from '@bgx/protocol/games/seasons';
import { ELEMENTS } from '@bgx/protocol/games/seasons';
import type { CardInstance, SeasonsState } from '../engine.js';
import { addEnergyCapped, ELEMENT_NAME_ZH, energySum } from '../rules/play.js';
import { drawOne, drawToHand, patchPlayer, printedCardType, pushLog, seatName } from '../rules/state.js';
import { cardById } from './registry.js';

/**
 * 召唤时效果注册表。
 *
 * 只收「不需要玩家选择」的效果；需要 choice 的效果（抽 N 留 1、选能量、
 * 牺牲/回手等）留给 T2.2b-2 与 T3.4 的弹窗流程，未实现前 summon 会先拒绝，
 * 避免扣完费用才发现效果无法执行。
 */
export type SummonEffectHandler = (
  state: SeasonsState,
  seat: number,
  card: CardInstance,
  effect: SeasonsCardEffect,
) => SeasonsState;

function nameOf(card: CardInstance): string {
  return cardById(card.i)?.nameZh ?? `#${card.i}`;
}

function logEffect(
  state: SeasonsState,
  seat: number,
  card: CardInstance,
  detail: string,
): SeasonsState {
  return {
    ...state,
    log: pushLog(state.log, 'effect', `${seatName(seat)}「${nameOf(card)}」：${detail}`),
  };
}

/** 卡牌声明里与 on_summon 相关的效果（triggers 含 on_summon 或以 on_summon 为主触发）。 */
export function summonEffectOf(def: SeasonsCardDef): SeasonsCardEffect | null {
  const effect = def.effect;
  if (!effect) return null;
  const triggers = effect.triggers ?? [];
  if (effect.trigger !== 'on_summon' && !triggers.includes('on_summon')) return null;
  return effect;
}

export function summonEffectKey(effect: SeasonsCardEffect): string {
  return effect.typeKey ?? effect.type;
}

export const SUMMON_EFFECTS: Readonly<Record<string, SummonEffectHandler>> = {
  per_familiar_crystal: (state, seat, card) => logEffect(
    patchPlayer(state, seat, (player) => ({ crystals: player.crystals + 10 })),
    seat, card, '水晶 +10',
  ),
  /** 85 心灵囚笼：牌面保留一个陷阱标记，拦截下一次召唤。 */
  urmian_psychic_cage: (state, seat, card) => {
    const next = patchPlayer(state, seat, (player) => ({
      cardMarks: {
        ...(player.cardMarks ?? {}),
        [card.u]: { ...(player.cardMarks?.[card.u] ?? {}), trapArmed: true },
      },
    }));
    return logEffect(next, seat, card, '布置陷阱标记');
  },

  /** 89 猫头鹰贤者：每个在场玩家各贡献一张牌组成中央候选区。 */
  otus_the_oracle: (state, seat, card) => {
    const pool: CardRef[] = [];
    let next = state;
    for (let index = 0; index < state.players.length; index += 1) {
      const [drawnState, drawn] = drawOne(next);
      next = drawnState;
      if (drawn) pool.push(drawn);
    }
    if (pool.length === 0) return state;
    return logEffect(
      { ...next, otusPool: pool, otusUsed: [] },
      seat,
      card,
      `展示 ${pool.length} 张中央候选牌`,
    );
  },

  // 神圣圣杯（召唤位不足）：抽 4 张全部弃掉。
  divine_chalice: (state, seat, card) => {
    const me = state.players[seat];
    if (!me || me.gauge > me.played.length) return state;
    const drawn: CardRef[] = [];
    let next = state;
    for (let i = 0; i < 4; i++) {
      const [drawnState, top] = drawOne(next);
      next = drawnState;
      if (top) drawn.push(top);
    }
    if (drawn.length === 0) return state;
    return logEffect(
      {
        ...next,
        discard: [...next.discard, ...drawn],
      },
      seat,
      card,
      `召唤位不足，抽 ${drawn.length} 张并全部弃掉`,
    );
  },

  // 空气护符：召唤计量条前进 N 格
  summon_gauge: (state, seat, _card, effect) => {
    const amount = effect.amount ?? 0;
    if (amount <= 0) return state;
    return patchPlayer(state, seat, (player) => ({ gauge: player.gauge + amount }));
  },

  // 大地护符 / 水晶类：水晶 +N
  gain_crystals: (state, seat, _card, effect) => {
    const amount = effect.amount ?? 0;
    if (amount <= 0) return state;
    return patchPlayer(state, seat, (player) => ({ crystals: player.crystals + amount }));
  },

  // 伟大权杖：每有 1 张其他魔法物品在场，水晶 +N
  per_magic_item_crystal: (state, seat, card, effect) => {
    const amount = effect.amount ?? 0;
    const count = (state.players[seat]?.played ?? []).filter(
      (item) =>
        item.u !== card.u && printedCardType(state.players[seat]!, item) === 'magic_item',
    ).length;
    if (amount <= 0 || count === 0) return state;
    const gained = amount * count;
    const next = patchPlayer(state, seat, (player) => ({
      crystals: player.crystals + gained,
    }));
    return logEffect(next, seat, card, `水晶 +${gained}（${count} 张魔法物品）`);
  },

  // 阿尔戈斯恶魔：每位对手召唤等级 -1 并抽 1 张
  demon_of_argos: (state, seat, card) => {
    let next = state;
    for (const opponent of state.players) {
      if (opponent.seat === seat) continue;
      next = patchPlayer(next, opponent.seat, (player) => ({
        gauge: Math.max(0, player.gauge - 1),
      }));
      next = drawToHand(next, opponent.seat, 1);
    }
    return logEffect(next, seat, card, '所有对手召唤等级 -1 并抽 1 张');
  },

  // 空气元素：所有对手的储备能量转为空气能量（受上限截断）
  air_elemental: (state, seat, card) => {
    let next = state;
    for (const opponent of state.players) {
      if (opponent.seat === seat) continue;
      const usable = (item: CardInstance) => !opponent.cardMarks?.[item.u]?.lockSource &&
        cardById(item.i)?.effect?.abilities?.some((a) => a.kind === 'reserve_slot') &&
        !cardById(item.i)?.effect?.abilities?.some((a) => a.kind === 'sealed_energy');
      const storedOnCards = opponent.played.filter(usable).reduce(
        (total, item) =>
          total + (item.stored ? energySum(item.stored as Record<Element, number>) : 0),
        0,
      );
      const total = energySum(opponent.energies) + storedOnCards;
      next = patchPlayer(next, opponent.seat, (player) => ({
        energies: addEnergyCapped(
          { water: 0, air: 0, fire: 0, earth: 0 },
          { air: total },
          player.maxEnergy,
        ),
        played: player.played.map((item) =>
          item.stored && usable(item) ? { ...item, stored: undefined } : item,
        ),
      }));
    }
    return logEffect(next, seat, card, '所有对手的储备能量转为空气能量');
  },

  // 夜行者希德：若你水晶最多，从每位对手偷 5 水晶
  sid_nightshare: (state, seat, card) => {
    const me = state.players[seat];
    if (!me) return state;
    const opponents = state.players.filter((player) => player.seat !== seat);
    const isLeader = opponents.every((player) => me.crystals > player.crystals);
    if (!isLeader) return logEffect(state, seat, card, '不是水晶最多，未触发');

    let next = state;
    for (const opponent of opponents) {
      const stolen = Math.min(5, opponent.crystals);
      if (stolen <= 0) continue;
      next = patchPlayer(next, opponent.seat, (player) => ({
        crystals: player.crystals - stolen,
      }));
      next = patchPlayer(next, seat, (player) => ({
        crystals: player.crystals + stolen,
      }));
    }
    return logEffect(next, seat, card, '从每位对手偷取 5 水晶');
  },

  // 奥尼斯的诅咒圣物：水晶 +10，水能量 +1（受上限截断）
  cursed_relic: (state, seat, card) => {
    const next = patchPlayer(state, seat, (player) => ({
      crystals: player.crystals + 10,
      energies: addEnergyCapped(player.energies, { water: 1 }, Infinity),
    }));
    return logEffect(next, seat, card, '水晶 +10，水能量 +1');
  },

  // 阿鲁斯的诅咒典籍：召唤时水晶 +10、召唤等级 +1（能量部分由选择弹窗结算）。
  cursed_treatise: (state, seat, card) => {
    const next = patchPlayer(state, seat, (player) => ({
      crystals: player.crystals + 10,
      gauge: player.gauge + 1,
    }));
    return logEffect(next, seat, card, '水晶 +10，召唤等级 +1');
  },

  // 元素护符：按实际支付的元素结算；水（选能量）需要选择，见 summonNeedsChoice。
  // 风 = 召唤等级 +1（前进一格），与旧项目卡片数据的「弃 1 张手牌」不同——旧数据有误，以用户裁定为准。
  elemental_amulet: (state, seat, card) => {
    const paid = card.paid ?? [];
    let next = state;
    const details: string[] = [];
    if (paid.includes('air')) {
      next = patchPlayer(next, seat, (player) => ({ gauge: player.gauge + 1 }));
      details.push('风：召唤等级 +1');
    }
    if (paid.includes('earth')) {
      next = patchPlayer(next, seat, (player) => ({ crystals: player.crystals + 5 }));
      details.push('土：水晶 +5');
    }
    if (paid.includes('fire')) {
      next = drawToHand(next, seat, 1);
      details.push('火：抽 1 张');
    }
    return details.length > 0
      ? logEffect(next, seat, card, details.join('，'))
      : next;
  },
  // --- 魔法王国 / 命运之路：进场效果 -----------------------------------------

  /** 60 复生王座：仅在召唤时触发一次；无手牌且无盾时无事发生。 */
  throne_of_renewal: (state) => state,

  /** 67 远古鹰隼：进场 +1 召唤等级、+10 水晶（牺牲激活在引擎中处理）。 */
  argos_hawk: (state, seat, card) => {
    let next = patchPlayer(state, seat, (player) => ({
      gauge: player.gauge + 1,
      crystals: player.crystals + 10,
    }));
    return logEffect(next, seat, card, '召唤等级 +1，水晶 +10');
  },

  /** 54 赛琳娜的法典：选一张费用含能量的其他魔器回手。 */
  selenias_codex: (state) => state,

  /** 55 伊斯塔的卷轴、58 精灵捕捉网：逐张翻牌后二选一。 */
  scroll_of_ishtar: (state) => state,
  familiar_catcher: (state) => state,

  /** 65 时光护符：2 能量自动选择，弃/抽 X 继续由引擎处理。 */
  amulet_of_time: (state) => state,

  /** 68 篡夺渡鸦：选对手魔器并复制。 */
  raven_the_usurper: (state) => state,

  /** 69 冥界狱犬：按座位依次做全桌选择。 */
  warden_of_argos: (state) => state,

  /** 70 贼头鼠：每位对手至多拿 2 个能量。 */
  ratty_nightshade: (state, seat) => ({
    ...state, pendingQueue: [...state.pendingQueue, ...state.players
      .filter((player) => player.seat !== seat)
      .filter((player) => ELEMENTS.some((e) => player.energies[e] > 0))
      .map((player) => ({
        kind: 'element_alloc', key: 'ratty_steal', choosingSeat: seat,
        options: { title: `贼头鼠：选择从${seatName(player.seat)}拿取的能量`,
          amount: Math.min(2, ELEMENTS.reduce((sum, e) => sum + player.energies[e], 0)),
           targetSeat: player.seat, maxPerElement: player.energies, allowPartial: true, minAmount: 0, label: '拿取' },
      }))],
  }),

  /** 79 坟墓护符：弃牌顶 3 张按顺序处理。 */
  sepulchral_amulet: (state) => state,

  /** 83 艾瑞斯的模仿：弃手牌或牺牲魔器换 12 水晶。 */
  arus_mimicry: (state) => state,

  /** 86 拉格菲尔德的仆从：≥10 水晶的玩家各自 +1 等级并摸 1 张。 */
  servant_of_ragfield: (state, seat, card) => {
    let next = state;
    let affected = 0;
    for (const player of state.players) {
      if (player.crystals < 10) continue;
      affected += 1;
      next = patchPlayer(next, player.seat, (item) => ({
        gauge: item.gauge + 1,
      }));
      const [drawnState, drawn] = drawOne(next);
      next = drawnState;
      if (drawn) {
        next = {
          ...next,
          pendingQueue: [
            ...next.pendingQueue,
            {
              kind: 'branch',
              key: 'servant_of_ragfield',
              choosingSeat: player.seat,
              options: {
                title: '拉格菲尔德的仆从：选择保留或弃掉刚摸到的牌',
                branches: [
                  { id: 'keep', label: `保留「${cardById(drawn.i)?.nameZh ?? drawn.i}」` },
                  { id: 'discard', label: '弃掉' },
                ],
                card: drawn,
                servantOwner: seat,
              },
            },
          ],
        };
      }
    }
    return logEffect(
      next,
      seat,
      card,
      affected > 0 ? `${affected} 位玩家召唤等级 +1 并摸牌` : '没有玩家拥有 10 水晶',
    );
  },

  /** 87 亚苟斯的纠缠：选择一名对手的一张神仆挂上锁结。 */
  argosian_tangleweed: (state, seat) => {
    const targets = state.players
      .filter((player) => player.seat !== seat)
      .flatMap((player) =>
        player.played
          .filter((item) => printedCardType(player, item) === 'familiar')
          .map((item) => ({ ...item, seat: player.seat })),
      );
    return targets.length > 0 ? state : state;
  },

  /** 90 诈欺狼：抽 2 后转赠一张。 */
  crafty_nightshade: (state, seat, card) => {
    const rivals = state.players.filter((player) => player.seat !== seat);
    if (rivals.length === 0) return state;
    const fewest = Math.min(...rivals.map((player) => player.played.length));
    const targets = rivals.filter((player) => player.played.length === fewest);
    let next = state;
    for (let i = 0; i < 2; i += 1) {
      const [drawnState, drawn] = drawOne(next);
      next = drawnState;
      if (drawn) {
        next = patchPlayer(next, seat, (player) => ({
          hand: [...player.hand, drawn],
        }));
      }
    }
    return logEffect(
      {
        ...next,
        pendingQueue: [
          ...next.pendingQueue,
          {
            kind: 'branch',
            key: 'crafty_nightshade',
            choosingSeat: seat,
            options: {
              title: '诈欺狼：选择场上魔法牌最少的对手，再把一张手牌交给他',
              branches: targets.map((target) => ({
                id: String(target.seat),
                label: `${seatName(target.seat)}（场上 ${target.played.length} 张）`,
              })),
              stage: 'target',
            },
          },
        ],
      },
      seat,
      card,
      '抽 2 张，等待选择交牌目标',
    );
  },

  /** 76 科洛夫的日晷：进场 +2 召唤等级（回合末重掷由事件状态机处理）。 */
  dial_of_colof: (state, seat, card) => {
    const next = patchPlayer(state, seat, (player) => ({ gauge: player.gauge + 2 }));
    return logEffect(next, seat, card, '召唤等级 +2');
  },

  /** 88 伊欧的爪牙：进场 +1 风、+1 召唤等级，持有者无法获得水晶。 */
  ios_minion: (state, seat, card) => {
    const next = patchPlayer(state, seat, (player) => ({
      gauge: player.gauge + 1,
      energies: addEnergyCapped(player.energies, { air: 1 }, Infinity),
    }));
    return logEffect(next, seat, card, '获得 1 风元素，召唤等级 +1');
  },

  // 扩展包「召唤条件」：满足条件时给自己水晶 / 扣对手水晶（魔法骑士/魔法巨龙/命运冠军）。
  summon_condition: (state, seat, card, effect) => {
    const me = state.players[seat];
    if (!me) return state;
    const countType = (type: string) =>
      me.played.reduce((total, item) => {
        return total + (printedCardType(me, item) === type ? 1 : 0);
      }, 0);
    if (typeof effect.requireMagic === 'number' && countType('magic_item') < effect.requireMagic) {
      return logEffect(state, seat, card, '召唤条件未满足（魔法物品不足）');
    }
    if (effect.requireLeader) {
      const leader = me.played.length >= 0
        && state.players.every((player) => player.seat === seat || player.crystals < me.crystals);
      if (!leader) return logEffect(state, seat, card, '召唤条件未满足（水晶未领先）');
    }
    const players = state.players.map((player) => {
      if (player.seat === seat) {
        return {
          ...player,
          crystals: player.crystals + (effect.selfCrystals ?? 0),
        };
      }
      const lose = Math.min(effect.opponentCrystals ?? 0, player.crystals);
      return lose > 0 ? { ...player, crystals: player.crystals - lose } : player;
    });
    const gain = effect.selfCrystals ?? 0;
    const drain = effect.opponentCrystals ?? 0;
    const detail = [gain > 0 ? `水晶 +${gain}` : '', drain > 0 ? `对手水晶 -${drain}` : '']
      .filter(Boolean)
      .join('，');
    return logEffect({ ...state, players }, seat, card, detail);
  },

};

/** 召唤时进入交互流程的效果。与 SUMMON_EFFECTS 一起构成完整的召唤入口。 */
export const SUMMON_CHOICE_KEYS: ReadonlySet<string> = new Set([
  'throne_of_renewal',
  'selenias_codex',
  'scroll_of_ishtar',
  'familiar_catcher',
  'raven_the_usurper',
  'warden_of_argos',
  'ratty_nightshade',
  'sepulchral_amulet',
  'argosian_tangleweed',
  'otus_the_oracle',
  'crafty_nightshade',
  'amulet_of_time',
  'gain_energy',
  'draw_cards',
  'bespelled_grimoire',
  'cursed_treatise',
  'per_magic_item_energy',
  'elemental_amulet',
  'temporal_boots',
  'lewis',
  'syllas',
  'amsug',
  'vampiric_crown',
  'divine_chalice',
  'naria',
]);

export function isSummonSupported(def: SeasonsCardDef): boolean {
  const effect = summonEffectOf(def);
  if (!effect) return false;
  const key = summonEffectKey(effect);
  return key in SUMMON_EFFECTS || SUMMON_CHOICE_KEYS.has(key);
}

/**
 * 召唤该卡是否需要尚未实现的玩家选择。
 * 元素护符按实际支付元素判断：土/火是自动效果，水/风需要弹窗。
 */
/** 召唤时需要先弹窗选择的事项。 */
export interface SummonChoiceRequest {
  kind:
    | 'element_alloc'
    | 'card_list'
    | 'card_pick'
    | 'multi_player_pick'
    | 'month_advance'
    | 'branch';
  key: string;
  /** element_alloc：reserve 进储备区；card 置于刚召唤的卡上。 */
  target?: 'reserve' | 'card';
  amount?: number;
  /** card_list：保留张数。 */
  keep?: number;
  title: string;
  label?: string;
  /** 每种元素最多分配几个；不传表示不限（只受总量约束）。 */
  maxPerElement?: Partial<Record<Element, number>>;
  /** 选择前先抽 N 张放进私密 pendingCards。 */
  draw?: number;
  /** element_alloc 结算后再丢弃 pendingCards（吸血鬼王冠）。 */
  then?: 'discard_pending';
  /** card_pick：免费召唤后把其余 pendingCards 弃掉（神圣圣杯）。 */
  discardRest?: boolean;
  /** card_list：未保留的牌分给对手；'choose' 表示由召唤者逐张指定（娜莉亚）。 */
  distribute?: boolean | 'choose';
  /** branch：牌堆顶的牌与它的声望（吸血鬼王冠）。 */
  card?: CardRef;
  points?: number;
  branches?: { id: string; label?: string; enabled?: boolean }[];
  /** card_pick：其余牌按顺序放到弃牌堆底（复活药剂）。 */
  bottomRest?: boolean;
  /** card_list：候选牌只用于排序，确认后放回牌堆顶。 */
  orderOnly?: boolean;
  /** 已由请求携带的候选牌；没有时由 pendingCards 提供。 */
  cards?: CardRef[];
  /** element_alloc：允许只分配一部分（路易斯复制）。 */
  allowPartial?: boolean;
  /** multi_player_pick：依次由这些座位的玩家选择（西拉斯/阿姆苏格）。 */
  players?: number[];
  /** sacrifice：选 1 张在场卡进弃牌；return：选 1 张魔法物品回手。 */
  purpose?: 'sacrifice' | 'return' | 'discard';
  /** 可跳过；用于“你可以”类触发。 */
  optional?: boolean;
  /** Owner seat of the effect source, used when the resolving player can differ. */
  sourceSeat?: number;
}

/**
 * 召唤该卡需要的选择；`null` 表示无需选择（由 SUMMON_EFFECTS 自动结算），
 * `'unimplemented'` 表示需要选择但尚未接入，summon 会拒绝且不扣费。
 */
export function summonChoiceFor(
  def: SeasonsCardDef,
  paid: readonly Element[],
  state: SeasonsState,
  seat: number,
): SummonChoiceRequest | 'unimplemented' | null {
  const effect = summonEffectOf(def);
  if (!effect) return null;
  const key = summonEffectKey(effect);

  if (key === 'throne_of_renewal') {
    return state.players[seat]?.hand.length
      ? {
          kind: 'card_pick',
          key: 'throne_of_renewal',
          title: '复生王座：选择一张手牌弃掉',
          label: '弃掉',
          purpose: 'discard',
        }
      : null;
  }

  if (key === 'selenias_codex') {
    const me = state.players[seat];
    const candidates =
      me?.played.filter((card) => {
        const def = cardById(card.i);
        return Boolean(def && printedCardType(me!, card) === 'magic_item' &&
          (def.costFlexible || ELEMENTS.some((element) => def.cost[element] > 0)));
      }) ?? [];
    return candidates.length
      ? {
          kind: 'card_pick',
          key: 'selenias_codex',
          title: '赛琳娜的法典：选择一张含能量费用的魔器回手',
          label: '回手',
          purpose: 'return',
          optional: true,
          cards: candidates,
        }
      : null;
  }

  if (key === 'scroll_of_ishtar') {
    return {
      kind: 'branch',
      key: 'scroll_of_ishtar',
      title: '伊斯塔的卷轴：选择要寻找的能量类型',
      label: '寻找',
      branches: ELEMENTS.map((element) => ({ id: element, label: `${ELEMENT_NAME_ZH[element]}元素` })),
    };
  }

  if (key === 'familiar_catcher') {
    return {
      kind: 'branch',
      key: 'familiar_catcher',
      title: '精灵捕捉网：翻到第一张神仆',
      label: '翻开',
      branches: [{ id: 'reveal', label: '从牌堆顶开始翻牌' }],
    };
  }

  if (key === 'raven_the_usurper') {
    const targets = state.players
      .filter((player) => player.seat !== seat)
      .flatMap((player) =>
        player.played
          .filter((card) => printedCardType(player, card) === 'magic_item')
          .map((card) => ({ ...card, seat: player.seat })),
      );
    return targets.length
      ? {
          kind: 'card_pick',
          key: 'raven_the_usurper',
          title: '篡夺渡鸦：选择一张对手魔器复制',
          label: '复制',
          cards: targets,
        }
      : null;
  }

  if (key === 'warden_of_argos') {
    return {
      kind: 'branch',
      key: 'warden_of_argos',
      title: '冥界狱犬：选择全桌效果',
      label: '确认',
      branches: [
        { id: 'energy', label: '每位玩家弃 4 个能量' },
        { id: 'cards', label: '每位玩家弃 1 张魔法牌' },
      ],
    };
  }

  if (key === 'ratty_nightshade') {
    return null;
  }

  if (key === 'sepulchral_amulet') {
    const cards = state.discard.slice(-3).reverse();
    return cards.length
      ? {
          kind: 'card_pick',
          key: 'sepulchral_amulet',
          title: '坟墓护符：先选择加入手牌的 1 张',
          label: '加入手牌',
          cards,
        }
      : null;
  }

  if (key === 'argosian_tangleweed') {
    const targets = state.players
      .filter((player) => player.seat !== seat)
      .flatMap((player) =>
        player.played
          .filter((card) => printedCardType(player, card) === 'familiar')
          .map((card) => ({ ...card, seat: player.seat, sourceSeat: seat })),
      );
    return targets.length
      ? {
          kind: 'card_pick',
          key: 'argosian_tangleweed',
          title: '亚苟斯的纠缠：选择一张对手神仆放置锁结',
          label: '放置锁结',
          cards: targets,
          optional: true,
          sourceSeat: seat,
        }
      : null;
  }

  if (key === 'otus_the_oracle') {
    return null;
  }

  if (key === 'crafty_nightshade') {
    return null;
  }

  if (key === 'amulet_of_time') {
    return {
      kind: 'element_alloc',
      key: 'amulet_of_time',
      target: 'reserve',
      amount: 2,
      title: '时光护符：选择获得 2 个能量',
      label: '获得',
    };
  }
  if (key === 'arus_mimicry') {
    const me = state.players[seat]!;
    const cards = [...me.hand, ...me.played];
    return cards.length ? { kind: 'card_pick', key, title: '弃掉手牌或牺牲场牌，获得 12 水晶',
      label: '确认', cards } : null;
  }

  // 流水护符：从库存取 N 个任意能量置于本卡上。
  if (key === 'gain_energy') {
    const amount = typeof effect.amount === 'number' ? effect.amount : 4;
    return {
      kind: 'element_alloc',
      key: 'gain_energy',
      target: 'card',
      amount,
      title: `选择 ${amount} 个能量置于「${def.nameZh}」`,
      label: '放置',
    };
  }

  // 火焰护符：抽 N 张，保留 keep 张，其余弃掉。
  if (key === 'draw_cards') {
    const amount = typeof effect.amount === 'number' ? effect.amount : 1;
    const keep = typeof effect.keep === 'number' ? effect.keep : 1;
    return {
      kind: 'card_list',
      key: 'draw_cards',
      amount,
      keep,
      title: `抽 ${amount} 张，保留 ${keep} 张`,
      label: '保留',
    };
  }

  // 附魔魔典：获得 2 个任意能量（maxEnergy 已在召唤时 +3，先不支持溢出到卡上）。
  if (key === 'bespelled_grimoire') {
    return {
      kind: 'element_alloc',
      key: 'bespelled_grimoire',
      target: 'reserve',
      amount: 2,
      title: '选择获得 2 个能量',
      label: '获得',
    };
  }

  // 阿鲁斯的诅咒典籍：水晶 +10 直接结算，另得 2 个任意能量。
  if (key === 'cursed_treatise') {
    return {
      kind: 'element_alloc',
      key: 'cursed_treatise',
      target: 'reserve',
      amount: 2,
      title: '选择获得 2 个能量',
      label: '获得',
    };
  }

  // 拉格诺的吊坠：每有 1 张其他魔法物品，得 1 个任意能量。
  if (key === 'per_magic_item_energy') {
    const me = state.players[seat];
    if (!me) return null;
    const others = me.played.filter(
      (card) => printedCardType(me, card) === 'magic_item',
    ).length;
    const per = typeof effect.amount === 'number' ? effect.amount : 1;
    const amount = others * per;
    if (amount <= 0) return null;
    return {
      kind: 'element_alloc',
      key: 'per_magic_item_energy',
      target: 'reserve',
      amount,
      title: `选择获得 ${amount} 个能量`,
      label: '获得',
    };
  }

  if (key === 'elemental_amulet') {
    if (paid.includes('water')) {
      return {
        kind: 'element_alloc',
        key: 'elemental_amulet_water',
        // The water payment puts the energy on this amulet, where it stays
        // available for later summon/transmute payments.
        target: 'card',
        amount: 2,
        title: '元素护符（水）：选择 2 个能量置于牌上',
        label: '放置',
      };
    }
    return null;
  }

  // 时光之靴：水晶 +2，然后在召唤时让季节轮前进/后退 1–3 格。
  if (key === 'temporal_boots') {
    return {
      kind: 'month_advance',
      key: 'temporal_boots',
      title: '选择季节轮移动方向和步数',
      label: '移动',
    };
  }

  // 灰脸路易斯：仅选择对手，种类和数量随后完整复制。
  if (key === 'lewis') {
    return {
      kind: 'branch',
      key: 'lewis',
      branches: state.players.filter((player) => player.seat !== seat)
        .map((player) => ({ id: String(player.seat), label: `玩家 ${player.seat + 1}` })),
      title: '选择一位对手，完整复制其储备能量',
      label: '复制',
    };
  }

  // 忠实的西拉斯：每位有在场牌的对手各牺牲 1 张（对手自选）。
  if (key === 'syllas') {
    const targets = state.players
      .filter((player) => player.seat !== seat && player.played.length > 0)
      .map((player) => player.seat);
    if (targets.length === 0) return null;
    return {
      kind: 'multi_player_pick',
      key: 'syllas',
      players: targets,
      purpose: 'sacrifice',
      title: '每位对手牺牲 1 张在场牌',
      label: '牺牲',
    };
  }

  // 长颈阿姆苏格：每位有魔法物品的玩家收回 1 张。
  if (key === 'amsug') {
    const hasItem = (player: SeasonsState['players'][number]) =>
      player.played.some(
        (card) => printedCardType(player, card) === 'magic_item',
      );
    const targets = state.players.filter(hasItem).map((player) => player.seat);
    if (targets.length === 0) return null;
    return {
      kind: 'multi_player_pick',
      key: 'amsug',
      players: targets,
      purpose: 'return',
      title: '每位玩家收回 1 张在场魔法物品',
      label: '收回',
    };
  }

  // 吸血鬼王冠：选择「抽入手牌」或「弃掉」，再按该牌声望得等量能量。
  if (key === 'vampiric_crown') {
    const top = state.deck[state.deck.length - 1];
    if (!top) return null;
    const points = cardById(top.i)?.points ?? 0;
    return {
      kind: 'branch',
      key: 'vampiric_crown',
      card: top,
      points,
      branches: [
        { id: 'draw', label: '抽入手牌' },
        { id: 'discard', label: '弃掉' },
      ],
      title: `吸血鬼王冠：抽 1 张牌入手，或弃掉它（声望 ${points}，获得等量能量）`,
    };
  }

  // 神圣圣杯：抽 4 张，免费召唤其中 1 张，其余弃掉；召唤位不足时直接抽 4 弃 4。
  if (key === 'divine_chalice') {
    // 此时圣杯尚未计入 played，免费召唤要再占 1 个槽位。
    const me = state.players[seat];
    if (!me || me.gauge <= me.played.length + 1) return null;
    return {
      kind: 'card_pick',
      key: 'divine_chalice',
      amount: 1,
      draw: 4,
      discardRest: true,
      title: '抽 4 张，选择 1 张免费召唤',
      label: '召唤',
    };
  }

  // 女先知娜莉亚：抽等于玩家人数张，自留 1 张，其余由召唤者逐张指定给各对手。
  if (key === 'naria') {
    const count = state.players.length;
    return {
      kind: 'card_list',
      key: 'naria',
      amount: count,
      keep: 1,
      draw: count,
      distribute: 'choose',
      title: `抽 ${count} 张，保留 1 张，其余分给对手`,
      label: '保留',
    };
  }

  return isSummonSupported(def) ? null : 'unimplemented';
}

/** 执行召唤时效果；未注册时原样返回（调用方应先检查 isSummonEffectImplemented）。 */
export function runSummonEffect(
  state: SeasonsState,
  seat: number,
  card: CardInstance,
): SeasonsState {
  const def = cardById(card.i);
  if (!def) return state;
  const effect = summonEffectOf(def);
  if (!effect) return state;
  const handler = SUMMON_EFFECTS[summonEffectKey(effect)];
  return handler ? handler(state, seat, card, effect) : state;
}
