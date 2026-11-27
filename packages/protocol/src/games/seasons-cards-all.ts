/**
 * 四季物语卡表入口。
 *
 * 基础 50 张及两个扩展各 20 张；生成的复制牌不进入轮抽牌池。
 */
import { BASE_CARDS, BASE_CARD_BY_ID } from './seasons-cards.js';
import { EXT_CARDS, EXT_CARD_BY_ID } from './seasons-cards-ext.js';
import type { SeasonsCardDef } from './seasons.js';

export { BASE_CARDS, BASE_CARD_BY_ID };
export { EXT1_CARDS, EXT2_CARDS, EXT_CARDS, EXT_CARD_BY_ID } from './seasons-cards-ext.js';

/**
 * Card 222 is generated only by Eolis's Replicator. It deliberately stays out
 * of every draft pool, but needs a definition for display and scoring.
 */
export const REPLICA_CARD: SeasonsCardDef = {
  id: 222,
  nameZh: '复制魔法牌',
  nameEn: 'Replica',
  type: 'magic_item',
  cost: { water: 0, air: 0, fire: 0, earth: 0, crystal: 0 },
  points: 7,
  desc: '由伊欧的复制仪生成，视为 7 点声望值的魔器。',
  descEn: 'A Replica Power card created by Eolis’s Replicator; worth 7 Prestige points.',
  effect: {
    trigger: 'permanent',
    typeKey: 'replica',
    type: 'replica',
    triggers: [],
  },
};

export const SEASONS_CARDS: readonly SeasonsCardDef[] = [...BASE_CARDS, ...EXT_CARDS];

export const SEASONS_CARD_BY_ID: ReadonlyMap<number, SeasonsCardDef> = new Map([
  ...BASE_CARD_BY_ID,
  ...EXT_CARD_BY_ID,
  [REPLICA_CARD.id, REPLICA_CARD],
]);

/** 别名：引擎里统一叫 CARD_BY_ID。 */
export const CARD_BY_ID = SEASONS_CARD_BY_ID;
