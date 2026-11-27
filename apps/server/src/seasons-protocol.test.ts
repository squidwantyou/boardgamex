import { describe, expect, it } from 'vitest';
import {
  seasonsActionSchema,
  seasonsCatalog,
  seasonsDefaultOptions,
  seasonsOptionsSchema,
  type SeasonsAction,
} from '@bgx/protocol/games/seasons';

function parse(action: unknown) {
  return seasonsActionSchema.safeParse(action);
}

describe('seasons catalog / options', () => {
  it('目录信息自洽', () => {
    expect(seasonsCatalog.id).toBe('seasons');
    expect(seasonsCatalog.minPlayers).toBe(2);
    expect(seasonsCatalog.maxPlayers).toBe(4);
    expect(seasonsCatalog.options).toHaveLength(2);
    const pool = seasonsCatalog.options[0]!;
    expect(pool.id).toBe('pool');
    expect(pool.type).toBe('select');
    expect(pool.default).toBe('standard');
    expect(pool.choices.map((c) => c.value)).toEqual(['standard', 'five_fortunes', 'dice_season']);
  });

  it('默认选项通过校验，且与 catalog 默认值一致', () => {
    expect(seasonsOptionsSchema.parse(seasonsDefaultOptions)).toEqual(seasonsDefaultOptions);
    expect(seasonsDefaultOptions).toEqual({ pool: 'standard' });
  });

  it('接受自定义卡池、拒绝非法 id 串与多余键', () => {
    // 自定义卡池（组牌 / 压力测试用）：逗号分隔的 id 串。
    expect(seasonsOptionsSchema.safeParse({ customDeck: '1, 2,3' }).success).toBe(true);
    expect(seasonsOptionsSchema.safeParse({}).success).toBe(true);
    expect(seasonsOptionsSchema.safeParse({ customDeck: '1,a' }).success).toBe(false);
    expect(seasonsOptionsSchema.safeParse({ customDeck: '' }).success).toBe(false);
    expect(seasonsOptionsSchema.safeParse({ customDeck: '1,2', extra: 1 }).success).toBe(false);
    expect(seasonsOptionsSchema.safeParse({ extensions: ['base', 'ext1', 'ext2'] }).success).toBe(true);
    expect(seasonsOptionsSchema.safeParse({ extensions: ['unknown'] }).success).toBe(false);
    // 预设卡池
    expect(seasonsOptionsSchema.safeParse({ pool: 'standard' }).success).toBe(true);
    expect(seasonsOptionsSchema.safeParse({ pool: 'five_fortunes' }).success).toBe(true);
    expect(seasonsOptionsSchema.safeParse({ pool: 'dice_season' }).success).toBe(true);
    expect(seasonsOptionsSchema.safeParse({ pool: 'other' }).success).toBe(false);
  });
});

describe('seasons action schema', () => {
  const accepted: SeasonsAction[] = [
    { type: 'draft-pick', cardUid: 1 },
    { type: 'organize', cardUids: [3, 4, 5] },
    { type: 'organize-reset' },
    { type: 'use-badge', badgeType: 1, fromElements: ['water', 'air'], toElements: ['fire', 'earth'] },
    { type: 'use-badge', badgeType: 2 },
    { type: 'use-badge', badgeType: 3 },
    { type: 'use-badge', badgeType: 4, dieId: 1 },
    { type: 'badge-keep', cardUid: 9 },
    { type: 'draft-dice', dieIndex: 0 },
    { type: 'summon', cardUid: 12 },
    { type: 'summon', cardUid: 12, paidElements: ['water', 'fire'] },
    { type: 'activate', cardUid: 7 },
    { type: 'activate', cardUid: 7, abilityKey: 'crystal_to_energy' },
    { type: 'transmute', element: 'water' },
    { type: 'end-turn' },
    { type: 'resolve-choice', choice: 'water' },
    { type: 'resolve-choice', choice: [3, 4] },
    { type: 'resolve-choice' },
    { type: 'resign' },
  ];

  it('接受全部 11 种动作 + resign 的合法形状', () => {
    for (const action of accepted) {
      const result = parse(action);
      expect(result.success, `${JSON.stringify(action)} 应被接受`).toBe(true);
    }
  });

  it('拒绝非法 uid / 元素 / dieIndex', () => {
    expect(parse({ type: 'draft-pick', cardUid: 0 }).success).toBe(false);
    expect(parse({ type: 'draft-pick', cardUid: 1.5 }).success).toBe(false);
    expect(parse({ type: 'organize', cardUids: [1, 2] }).success).toBe(false);
    expect(parse({ type: 'use-badge', badgeType: 1, fromElements: ['water'], toElements: ['fire', 'earth'] }).success).toBe(false);
    expect(parse({ type: 'use-badge', badgeType: 1, fromElements: ['water', 'wind'], toElements: ['fire', 'earth'] }).success).toBe(false);
    expect(parse({ type: 'use-badge', badgeType: 2, element: 'wind' }).success).toBe(false);
    expect(parse({ type: 'use-badge', badgeType: 5 }).success).toBe(false);
    expect(parse({ type: 'draft-dice', dieIndex: -1 }).success).toBe(false);
    expect(parse({ type: 'draft-dice', dieIndex: 8 }).success).toBe(false);
    expect(
      parse({
        type: 'summon',
        cardUid: 3,
        paidElements: ['water', 'water', 'water', 'water', 'water'],
      }).success,
    ).toBe(false);
    expect(parse({ type: 'transmute', element: 'light' }).success).toBe(false);
  });

  it('拒绝未知动作与缺少必填字段', () => {
    expect(parse({ type: 'do-magic' }).success).toBe(false);
    expect(parse({ type: 'summon' }).success).toBe(false);
    expect(parse({ type: 'activate', cardUid: 1, abilityKey: '' }).success).toBe(false);
    expect(parse(null).success).toBe(false);
    expect(parse('resign').success).toBe(false);
  });
});
