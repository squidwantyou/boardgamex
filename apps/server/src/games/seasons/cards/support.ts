import type { SeasonsCardDef } from '@bgx/protocol/games/seasons';
import { ACTIVATION_HANDLERS } from './activation-handlers.js';
import { isSummonSupported } from './effects.js';
import {
  ROUND_END_HANDLERS,
  SCORE_HANDLERS,
  SEASON_CHANGE_HANDLERS,
  TURN_END_HANDLERS,
} from './event-handlers.js';

/**
 * Runtime support is deliberately derived from the real dispatch tables.
 * A card may be playable while some of its abilities are still missing, so
 * "can enter play" and "every declared trigger is implemented" are separate
 * questions. This prevents a stale hand-maintained key whitelist from being
 * the authority again.
 */
export const STATIC_ABILITY_HANDLERS = {
    activation_ability: true,
  activation_cost: true,
  cost_reduction: true,
  dice_reroll: true,
  draft_twist: true,
  eog_score: true,
  max_energy_plus: true,
  no_free_summon: true,
  on_summon_crystal: true,
  on_summon_energy: true,
    reserve_slot: true,
    sealed_energy: true,
  transmute_bonus: true,
} as const;

/** Activation entries that live in engine.ts because they inspect or rewrite table state. */
export const ENGINE_ACTIVATION_KEYS = new Set([
  'crystal_orb',
  'dragonsoul',
  'eolis_replicator',
  'ios_minion',
  'jewel_of_the_ancients',
  'magma_core',
  'mirror_of_seasons',
  'tree_of_light',
]);

/** Engine-owned continuations of a declared trigger. */
export const ENGINE_TRIGGER_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  activation: ENGINE_ACTIVATION_KEYS,
  draft_end: new Set(['draft_twist']),
    month_advance: new Set(['chrono_ring']),
    opponent_activate: new Set(['opponent_action_reward', 'thieving_fairies']),
  opponent_summon: new Set(['arcano_leech', 'magma_core', 'opponent_action_reward']),
  season_change: new Set(['on_season_change_energy']),
    summon: new Set(['urmian_psychic_cage']),
    turn_end: new Set(['beggars_horn', 'transmute_on_crystal_die']),
};

const DISPATCH_HANDLERS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  on_summon: { __normalOnly: true },
  turn_end: TURN_END_HANDLERS,
  round_end: ROUND_END_HANDLERS,
  season_change: SEASON_CHANGE_HANDLERS,
  score: SCORE_HANDLERS,
  activation: ACTIVATION_HANDLERS,
};

  /**
   * `permanent` is a card family marker, not an event. These keys are read
   * directly by static rules or by engine-owned timing paths. Keep this list
   * explicit so a new passive is not accepted merely because it has a name.
   */
  export const PERMANENT_HANDLER_KEYS = new Set([
    'on_play_card_crystal',
    'on_play_card_energy',
    'purse_of_io',
    'transmute_on_crystal_die',
    'shield_of_zira',
  ]);

export type CardSupportIssueCode =
  | 'summon_handler_missing'
  | 'trigger_handler_missing'
  | 'activation_handler_missing'
  | 'static_ability_missing';

export interface CardSupportIssue {
  code: CardSupportIssueCode;
  trigger: string;
  key: string;
  message: string;
}

export function effectKeyOf(def: SeasonsCardDef): string {
  return def.effect ? (def.effect.typeKey ?? def.effect.type) : '';
}

/** All trigger labels a card actually declares. The primary trigger is included. */
export function declaredTriggersOf(def: SeasonsCardDef): string[] {
  const effect = def.effect;
  if (!effect) return [];
  return [...new Set([effect.trigger, ...(effect.triggers ?? [])])];
}

  function hasDispatch(def: SeasonsCardDef, trigger: string, key: string): boolean {
    if (trigger === 'permanent') {
      const abilityKinds = (def.effect?.abilities ?? []).map((ability) => ability.kind);
      if (
        abilityKinds.length > 0 &&
        abilityKinds.every((kind) => kind in STATIC_ABILITY_HANDLERS)
      ) {
        return true;
      }
      return PERMANENT_HANDLER_KEYS.has(key) || key === 'steadfast_die';
    }
    if (trigger === 'score') {
      // Every score card contributes its printed points; special score
      // handlers add their crystal bonus separately in SCORE_HANDLERS.
      return (
        (key !== '' && SCORE_HANDLERS[key] !== undefined) ||
        key === '' ||
        key === 'points'
      );
    }
    if (trigger === 'on_sacrifice') {
      return key === 'cursed_treatise';
    }
    if (trigger === 'dice_change') {
      return key === 'die_of_malice';
    }
  return (
    DISPATCH_HANDLERS[trigger]?.[key] !== undefined ||
    ENGINE_TRIGGER_KEYS[trigger]?.has(key) === true
  );
}

/** A normal/free summon path must be able to construct or execute this card's summon effect. */
export function summonSupportIssue(def: SeasonsCardDef): CardSupportIssue | null {
  const effect = def.effect;
  if (!effect || !declaredTriggersOf(def).includes('on_summon')) return null;
  const key = effectKeyOf(def);
  if (!isSummonSupported(def)) {
    return {
      code: 'summon_handler_missing',
      trigger: 'on_summon',
      key,
      message: `召唤入口缺少处理程序：on_summon → ${key}`,
    };
  }
  return null;
}

/** Every declared ability must have a real dispatcher, not merely a card definition. */
export function cardSupportIssues(def: SeasonsCardDef): CardSupportIssue[] {
  const effect = def.effect;
  if (!effect) return [];
  const key = effectKeyOf(def);
  const issues: CardSupportIssue[] = [];
  const summonIssue = summonSupportIssue(def);
  if (summonIssue) issues.push(summonIssue);

    for (const trigger of declaredTriggersOf(def)) {
    if (trigger === 'on_summon') continue;
      if (hasDispatch(def, trigger, key)) continue;
    if (trigger === 'activation') {
      issues.push({
        code: 'activation_handler_missing',
        trigger,
        key,
        message: `激活入口缺少处理程序：activation → ${key}`,
      });
    } else {
      issues.push({
        code: 'trigger_handler_missing',
        trigger,
        key,
        message: `触发入口缺少处理程序：${trigger} → ${key}`,
      });
    }
  }

  for (const ability of effect.abilities ?? []) {
    if (ability.kind in STATIC_ABILITY_HANDLERS) continue;
    issues.push({
      code: 'static_ability_missing',
      trigger: effect.trigger,
      key,
      message: `静态能力缺少处理程序：${ability.kind}`,
    });
  }
  return issues;
}

export interface CardPoolIssue {
  cardId: number | null;
  message: string;
}

export function validateCardPool(cards: readonly SeasonsCardDef[]): CardPoolIssue[] {
  const issues: CardPoolIssue[] = [];
  const seen = new Set<number>();
  for (const def of cards) {
    if (seen.has(def.id)) issues.push({ cardId: def.id, message: `卡牌 id ${def.id} 重复` });
    seen.add(def.id);
    if (!def.nameZh) issues.push({ cardId: def.id, message: '缺少中文名' });
    if (def.id >= 51 && effectKeyOf(def) === 'inert_extension') {
      issues.push({ cardId: def.id, message: `扩展卡「${def.nameZh}」效果尚未实现，不能加入验收卡池` });
      continue;
    }
    if (!Number.isInteger(def.points)) issues.push({ cardId: def.id, message: '分数必须是整数' });
    if (!Number.isInteger(def.cost.crystal) || def.cost.crystal < 0) {
      issues.push({ cardId: def.id, message: '水晶费用必须是非负整数' });
    }
    for (const element of ['water', 'air', 'fire', 'earth'] as const) {
      if (!Number.isInteger(def.cost[element]) || def.cost[element] < 0) {
        issues.push({ cardId: def.id, message: `${element} 费用必须是非负整数` });
      }
    }
      const summonIssue = summonSupportIssue(def);
      if (summonIssue) issues.push({ cardId: def.id, message: summonIssue.message });
  }
  return issues;
}
