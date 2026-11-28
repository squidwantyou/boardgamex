import { z } from 'zod';
import type { GameCatalog } from '../index.js';

/* ------------------------------------------------------------------ */
/* 目录信息                                                            */
/* ------------------------------------------------------------------ */

/**
 * 四季物语（Seasons）。
 *
 * 支持 2–4 人局；2 人局可以认输，3–4 人局不能认输（见 §6）。
 * 卡表为 50 张基础牌（seasons-cards.ts），另有预设卡池「五福季节」
 * （空气/火焰/大地/流水/元素护符各 20 张）、骰子季节（100 张恶意之骰）。
 * 房间界面只暴露 `pool`；`customDeck` 仅留给脚本/压力测试直接调用引擎。
 */
export const seasonsCatalog: GameCatalog = {
  id: 'seasons',
  name: '四季物语',
  tagline: '轮抽组牌、掷骰取能、召唤魔法牌，三年后水晶最多者胜',
  description:
    '在线四季物语对局：轮抽 9 张牌分成三年手牌，每年 4 季掷骰选骰，召唤与激活魔法牌，三年结束时结算声望。支持 2–4 人局；开局可选标准卡池或「五福季节」卡池。',
  minPlayers: 2,
  maxPlayers: 4,
  rules: [
    '轮抽：每人 9 张牌，每轮同时选 1 张，其余传给左手边玩家，共 9 轮。',
    '组牌：把 9 张牌分成 3/3/3，分别作为第 1/2/3 年加入手牌。',
    '每年 12 个月（4 季 × 3 月）。每月掷出（人数 + 1）颗季节骰，玩家依次选骰。',
    '选骰后按选骰顺序行动：先结算骰面奖励，再选择召唤 1 张牌、激活 1 张牌或转换 1 个能量。',
    '召唤等级必须严格大于场上已有牌数，并支付卡牌费用。',
    '3 年结束时结算：水晶 + 场上卡牌分数 + 特殊计分 − 手牌惩罚（每张 5 分）− 徽章惩罚。',
  ],
  options: [
    {
      id: 'pool',
      label: '卡池',
      type: 'select',
      description:
        '选标准卡池（50 张 ×2）、五福季节（5 种护符 × 20 张）或骰子季节（100 张恶意之骰）。',
      default: 'standard',
      choices: [
        { value: 'standard', label: '标准卡池（50 张）' },
        { value: 'five_fortunes', label: '五福季节（5 种 × 20 张）' },
        { value: 'dice_season', label: '骰子季节（100 张恶意之骰）' },
      ],
    },
    {
      id: 'extensions',
      label: '扩展包',
      type: 'multi',
      description: '基础 50 张必选；两个扩展各追加 20 种卡牌，可叠加选用。',
      default: ['base'],
      choices: [
        {
          value: 'base',
          label: '基础 50 张',
          description: '必选。关闭后无法开局。',
        },
        {
          value: 'ext1',
          label: '魔法王国（+20 张）',
          description: '追加 20 种“魔法王国”卡牌及其效果。',
        },
        {
          value: 'ext2',
          label: '命运之路（+20 张）',
          description: '追加 20 种“命运之路”卡牌及其效果。',
        },
      ],
    },
  ],
};

/** 预设卡池：standard = 基础 50 张；five_fortunes = 五种护符各 20 张。 */
export type SeasonsPool = 'standard' | 'five_fortunes' | 'dice_season';

/** 对局选项：可选 pool 预设卡池与 customDeck（逗号分隔的卡牌 id）。 */
export const seasonsOptionsSchema = z
  .object({
    pool: z.enum(['standard', 'five_fortunes', 'dice_season']).optional(),
    extensions: z.array(z.enum(['base', 'ext1', 'ext2'])).optional(),
    /**
     * 自定义卡池：逗号分隔的卡牌 id（每种仍按 2 张入池）。
     * 不暴露在房间创建界面（仅供脚本/压力测试直接调用引擎时使用）；
     * 优先级高于 pool；留空时按 pool 或标准 50 张基础卡。
     */
    customDeck: z
      .string()
      .regex(/^\s*\d+(\s*,\s*\d+)*\s*$/, 'customDeck 应为逗号分隔的卡牌 id')
      .optional(),
  })
  .strict();

export type SeasonsOptions = z.infer<typeof seasonsOptionsSchema>;

export const seasonsDefaultOptions: SeasonsOptions = { pool: 'standard' };

/* ------------------------------------------------------------------ */
/* 基础类型                                                            */
/* ------------------------------------------------------------------ */

/**
 * 四元素。用全名而不是 w/a/f/e：旧卡牌数据（cost / costByPlayers /
 * costFlexible / 骰面 rewards）全部以全名为键，直接对齐可以少一层翻译。
 */
export type Element = 'water' | 'air' | 'fire' | 'earth';

export const ELEMENTS = ['water', 'air', 'fire', 'earth'] as const;

/**
 * 一次元素支付的稳定来源。
 *
 * - `reserve`：玩家储备区中的一枚；
 * - `card`：场上某张允许作为储备的卡（流水护符等）上的一枚。
 *
 * `slot` 是同一来源内该元素的获得顺序。它只在一次待支付会话内
 * 标识“哪一枚”，不会跨回合或跨刷新保留。旧客户端仍可发送只含
 * 元素种类的 `paidElements`，服务端会按“储备优先”兼容解析。
 */
export interface SeasonsElementSource {
  element: Element;
  source: 'reserve' | 'card';
  cardUid?: number;
  slot?: number;
}

export type SeasonsPhase = 'draft' | 'organize' | 'play' | 'ended';

/**
 * 一张卡牌实例：`i` 是卡牌定义 id（1–50 基础，51+ 扩展），
 * `u` 是本局内唯一的实例 uid（从 1 递增）。同名卡靠 `u` 区分。
 */
export interface CardRef {
  i: number;
  u: number;
}

export type CardType = 'magic_item' | 'familiar';

/** 卡牌费用；缺失的元素按 0 处理。 */
export interface SeasonsCardCost {
  water: number;
  air: number;
  fire: number;
  earth: number;
  crystal: number;
}

/**
 * 卡牌静态定义。规则与展示共用：服务端用它结算，前端用它渲染。
 * 定义表本身（50 张卡的数值）在 T2.6 落到 `cards/base.ts`。
 */
/** 卡牌被动/触发能力的声明式描述（由服务端效果注册表解释）。 */
export interface SeasonsCardAbility {
  kind: string;
  amount?: number;
  crystals?: number;
  key?: string;
  label?: string;
  element?: Element;
}

/**
 * 卡牌效果的数据部分；具体 handler 在服务端 cards/effects.ts。
 *
 * 扩展包的卡把条件参数也写在 effect 里（minMagic / minCards / cost 等），
 * 这里按旧数据原样保留；未实现的效果由引擎显式拒绝，不会静默结算。
 */
export interface SeasonsCardEffect {
  trigger: 'on_summon' | 'activation' | 'permanent' | 'score' | 'dice_change';
  type: string;
  typeKey?: string;
  amount?: number;
  keep?: number;
  draw?: number;
  energy?: number;
  crystals?: number;
  selfCrystals?: number;
  opponentCrystals?: number;
  maxReserve?: number;
  minCards?: number;
  minMagic?: number;
  minFamiliar?: number;
  cost?: number;
  requireMagic?: number;
  requireLeader?: boolean;
  triggerKind?: string;
  abilities?: SeasonsCardAbility[];
  triggers: string[];
}

export interface SeasonsCardDef {
  id: number;
  nameZh: string;
  nameEn: string;
  type: CardType;
  cost: SeasonsCardCost;
  /** 按人数覆盖/追加的费用段，使用时与 cost 合并 */
  costByPlayers?: Partial<Record<'2' | '3' | '4', Partial<SeasonsCardCost>>>;
  /** 灵活费用：支付 min–max 种不同元素，每种最多 maxPerType 个 */
  costFlexible?: { min: number; max: number; maxPerType?: number };
  points: number;
  effect?: SeasonsCardEffect | null;
  desc: string;
  descEn?: string;
  extension?: 'base' | 'ext1' | 'ext2';
}

/* ------------------------------------------------------------------ */
/* 动作                                                                */
/* ------------------------------------------------------------------ */

export type BadgeType = 1 | 2 | 3 | 4;

/**
 * 选择弹窗的应答值。迷你版只做 element / card_list / card_multi /
 * card_list_grouped 四种，其余 kind 先由引擎 autoPick 兜底；
 * 具体形状由 kind 决定，所以协议层只做“外壳”校验。
 */
export type ChoiceValue =
  | Element
  | number
  | string
  | boolean
  | null
  | ChoiceValue[]
  | { [key: string]: ChoiceValue };

export type SeasonsAction =
  /** 轮抽：选一张牌 */
  | { type: 'draft-pick'; cardUid: number }
  /** 组牌：一次选 3 张；第一次是第 1 年，第二次是第 2 年 */
  | { type: 'organize'; cardUids: [number, number, number] }
  /** 组牌：撤回已选的两步（尚未确认完成时） */
  | { type: 'organize-reset' }
  /** 徽章 1：把 2 个储备能量换成任意 2 个能量 */
  | { type: 'use-badge'; badgeType: 1; fromElements: [Element, Element]; toElements: [Element, Element]; paidSources?: SeasonsElementSource[] }
  /** 徽章 2：本行动轮获得晶化权，每枚晶化元素额外 +1（可叠加） */
  | { type: 'use-badge'; badgeType: 2; element?: Element }
  /** 徽章 3：召唤等级 +1；徽章 4：本次带抽牌图标的季节骰摸 2 选 1 */
  | { type: 'use-badge'; badgeType: 3 }
  | { type: 'use-badge'; badgeType: 4; dieId: number }
  /** 徽章 4 抽到 2 张时，选择保留哪一张 */
  | { type: 'badge-keep'; cardUid: number }
  /** 选骰：挑一颗尚未被选的骰子 */
  | { type: 'draft-dice'; dieIndex: number }
  /** 坚定骰子：放弃季节骰行动，选择一项替代行动 */
  | { type: 'steadfast'; mode: 'gauge' | 'energy' | 'transmute' | 'skip' }
  /** 召唤手牌；paidElements 只对灵活费用卡有意义 */
  | {
      type: 'summon';
      cardUid: number;
      /** @deprecated Prefer paidSources; retained for old clients. */
      paidElements?: Element[];
      paidSources?: SeasonsElementSource[];
    }
  /** 猫头鹰中央候选：正常支付费用召唤 */
  | {
      type: 'summon-otus';
      cardUid: number;
      /** @deprecated Prefer paidSources; retained for old clients. */
      paidElements?: Element[];
      paidSources?: SeasonsElementSource[];
    }
  /** 激活场上一张牌；多激活卡用 abilityKey 指定能力 */
  | { type: 'activate'; cardUid: number; abilityKey?: string; paidSources?: SeasonsElementSource[] }
  /** 转换 1 个能量为水晶 */
  | { type: 'transmute'; element: Element; paidSources?: SeasonsElementSource[] }
  | { type: 'transmute-batch'; elements: { element: Element; count: number }[] }
  | { type: 'end-turn' }
  /**
   * 回应选择弹窗。形状由 pendingChoice.kind 决定；协议层只校验外壳，
   * 具体形状与合法性由引擎按 kind 校验（所以这里是 unknown 而非 ChoiceValue）。
   */
  | { type: 'resolve-choice'; choice?: unknown }
  /** 2 人局认输（直接判负） */
  | { type: 'resign' };

const elementSchema = z.enum(['water', 'air', 'fire', 'earth']);
const cardUidSchema = z.number().int().positive();
const elementSourceSchema = z.object({
  element: elementSchema,
  source: z.enum(['reserve', 'card']),
  cardUid: cardUidSchema.optional(),
  slot: z.number().int().min(0).optional(),
});

const badgeSchema = z.union([
  z.object({
    type: z.literal('use-badge'),
    badgeType: z.literal(1),
    fromElements: z.tuple([elementSchema, elementSchema]),
    paidSources: z.array(elementSourceSchema).length(2).optional(),
    toElements: z.tuple([elementSchema, elementSchema]),
  }),
  z.object({
    type: z.literal('use-badge'),
    badgeType: z.literal(2),
    element: elementSchema.optional(),
  }),
  z.object({
    type: z.literal('use-badge'),
    badgeType: z.literal(3),
  }),
  z.object({
    type: z.literal('use-badge'),
    badgeType: z.literal(4),
    dieId: z.number().int().positive(),
  }),
]);

export const seasonsActionSchema: z.ZodType<SeasonsAction> = z.union([
  z.object({ type: z.literal('draft-pick'), cardUid: cardUidSchema }),
  z.object({
    type: z.literal('organize'),
    cardUids: z.tuple([cardUidSchema, cardUidSchema, cardUidSchema]),
  }),
  z.object({ type: z.literal('organize-reset') }),
  badgeSchema,
  z.object({ type: z.literal('badge-keep'), cardUid: cardUidSchema }),
  z.object({
    type: z.literal('draft-dice'),
    dieIndex: z.number().int().min(0).max(7),
  }),
  z.object({
    type: z.literal('steadfast'),
    mode: z.enum(['gauge', 'energy', 'transmute', 'skip']),
  }),
  z.object({
    type: z.literal('summon'),
    cardUid: cardUidSchema,
    paidElements: z.array(elementSchema).max(4).optional(),
    paidSources: z.array(elementSourceSchema).max(20).optional(),
  }),
  z.object({
    type: z.literal('summon-otus'),
    cardUid: cardUidSchema,
    paidElements: z.array(elementSchema).max(4).optional(),
    paidSources: z.array(elementSourceSchema).max(20).optional(),
  }),
  z.object({
    type: z.literal('activate'),
    cardUid: cardUidSchema,
    abilityKey: z.string().min(1).max(40).optional(),
    paidSources: z.array(elementSourceSchema).max(20).optional(),
  }),
  z.object({ type: z.literal('transmute-batch'),
    elements: z.array(z.object({ element: elementSchema, count: z.number().int().min(1).max(9) })).min(1).max(4) }),
  z.object({ type: z.literal('transmute'), element: elementSchema,
    paidSources: z.array(elementSourceSchema).length(1).optional() }),
  z.object({ type: z.literal('end-turn') }),
  z.object({ type: z.literal('resolve-choice'), choice: z.unknown() }),
  z.object({ type: z.literal('resign') }),
]);

/* ------------------------------------------------------------------ */
/* 视图                                                                */
/* ------------------------------------------------------------------ */

/**
 * 视图里的一张卡。`u`/`i` 指向实例与定义，动态字段只有公开信息
 * （卡上储存的能量、本回合是否已激活、灵活支付选过的元素）。
 */
export interface SeasonsCardView extends CardRef {
  /** Copied effect definition, while i remains the effective rules definition. */
  copyOf?: number;
  /** Original face and printed points of a Raven instance. */
  printedId?: number;
  /** Instance UID of the copied card, used to clear the copy when it leaves play. */
  copySourceUid?: number;
  stored?: Partial<Record<Element, number>>;
  used?: boolean;
  paid?: Element[];
  usedAbilityKeys?: string[];
  /** Extension card's banked jewel tokens. */
  jewels?: number;
  /** Urmian Psychic Cage's one-shot trap is still armed. */
  trapArmed?: boolean;
  /** Source UID of an Argosian Tangleweed lock. */
  lockedBy?: number;
}

export interface SeasonsPlayerView {
  seat: number;
  isYou: boolean;
  handCount: number;
  /** 仅本人可见 */
  hand: SeasonsCardView[] | null;
  played: SeasonsCardView[];
  /** 第 2、3 年牌库合计张数 */
  libraryCount: number;
  /** 第 2 年牌库张数（公开） */
  library2Count: number;
  /** 第 3 年牌库张数（公开） */
  library3Count: number;
  /** 第 2 年牌库内容，仅本人可见 */
  library2: SeasonsCardView[] | null;
  /** 第 3 年牌库内容，仅本人可见 */
  library3: SeasonsCardView[] | null;
  /** Public Otus central candidates. */
  otusPool?: SeasonsCardView[];
  /** Public Otus offer restricted to the current actor. */
  otusOffer?: SeasonsCardView[] | null;
  /** Remaining Replica cards visible to this player. */
  replicaSupply?: number;
  energies: Record<Element, number>;
  jewels?: Partial<Record<Element, number>>;
  crystals: number;
  gauge: number;
  canTransmute: boolean;
  /** Badge 2 bonus applied to each crystallised token this action round. */
  transmuteBonus: number;
  /** Effective reserve capacity after card modifiers (Bespelled Grimoire etc.). */
  maxEnergy: number;
  badgesUsed: number;
  /** 本行动轮已由徽章升级的抽牌骰；null 表示没有。 */
  badgeDrawDieId: number | null;
  /** 徽章升级后的「摸 2 选 1」待选牌，仅本人可见 */
  badgeDraw: SeasonsCardView[] | null;
  /** 轮抽：本轮是否已经选过牌 */
  draftPicked: boolean;
  draftHandCount: number;
  /** 仅本人可见（draft 阶段） */
  draftHand: SeasonsCardView[] | null;
  draftedCount: number;
  /** 仅本人可见（organize 阶段） */
  drafted: SeasonsCardView[] | null;
  organizeDone: boolean;
  /** 组牌已选的 uid；仅本人可见 */
  organizeYear1: number[] | null;
  organizeYear2: number[] | null;
  /** 组牌阶段本人可见的待分组牌；其他玩家为 null。 */
  organizeCards1: SeasonsCardView[] | null;
  organizeCards2: SeasonsCardView[] | null;
  /** 组牌阶段尚未分配到年份的牌；仅本人可见。 */
  organizeRemaining: SeasonsCardView[] | null;
}

export interface SeasonsDieRewards {
  summon?: true;
  transmute?: true;
  card?: true;
  crystals?: number;
  water?: number;
  air?: number;
  fire?: number;
  earth?: number;
}

export interface SeasonsDieView {
  id: number;
  /** 季节字母（冬季 w / 春季 s 等），用于骰子图标 */
  letter: string;
  /** 骰面序号 1–6 */
  face: number;
  /** 点数 1–3 */
  pip: number;
  rewards: SeasonsDieRewards;
  picked: boolean;
  /** 被哪位玩家选走；未选为 null */
  pickedBy: number | null;
}

export interface SeasonsSeasonView {
  /** 中文季节名 */
  name: string;
  nameEn: string;
  element: Element;
  letter: string;
  /** 0 冬 / 1 春 / 2 夏 / 3 秋 */
  index: number;
}

/**
 * 待选弹窗。各 kind 的 options 形状由引擎定义（迷你版先支持
 * element / card_list / card_multi / card_list_grouped）。
 */
export interface SeasonsPendingChoiceView {
  kind: string;
  key: string;
  choosingSeat: number;
  options: Record<string, unknown>;
}

export interface SeasonsLogEntry {
  seq?: number;
  t: 'draft' | 'organize' | 'month' | 'summon' | 'activate' | 'transmute' | 'effect' | 'badge' | 'season' | 'choice' | 'score';
  msg: string;
}

export interface SeasonsPlayerScore {
  seat: number;
  crystals: number;
  cardPoints: number;
  effectPoints: number;
  handSize: number;
  handPenalty: number;
  badgesUsed: number;
  badgePenalty: number;
  cardsInPlay: number;
  energyLeft: number;
  score: number;
}

export interface SeasonsResultView {
  /** 按分数从高到低排序 */
  players: SeasonsPlayerScore[];
  winner: number | null;
  draw: boolean;
}

export interface SeasonsGameView {
  rulesVersion?: string;
  otusPool?: SeasonsCardView[];
  otusUsedThisRound?: number[];
  phase: SeasonsPhase;
  /** 0–35，0 是第 1 年冬季第 1 月 */
  month: number;
  /** 1–3 */
  year: number;
  /** 0 冬 / 1 春 / 2 夏 / 3 秋 */
  seasonIdx: number;
  /** draft / organize 阶段为 null */
  season: SeasonsSeasonView | null;
  startPlayer: number;
  /** 选骰阶段当前轮到谁选骰 */
  currentPicker: number | null;
  /** 行动阶段当前行动者 */
  turnOwner: number | null;
  draftRound: number;
  /** 本轮已经选过牌的座位 */
  draftPickedThisRound: number[];
  /** 本赛季（当月）已经行动完的座位 */
  pickedThisSeason: number[];
  dice: SeasonsDieView[];
  playerCount: number;
  players: SeasonsPlayerView[];
  deckCount: number;
  discardCount: number;
  transmuteValues: { element: Element; value: number }[];
  pendingChoice: SeasonsPendingChoiceView | null;
  /** 当前选择之后还排着多少个待处理选择（同一时机多人/多效果排队） */
  pendingQueueCount: number;
  /** 当前查看者现在是否可以行动（含选骰/选牌/组牌/应答弹窗） */
  myTurn: boolean;
  result: SeasonsResultView | null;
  log: SeasonsLogEntry[];
}
