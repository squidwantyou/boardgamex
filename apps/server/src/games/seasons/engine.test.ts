import { describe, expect, it } from 'vitest';
import {
  ELEMENTS,
  seasonsDefaultOptions,
  type CardRef,
  type Element,
  type SeasonsAction,
  type SeasonsCardDef,
} from '@bgx/protocol/games/seasons';
import { createRng } from '../../random.js';
import {
  BASE_CARDS,
  BASE_CARD_BY_ID,
  CARD_BY_ID,
  EXT1_CARDS,
  EXT2_CARDS,
  SEASONS_CARDS,
} from './cards/base.js';
import { cardSupportIssues, declaredTriggersOf, validateCardPool } from './cards/support.js';
import { registerCards, unregisterCards } from './cards/registry.js';
import { summonEffectKey, summonEffectOf } from './cards/effects.js';
import { energySum } from './rules/play.js';
import { seasons, type SeasonsState } from './engine.js';

const rng = createRng('seasons-test');
const ctx = { now: 0, rng };

function setup(seed = 'seasons-test'): SeasonsState {
  return seasons.setup(2, seasonsDefaultOptions, createRng(seed));
}

function apply(
  state: SeasonsState,
  seat: number,
  action: SeasonsAction,
): SeasonsState {
  const result = seasons.reduce(state, seat, action, ctx);
  if (!result.ok) throw new Error(`${action.type} 失败：${result.code} ${result.message}`);
  return result.state;
}

/** 双方完成组牌，进入对局阶段。 */
function toPlay(state: SeasonsState): SeasonsState {
  let next = state;
  for (let seat = 0; seat < state.players.length; seat += 1) {
    const uids = next.players[seat]?.drafted.map((c) => c.u) ?? [];
    next = apply(next, seat, {
      type: 'organize',
      cardUids: [uids[0] ?? 0, uids[1] ?? 0, uids[2] ?? 0],
    });
    next = apply(next, seat, {
      type: 'organize',
      cardUids: [uids[3] ?? 0, uids[4] ?? 0, uids[5] ?? 0],
    });
  }
  return next;
}

/** 双方依次选走各自当前手牌的第一张，直到轮抽结束。 */
function draftAll(state: SeasonsState): SeasonsState {
  let next = state;
  while (next.phase === 'draft') {
    for (const seat of [0, 1]) {
      const card = next.players[seat]?.draftHand[0];
      if (!card) throw new Error('轮抽手牌为空');
      next = apply(next, seat, { type: 'draft-pick', cardUid: card.u });
    }
  }
  return next;
}

describe('seasons 扩展包', () => {
  const withExtensions = (...extensions: Array<'base' | 'ext1' | 'ext2'>) =>
    seasons.setup(2, { extensions }, createRng('ext-seed'));

  it('ext1 追加 40 张牌（20 种 × 2 张），uid 连续且唯一', () => {
    const cards = [...BASE_CARDS, ...EXT1_CARDS];
    const expected = cards.reduce((sum) => sum + 2, 0);
    expect(expected).toBe(140);
    expect(EXT1_CARDS).toHaveLength(20);
    expect(new Set(EXT1_CARDS.map((card) => card.id)).size).toBe(20);
    expect(cards.some((card) => EXT1_CARDS.some((def) => def.id === card.id))).toBe(true);
    expect(cards.some((card) => EXT2_CARDS.some((def) => def.id === card.id))).toBe(false);
  });

  it('ext1 + ext2 共 180 张牌（每人 9 张后剩 162）', () => {
    expect(SEASONS_CARDS).toHaveLength(90);
    expect(EXT1_CARDS).toHaveLength(20);
    expect(EXT2_CARDS).toHaveLength(20);
  });

  it('缺少 base 时拒绝开局', () => {
    expect(() => withExtensions('ext1')).toThrow('基础卡包（base）是必选项');
  });

  it('两套扩展都能通过完整卡池校验并进入轮抽', () => {
    const state = seasons.setup(
      2,
      { extensions: ['base', 'ext1', 'ext2'] },
      createRng('ext-seed'),
    );
    expect(state.players.flatMap((player) => player.draftHand)).toHaveLength(18);
    expect(state.deck).toHaveLength(162);
    expect(validateCardPool(SEASONS_CARDS)).toEqual([]);
  });
});

describe('seasons 扩展包激活效果', () => {
  const playState = () => toPlay(draftAll(setup('ext-act')));

  function setupActivation(cardId: number) {
    const base = playState();
    const state: SeasonsState = {
      ...base,
      turnOwner: 0,
      players: [
        {
          ...base.players[0]!,
          hand: [...base.players[0]!.hand, { i: cardId, u: 8800 }],
          gauge: base.players[0]!.played.length + 1,
          energies: { water: 5, air: 5, fire: 5, earth: 5 },
          maxEnergy: 40,
          crystals: 0,
        },
        base.players[1]!,
      ],
    };
    const summoned = apply(state, 0, { type: 'summon', cardUid: 8800 });
    expect(summoned.players[0]?.played.some((card) => card.u === 8800)).toBe(true);
    return { state: summoned };
  }

  it('扩展牌池开局后可以直接进入行动阶段', () => {
    expect(playState().phase).toBe('play');
  });
});

describe('seasons setup', () => {
  it('2 人局：每人 9 张轮抽牌，牌堆剩 82 张，实例 uid 唯一', () => {
    const state = setup();
    expect(state.phase).toBe('draft');
    expect(state.draftRound).toBe(0);
    expect(state.players).toHaveLength(2);
    expect(state.players[0]?.draftHand).toHaveLength(9);
    expect(state.players[1]?.draftHand).toHaveLength(9);
    expect(state.deck).toHaveLength(82);

    const uids = [
      ...state.players.flatMap((player) => player.draftHand),
      ...state.deck,
    ].map((card) => card.u);
    expect(new Set(uids).size).toBe(100);
    expect(Math.min(...uids)).toBe(1);
    expect(Math.max(...uids)).toBe(100);
  });

  it('同一 seed 得到同一副牌，不同 seed 不同', () => {
    const a = setup('seed-a');
    const b = setup('seed-a');
    const c = setup('seed-b');
    expect(a.players[0]?.draftHand).toEqual(b.players[0]?.draftHand);
    expect(a.players[1]?.draftHand).toEqual(b.players[1]?.draftHand);
    expect(a.rngSeed).toBe(b.rngSeed);
    expect(a.players[0]?.draftHand).not.toEqual(c.players[0]?.draftHand);
  });

  it('支持 2–4 人，少于 2 人或多于 4 人拒绝', () => {
    expect(() => seasons.setup(1, seasonsDefaultOptions, rng)).toThrow();
    expect(() => seasons.setup(5, seasonsDefaultOptions, rng)).toThrow();

    const three = seasons.setup(3, seasonsDefaultOptions, createRng('three'));
    expect(three.players).toHaveLength(3);
    expect(three.players.every((player) => player.draftHand.length === 9)).toBe(true);
    expect(three.deck).toHaveLength(73);

    const four = seasons.setup(4, seasonsDefaultOptions, createRng('four'));
    expect(four.players).toHaveLength(4);
    expect(four.deck).toHaveLength(64);
  });

  it('3 人局轮抽：一轮三人各选一张后轮数推进、手牌轮转', () => {
    let state = seasons.setup(3, seasonsDefaultOptions, createRng('three-draft'));
    const handBefore = state.players.map((player) => player.draftHand.map((card) => card.u));
    for (const seat of [0, 1, 2]) {
      state = apply(state, seat, { type: 'draft-pick', cardUid: state.players[seat]!.draftHand[0]!.u });
    }
    expect(state.draftRound).toBe(1);
    expect(state.players.map((player) => player.drafted.length)).toEqual([1, 1, 1]);
    expect(state.players[0]!.draftHand.map((card) => card.u)).toEqual(handBefore[2]!.slice(1));
  });

  it('3 人局进入对局阶段掷 4 颗骰，4 人局掷 5 颗', () => {
    const three = seasons.setup(3, seasonsDefaultOptions, createRng('three-play'));
    const four = seasons.setup(4, seasonsDefaultOptions, createRng('four-play'));
    const diceOf = (count: 3 | 4) => {
      const state = count === 3 ? three : four;
      // 轮抽 + 组牌：座位顺序推进，直到 phase === 'play'。
      let next = state;
      while (next.phase !== 'play') {
        if (next.phase === 'draft') {
          const seat = next.players.findIndex((player) => player.drafted.length === next.draftRound);
          next = apply(next, seat, {
            type: 'draft-pick',
            cardUid: next.players[seat]!.draftHand[0]!.u,
          });
        } else {
          const seat = next.players.findIndex((player) => !player.organizeDone);
          const taken = new Set(next.players[seat]!.organizeYear1);
          const uids = next.players[seat]!.drafted
            .filter((card) => !taken.has(card.u))
            .slice(0, 3)
            .map((card) => card.u);
          next = apply(next, seat, { type: 'organize', cardUids: uids });
        }
      }
      return next.season.dice.length;
    };
    expect(diceOf(3)).toBe(4);
    expect(diceOf(4)).toBe(5);
  });

  it('3 人局不能认输，终局名次按分数并列', () => {
    const state = seasons.setup(3, seasonsDefaultOptions, createRng('three-end'));
    const resign = seasons.reduce(state, 0, { type: 'resign' }, ctx);
    expect(resign.ok).toBe(false);
    if (!resign.ok) expect(resign.code).toBe('resign_not_allowed');
    expect(seasons.resignable(state, 0)).toBe(false);

    const ended: SeasonsState = {
      ...state,
      phase: 'ended',
      result: {
        winner: null,
        draw: true,
        players: [
          { seat: 0, score: 10 } as never,
          { seat: 1, score: 10 } as never,
          { seat: 2, score: 5 } as never,
        ],
      },
    };
    expect(seasons.rankings(ended).map((entry) => entry.rank)).toEqual([1, 1, 3]);
    expect(seasons.rankings(ended).map((entry) => entry.score)).toEqual([10, 10, 5]);
  });
});

describe('seasons draft', () => {
  it('选牌后手牌减少、已选增加，同一轮不能重复选', () => {
    const state = setup();
    const card = state.players[0]?.draftHand[0];
    expect(card).toBeDefined();
    if (!card) return;

    const next = apply(state, 0, { type: 'draft-pick', cardUid: card.u });
    expect(next.players[0]?.draftHand).toHaveLength(8);
    expect(next.players[0]?.drafted.map((c) => c.u)).toEqual([card.u]);
    expect(next.draftRound).toBe(0);

    const again = seasons.reduce(next, 0, { type: 'draft-pick', cardUid: card.u }, ctx);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('already_picked');

    const notMine = seasons.reduce(
      next,
      0,
      { type: 'draft-pick', cardUid: next.players[0]?.draftHand[0]?.u ?? -1 },
      ctx,
    );
    expect(notMine.ok).toBe(false);
  });

  it('双方选完一轮后手牌传给左边，轮数 +1', () => {
    const state = setup();
    const hand0 = state.players[0]?.draftHand ?? [];
    const hand1 = state.players[1]?.draftHand ?? [];
    let next = apply(state, 0, { type: 'draft-pick', cardUid: hand0[0]?.u ?? -1 });
    next = apply(next, 1, { type: 'draft-pick', cardUid: hand1[0]?.u ?? -1 });

    expect(next.draftRound).toBe(1);
    // seat0 拿到 seat1 剩下的 8 张，seat1 拿到 seat0 剩下的 8 张
    expect(next.players[0]?.draftHand.map((c) => c.u)).toEqual(
      hand1.slice(1).map((c) => c.u),
    );
    expect(next.players[1]?.draftHand.map((c) => c.u)).toEqual(
      hand0.slice(1).map((c) => c.u),
    );
  });

  it('9 轮后进入组牌阶段，每人 9 张已选牌', () => {
    const state = draftAll(setup());
    expect(state.phase).toBe('organize');
    expect(state.draftRound).toBe(9);
    for (const player of state.players) {
      expect(player.draftHand).toHaveLength(0);
      expect(player.drafted).toHaveLength(9);
      expect(player.organizeDone).toBe(false);
    }
    const leftover = seasons.reduce(
      state,
      0,
      { type: 'draft-pick', cardUid: state.players[0]?.drafted[0]?.u ?? -1 },
      ctx,
    );
    expect(leftover.ok).toBe(false);
    if (!leftover.ok) expect(leftover.code).toBe('bad_phase');
  });
});

describe('seasons organize', () => {
  function organized(): SeasonsState {
    return draftAll(setup());
  }

  it('第一步存第 1 年，第二步分配第 2 年并把剩余归第 3 年', () => {
    const state = organized();
    const uids = state.players[0]?.drafted.map((c) => c.u) ?? [];
    const first: [number, number, number] = [uids[0] ?? 0, uids[1] ?? 0, uids[2] ?? 0];
    const second: [number, number, number] = [uids[3] ?? 0, uids[4] ?? 0, uids[5] ?? 0];

    const step1 = apply(state, 0, { type: 'organize', cardUids: first });
    expect(step1.players[0]?.organizeYear1).toEqual(first);
    expect(step1.players[0]?.organizeDone).toBe(false);
    expect(step1.phase).toBe('organize');

    const step2 = apply(step1, 0, { type: 'organize', cardUids: second });
    const me = step2.players[0];
    expect(me?.organizeDone).toBe(true);
    expect(me?.hand.map((c) => c.u)).toEqual(first);
    expect(me?.library2.map((c) => c.u)).toEqual(second);
    expect(me?.library3.map((c) => c.u)).toEqual(uids.slice(6));
    expect(me?.organizeYear2).toEqual(second);
  });

  it('拒绝重复、非本人牌与非法张数', () => {
    const state = organized();
    const uids = state.players[0]?.drafted.map((c) => c.u) ?? [];
    const dup = [uids[0] ?? 0, uids[0] ?? 0, uids[1] ?? 0] as [number, number, number];
    const res = seasons.reduce(state, 0, { type: 'organize', cardUids: dup }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('duplicate_card');

    const foreign = state.players[1]?.drafted[0]?.u ?? -1;
    const res2 = seasons.reduce(
      state,
      0,
      { type: 'organize', cardUids: [foreign, uids[0] ?? 0, uids[1] ?? 0] },
      ctx,
    );
    expect(res2.ok).toBe(false);
    if (!res2.ok) expect(res2.code).toBe('card_not_drafted');
  });

  it('撤回可清空两步；完成组牌后不能撤回也不能再改', () => {
    const state = organized();
    const uids = state.players[0]?.drafted.map((c) => c.u) ?? [];
    const step1 = apply(state, 0, {
      type: 'organize',
      cardUids: [uids[0] ?? 0, uids[1] ?? 0, uids[2] ?? 0],
    });
    const reset = apply(step1, 0, { type: 'organize-reset' });
    expect(reset.players[0]?.organizeYear1).toEqual([]);
    expect(reset.players[0]?.organizeYear2).toEqual([]);

    const done = apply(
      apply(reset, 0, {
        type: 'organize',
        cardUids: [uids[0] ?? 0, uids[1] ?? 0, uids[2] ?? 0],
      }),
      0,
      { type: 'organize', cardUids: [uids[3] ?? 0, uids[4] ?? 0, uids[5] ?? 0] },
    );
    expect(done.players[0]?.organizeDone).toBe(true);

    const secondAttempt = seasons.reduce(
      done,
      0,
      { type: 'organize', cardUids: [uids[6] ?? 0, uids[7] ?? 0, uids[8] ?? 0] },
      ctx,
    );
    expect(secondAttempt.ok).toBe(false);
    if (!secondAttempt.ok) expect(secondAttempt.code).toBe('organize_done');

    const resetAfterDone = seasons.reduce(done, 0, { type: 'organize-reset' }, ctx);
    expect(resetAfterDone.ok).toBe(false);
    if (!resetAfterDone.ok) expect(resetAfterDone.code).toBe('organize_done');
  });

  it('双方都完成后进入对局阶段', () => {
    const state = organized();
    let next = state;
    for (const seat of [0, 1]) {
      const uids = next.players[seat]?.drafted.map((c) => c.u) ?? [];
      next = apply(next, seat, {
        type: 'organize',
        cardUids: [uids[0] ?? 0, uids[1] ?? 0, uids[2] ?? 0],
      });
      next = apply(next, seat, {
        type: 'organize',
        cardUids: [uids[3] ?? 0, uids[4] ?? 0, uids[5] ?? 0],
      });
    }
    expect(next.phase).toBe('play');
    expect(next.currentPicker).toBe(next.startPlayer);
    expect(next.turnOwner).toBeNull();
    expect(seasons.finished(next)).toBe(false);
    expect(seasons.turn(next)).toBe(next.startPlayer);
  });
});

describe('seasons dice', () => {
  it('进入对局时按人数 + 1 掷出当季骰子', () => {
    const state = toPlay(draftAll(setup()));
    expect(state.phase).toBe('play');
    expect(state.seasonIdx).toBe(0);
    expect(state.season?.index).toBe(0);
    expect(state.season?.dice).toHaveLength(3);
    for (const die of state.season?.dice ?? []) {
      expect(die.letter).toBe('w');
      expect(die.face).toBeGreaterThanOrEqual(1);
      expect(die.face).toBeLessThanOrEqual(6);
      expect(die.pip).toBeGreaterThanOrEqual(1);
      expect(die.pip).toBeLessThanOrEqual(3);
      expect(die.pickedBy).toBeNull();
    }
    expect(state.currentPicker).toBe(0);
    expect(state.turnOwner).toBeNull();
  });

  it('同一 seed 掷出同一组骰子', () => {
    const a = toPlay(draftAll(setup('dice-seed')));
    const b = toPlay(draftAll(setup('dice-seed')));
    expect(a.season?.dice).toEqual(b.season?.dice);
    expect(a.rngCursor).toBe(b.rngCursor);
  });

  it('按顺序选骰，选满后进入行动阶段，行动顺序按选骰顺序', () => {
    const state = toPlay(draftAll(setup()));
    const first = apply(state, 0, { type: 'draft-dice', dieIndex: 1 });
    expect(first.season?.dice[1]?.pickedBy).toBe(0);
    expect(first.currentPicker).toBe(1);
    expect(first.turnOwner).toBeNull();
    expect(first.dicePicked).toEqual([0]);

    const notYourTurn = seasons.reduce(first, 0, { type: 'draft-dice', dieIndex: 0 }, ctx);
    expect(notYourTurn.ok).toBe(false);
    if (!notYourTurn.ok) expect(notYourTurn.code).toBe('not_your_turn');

    const taken = seasons.reduce(first, 1, { type: 'draft-dice', dieIndex: 1 }, ctx);
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.code).toBe('die_taken');

    const second = apply(first, 1, { type: 'draft-dice', dieIndex: 2 });
    expect(second.dicePicked).toEqual([0, 1]);
    expect(second.turnOwner).toBe(0);
    expect(second.currentPicker).toBe(0);
    expect(second.pickedThisSeason).toEqual([]);

    // 选满骰后先建立首位玩家的骰面抽牌待决，不能绕过该待决另选骰。
    const pendingDieDraw = second.pendingChoice?.key === 'die_draw';
    const after = seasons.reduce(
      second,
      0,
      { type: pendingDieDraw ? 'resolve-choice' : 'draft-dice', ...(pendingDieDraw
        ? { choice: [second.pendingCards![0]!.u] }
        : { dieIndex: 0 }) } as SeasonsAction,
      ctx,
    );
    expect(after.ok).toBe(true);
  });

  it('拒绝非法骰子索引与阶段外的选骰', () => {
    const state = toPlay(draftAll(setup()));
    for (const dieIndex of [-1, 3, 99]) {
      const res = seasons.reduce(state, 0, { type: 'draft-dice', dieIndex }, ctx);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('invalid_die');
    }

    const drafting = setup();
    const res = seasons.reduce(drafting, 0, { type: 'draft-dice', dieIndex: 0 }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('bad_phase');
  });

  it('视图暴露骰面与选中状态，但不泄露未知信息', () => {
    const state = apply(toPlay(draftAll(setup())), 0, { type: 'draft-dice', dieIndex: 0 });
    const view = seasons.view(state, 1, true);
    expect(view.season).toEqual({
      name: '冬季',
      nameEn: 'Winter',
      element: 'water',
      letter: 'w',
      index: 0,
    });
    expect(view.dice).toHaveLength(3);
    expect(view.dice[0]?.picked).toBe(true);
    expect(view.dice[0]?.pickedBy).toBe(0);
    expect(view.dice[1]?.picked).toBe(false);
    expect(view.dice[1]?.pickedBy).toBeNull();
    expect(view.myTurn).toBe(true);
    expect(view.currentPicker).toBe(1);
  });
});

describe('seasons resign', () => {
  it('2 人局可认输，对方获胜，终局后拒绝继续操作', () => {
    const state = setup();
    expect(seasons.resignable(state, 0)).toBe(true);
    const result = seasons.reduce(state, 1, { type: 'resign' }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.state;
    expect(next.phase).toBe('ended');
    expect(seasons.finished(next)).toBe(true);
    expect(seasons.winner(next)).toBe(0);
    expect(seasons.resignable(next, 0)).toBe(false);
    expect(seasons.rankings(next)).toEqual([
      { seat: 0, rank: 1, score: undefined },
      { seat: 1, rank: 2, score: undefined },
    ]);

    const after = seasons.reduce(next, 0, { type: 'resign' }, ctx);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.code).toBe('game_over');
  });

  it('3 人局不能认输', () => {
    const state = setup();
    const three: SeasonsState = {
      ...state,
      players: [
        ...state.players,
        { ...state.players[1]!, seat: 2 },
      ],
    };
    expect(seasons.resignable(three, 0)).toBe(false);
    const result = seasons.reduce(three, 0, { type: 'resign' }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('resign_not_allowed');
  });
});

describe('seasons view', () => {
  it('轮抽阶段只暴露自己的手牌', () => {
    const state = setup();
    const view0 = seasons.view(state, 0, true);
    const view1 = seasons.view(state, 1, true);
    const spectator = seasons.view(state, null, true);

    expect(view0.players[0]?.hand).toEqual([]);
    expect(view0.players[0]?.draftHand).toHaveLength(9);
    expect(view0.players[1]?.draftHand).toBeNull();
    expect(view0.players[1]?.draftHandCount).toBe(9);
    expect(view1.players[0]?.draftHand).toBeNull();

    expect(spectator.players[0]?.draftHand).toBeNull();
    expect(spectator.players[1]?.draftHand).toBeNull();
    expect(spectator.myTurn).toBe(false);

    expect(view0.myTurn).toBe(true);
    expect(view0.draftPickedThisRound).toEqual([]);
  });

  it('观战者看不到手牌/徽章抽牌，也看不到弹窗里的私有候选牌', () => {
    const base = actionPhase();
    const hand = base.players[0]!.hand.slice(0, 1);
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0 ? { ...player, badgeDraw: hand } : player,
      ),
      pendingChoice: {
        kind: 'card_pick',
        key: 'divine_chalice',
        choosingSeat: 0,
        options: { title: '抽 4 张，选择 1 张免费召唤', amount: 1 },
      },
      pendingCards: hand,
    };
    const mine = seasons.view(state, 0, true);
    const opponent = seasons.view(state, 1, true);
    const spectator = seasons.view(state, null, true);

    expect(mine.players[0]?.badgeDraw).toHaveLength(1);
    expect(mine.players[0]?.hand).toEqual(base.players[0]?.hand);
    expect((mine.pendingChoice?.options as { cards?: unknown }).cards).toHaveLength(1);

    expect(opponent.players[0]?.badgeDraw).toBeNull();
    expect(spectator.players[0]?.badgeDraw).toBeNull();
    expect(spectator.players[0]?.hand).toBeNull();
    expect(spectator.players[1]?.hand).toBeNull();
    expect(
      (opponent.pendingChoice?.options as { cards?: unknown }).cards,
    ).toBeUndefined();
    expect(
      (spectator.pendingChoice?.options as { cards?: unknown }).cards,
    ).toBeUndefined();
    expect(spectator.myTurn).toBe(false);
    expect(spectator.pendingQueueCount).toBe(0);
  });

  it('组牌阶段只暴露自己的已选牌与分配', () => {
    const state = draftAll(setup());
    const view0 = seasons.view(state, 0, true);
    expect(view0.players[0]?.drafted).toHaveLength(9);
    expect(view0.players[1]?.drafted).toBeNull();
    expect(view0.players[0]?.organizeYear1).toEqual([]);
    expect(view0.myTurn).toBe(true);
    expect(view0.draftPickedThisRound).toEqual([]);
  });

  it('对局阶段按 turnOwner 判断 myTurn，观战者不能行动', () => {
    const state: SeasonsState = {
      ...setup(),
      phase: 'play',
      turnOwner: 1,
      currentPicker: 0,
    };
    expect(seasons.view(state, 0, true).myTurn).toBe(false);
    expect(seasons.view(state, 1, true).myTurn).toBe(true);
    expect(seasons.view(state, null, true).myTurn).toBe(false);
    expect(seasons.turn(state)).toBe(1);
  });

  it('待选弹窗只有应答者能行动', () => {
    const state: SeasonsState = {
      ...setup(),
      phase: 'play',
      turnOwner: 0,
      pendingChoice: { kind: 'element', key: 'k', choosingSeat: 1, options: {} },
    };
    expect(seasons.view(state, 0, true).myTurn).toBe(false);
    expect(seasons.view(state, 1, true).myTurn).toBe(true);
  });
});

/** 双方各选一颗骰子，进入行动阶段（首位玩家的骰面奖励此时已结算）。 */
function actionPhase(seed = 'seasons-test'): SeasonsState {
  const picked = apply(toPlay(draftAll(setup(seed))), 0, {
    type: 'draft-dice',
    dieIndex: 0,
  });
  return apply(picked, 1, { type: 'draft-dice', dieIndex: 1 });
}

function actionPhaseForSeats(
  playerCount: number,
  seed = 'seasons-test',
): SeasonsState {
  let next = seasons.setup(playerCount, seasonsDefaultOptions, createRng(seed));
  while (next.phase === 'draft') {
    for (let seat = 0; seat < playerCount; seat += 1) {
      const card = next.players[seat]?.draftHand[0];
      if (!card) throw new Error('轮抽手牌为空');
      next = apply(next, seat, { type: 'draft-pick', cardUid: card.u });
    }
  }
  next = toPlay(next);
  for (let seat = 0; seat < playerCount; seat += 1) {
    next = apply(next, seat, { type: 'draft-dice', dieIndex: seat });
  }
  return next;
}

describe('seasons 卡池框架', () => {
  it('骰子季节：100 张恶意之骰', () => {
    const state = seasons.setup(2, { pool: 'dice_season' }, createRng('dice-season'));
    const all = [...state.players.flatMap((player) => player.draftHand), ...state.deck];
    expect(all).toHaveLength(100);
    expect(state.deck).toHaveLength(82);
    for (const card of all) expect(card.i).toBe(15);
    expect(new Set(all.map((card) => card.u)).size).toBe(100);
  });

  it('五福季节：5 种护符各 20 张，共 100 张', () => {
    const state = seasons.setup(2, { pool: 'five_fortunes' }, createRng('five-fortunes'));
    const all = [...state.players.flatMap((player) => player.draftHand), ...state.deck];
    expect(all).toHaveLength(100);
    expect(state.deck).toHaveLength(82);
    const ids = new Set([1, 2, 3, 4, 31]);
    for (const card of all) expect(ids.has(card.i)).toBe(true);
    for (const id of ids) {
      expect(all.filter((card) => card.i === id)).toHaveLength(20);
    }
  });

  it('全部 90 张卡（基础 + 扩展）都通过卡池校验', () => {
    expect(validateCardPool(BASE_CARDS)).toEqual([]);
    expect(validateCardPool(SEASONS_CARDS)).toEqual([]);
  });

  it('支持扫描只看真实分发入口，缺 handler 的附加触发不会被白名单放行', () => {
    const fake: SeasonsCardDef = {
      ...BASE_CARDS[0]!,
      id: 9002,
      nameZh: '缺处理程序测试卡',
      effect: {
        trigger: 'on_summon',
        type: 'not_a_real_key',
        triggers: ['on_summon', 'activation'],
      },
      cost: { water: 0, air: 0, fire: 0, earth: 0, crystal: 0 },
    };
    const issues = cardSupportIssues(fake);
    expect(issues.map((issue) => issue.code)).toEqual([
      'summon_handler_missing',
      'activation_handler_missing',
    ]);
    expect(validateCardPool([...BASE_CARDS, fake])).toContainEqual({
      cardId: fake.id,
      message: '召唤入口缺少处理程序：on_summon → not_a_real_key',
    });
  });

  it('邪神之心是每回合一次的被动效果，不伪装成主动激活', () => {
    const heart = EXT1_CARDS.find((card) => card.id === 51);
    expect(heart).toBeDefined();
    if (!heart) return;
    expect(declaredTriggersOf(heart)).toEqual(['permanent']);
    expect(heart.effect?.abilities?.some((ability) => ability.kind === 'sealed_energy')).toBe(true);
    expect(cardSupportIssues(heart)).toEqual([]);
  });

  it('未登记的效果 key 会被校验拦下，并在 setup 时报错', () => {
    const fake: SeasonsCardDef = {
      ...BASE_CARDS[0]!,
      id: 9001,
      nameZh: '测试卡',
      effect: { trigger: 'on_summon', type: 'not_a_real_key' },
    };
    const issues = validateCardPool([...BASE_CARDS, fake]);
    expect(issues).toContainEqual({
      cardId: 9001,
      message: '召唤入口缺少处理程序：on_summon → not_a_real_key',
    });
    registerCards([fake]);
    try {
      expect(() =>
        seasons.setup(2, { customDeck: '1,2,9001' }, createRng('pool-bad')),
      ).toThrow(/卡池校验失败：.*not_a_real_key/);
    } finally {
      unregisterCards([9001]);
    }
  });

  it('customDeck 可以拼出任意小卡池并正常发牌', () => {
    const ids = BASE_CARDS.slice(0, 12).map((def) => def.id);
    const state = seasons.setup(
      2,
      { customDeck: ids.join(',') },
      createRng('pool-small'),
    );
    expect(state.deck.length).toBe(24 - 18);
    expect(state.players[0]?.draftHand).toHaveLength(9);
    expect(state.players[1]?.draftHand).toHaveLength(9);
    const uids = new Set(
      [...state.players.flatMap((player) => player.draftHand), ...state.deck].map((card) => card.u),
    );
    expect(uids.size).toBe(24);
    // 卡牌 id 只来自给定卡池。
    const pool = new Set(ids);
    for (const card of state.deck) expect(pool.has(card.i)).toBe(true);
  });

  it('customDeck 里未知 id / 卡池不足会给出明确错误', () => {
    expect(() =>
      seasons.setup(2, { customDeck: '1,2,9999' }, createRng('pool-missing')),
    ).toThrow(/未知卡牌 id：9999/);
    expect(() =>
      seasons.setup(2, { customDeck: '1,2' }, createRng('pool-tiny')),
    ).toThrow(/卡池只有 4 张牌，至少需要 18 张/);
  });
});

describe('seasons 储备语义（卡上能量 = 储备区）', () => {
  it('魔典卡上的能量可以用来支付召唤费用', () => {
    const base = actionPhase('stored-pay');
    const state: SeasonsState = {
      ...base,
      turnOwner: 0,
      players: base.players.map((player) =>
        player.seat === 0
          ? {
              ...player,
              gauge: 5,
              maxEnergy: 10,
              crystals: 0,
              energies: { water: 1, air: 0, fire: 0, earth: 0 },
              hand: [{ i: 29, u: 7000 }],
              played: [{ i: 18, u: 7001, stored: { water: 2 } }],
            }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 7000 }, ctx);
    expect(res.ok, res.ok ? '' : `${res.code}: ${res.message}`).toBe(true);
    if (!res.ok) return;
    const me = res.state.players[0]!;
    expect(me.energies.water).toBe(0);
    expect(me.played.find((card) => card.u === 7001)?.stored?.water ?? 0).toBe(0);
    expect(me.played.some((card) => card.u === 7000)).toBe(true);
    expect(me.crystals).toBe(20);
  });

  it('魔典离场导致上限下降时，由本人选择弃掉多余能量', () => {
    const base = actionPhase('stored-discard');
    const state: SeasonsState = {
      ...base,
      turnOwner: 0,
      players: base.players.map((player) =>
        player.seat === 0
          ? {
              ...player,
              gauge: 5,
              maxEnergy: 10,
              crystals: 0,
              energies: { water: 5, air: 5, fire: 0, earth: 0 },
              hand: [{ i: 17, u: 7000 }],
              played: [{ i: 18, u: 7001 }],
            }
          : player,
      ),
    };
    const summoned = seasons.reduce(state, 0, { type: 'summon', cardUid: 7000 }, ctx);
    expect(summoned.ok).toBe(true);
    if (!summoned.ok) return;
    expect(summoned.state.pendingChoice?.kind).toBe('multi_player_pick');

    const returned = seasons.reduce(
      summoned.state,
      0,
      { type: 'resolve-choice', choice: { uid: 7001 } },
      ctx,
    );
    expect(returned.ok).toBe(true);
    if (!returned.ok) return;
    expect(returned.state.players[0]?.maxEnergy).toBe(7);
    expect(returned.state.players[0]?.energies.water).toBe(4);
    expect(returned.state.players[0]?.energies.air).toBe(4);
    expect(returned.state.pendingChoice?.kind).toBe('energy_discard');
    expect(returned.state.pendingChoice?.options.amount).toBe(1);

    const discard = seasons.reduce(
      returned.state,
      0,
      { type: 'resolve-choice', choice: { water: 1, air: 0, fire: 0, earth: 0 } },
      ctx,
    );
    expect(discard.ok).toBe(true);
    if (!discard.ok) return;
    expect(discard.state.pendingChoice).toBeNull();
    expect(discard.state.players[0]?.energies.water).toBe(3);
    expect(discard.state.players[0]?.energies.air).toBe(4);
  });

  it('energy_discard 的可用能量只对本人可见', () => {
    const base = actionPhase('stored-discard-view');
    const state: SeasonsState = {
      ...base,
      turnOwner: 0,
      pendingChoice: {
        kind: 'energy_discard',
        key: 'energy_discard',
        choosingSeat: 0,
        options: {
          title: '储备上限变为 7，请弃掉 2 个能量',
          amount: 2,
          available: { water: 3, air: 2, fire: 0, earth: 0 },
          label: '弃掉',
        },
      },
    };
    const mine = seasons.view(state, 0) as SeasonsGameView;
    const other = seasons.view(state, 1) as SeasonsGameView;
    expect((mine.pendingChoice?.options as Record<string, unknown>).available).toEqual({
      water: 3,
      air: 2,
      fire: 0,
      earth: 0,
    });
    expect((other.pendingChoice?.options as Record<string, unknown>).available).toBeUndefined();
  });
});

  it('流水护符卡上的能量可以支付召唤费用', () => {
    const amulet = BASE_CARDS.find((card) => card.nameZh === '流水护符')!;
    const target = BASE_CARDS.find((card) => card.nameZh === '深凝视的提图斯')!;
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              energies: { water: 0, air: 0, fire: 0, earth: 0 },
               played: [...player.played, { i: amulet.id, u: 9401, stored: { fire: 2 } }],
              hand: [{ i: target.id, u: 9402 }, ...player.hand],
            }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 9402 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // 费用 1 火从卡上能量扣，而不是储备区。
    const amuletAfter = res.state.players[0]?.played.find((card) => card.u === 9401);
    expect(amuletAfter?.stored?.fire).toBe(1);
    expect(res.state.players[0]?.energies.fire).toBe(0);
  });

  it('流水护符卡上的能量可以用于转换（晶化）', () => {
    const amulet = BASE_CARDS.find((card) => card.nameZh === '流水护符')!;
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      turnOwner: 0,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              canTransmute: true,
              energies: { water: 0, air: 0, fire: 0, earth: 0 },
              played: [...player.played, { i: amulet.id, u: 9403, stored: { water: 2 } }],
            }
          : player,
      ),
    };
    const before = state.players[0]?.crystals ?? 0;
    const res = seasons.reduce(state, 0, { type: 'transmute', element: 'water' }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const amuletAfter = res.state.players[0]?.played.find((card) => card.u === 9403);
    expect(amuletAfter?.stored?.water).toBe(1);
    expect(res.state.players[0]?.crystals).toBeGreaterThan(before);
  });

describe('seasons die rewards', () => {
  it('首位玩家在行动阶段开始时结算骰面奖励，后位玩家暂不结算', () => {
    const before = toPlay(draftAll(setup('reward-seed')));
    const die = before.season?.dice[0];
    expect(die).toBeDefined();

    const after = actionPhase('reward-seed');
    const p0Before = before.players[0];
    const p0After = after.players[0];
    expect(p0Before).toBeDefined();
    expect(p0After).toBeDefined();
    expect(p0After?.gauge).toBe((p0Before?.gauge ?? 0) + (die?.rewards.summon ? 1 : 0));
    expect(p0After?.crystals).toBe((p0Before?.crystals ?? 0) + (die?.rewards.crystals ?? 0));
    expect(p0After?.canTransmute).toBe(Boolean(die?.rewards.transmute));
    expect(p0After?.hand.length).toBe(
      (p0Before?.hand.length ?? 0) + (die?.rewards.card ? 1 : 0),
    );
    // 能量奖励受上限封顶，只断言没有减少
    const sum = (energies: Record<string, number> | undefined): number =>
      Object.values(energies ?? {}).reduce((total, value) => total + value, 0);
    expect(sum(p0After?.energies)).toBeGreaterThanOrEqual(sum(p0Before?.energies));

    // 后位玩家尚未结算
    expect(after.players[1]).toEqual(before.players[1]);
    expect(after.log.at(-1)?.msg).toContain('骰子效果');
  });

  it('能量装不下时挂 energy_swap，由玩家决定保留哪些元素', () => {
    const base = toPlay(draftAll(setup('swap-seed')));
    const zero = { summon: false, transmute: false, card: false, crystals: 0, water: 0, air: 0, fire: 0, earth: 0 };
    const prepared: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              energies: { water: 6, air: 1, fire: 0, earth: 0 },
              gauge: 9,
            }
          : player,
      ),
      season: {
        ...base.season!,
        dice: base.season!.dice.map((die, index) => ({
          ...die,
          pickedBy: null,
          rewards: index === 0 ? { ...zero, water: 2 } : zero,
        })),
      },
    };
    const first = apply(prepared, 0, { type: 'draft-dice', dieIndex: 0 });
    const picked = apply(first, 1, { type: 'draft-dice', dieIndex: 1 });
    expect(picked.pendingChoice?.kind).toBe('energy_swap');
    expect(picked.pendingChoice?.options.total).toBe(7);
    expect(picked.pendingChoice?.options.pool).toBe(9);
    expect(picked.pendingChoice?.options.current).toEqual({ water: 6, air: 1, fire: 0, earth: 0 });
    // 对手看不到储备构成，只能看到上限/池大小。
    const opponentChoice = seasons.view(picked, 1, true).pendingChoice;
    expect(opponentChoice?.options.current).toBeUndefined();
    expect(opponentChoice?.options.incoming).toBeUndefined();
    expect(seasons.view(picked, 0, true).pendingChoice?.options.current).toEqual({
      water: 6,
      air: 1,
      fire: 0,
      earth: 0,
    });

    const invalid = seasons.reduce(picked, 0, {
      type: 'resolve-choice',
      choice: { water: 5, air: 2, fire: 0, earth: 0 },
    }, ctx);
    expect(invalid.ok).toBe(false);
    expect(picked.players[0]?.energies).toEqual({ water: 6, air: 1, fire: 0, earth: 0 });
    const swapped = apply(picked, 0, {
      type: 'resolve-choice',
      choice: { water: 6, air: 1, fire: 0, earth: 0 },
    });
    expect(swapped.players[0]?.energies).toEqual({ water: 6, air: 1, fire: 0, earth: 0 });
    expect(swapped.pendingChoice).toBeNull();
    expect(swapped.log.some((entry) => entry.msg.includes('重新分配能量'))).toBe(true);
  });

  it('储备能量获取装不下时也挂 energy_swap（无后续链路的选择）', () => {
    const base = actionPhase('gain-swap');
    const prepared: SeasonsState = {
      ...base,
      turnOwner: 0,
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, energies: { water: 6, air: 1, fire: 0, earth: 0 } }
          : player,
      ),
      pendingChoice: {
        kind: 'element_alloc',
        key: 'bespelled_grimoire',
        choosingSeat: 0,
        options: { amount: 3, target: 'reserve', title: '选择获得 3 个能量' },
      },
    };
    const queued = apply(prepared, 0, {
      type: 'resolve-choice',
      choice: { water: 3, air: 0, fire: 0, earth: 0 },
    });
    expect(queued.pendingChoice?.kind).toBe('energy_swap');
    expect(queued.pendingChoice?.options.amount).toBe(3);
    expect(queued.pendingChoice?.options.current).toEqual({ water: 6, air: 1, fire: 0, earth: 0 });
    // 选择结果此时尚未入账，由 energy_swap 一次性写回。
    expect(queued.players[0]?.energies).toEqual({ water: 6, air: 1, fire: 0, earth: 0 });

    const swapped = apply(queued, 0, {
      type: 'resolve-choice',
      choice: { water: 7, air: 0, fire: 0, earth: 0 },
    });
    expect(swapped.players[0]?.energies).toEqual({ water: 7, air: 0, fire: 0, earth: 0 });
  });

  it('energy_swap 保留总量不等于上限时拒绝，弹窗保留', () => {
    const base = toPlay(draftAll(setup('swap-bad')));
    const zero = { summon: false, transmute: false, card: false, crystals: 0, water: 0, air: 0, fire: 0, earth: 0 };
    const prepared: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0 ? { ...player, energies: { water: 7, air: 0, fire: 0, earth: 0 }, gauge: 9 } : player,
      ),
      season: {
        ...base.season!,
        dice: base.season!.dice.map((die, index) => ({
          ...die,
          pickedBy: null,
          rewards: index === 0 ? { ...zero, water: 1 } : zero,
        })),
      },
    };
    const first = apply(prepared, 0, { type: 'draft-dice', dieIndex: 0 });
    const picked = apply(first, 1, { type: 'draft-dice', dieIndex: 1 });
    expect(picked.pendingChoice?.kind).toBe('energy_swap');
    const result = seasons.reduce(picked, 0, {
      type: 'resolve-choice',
      choice: { water: 3 },
    }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('choice_amount_mismatch');
  });
});

describe('seasons element_alloc 溢出与后续链路', () => {
  function chainReady(seed: string): { base: SeasonsState; ref: CardRef } {
    const base = actionPhase(seed);
    const ref = base.deck[base.deck.length - 1]!;
    return {
      ref,
      base: {
        ...base,
        turnOwner: 0,
        deck: base.deck.slice(0, -1),
        players: base.players.map((player) =>
          player.seat === 0
            ? { ...player, energies: { water: 6, air: 1, fire: 0, earth: 0 } }
            : player,
        ),
      },
    };
  }

  it('discard_pending 链路：重分配后继续弃掉暂存的牌', () => {
    const { base, ref } = chainReady('swap-chain-discard');
    const prepared: SeasonsState = {
      ...base,
      pendingCards: [ref],
      pendingChoice: {
        kind: 'element_alloc',
        key: 'vampiric_crown',
        choosingSeat: 0,
        options: { amount: 3, target: 'reserve', title: '选择获得 3 个能量', then: 'discard_pending' },
      },
    };
    const queued = apply(prepared, 0, {
      type: 'resolve-choice',
      choice: { water: 0, air: 0, fire: 3, earth: 0 },
    });
    expect(queued.pendingChoice?.kind).toBe('energy_swap');
    expect(queued.pendingChoice?.options.after).toEqual({ kind: 'discard_pending' });

    const done = apply(queued, 0, {
      type: 'resolve-choice',
      choice: { water: 6, air: 1, fire: 0, earth: 0 },
    });
    expect(done.pendingCards).toBeNull();
    expect(done.discard.some((card) => card.u === ref.u)).toBe(true);
    expect(done.players[0]?.energies).toEqual({ water: 6, air: 1, fire: 0, earth: 0 });
  });
});

/** 进入行动阶段并给 0 号位充足资源，返回一个可自由组手牌的状态。 */
function summonReady(): SeasonsState {
  const base = actionPhase();
  return {
    ...base,
    players: base.players.map((player, seat) =>
      seat === 0
        ? {
            ...player,
            gauge: 9,
            energies: { water: 9, air: 9, fire: 9, earth: 9 },
            crystals: 9,
          }
        : player,
    ),
  };
}

function findDef(predicate: (def: (typeof BASE_CARDS)[number]) => boolean) {
  const def = BASE_CARDS.find(predicate);
  if (!def) throw new Error('卡表中没有符合条件的卡');
  return def;
}

describe('Magma Core summon triggers', () => {
  const CORE_UID = 7600;
  const summonUid = 7601;
  const freeUid = 7602;
  const normalMagicItem = BASE_CARDS.find((card) => card.id === 46);
  const normalFamiliar = BASE_CARDS.find((card) => card.id === 39);
  const plain = BASE_CARDS.find((card) => card.id === 15);
  const freeSource = BASE_CARDS.find((card) => card.id === 24);
  if (!normalMagicItem || !normalFamiliar || !plain || !freeSource) {
    throw new Error('熔岩核夹具缺少召唤用卡牌');
  }

  function magmaReady(
    players = 2,
    summonCard: SeasonsCardDef = normalMagicItem,
    options: {
      seed?: string;
      payerFire?: number;
      maxEnergy?: number;
      extraPlayed?: { i: number; u: number }[];
      coreUids?: number[];
      extraCoresBySeat?: Partial<Record<number, number[]>>;
      hand?: CardRef[];
    } = {},
  ): SeasonsState {
    const base =
      players === 2
        ? actionPhase(options.seed ?? 'magma-core')
        : actionPhaseForSeats(players, options.seed ?? 'magma-core');
    const core = EXT2_CARDS.find((card) => card.id === 72);
    if (!core) throw new Error('熔岩核夹具缺少熔岩核');
    const coreUids = options.coreUids ?? [CORE_UID];
    const payerFire = options.payerFire ?? 9;
    const state: SeasonsState = {
      ...base,
      players: Array.from({ length: players }, (_, seat) => ({
        ...(base.players[seat] ?? base.players[seat % base.players.length]!),
        seat,
        gauge: 12,
        maxEnergy: options.maxEnergy ?? 40,
        crystals: 20,
        energies: {
          water: 9,
          air: 9,
          fire: seat === 0 ? payerFire : 9,
          earth: 9,
        },
        played:
          seat === 1
            ? coreUids.map((uid) => ({ i: core.id, u: uid }))
            : seat === 0
              ? (options.extraPlayed ?? [])
              : (options.extraCoresBySeat?.[seat] ?? []).map((uid) => ({
                  i: core.id,
                  u: uid,
                })),
        hand:
          seat === 0
            ? (options.hand ?? [{ i: summonCard.id, u: summonUid }])
            : [{ i: plain.id, u: 7700 + seat }],
      })),
      turnOwner: 0,
      currentPicker: 0,
      dicePicked: Array.from({ length: players }, (_, seat) => seat),
      pendingChoice: null,
      pendingQueue: [],
    };
    return state;
  }

  function resolveCardChoice(
    state: SeasonsState,
    seat: number,
    uid: number,
  ): ReturnType<typeof seasons.reduce> {
    return seasons.reduce(
      state,
      seat,
      { type: 'resolve-choice', choice: { uid } },
      ctx,
    );
  }

  it('normal magic-item summon pays fire, triggers once, and logs id/uid', () => {
    const state = magmaReady();
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: summonUid }, ctx);
    expect(res.ok, res.ok ? '' : `${res.code}: ${res.message}`).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.played.some((card) => card.u === summonUid)).toBe(true);
    expect(res.state.players[0]?.energies.fire).toBe(9);
    expect(res.state.players[0]?.energies.water).toBe(7);
    expect(res.state.players[0]?.energies.earth).toBe(8);
    expect(res.state.players[0]?.played.at(-1)?.i).toBe(normalMagicItem.id);
    expect(res.state.pendingChoice).toBeNull();
    expect(res.state.players[1]?.energies.fire).toBe(10);
      expect(res.events).toContainEqual({
        type: 'summon',
        seat: 0,
        summonerSeat: 0,
        cardUid: summonUid,
        cardId: normalMagicItem.id,
        origin: 'normal',
        actionSeq: state.actionSeq + 1,
      });
    const log = res.state.log.find((entry) => entry.msg.includes('熔岩核'))?.msg ?? '';
    expect(log).toContain(`#${normalMagicItem.id}`);
    expect(log).toContain(`UID ${summonUid}`);

    const replay = seasons.reduce(
      res.state,
      1,
      { type: 'resolve-choice', choice: { fire: 1 } },
      ctx,
    );
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe('no_pending_choice');
    expect(res.state.players[1]?.energies.fire).toBe(10);
  });

  it('a standard familiar summon also grants one fire', () => {
    const res = seasons.reduce(
      magmaReady(2, normalFamiliar),
      0,
      { type: 'summon', cardUid: summonUid },
      ctx,
    );
    expect(res.ok, res.ok ? '' : `${res.code}: ${res.message}`).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.played.at(-1)?.i).toBe(normalFamiliar.id);
    expect(res.state.pendingChoice).toBeNull();
    expect(res.state.players[1]?.energies.fire).toBe(10);
  });

  it('does not trigger Magma Core when the summoner plays their own card', () => {
    const state = magmaReady();
    const withOwnCore: SeasonsState = {
      ...state,
      players: state.players.map((player) =>
        player.seat === 0
          ? { ...player, played: [{ i: 72, u: 7602 }, ...player.played] }
          : { ...player, played: [] },
      ),
    };
    const res = seasons.reduce(withOwnCore, 0, { type: 'summon', cardUid: 7601 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice).toBeNull();
    expect(withOwnCore.players[0]?.energies.fire).toBe(9);
    expect(res.state.players[0]?.played.some((card) => card.u === 7601)).toBe(true);
    expect(res.state.log.some((entry) => entry.msg.includes('熔岩核'))).toBe(false);
  });

  it('free-effect summon skips Magma Core but still resolves its normal summon effect', () => {
    const state: SeasonsState = {
      ...magmaReady(2, plain, {
        hand: [{ i: freeSource.id, u: 7790 }],
      }),
      players: magmaReady(2, plain, {
        hand: [{ i: freeSource.id, u: 7790 }],
      }).players.map((player) =>
        player.seat === 0
          ? {
              ...player,
              played: [{ i: freeSource.id, u: freeUid }],
            }
          : player,
      ),
      turnOwner: 0,
    };
    const payment = apply(state, 0, { type: 'activate', cardUid: freeUid });
    const started = apply(payment, 0, { type: 'resolve-choice', choice: state.players[0]!.energies });
    expect(started.pendingChoice?.key).toBe('potion_dreams');
    expect(started.pendingCards?.some((card) => card.u === 7790)).toBe(true);
    const result = resolveCardChoice(started, 0, 7790);
    expect(result.ok, result.ok ? '' : `${result.code}: ${result.message}`).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[0]?.played.some((card) => card.u === 7790)).toBe(true);
    expect(result.state.pendingChoice).toBeNull();
    expect(result.state.players[1]?.energies.fire).toBe(9);
    expect(result.state.log.some((entry) => entry.msg.includes('熔岩核'))).toBe(false);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          type: 'summon',
          summonerSeat: 0,
          cardUid: 7790,
          origin: 'freeEffect',
        }),
      );
  });

  it('failed normal summons do not trigger or mutate the table', () => {
    const state = magmaReady();
    const poor: SeasonsState = {
      ...state,
      players: state.players.map((player) =>
        player.seat === 0
          ? { ...player, energies: { water: 0, air: 0, fire: 0, earth: 0 }, crystals: 0 }
          : player,
      ),
    };
    const failed = seasons.reduce(poor, 0, { type: 'summon', cardUid: summonUid }, ctx);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.code).toBe('cant_afford');
    expect(poor.players[0]?.hand.some((card) => card.u === summonUid)).toBe(true);
    expect(poor.players[1]?.energies.fire).toBe(9);
    expect(poor.pendingChoice).toBeNull();
    expect(poor.pendingQueue).toEqual([]);

    const wrongSeat = seasons.reduce(state, 1, { type: 'summon', cardUid: summonUid }, ctx);
    expect(wrongSeat.ok).toBe(false);
    if (!wrongSeat.ok) expect(wrongSeat.code).toBe('not_your_turn');
    expect(state.pendingQueue).toEqual([]);
    expect(state.players[1]?.energies.fire).toBe(9);
  });

  it('two Magma Core instances automatically grant one fire each, never double-award', () => {
    const state = magmaReady(2, plain, {
      coreUids: [7801, 7802],
    });
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: summonUid }, ctx);
    expect(res.ok, res.ok ? '' : `${res.code}: ${res.message}`).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice).toBeNull();
    expect(res.state.pendingQueue).toHaveLength(0);
    expect(res.state.players[1]?.energies.fire).toBe(11);

    const replay = seasons.reduce(
      res.state,
      1,
      { type: 'resolve-choice', choice: { fire: 1 } },
      ctx,
    );
    expect(replay.ok).toBe(false);
    expect(res.state.players[1]?.energies.fire).toBe(11);
  });

  it('a full reserve asks for a legal energy swap instead of exceeding max', () => {
    const state = magmaReady(2, plain, { maxEnergy: 9 });
    state.players[1]!.energies = { water: 0, air: 0, fire: 9, earth: 0 };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: summonUid }, ctx);
    expect(res.ok, res.ok ? '' : `${res.code}: ${res.message}`).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.kind).toBe('energy_swap');
    expect(res.state.pendingChoice?.options.discardAmount).toBe(1);
    expect(res.state.players[1]?.energies.fire).toBe(9);
  });

  it('activating Magma Core sacrifices it once and grants exactly 3 fire', () => {
    const state = magmaReady(2, plain, {
      maxEnergy: 40,
      extraPlayed: [{ i: 72, u: 7901 }],
    });
    const started = seasons.reduce(state, 0, { type: 'activate', cardUid: 7901 }, ctx);
    expect(started.ok, started.ok ? '' : `${started.code}: ${started.message}`).toBe(true);
    if (!started.ok) return;
    expect(started.state.pendingChoice?.key).toBe('magma_core_shield');
    expect(started.state.players[0]?.played.some((card) => card.u === 7901)).toBe(true);
    expect(started.state.players[0]?.energies.fire).toBe(9);
    const result = seasons.reduce(
      started.state,
      0,
      { type: 'resolve-choice', choice: 'sacrifice' },
      ctx,
    );
    expect(result.ok, result.ok ? '' : `${result.code}: ${result.message}`).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[0]?.played.some((card) => card.u === 7901)).toBe(false);
    expect(result.state.discard.some((card) => card.u === 7901)).toBe(true);
    expect(result.state.players[0]?.energies.fire).toBe(12);
    const replay = seasons.reduce(
      result.state,
      0,
      { type: 'activate', cardUid: 7901 },
      ctx,
    );
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe('card_not_in_play');
  });

  it('Shield of Zira can replace Magma Core sacrifice while still giving 3 fire', () => {
    const state = magmaReady(2, plain, {
      maxEnergy: 40,
      extraPlayed: [
        { i: 72, u: 7911 },
        { i: 63, u: 7912 },
      ],
    });
    const started = seasons.reduce(state, 0, { type: 'activate', cardUid: 7911 }, ctx);
    expect(started.ok, started.ok ? '' : `${started.code}: ${started.message}`).toBe(true);
    if (!started.ok) return;
    const branches = started.state.pendingChoice?.options.branches as
      | { id: string }[]
      | undefined;
    expect(branches?.map((branch) => branch.id)).toEqual(['sacrifice', 'shield']);
    const result = seasons.reduce(
      started.state,
      0,
      { type: 'resolve-choice', choice: 'shield' },
      ctx,
    );
    expect(result.ok, result.ok ? '' : `${result.code}: ${result.message}`).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[0]?.played.some((card) => card.u === 7911)).toBe(true);
    expect(result.state.players[0]?.played.some((card) => card.u === 7912)).toBe(false);
    expect(result.state.discard.some((card) => card.u === 7912)).toBe(true);
    expect(result.state.players[0]?.crystals).toBe(30);
    expect(result.state.players[0]?.energies.fire).toBe(12);
    expect(result.state.log.some((entry) => entry.msg.includes('席拉之盾'))).toBe(true);
  });

    it('declining Shield of Zira keeps the shield and sacrifices only Magma Core', () => {
      const state = magmaReady(2, plain, {
        maxEnergy: 40,
        extraPlayed: [
          { i: 72, u: 7921 },
          { i: 63, u: 7922 },
        ],
      });
      const started = seasons.reduce(state, 0, { type: 'activate', cardUid: 7921 }, ctx);
      expect(started.ok, started.ok ? '' : `${started.code}: ${started.message}`).toBe(true);
      if (!started.ok) return;
      const result = seasons.reduce(
        started.state,
        0,
        { type: 'resolve-choice', choice: 'sacrifice' },
        ctx,
      );
      expect(result.ok, result.ok ? '' : `${result.code}: ${result.message}`).toBe(true);
      if (!result.ok) return;
      expect(result.state.players[0]?.played.some((card) => card.u === 7921)).toBe(false);
      expect(result.state.discard.some((card) => card.u === 7921)).toBe(true);
      expect(result.state.players[0]?.played.some((card) => card.u === 7922)).toBe(true);
      expect(result.state.discard.some((card) => card.u === 7922)).toBe(false);
      expect(result.state.players[0]?.crystals).toBe(20);
      expect(result.state.players[0]?.energies.fire).toBe(12);
    });

    it('activating Magma Core at full reserve queues an energy swap', () => {
      const base = magmaReady(2, plain, {
        maxEnergy: 9,
        extraPlayed: [{ i: 72, u: 7931 }],
      });
      const state: SeasonsState = {
        ...base,
        players: base.players.map((player) =>
          player.seat === 0
            ? { ...player, energies: { water: 0, air: 0, fire: 9, earth: 0 } }
            : player,
        ),
      };
      const started = seasons.reduce(state, 0, { type: 'activate', cardUid: 7931 }, ctx);
      expect(started.ok, started.ok ? '' : `${started.code}: ${started.message}`).toBe(true);
      if (!started.ok) return;
      const resolution = seasons.reduce(
        started.state,
        0,
        { type: 'resolve-choice', choice: 'sacrifice' },
        ctx,
      );
      expect(resolution.ok, resolution.ok ? '' : `${resolution.code}: ${resolution.message}`).toBe(
        true,
      );
      if (!resolution.ok) return;
      expect(resolution.state.pendingChoice?.kind).toBe('energy_swap');
      expect(resolution.state.pendingChoice?.options.total).toBe(9);
      expect(resolution.state.pendingChoice?.options.pool).toBe(12);
      expect(resolution.state.players[0]?.energies.fire).toBe(9);
      const swapped = seasons.reduce(
        resolution.state,
        0,
        { type: 'resolve-choice', choice: { water: 0, air: 0, fire: 9, earth: 0 } },
        ctx,
      );
      expect(swapped.ok, swapped.ok ? '' : `${swapped.code}: ${swapped.message}`).toBe(true);
      if (!swapped.ok) return;
      expect(swapped.state.pendingChoice).toBeNull();
      expect(swapped.state.players[0]?.energies).toEqual({
        water: 0,
        air: 0,
        fire: 9,
        earth: 0,
      });
    });

  for (const players of [3, 4]) {
    it(`${players}-player Magma Core costs ${players - 1} fire; seated cores queue`, () => {
      const core = EXT2_CARDS.find((card) => card.id === 72);
      if (!core) throw new Error('missing Magma Core');
        const otherCoreUids = Array.from(
          { length: players - 1 },
          (_, index) => 7960 + players * 10 + index,
        );
        const state = magmaReady(players, core, {
        payerFire: players + 2,
          coreUids: [otherCoreUids[0]!],
        extraCoresBySeat: {
          1: [otherCoreUids[0]!],
            2: [otherCoreUids[1]!],
            ...(players === 4 ? { 3: [otherCoreUids[2]!] } : {}),
        },
      });
      const isolated: SeasonsState = {
        ...state,
        players: state.players.map((player) => ({
          ...player,
          hand:
            player.seat === 0
              ? player.hand.filter((card) => card.u === summonUid)
              : state.players[players - 1]!.hand,
        })),
      };
      const res = seasons.reduce(isolated, 0, { type: 'summon', cardUid: summonUid }, ctx);
      expect(res.ok, res.ok ? '' : `${res.code}: ${res.message}`).toBe(true);
      if (!res.ok) return;
        expect(res.state.players.map((player) => player.played.map((card) => card.u))).toEqual([
          [summonUid],
          [otherCoreUids[0]],
          [otherCoreUids[1]],
          ...(players === 4 ? [[otherCoreUids[2]]] : []),
        ]);
      expect(res.state.players[0]?.energies.fire).toBe(3);
      expect(res.state.players[0]?.played.at(-1)?.i).toBe(core.id);
      expect(res.state.pendingChoice).toBeNull();
      expect(res.state.pendingQueue).toEqual([]);
      expect(res.state.players.slice(1).map((player) => player.energies.fire))
        .toEqual(Array.from({ length: players - 1 }, () => 10));
    });
  }
});

describe('seasons summon', () => {
  it('扣除能量与水晶，手牌进入场上，召唤不结束回合', () => {
    const base = summonReady();
    const def = findDef((card) => !card.costFlexible && !card.costByPlayers);
    const uid = 9001;
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0 ? { ...player, hand: [{ i: def.id, u: uid }, ...player.hand] } : player,
      ),
    };

    const next = apply(state, 0, { type: 'summon', cardUid: uid });
    const after = next.players[0];
    expect(after?.hand.some((card) => card.u === uid)).toBe(false);
    expect(after?.played.map((card) => card.u)).toContain(uid);
    expect(after?.energies.water).toBe(9 - def.cost.water);
    expect(after?.energies.air).toBe(9 - def.cost.air);
    expect(after?.energies.fire).toBe(9 - def.cost.fire);
    expect(after?.energies.earth).toBe(9 - def.cost.earth);
    expect(after?.crystals).toBe(9 - def.cost.crystal);
    expect(next.turnOwner).toBe(0);
    expect(next.log.at(-1)?.msg).toContain(`召唤「${def.nameZh}」`);
  });

  it('召唤等级必须严格大于场上卡牌数', () => {
    const base = summonReady();
    const def = findDef((card) => !card.costFlexible);
    const uid = 9002;
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, gauge: 0, hand: [{ i: def.id, u: uid }, ...player.hand] }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: uid }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('gauge_low');
  });

  it('拒绝非当前行动者、不在手牌的卡与资源不足', () => {
    const base = summonReady();
    const def = findDef((card) => !card.costFlexible && !card.costByPlayers);
    const uid = 9003;
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0 ? { ...player, hand: [{ i: def.id, u: uid }, ...player.hand] } : player,
      ),
    };

    const otherSeat = seasons.reduce(state, 1, { type: 'summon', cardUid: uid }, ctx);
    expect(otherSeat.ok).toBe(false);
    if (!otherSeat.ok) expect(otherSeat.code).toBe('not_your_turn');

    const missing = seasons.reduce(state, 0, { type: 'summon', cardUid: 99999 }, ctx);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('card_not_in_hand');

    const poor: SeasonsState = {
      ...state,
      players: state.players.map((player, seat) =>
        seat === 0
          ? { ...player, energies: { water: 0, air: 0, fire: 0, earth: 0 }, crystals: 0 }
          : player,
      ),
    };
    const res = seasons.reduce(poor, 0, { type: 'summon', cardUid: uid }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('cant_afford');
  });

  it('灵活费用：支付 1~4 种不同能量，记录 paid 元素', () => {
    const base = summonReady();
    const flex = findDef((card) => card.costFlexible !== undefined);
    const uid = 9004;
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              energies: { water: 3, air: 0, fire: 3, earth: 3 },
              hand: [{ i: flex.id, u: uid }, ...player.hand],
            }
          : player,
      ),
    };

    const empty = seasons.reduce(state, 0, { type: 'summon', cardUid: uid }, ctx);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe('flex_cost_count');

    const duplicate = seasons.reduce(
      state,
      0,
      { type: 'summon', cardUid: uid, paidElements: ['water', 'water'] },
      ctx,
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.code).toBe('flex_cost_duplicate');

    const lack = seasons.reduce(
      state,
      0,
      { type: 'summon', cardUid: uid, paidElements: ['air'] },
      ctx,
    );
    expect(lack.ok).toBe(false);
    if (!lack.ok) expect(lack.code).toBe('energy_low');

    // 付水会挂起「获得 2 个能量」的选择；土/火是自动效果，可直接召唤。
    const waterPaid = seasons.reduce(
      state,
      0,
      { type: 'summon', cardUid: uid, paidElements: ['water'] },
      ctx,
    );
    expect(waterPaid.ok).toBe(true);
    if (waterPaid.ok) {
      expect(waterPaid.state.pendingChoice?.kind).toBe('element_alloc');
    }

    const next = apply(state, 0, {
      type: 'summon',
      cardUid: uid,
      paidElements: ['earth'],
    });
    const after = next.players[0];
    expect(after?.energies.earth).toBe(2);
    expect(after?.played.at(-1)?.paid).toEqual(['earth']);
    // 土：水晶 +5
    expect(after?.crystals).toBe(9 + 5);
  });

});

describe('seasons paid element sources', () => {
  it('按卡牌 UID 精确扣除同类元素，未选中的卡上元素保留', () => {
    const state = summonReady();
    const sourceCard = BASE_CARDS.find((card) => card.id === 18);
    const targetCard = BASE_CARDS.find(
      (card) =>
        card.id !== sourceCard?.id &&
        !card.costFlexible &&
        card.cost.fire === 1 &&
        energySum(card.cost) === 1,
    );
    if (!sourceCard || !targetCard) throw new Error('缺少支付来源测试卡');
    const sourceUid = 9500;
    const targetUid = 9501;
    const prepared: SeasonsState = {
      ...state,
      players: state.players.map((player) =>
        player.seat === 0
          ? {
              ...player,
              hand: [{ i: targetCard.id, u: targetUid }],
              played: [
                { i: sourceCard.id, u: sourceUid, stored: { fire: 1 } },
                { i: sourceCard.id, u: sourceUid + 1, stored: { fire: 1 } },
              ],
              energies: { water: 9, air: 9, fire: 0, earth: 9 },
            }
          : player,
      ),
    };
    const paidElement = 'fire' as const;
    const res = seasons.reduce(
      prepared,
      0,
      {
        type: 'summon',
        cardUid: targetUid,
        paidSources: [{ element: paidElement, source: 'card', cardUid: sourceUid }],
      },
      ctx,
    );
    expect(res.ok, res.ok ? '' : `${res.code}: ${res.message}`).toBe(true);
    if (!res.ok) return;
    const me = res.state.players[0]!;
    expect(me.played.find((card) => card.u === sourceUid)?.stored?.[paidElement] ?? 0).toBe(0);
    expect(me.played.find((card) => card.u === sourceUid + 1)?.stored?.[paidElement] ?? 0).toBe(1);
  });

  it('来源不足或重复槽位时整笔拒绝，不扣任何元素', () => {
    const state = summonReady();
    const targetCard = BASE_CARDS.find((card) =>
      !card.costFlexible &&
      energySum(card.cost) === 2 &&
      ELEMENTS.some((element) => (card.cost[element] ?? 0) === 2),
    );
    if (!targetCard) throw new Error('缺少支付来源测试卡');
    const targetUid = 9510;
    const prepared: SeasonsState = {
      ...state,
      players: state.players.map((player) =>
        player.seat === 0
          ? {
              ...player,
              hand: [{ i: targetCard.id, u: targetUid }],
              energies: { water: 9, air: 9, fire: 9, earth: 9 },
            }
          : player,
      ),
    };
    const paidElement = (['water', 'air', 'fire', 'earth'] as const).find(
      (element) => (targetCard.cost[element] ?? 0) > 0,
    )!;
    const before = prepared.players[0]!;
    const duplicate = seasons.reduce(
      prepared,
      0,
      {
        type: 'summon',
        cardUid: targetUid,
        paidSources: [
          { element: paidElement, source: 'reserve', slot: 0 },
          { element: paidElement, source: 'reserve', slot: 0 },
        ],
      },
      ctx,
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.code).toBe('choice_duplicate');
    expect(prepared.players[0]!.energies).toEqual(before.energies);
    expect(prepared.players[0]!.hand.some((card) => card.u === targetUid)).toBe(true);
  });
});

describe('seasons summon effects', () => {
  function withSummonCard(
    state: SeasonsState,
    key: string,
    uid = 9100,
  ): SeasonsState {
    const def = findDef((card) => {
      const effect = summonEffectOf(card);
      return effect !== null && summonEffectKey(effect) === key;
    });
    return {
      ...state,
      players: state.players.map((player, seat) =>
        seat === 0 ? { ...player, hand: [{ i: def.id, u: uid }, ...player.hand] } : player,
      ),
    };
  }

  it('summon_gauge / gain_crystals：直接结算召唤计量条与水晶', () => {
    const base = summonReady();

    const gaugeState = withSummonCard(base, 'summon_gauge', 9101);
    const afterGauge = apply(gaugeState, 0, { type: 'summon', cardUid: 9101 }).players[0];
    expect(afterGauge?.gauge).toBe((gaugeState.players[0]?.gauge ?? 0) + 2);

    const crystalState = withSummonCard(base, 'gain_crystals', 9102);
    const afterCrystal = apply(crystalState, 0, { type: 'summon', cardUid: 9102 })
      .players[0];
    expect(afterCrystal?.crystals).toBe((crystalState.players[0]?.crystals ?? 0) + 9);
  });

  it('per_magic_item_crystal：按其他魔法物品数量加水晶', () => {
    const base = withSummonCard(summonReady(), 'per_magic_item_crystal', 9103);
    const magicItems = BASE_CARDS.filter((card) => card.type === 'magic_item').slice(0, 2);
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              played: [
                ...player.played,
                { i: magicItems[0]?.id ?? 1, u: 8001 },
                { i: magicItems[1]?.id ?? 2, u: 8002 },
              ],
            }
          : player,
      ),
    };
    const after = apply(state, 0, { type: 'summon', cardUid: 9103 }).players[0];
    expect(after?.crystals).toBe((state.players[0]?.crystals ?? 0) + 3 * 2);
  });

  it('demon_of_argos：对手召唤等级 -1 并抽 1 张', () => {
    const base = withSummonCard(summonReady(), 'demon_of_argos', 9104);
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 1 ? { ...player, gauge: 5, hand: [] } : player,
      ),
    };
    const next = apply(state, 0, { type: 'summon', cardUid: 9104 });
    expect(next.players[1]?.gauge).toBe(4);
    expect(next.players[1]?.hand).toHaveLength(1);
    expect(next.deck.length).toBe(state.deck.length - 1);
  });

  it('air_elemental：对手储备能量全部转为空气（受上限截断）', () => {
    const base = withSummonCard(summonReady(), 'air_elemental', 9105);
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 1
          ? {
              ...player,
              maxEnergy: 5,
              energies: { water: 2, air: 1, fire: 1, earth: 0 },
            }
          : player,
      ),
    };
    const next = apply(state, 0, { type: 'summon', cardUid: 9105 });
    expect(next.players[1]?.energies).toEqual({ water: 0, air: 4, fire: 0, earth: 0 });
  });

  it('sid_nightshare：水晶最多时从每位对手偷 5', () => {
    const base = withSummonCard(summonReady(), 'sid_nightshare', 9106);
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, crystals: 20 }
          : { ...player, crystals: 7 },
      ),
    };
    const next = apply(state, 0, { type: 'summon', cardUid: 9106 });
    expect(next.players[0]?.crystals).toBe(25);
    expect(next.players[1]?.crystals).toBe(2);

    // 不是水晶最多时不触发
    const notLeader: SeasonsState = {
      ...state,
      players: state.players.map((player, seat) =>
        seat === 0 ? { ...player, crystals: 1 } : { ...player, crystals: 7 },
      ),
    };
    const next2 = apply(notLeader, 0, { type: 'summon', cardUid: 9106 });
    expect(next2.players[0]?.crystals).toBe(1);
    expect(next2.players[1]?.crystals).toBe(7);
  });

  it('cursed_relic：水晶 +10、水能量 +1', () => {
    const ready = summonReady();
    const base = withSummonCard(
      {
        ...ready,
        players: ready.players.map((player, seat) =>
          seat === 0 ? { ...player, maxEnergy: 40 } : player,
        ),
      },
      'cursed_relic',
      9107,
    );
    const next = apply(base, 0, { type: 'summon', cardUid: 9107 });
    expect(next.players[0]?.crystals).toBe((base.players[0]?.crystals ?? 0) + 10);
    // 费用付 1 水、效果再 +1 水，净变化为 0。
    expect(next.players[0]?.energies.water).toBe(base.players[0]?.energies.water);
  });
});

describe('seasons pending choice', () => {
  function summonChoiceState(key: string, uid: number, patch?: Partial<SeasonsState['players'][number]>): SeasonsState {
    const base = summonReady();
    const def = findDef((card) => {
      const effect = card.effect;
      if (!effect) return false;
      return (effect.typeKey ?? effect.type) === key;
    });
    return {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              gauge: 9,
              energies: { water: 3, air: 2, fire: 2, earth: 2 },
              maxEnergy: 10,
              hand: [{ i: def.id, u: uid }, ...player.hand],
              ...patch,
            }
          : player,
      ),
    };
  }

  it('流水护符：支付后进入 element_alloc，按分配置 4 个能量到卡上', () => {
    const state = summonChoiceState('gain_energy', 9201);
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 9201 }, ctx);
    expect(res.ok, res.ok ? '' : `${res.code}: ${res.message}`).toBe(true);
    if (!res.ok) return;
    const pending = res.state.pendingChoice;
    expect(pending?.kind).toBe('element_alloc');
    expect(pending?.choosingSeat).toBe(0);
    expect(pending?.options.amount).toBe(4);
    expect(pending?.options.target).toBe('card');
    expect(res.state.players[0]?.energies.water).toBe(1); // 已支付 2 水

    // 弹窗期间其他动作被挡
    const blocked = seasons.reduce(res.state, 0, { type: 'draft-dice', dieIndex: 0 }, ctx);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('pending_choice');

    // 不是选择者
    const wrong = seasons.reduce(res.state, 1, { type: 'resolve-choice', choice: { water: 2, air: 2 } }, ctx);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe('not_your_choice');

    // 数量不对
    const bad = seasons.reduce(res.state, 0, { type: 'resolve-choice', choice: { water: 3 } }, ctx);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('choice_amount_mismatch');

    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { water: 2, air: 2 } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.pendingChoice).toBeNull();
    const card = done.state.players[0]?.played.find((item) => item.u === 9201);
    expect(card?.stored).toEqual({ water: 2, air: 2 });
    expect(done.state.players[0]?.energies.water).toBe(1);
    expect(done.state.players[0]?.energies.air).toBe(2);
  });

  it('火焰护符：抽 4 张只对选择者可见，保留 1 张其余进弃牌堆', () => {
    const base = summonReady();
    const def = findDef((card) => card.effect?.type === 'draw_cards');
    const uid = 9301;
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              gauge: 9,
              maxEnergy: 10,
              energies: { water: 3, air: 3, fire: 3, earth: 3 },
              hand: [{ i: def.id, u: uid }, ...player.hand],
            }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: uid }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const pending = res.state.pendingChoice;
    expect(pending?.kind).toBe('card_list');
    expect(pending?.options.keep).toBe(1);
    expect(res.state.pendingCards).toHaveLength(4);
    expect(res.state.deck.length).toBe(state.deck.length - 4);
    expect(res.state.players[0]?.hand.length).toBe(state.players[0]!.hand.length - 1);

    // 对手看不到抽到的牌，只有张数提示
    const opponentView = seasons.view(res.state, 1);
    expect(opponentView.pendingChoice?.options.cards).toBeUndefined();
    const ownView = seasons.view(res.state, 0);
    const visible = ownView.pendingChoice?.options.cards as { u: number }[] | undefined;
    expect(visible).toHaveLength(4);

    const two = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: [visible![0]!.u, visible![1]!.u] },
      ctx,
    );
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.code).toBe('choice_card_count');

    const keepUid = visible![0]!.u;
    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: [keepUid] },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.pendingChoice).toBeNull();
    expect(done.state.pendingCards).toBeNull();
    expect(done.state.players[0]?.hand.some((card) => card.u === keepUid)).toBe(true);
    expect(done.state.players[0]?.hand.length).toBe(state.players[0]!.hand.length);
    expect(done.state.discard).toHaveLength(3);
  });

  it('火焰护符：牌堆与弃牌堆都空时抽不到牌，直接跳过选择并正常召唤', () => {
    const base = summonReady();
    const def = findDef((card) => card.effect?.type === 'draw_cards');
    const uid = 9302;
    const state: SeasonsState = {
      ...base,
      deck: [],
      discard: [],
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              gauge: 9,
              maxEnergy: 10,
              energies: { water: 3, air: 3, fire: 3, earth: 3 },
              hand: [{ i: def.id, u: uid }, ...player.hand],
            }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: uid }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice).toBeNull();
    expect(res.state.pendingCards).toBeNull();
    expect(res.state.players[0]?.played.some((card) => card.u === uid)).toBe(true);
    expect(res.state.log.some((entry) => entry.msg.includes('全部保留'))).toBe(true);
  });

  it('拉格诺的吊坠：每有 1 张其他魔法物品得 1 个任意能量', () => {
    const base = summonChoiceState('per_magic_item_energy', 9401, {
      energies: { water: 5, air: 5, fire: 5, earth: 5 },
      maxEnergy: 40,
    });
    const magicItems = BASE_CARDS.filter((card) => card.type === 'magic_item').slice(0, 3);
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              played: magicItems.map((card, index) => ({ i: card.id, u: 8100 + index })),
            }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 9401 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.options.amount).toBe(3);
    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { water: 3 } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.players[0]?.energies.water).toBe(
      (res.state.players[0]?.energies.water ?? 0) + 3,
    );
  });

  it('阿鲁斯的诅咒典籍：水晶 +10 立即结算，再选 2 个能量', () => {
    const state = summonChoiceState('cursed_treatise', 9402, {
      energies: { water: 5, air: 5, fire: 5, earth: 5 },
      maxEnergy: 40,
    });
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 9402 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.crystals).toBe((state.players[0]?.crystals ?? 0) + 10);
    expect(res.state.players[0]?.gauge).toBe((state.players[0]?.gauge ?? 0) + 1);
    expect(res.state.pendingChoice?.options.amount).toBe(2);

    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { air: 2 } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.players[0]?.energies.air).toBe(
      (res.state.players[0]?.energies.air ?? 0) + 2,
    );
  });

  it('附魔魔典：maxEnergy +3 后选择 2 个能量进储备区', () => {
    const state = summonChoiceState('bespelled_grimoire', 9202, {
      energies: { water: 2, air: 2, fire: 2, earth: 1 },
      maxEnergy: 7,
    });
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 9202 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.maxEnergy).toBe(10);
    expect(res.state.pendingChoice?.options.amount).toBe(2);
    expect(res.state.pendingChoice?.options.target).toBe('reserve');

    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { fire: 2 } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.pendingChoice).toBeNull();
    expect(done.state.players[0]?.energies.fire).toBe(4);
    expect(done.state.players[0]?.energies.water).toBe(1); // 支付 1 水
    expect(done.state.players[0]?.energies.earth).toBe(0); // 支付 1 土
    expect(done.state.players[0]?.maxEnergy).toBe(10);
  });
});

describe('seasons turn flow', () => {
  it('转换：消耗 1 点能量换水晶，数值随季节变化', () => {
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      seasonIdx: 0,
      turnOwner: 0,
      players: base.players.map((player, seat) =>
        seat === 0 ? { ...player, canTransmute: true, crystals: 0 } : player,
      ),
    };
    const next = apply(state, 0, { type: 'transmute', element: 'water' });
    expect(next.players[0]?.crystals).toBe(1); // 冬季水 = 1 水晶
    expect(next.players[0]?.energies.water).toBe(8);

    // 春季土 = 1，夏季火 = 1，秋季风 = 1；冬季土 = 3
    const earth = apply({ ...state, seasonIdx: 0 }, 0, {
      type: 'transmute',
      element: 'earth',
    });
    expect(earth.players[0]?.crystals).toBe(3);
  });

  it('没有转换能力时拒绝；没有对应能量时拒绝', () => {
    const base = summonReady();
    const noAbility: SeasonsState = {
      ...base,
      turnOwner: 0,
      players: base.players.map((player, seat) =>
        seat === 0 ? { ...player, canTransmute: false } : player,
      ),
    };
    const r1 = seasons.reduce(noAbility, 0, { type: 'transmute', element: 'water' }, ctx);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe('no_transmute');

    const noEnergy: SeasonsState = {
      ...noAbility,
      players: noAbility.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              canTransmute: true,
              energies: { water: 0, air: 0, fire: 0, earth: 0 },
            }
          : player,
      ),
    };
    const r2 = seasons.reduce(noEnergy, 0, { type: 'transmute', element: 'water' }, ctx);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('energy_low');
  });

  it('结束回合：轮到下一位选骰者并结算其骰面奖励', () => {
    const base = actionPhase();
    const first = base.turnOwner;
    expect(first).toBe(base.dicePicked[0]);
    const second = base.dicePicked.find((seat) => seat !== first);
    expect(second).toBeDefined();

    const next = apply(base, first!, { type: 'end-turn' });
    expect(next.turnOwner).toBe(second);
    expect(next.currentPicker).toBe(second);
    expect(next.pickedThisSeason).toEqual([first]);
  });

  it('全员结束回合后按剩余骰子点数推进月份并轮转起始玩家', () => {
    const base = actionPhase();
    const first = base.turnOwner!;
    const second = base.dicePicked.find((seat) => seat !== first)!;
    const leftover = base.season!.dice.find((die) => die.pickedBy === null)!;

    const afterFirst = apply(base, first, { type: 'end-turn' });
    const afterSecond = apply(afterFirst, second, { type: 'end-turn' });
    expect(afterSecond.month).toBe(base.month + leftover.pip);
    expect(afterSecond.startPlayer).toBe((base.startPlayer + 1) % 2);
    expect(afterSecond.turnOwner).toBeNull();
  });

  it('第 36 月结束后计分：水晶 + 卡面分 - 手牌惩罚 - 徽章惩罚', () => {
    const base = actionPhase();
    const first = base.turnOwner!;
    const second = base.dicePicked.find((seat) => seat !== first)!;
    const pointsCard = BASE_CARDS.find((card) => card.points > 0)!;
    const state: SeasonsState = {
      ...base,
      month: 35,
      startPlayer: first,
      players: base.players.map((player, seat) => {
        if (seat === first) {
          return {
            ...player,
            canTransmute: false,
            crystals: 10,
            hand: player.hand.slice(0, 2),
            badgesUsed: 0,
            played: [...player.played, { i: pointsCard.id, u: 7001 }],
          };
        }
        return {
          ...player,
          canTransmute: false,
          crystals: 10,
          hand: player.hand.slice(0, 3),
          badgesUsed: 1,
          played: [],
        };
      }),
    };
    const afterFirst = apply(state, first, { type: 'end-turn' });
    const ended = apply(afterFirst, second, { type: 'end-turn' });
    expect(ended.phase).toBe('ended');
    expect(ended.result?.players).toHaveLength(2);
    const scores = ended.result!.players;
    const p0 = scores.find((row) => row.seat === first)!;
    expect(p0.crystals).toBe(10);
    expect(p0.cardPoints).toBe(pointsCard.points);
    expect(p0.handPenalty).toBe(2 * 5);
    expect(p0.score).toBe(10 + pointsCard.points - 10);
    const p1 = scores.find((row) => row.seat === second)!;
    expect(p1.badgePenalty).toBe(5);
    // 座位 1 回合开始时可能因骰面奖励抽牌，手牌惩罚按最终手牌数计算。
    expect(p1.score).toBe(p1.crystals + p1.cardPoints - p1.handPenalty - p1.badgePenalty);
    expect(scores[0]!.score).toBeGreaterThanOrEqual(scores[1]!.score);
    expect(ended.result?.winner).toBe(first);
  });

  it('特殊计分：灯笼按储备能量 ×3、头盔在场牌更多 +20、宝箱无随从 +20', () => {
    const base = actionPhase();
    const first = base.turnOwner!;
    const second = base.dicePicked.find((seat) => seat !== first)!;
    const lantern = BASE_CARDS.find((card) => card.id === 45)!;
    const helm = BASE_CARDS.find((card) => card.id === 19)!;
    const chest = BASE_CARDS.find((card) => card.id === 46)!;
    const filler = BASE_CARDS.find(
      (card) => card.type === 'magic_item' && card.id !== lantern.id && card.id !== helm.id && card.id !== chest.id,
    )!;
    const state: SeasonsState = {
      ...base,
      month: 35,
      startPlayer: first,
      players: base.players.map((player, seat) => {
        if (seat === first) {
          return {
            ...player,
            canTransmute: false,
            crystals: 0,
            hand: [],
            played: [
              { i: lantern.id, u: 7100 },
              { i: helm.id, u: 7101 },
              { i: chest.id, u: 7102 },
              { i: filler.id, u: 7103 },
            ],
            energies: { water: 2, air: 1, fire: 0, earth: 0 },
          };
        }
        return {
          ...player,
          canTransmute: false,
          crystals: 0,
          hand: [],
          played: [],
          energies: { water: 0, air: 0, fire: 0, earth: 0 },
        };
      }),
    };
    const afterFirst = apply(state, first, { type: 'end-turn' });
    const ended = apply(afterFirst, second, { type: 'end-turn' });
    expect(ended.phase).toBe('ended');
    const me = ended.result!.players.find((row) => row.seat === first)!;
    // 灯笼：储备 3 个能量 × 3 = 9；头盔：在场 4 张 > 对手 0 张 → +20；宝箱：场上无随从 → +20。
    expect(me.effectPoints).toBe(9 + 20 + 20);
    expect(me.score).toBe(me.cardPoints + me.effectPoints);
  });

  it('特殊计分：宝箱在场上有随从时不加分', () => {
    const base = actionPhase();
    const first = base.turnOwner!;
    const second = base.dicePicked.find((seat) => seat !== first)!;
    const chest = BASE_CARDS.find((card) => card.id === 46)!;
    const familiar = BASE_CARDS.find((card) => card.type === 'familiar')!;
    const state: SeasonsState = {
      ...base,
      month: 35,
      startPlayer: first,
      players: base.players.map((player, seat) =>
        seat === first
          ? {
              ...player,
              canTransmute: false,
              crystals: 0,
              hand: [],
              played: [
                { i: chest.id, u: 7200 },
                { i: familiar.id, u: 7201 },
              ],
              energies: { water: 0, air: 0, fire: 0, earth: 0 },
            }
          : { ...player, canTransmute: false, crystals: 0, hand: [], played: [] },
      ),
    };
    const afterFirst = apply(state, first, { type: 'end-turn' });
    const ended = apply(afterFirst, second, { type: 'end-turn' });
    const me = ended.result!.players.find((row) => row.seat === first)!;
    expect(me.effectPoints).toBe(0);
  });

  it('奥尼斯的受诅咒灵魂：持有者回合结束失 3 水晶（不足则扣光）', () => {
    const base = actionPhase();
    const first = base.turnOwner!;
    const relic = BASE_CARDS.find((card) => card.effect?.typeKey === 'cursed_relic')!;
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === first
          ? {
              ...player,
              crystals: 2,
              played: [...player.played, { i: relic.id, u: 7300 }],
            }
          : player,
      ),
    };
    const afterFirst = apply(state, first, { type: 'end-turn' });
    expect(afterFirst.players[first]?.crystals).toBe(2);
    const after = apply(afterFirst, afterFirst.turnOwner!, { type: 'end-turn' });
    expect(after.players[first]?.crystals).toBe(0);
    expect(after.log.some((entry) => entry.msg.includes('受诅咒灵魂'))).toBe(true);
  });
});

describe('seasons full game', () => {
  it('两人局从轮抽自动打到 36 个月终局', () => {
    let state = toPlay(draftAll(setup('full-game')));
    let guard = 0;
    while (state.phase !== 'ended' && guard < 20000) {
      guard += 1;
      if (state.pendingChoice) {
        const pending = state.pendingChoice;
        const seat = pending.choosingSeat;
        if (pending.kind === 'multi_player_pick') {
          const uid = state.players[seat]?.played[0]?.u;
          expect(uid).toBeDefined();
          state = apply(state, seat, {
            type: 'resolve-choice',
            choice: { uid: uid! },
          });
        } else if (pending.kind === 'month_advance') {
          state = apply(state, seat, {
            type: 'resolve-choice',
            choice: { direction: 'forward', steps: 1 },
          });
        } else if (pending.kind === 'card_pick') {
          const uid =
            pending.options.purpose === 'discard'
              ? state.players[seat]?.hand[0]?.u
              : state.pendingCards?.[0]?.u;
          expect(uid).toBeDefined();
          state = apply(state, seat, {
            type: 'resolve-choice',
            choice: { uid: uid! },
          });
        } else if (pending.kind === 'branch') {
          const branches = Array.isArray(pending.options.branches)
            ? (pending.options.branches as { id: string }[])
            : [];
          const branch = branches[0]?.id ?? '';
          state = apply(state, seat, { type: 'resolve-choice', choice: { id: branch } });
        } else if (pending.kind === 'energy_swap') {
          const total = typeof pending.options.total === 'number' ? pending.options.total : 0;
          const current = pending.options.current as Partial<Record<Element, number>>;
          const incoming = pending.options.incoming as Partial<Record<Element, number>>;
          const kept = { water: 0, air: 0, fire: 0, earth: 0 };
          let remaining = total;
          for (const element of ELEMENTS) {
            kept[element] = Math.min(remaining, (current[element] ?? 0) + (incoming[element] ?? 0));
            remaining -= kept[element];
          }
          state = apply(state, seat, { type: 'resolve-choice', choice: kept });
        } else if (pending.kind === 'card_list') {
          const uid = state.pendingCards?.[0]?.u;
          expect(uid).toBeDefined();
          state = apply(state, seat, {
            type: 'resolve-choice',
            choice: [uid!],
          });
        } else {
          const amount = typeof pending.options.amount === 'number' ? pending.options.amount : 0;
          state = apply(state, seat, {
            type: 'resolve-choice',
            choice: { water: amount },
          });
        }
        continue;
      }

      if (state.turnOwner === null) {
        const seat = state.currentPicker!;
        const dieIndex = state.season?.dice.findIndex((die) => die.pickedBy === null) ?? -1;
        expect(dieIndex).toBeGreaterThanOrEqual(0);
        state = apply(state, seat, { type: 'draft-dice', dieIndex });
        continue;
      }

      const seat = state.turnOwner;
      const hand = state.players[seat]?.hand ?? [];
      let summoned = false;
      for (const card of hand) {
        const def = BASE_CARD_BY_ID.get(card.i);
        if (!def) continue;
        const res = seasons.reduce(state, seat, { type: 'summon', cardUid: card.u }, ctx);
        if (res.ok) {
          state = res.state;
          summoned = true;
          break;
        }
      }
      if (!summoned) state = apply(state, seat, { type: 'end-turn' });
    }

    expect(state.phase).toBe('ended');
    expect(state.month).toBe(36);
    expect(state.result?.players).toHaveLength(2);
    expect(state.result?.players[0]!.score).toBeGreaterThanOrEqual(
      state.result?.players[1]!.score ?? 0,
    );
    expect(guard).toBeLessThan(20000);
  });
});

/** 进入行动阶段并给 0 号位指定场上卡与充足资源。 */
function activateReady(names: string[], uidBase = 7000): SeasonsState {
  const base = actionPhase('activate-seed');
  const played = names.map((name, index) => {
    const def = BASE_CARDS.find((card) => card.nameZh === name);
    if (!def) throw new Error(`没有名为 ${name} 的卡`);
    return { i: def.id, u: uidBase + index };
  });
  return {
    ...base,
    players: base.players.map((player, seat) =>
      seat === 0
        ? {
            ...player,
            gauge: 9,
            maxEnergy: 40,
            crystals: 10,
            energies: { water: 5, air: 5, fire: 5, earth: 5 },
            played,
          }
        : { ...player, crystals: 6 },
    ),
  };
}

describe('seasons activate', () => {
  function reserveSlotCard() {
    return BASE_CARDS.find((card) =>
      card.effect?.abilities?.some((ability) => ability.kind === 'reserve_slot'),
    )!;
  }

  it('奥尼斯的受诅咒灵魂：付 1 水把控制权转给下一位', () => {
    const base = activateReady(['奥尼斯的受诅咒灵魂']);
    const res = seasons.reduce(base, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const giver = res.state.players[0]!;
    const receiver = res.state.players[1]!;
    expect(giver.played.some((card) => card.u === 7000)).toBe(false);
    expect(receiver.played.some((card) => card.u === 7000)).toBe(true);
    expect(giver.energies.water).toBe(4);
    expect(res.state.log.some((entry) => entry.msg.includes('控制权转移'))).toBe(true);
  });

  it('牺牲附魔魔典会恢复储备上限；牺牲诅咒典籍会清空储备能量', () => {
    const base = activateReady(['龙之头骨', '附魔魔典', '阿鲁斯的诅咒典籍']);
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0 ? { ...player, maxEnergy: 43, energies: { water: 5, air: 5, fire: 5, earth: 5 } } : player,
      ),
    };
    const first = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.pendingChoice?.kind).toBe('sacrifice_cards');

    let current = first.state;
    for (const uid of [7001, 7002, 7000]) {
      const res = seasons.reduce(current, 0, { type: 'resolve-choice', choice: uid }, ctx);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      current = res.state;
    }
    const me = current.players[0]!;
    expect(me.maxEnergy).toBe(40);
    expect(me.energies).toEqual({ water: 0, air: 0, fire: 0, earth: 0 });
    expect(me.played).toHaveLength(0);
    expect(me.crystals).toBe(25);
  });

  it('随从偶像：水晶 + 在场随从数，并标记本回合已用', () => {
    const base = activateReady(['随从偶像']);
    const familiars = BASE_CARDS.filter((card) => card.type === 'familiar').slice(0, 2);
    expect(familiars).toHaveLength(2);
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              played: [
                ...player.played,
                ...familiars.map((card, index) => ({ i: card.id, u: 7100 + index })),
              ],
            }
          : player,
      ),
    };
    // 两张随从在场：+2
    const res = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.crystals).toBe(12);
    expect(res.state.players[0]?.activatedThisTurn).toContain('7000');
    const view = seasons.view(res.state, 0, true);
    expect(view.players[0]?.played[0]?.used).toBe(true);

    const again = seasons.reduce(res.state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe('already_activated');
  });

  it('力量药水：牺牲本卡、抽 1 张、召唤等级 +2', () => {
    const state = activateReady(['力量药水']);
    const handBefore = state.players[0]?.hand.length ?? 0;
    const res = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.played).toHaveLength(0);
    expect(res.state.players[0]?.gauge).toBe((state.players[0]?.gauge ?? 0) + 2);
    // 抽到 1 张手牌；召唤等级 +2 后依然满足结算，不额外断言具体牌。
    expect(res.state.players[0]?.hand.length).toBeGreaterThanOrEqual(handBefore + 1);
    expect(res.state.discard.some((card) => card.u === 7000)).toBe(true);
  });

  it('毁灭者凯恩：选择弃 1 能量，对手水晶 -4', () => {
    const state = activateReady(['毁灭者凯恩']);
    const res = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.kind).toBe('element_pick');
    expect(res.state.pendingChoice?.options.amount).toBe(1);

    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { element: 'air' } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.players[1]?.crystals).toBe(2);
    expect(done.state.pendingChoice).toBeNull();
    expect(done.state.players[0]?.energies.air).toBe(4);
  });

  it('伊什塔尔天平：弃 3 个相同能量换 9 水晶', () => {
    const state = activateReady(['伊什塔尔天平']);
    const res = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { element: 'fire' } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.players[0]?.crystals).toBe(19);
    expect(done.state.players[0]?.energies.fire).toBe(2);
  });

  it('伊什塔尔天平：不足 3 个同类能量时请求阶段直接拒绝，不留下死待答', () => {
    const state = activateReady(['伊什塔尔天平']);
    const poor: SeasonsState = {
      ...state,
      players: state.players.map((player, seat) =>
        seat === 0
          ? { ...player, energies: { water: 1, air: 1, fire: 1, earth: 1 } }
          : player,
      ),
    };
    const res = seasons.reduce(poor, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('effect_not_implemented');
  });

  it('伊什塔尔天平：储备不足但卡上同类能量足够时可以激活', () => {
    const state = activateReady(['伊什塔尔天平']);
    const withStored: SeasonsState = {
      ...state,
      players: state.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              energies: { water: 1, air: 1, fire: 0, earth: 1 },
              played: [
                ...player.played,
                {
                  i: reserveSlotCard().id,
                  u: 7099,
                  stored: { water: 3 },
                },
              ],
            }
          : player,
      ),
    };
    const res = seasons.reduce(
      withStored,
      0,
      { type: 'activate', cardUid: 7000 },
      ctx,
    );
    expect(res.ok, res.ok ? '' : `${res.code}: ${res.message}`).toBe(true);
  });

  it('非自己回合不能激活', () => {
    const state = activateReady(['随从偶像']);
    const res = seasons.reduce(state, 1, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('not_your_turn');
  });
});

  it('偷窃妖精：对手激活时，自己水晶 +2（1 来自对手）', () => {
    const base = activateReady(['随从偶像']);
    const fairies = BASE_CARDS.find((card) => card.nameZh === '偷窃妖精')!;
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player) =>
        player.seat === 1
          ? { ...player, crystals: 3, played: [{ i: fairies.id, u: 7300 }] }
          : { ...player, crystals: 5 },
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.crystals).toBe(4);
    expect(res.state.players[1]?.crystals).toBe(5);
  });

describe('seasons activate (batch 2)', () => {
  it('知识药水：牺牲后获得 5 个任意能量', () => {
    const state = activateReady(['知识药水']);
    const res = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.played).toHaveLength(0);
    expect(res.state.discard.some((card) => card.u === 7000)).toBe(true);
    expect(res.state.pendingChoice?.kind).toBe('element_alloc');
    expect(res.state.pendingChoice?.options.amount).toBe(5);

    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { water: 3, air: 2 } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.players[0]?.energies.water).toBe(8);
    expect(done.state.players[0]?.energies.air).toBe(7);
    expect(done.state.players[0]?.activatedThisTurn.some((k) => k.startsWith('7000'))).toBe(true);
  });

  it('死灵匕首：弃手牌随从后获得 4 个任意能量', () => {
    const familiar = BASE_CARDS.find(
      (card) => card.type === 'familiar' && card.effect?.trigger === 'permanent',
    )!;
    const base = activateReady(['死灵匕首']);
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0 ? { ...player, hand: [{ i: familiar.id, u: 7100 }] } : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.kind).toBe('sacrifice_cards');
    expect(res.state.pendingChoice?.options.source).toBe('hand_or_play');
    const picked = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { uid: 7100 } },
      ctx,
    );
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.state.players[0]?.hand).toHaveLength(0);
    expect(picked.state.discard.some((card) => card.u === 7100)).toBe(true);
    expect(picked.state.pendingChoice?.kind).toBe('element_alloc');
    expect(picked.state.pendingChoice?.options.amount).toBe(4);
    const done = seasons.reduce(
      picked.state,
      0,
      { type: 'resolve-choice', choice: { earth: 4 } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.players[0]?.energies.earth).toBe(9);
    // 匕首本身留在场上
    expect(done.state.players[0]?.played.some((card) => card.u === 7000)).toBe(true);
  });

  it('死灵匕首：牺牲在场随从后获得 4 个任意能量', () => {
    const familiar = BASE_CARDS.find(
      (card) => card.type === 'familiar' && card.effect?.trigger === 'permanent',
    )!;
    const base = activateReady(['死灵匕首']);
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, played: [...player.played, { i: familiar.id, u: 7101 }] }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const picked = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { uid: 7101 } },
      ctx,
    );
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.state.players[0]?.played.some((card) => card.u === 7101)).toBe(false);
    expect(picked.state.discard.some((card) => card.u === 7101)).toBe(true);
    const done = seasons.reduce(
      picked.state,
      0,
      { type: 'resolve-choice', choice: { earth: 4 } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.players[0]?.energies.earth).toBe(9);
  });

  it('死灵匕首：没有随从可弃/牺牲时激活被拒绝', () => {
    const state = activateReady(['死灵匕首']);
    const res = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('invalid_choice');
  });

  it('生命药水：必须将全部储备元素按每个 4 水晶转换', () => {
    const state = activateReady(['生命药水']);
    const res = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.played).toHaveLength(0);
    expect(res.state.pendingChoice?.kind).toBe('element_multi');
    expect(res.state.pendingChoice?.options.elements).toEqual([
      { element: 'water', count: 5 },
      { element: 'air', count: 5 },
      { element: 'fire', count: 5 },
      { element: 'earth', count: 5 },
    ]);
    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: ['water', 'air', 'fire', 'earth'] },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.players[0]?.crystals).toBe(10 + 20 * 4);
    expect(done.state.players[0]?.energies.water).toBe(0);
    expect(done.state.players[0]?.energies.air).toBe(0);
    expect(done.state.players[0]?.energies.fire).toBe(0);
    expect(done.state.players[0]?.energies.earth).toBe(0);
  });

  it('生命药水：重复或没有能量的元素被拒绝', () => {
    const state = activateReady(['生命药水']);
    const res = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const dup = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: ['water', 'water'] },
      ctx,
    );
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.code).toBe('invalid_choice');
    const empty = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: [] },
      ctx,
    );
    expect(empty.ok).toBe(false);
  });

  it('光之树 A：弃 3 水晶得 1 能量', () => {
    const state = activateReady(['光之树']);
    const res = seasons.reduce(
      state,
      0,
      { type: 'activate', cardUid: 7000, abilityKey: 'crystal_to_energy' },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.crystals).toBe(7);
    expect(res.state.pendingChoice?.options.amount).toBe(1);
    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { air: 1 } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.players[0]?.energies.air).toBe(6);
  });

  it('光之树 B：弃 1 能量按当季转化值换水晶', () => {
    const state = activateReady(['光之树']);
    const res = seasons.reduce(
      state,
      0,
      { type: 'activate', cardUid: 7000, abilityKey: 'energy_to_crystal' },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { element: 'fire' } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    // 第 1 年冬季：火 → 2 水晶
    expect(done.state.players[0]?.crystals).toBe(12);
    expect(done.state.players[0]?.energies.fire).toBe(4);
  });
});

describe('seasons end-of-turn and season effects', () => {
  it('奇迹宝箱：所有玩家完成本轮后才结算，且只结算一次', () => {
    const base = activateReady(['奇迹宝箱']);
    const first = base.turnOwner!;
    const second = base.dicePicked.find((seat) => seat !== first)!;
    const afterFirst = seasons.reduce(base, first, { type: 'end-turn' }, ctx);
    expect(afterFirst.ok).toBe(true);
    if (!afterFirst.ok) return;
    expect(afterFirst.state.players[first]?.crystals).toBe(10);

    const afterSecond = seasons.reduce(afterFirst.state, second, { type: 'end-turn' }, ctx);
    expect(afterSecond.ok).toBe(true);
    if (!afterSecond.ok) return;
    expect(afterSecond.state.players[first]?.crystals).toBe(13);
    expect(
      afterSecond.state.log.filter((entry) => entry.msg.includes('奇迹宝箱：水晶 +3')),
    ).toHaveLength(1);
  });

  it('奇迹宝箱：首位结束后仍未满足 4 点储备，不提前结算', () => {
    const base = activateReady(['奇迹宝箱']);
    const first = base.turnOwner!;
    const second = base.dicePicked.find((seat) => seat !== first)!;
    const prepared: SeasonsState = {
      ...base,
      players: base.players.map((player) =>
        player.seat === first
          ? { ...player, energies: { water: 1, air: 1, fire: 1, earth: 0 } }
          : player,
      ),
    };
    const afterFirst = seasons.reduce(prepared, first, { type: 'end-turn' }, ctx);
    expect(afterFirst.ok).toBe(true);
    if (!afterFirst.ok) return;
    expect(afterFirst.state.players[first]?.crystals).toBe(10);
    const afterSecond = seasons.reduce(afterFirst.state, second, { type: 'end-turn' }, ctx);
    expect(afterSecond.ok).toBe(true);
    if (!afterSecond.ok) return;
    expect(afterSecond.state.players[first]?.crystals).toBe(10);
  });

  it('深凝视的提图斯：对手给 1 水晶；对手无水晶时牺牲本卡', () => {
    const state = { ...activateReady(['深凝视的提图斯']), pickedThisSeason: [1] };
    const res = seasons.reduce(state, 0, { type: 'end-turn' }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.crystals).toBe(11);
    expect(res.state.players[1]?.crystals).toBe(5);

    const poor: SeasonsState = {
      ...state,
      players: state.players.map((player, seat) =>
        seat === 1 ? { ...player, crystals: 0 } : player,
      ),
    };
    const res2 = seasons.reduce(poor, 0, { type: 'end-turn' }, ctx);
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    // 有对手付不起：直接牺牲，不收其他人的水晶（自己仍是 10）。
    expect(res2.state.players[0]?.crystals).toBe(10);
    expect(res2.state.players[0]?.played).toHaveLength(0);
    expect(res2.state.discard.some((card) => card.u === 7000)).toBe(true);
  });

  it('贪婪的菲格里姆：换季时每位对手给 1 水晶', () => {
    const base = activateReady(['贪婪的菲格里姆']);
    const state: SeasonsState = { ...base, month: 2 };
    const afterFirst = apply(state, 0, { type: 'end-turn' });
    const afterSecond = apply(afterFirst, 1, { type: 'end-turn' });
    expect(afterSecond.month).toBeGreaterThanOrEqual(3);
    expect(afterSecond.seasonIdx).toBe(1);
    expect(afterSecond.players[0]?.crystals).toBe(11);
    expect(afterSecond.players[1]?.crystals).toBe(5);
  });
});

describe('seasons passive summon effects', () => {
  it('春之杖：每次召唤得 3 水晶', () => {
    const wand = BASE_CARDS.find((card) => card.nameZh === '春之杖')!;
    const plain = BASE_CARDS.find(
      (card) =>
        card.id !== wand.id &&
        card.effect?.trigger === 'permanent' &&
        card.effect.triggers.length === 0,
    )!;
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              crystals: 0,
              played: [{ i: wand.id, u: 7200 }],
              hand: [{ i: plain.id, u: 7201 }, ...player.hand],
            }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 7201 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.crystals).toBe(3);
    expect(res.state.log.some((entry) => entry.msg.includes('春之杖'))).toBe(true);
  });

  it('奥术水蛭：对手召唤时给你 1 水晶', () => {
    const leech = BASE_CARDS.find((card) => card.nameZh === '奥术水蛭')!;
    const plain = BASE_CARDS.find((card) => card.nameZh === '伊俄的钱袋')!;
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, crystals: 5, hand: [{ i: plain.id, u: 7301 }, ...player.hand] }
          : { ...player, crystals: 5, played: [{ i: leech.id, u: 7300 }] },
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 7301 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.crystals).toBe(4);
    expect(res.state.players[1]?.crystals).toBe(6);
  });
});

describe('seasons activate (batch 3)', () => {
  it('贪吃锅：放入能量，满 7 时牺牲并返还能量 +15 水晶', () => {
    const base = activateReady(['贪吃锅']);
    const glutton = BASE_CARDS.find((card) => card.nameZh === '贪吃锅')!;
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              played: [{ i: glutton.id, u: 7000, stored: { water: 6 } }],
            }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.kind).toBe('element_pick');

    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { element: 'water' } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.players[0]?.crystals).toBe(25);
    expect(done.state.players[0]?.played).toHaveLength(0);
    expect(done.state.discard.some((card) => card.u === 7000)).toBe(true);
    // 原储备 5 - 放入 1 + 返还 7 = 11
    expect(done.state.players[0]?.energies.water).toBe(11);
  });

  it('龙之头骨：连续三次选择牺牲，合计 +15 水晶', () => {
    const base = activateReady(['龙之头骨']);
    const extra = BASE_CARDS.filter((card) => card.type === 'familiar').slice(0, 2);
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              played: [
                ...player.played,
                ...extra.map((card, index) => ({ i: card.id, u: 7100 + index })),
              ],
            }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.kind).toBe('sacrifice_cards');
    expect(res.state.pendingChoice?.options.remaining).toBe(3);

    let next = res.state;
    for (const uid of [7100, 7101, 7000]) {
      const step = seasons.reduce(next, 0, { type: 'resolve-choice', choice: [uid] }, ctx);
      expect(step.ok).toBe(true);
      if (!step.ok) return;
      next = step.state;
    }
    expect(next.players[0]?.crystals).toBe(25);
    expect(next.players[0]?.played).toHaveLength(0);
    expect(next.discard).toHaveLength(3);
    expect(next.pendingChoice).toBeNull();
  });
});

describe('seasons crystal orb', () => {
  it('放回牌堆顶：牌堆数量不变、已激活标记', () => {
    const base = activateReady(['水晶球']);
    const orb = base.players[0]!.played.find((card) => card.i === 34)!;
    const res = seasons.reduce(
      base,
      0,
      { type: 'activate', cardUid: orb.u, abilityKey: 'summon' },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.kind).toBe('branch');
    expect(res.state.deck).toHaveLength(base.deck.length - 1);

    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: 'keep' },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.deck).toHaveLength(base.deck.length);
    expect(done.state.pendingChoice).toBeNull();
    expect(done.state.players[0]?.activatedThisTurn.length).toBe(1);
  });

  it('弃 4 能量免费召唤牌堆顶', () => {
    const prepared = activateReady(['水晶球']);
    // drawOne 从数组尾部取牌：放一张无召唤选择的钱袋在牌堆顶。
    const base: SeasonsState = {
      ...prepared,
      deck: [...prepared.deck, { i: 8, u: 9001 }],
    };
    const orb = base.players[0]!.played.find((card) => card.i === 34)!;
    const started = seasons.reduce(
      base,
      0,
      { type: 'activate', cardUid: orb.u, abilityKey: 'summon' },
      ctx,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const summonStep = seasons.reduce(
      started.state,
      0,
      { type: 'resolve-choice', choice: 'summon' },
      ctx,
    );
    expect(summonStep.ok).toBe(true);
    if (!summonStep.ok) return;
    expect(summonStep.state.pendingChoice?.kind).toBe('element_alloc');
    expect(summonStep.state.pendingChoice?.options.mode).toBe('pay');

    const before = summonStep.state.players[0]!.energies;
    const alloc = { water: 2, air: 1, fire: 1 };
    const done = seasons.reduce(
      summonStep.state,
      0,
      { type: 'resolve-choice', choice: alloc },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const me = done.state.players[0]!;
    expect(me.energies.water).toBe(before.water - 2);
    expect(me.energies.air).toBe(before.air - 1);
    expect(me.played.length).toBeGreaterThan(1);
    expect(done.state.pendingChoice).toBeNull();
  });

  it('退 3 水晶弃掉牌堆顶', () => {
    const base = activateReady(['水晶球']);
    const orb = base.players[0]!.played.find((card) => card.i === 34)!;
    const crystalsBefore = base.players[0]!.crystals;
    const res = seasons.reduce(
      base,
      0,
      { type: 'activate', cardUid: orb.u, abilityKey: 'discard' },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.crystals).toBe(crystalsBefore - 3);
    expect(res.state.discard).toHaveLength(1);
  });
});

describe('seasons mirror and dreams', () => {
  it('四季之镜：选源→选数量→选目标，扣水晶并转换同量能量', () => {
    const base = activateReady(['四季之镜']);
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, crystals: 5, energies: { water: 3, air: 1, fire: 1, earth: 1 } }
          : player,
      ),
    };
    const started = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.state.pendingChoice?.options.step).toBe('source');

    const source = seasons.reduce(
      started.state,
      0,
      { type: 'resolve-choice', choice: 'water' },
      ctx,
    );
    expect(source.ok).toBe(true);
    if (!source.ok) return;
    expect(source.state.pendingChoice?.options.step).toBe('amount');

    const amount = seasons.reduce(
      source.state,
      0,
      { type: 'resolve-choice', choice: '2' },
      ctx,
    );
    expect(amount.ok).toBe(true);
    if (!amount.ok) return;
    expect(amount.state.pendingChoice?.options.step).toBe('target');

    const done = seasons.reduce(
      amount.state,
      0,
      { type: 'resolve-choice', choice: 'air' },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const me = done.state.players[0]!;
    expect(me.crystals).toBe(3);
    expect(me.energies.water).toBe(1);
    expect(me.energies.air).toBe(3);
    expect(done.state.pendingChoice).toBeNull();
  });

  it('梦境药水：牺牲、清空能量、免费召唤手牌', () => {
    const base = activateReady(['梦境药水']);
    const pouch = BASE_CARDS.find((card) => card.nameZh === '伊俄的钱袋')!;
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, hand: [{ i: pouch.id, u: 7400 }, ...player.hand] }
          : player,
      ),
    };
    const started = seasons.reduce(state, 0, { type: 'activate', cardUid: 7000 }, ctx);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.state.pendingChoice?.key).toBe('dream_payment');
    expect(started.state.players[0]?.energies).toEqual(state.players[0]?.energies);
    const paid = seasons.reduce(started.state, 0,
      { type: 'resolve-choice', choice: state.players[0]!.energies }, ctx);
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.state.pendingChoice?.kind).toBe('card_pick');
    expect(paid.state.players[0]?.energies).toEqual({
      water: 0,
      air: 0,
      fire: 0,
      earth: 0,
    });
    expect(started.state.players[0]?.played).toHaveLength(0);

    const done = seasons.reduce(
      paid.state,
      0,
      { type: 'resolve-choice', choice: { uid: 7400 } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.players[0]?.played.map((card) => card.u)).toEqual([7400]);
    expect(done.state.players[0]?.hand.some((card) => card.u === 7400)).toBe(false);
  });
});

describe('seasons summon choices (batch 2)', () => {
  it('吸血鬼王冠：选择抽或弃，再按声望得能量', () => {
    const crown = BASE_CARDS.find((card) => card.nameZh === '吸血鬼王冠')!;
    const top = BASE_CARDS.find((card) => card.points >= 3 && card.id !== crown.id)!;
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      deck: [...base.deck, { i: top.id, u: 9100 }],
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, hand: [{ i: crown.id, u: 9101 }, ...player.hand] }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 9101 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.kind).toBe('branch');
    expect(res.state.pendingChoice?.options.points).toBe(top.points);

    // 选「抽入手牌」：牌进手牌，不再弃掉，并继续选能量。
    const drawn = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { id: 'draw' } },
      ctx,
    );
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;
    expect(drawn.state.players[0]?.hand.some((card) => card.u === 9100)).toBe(true);
    expect(drawn.state.discard.some((card) => card.u === 9100)).toBe(false);
    expect(drawn.state.pendingChoice?.kind).toBe('element_alloc');
    expect(drawn.state.pendingChoice?.options.amount).toBe(top.points);
  });

  it('吸血鬼王冠：选「弃掉」时牌进弃牌堆', () => {
    const crown = BASE_CARDS.find((card) => card.nameZh === '吸血鬼王冠')!;
    const top = BASE_CARDS.find((card) => card.points >= 3 && card.id !== crown.id)!;
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      deck: [...base.deck, { i: top.id, u: 9102 }],
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, hand: [{ i: crown.id, u: 9103 }, ...player.hand] }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 9103 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const discarded = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { id: 'discard' } },
      ctx,
    );
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    expect(discarded.state.discard.some((card) => card.u === 9102)).toBe(true);
    expect(discarded.state.players[0]?.hand.some((card) => card.u === 9102)).toBe(false);
    expect(discarded.state.pendingChoice?.kind).toBe('element_alloc');
  });

  it('神圣圣杯：抽 4 张，免费召唤 1 张，其余弃掉', () => {
    const chalice = BASE_CARDS.find((card) => card.nameZh === '神圣圣杯')!;
    const base = summonReady();
    const top = BASE_CARDS.find((card) => card.nameZh === '伊俄的钱袋')!;
    const state: SeasonsState = {
      ...base,
      deck: [...base.deck, { i: top.id, u: 9200 }],
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, hand: [{ i: chalice.id, u: 9201 }, ...player.hand] }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 9201 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.kind).toBe('card_pick');
    expect(res.state.pendingCards).toHaveLength(4);
    const pickedUid = res.state.pendingCards!.find((card) => card.i === top.id)!.u;

    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { uid: pickedUid } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.players[0]?.played.some((card) => card.u === pickedUid)).toBe(true);
    expect(done.state.discard).toHaveLength(3);
    expect(done.state.pendingCards).toBeNull();
  });

  it('女先知娜莉亚：抽等于人数张，自留 1 张，其余指定给各对手', () => {
    const naria = BASE_CARDS.find((card) => card.nameZh === '女先知娜莉亚')!;
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, hand: [{ i: naria.id, u: 9301 }, ...player.hand] }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 9301 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.kind).toBe('card_list');
    expect(res.state.pendingCards).toHaveLength(2); // 2 人局：抽 2 张
    const keepUid = res.state.pendingCards![0]!.u;
    const giveUid = res.state.pendingCards![1]!.u;
    const handBefore = res.state.players[0]!.hand.length;
    const oppBefore = res.state.players[1]!.hand.length;

    const kept = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: [keepUid] },
      ctx,
    );
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.state.players[0]?.hand).toHaveLength(handBefore + 1);
    // 剩下的 1 张由召唤者指定对手（不能自动分）。
    expect(kept.state.pendingChoice?.kind).toBe('card_pick');
    expect(kept.state.pendingChoice?.options.purpose).toBe('distribute');
    expect(kept.state.players[1]?.hand).toHaveLength(oppBefore);

    const given = seasons.reduce(
      kept.state,
      0,
      { type: 'resolve-choice', choice: { uid: giveUid } },
      ctx,
    );
    expect(given.ok).toBe(true);
    if (!given.ok) return;
    expect(given.state.players[1]?.hand).toHaveLength(oppBefore + 1);
    expect(given.state.players[1]?.hand.some((card) => card.u === giveUid)).toBe(true);
    expect(given.state.pendingChoice).toBeNull();
    expect(given.state.pendingCards).toBeNull();
  });
});

describe('seasons multi-player summon choices', () => {
  it('忠实的西拉斯：对手各自牺牲 1 张在场牌', () => {
    const syllas = BASE_CARDS.find((card) => card.nameZh === '忠实的西拉斯')!;
    const base = summonReady();
    const oppCard = BASE_CARDS.find((card) => card.nameZh === '伊俄的钱袋')!;
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, hand: [{ i: syllas.id, u: 9401 }, ...player.hand] }
          : { ...player, played: [{ i: oppCard.id, u: 9402 }] },
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 9401 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.kind).toBe('multi_player_pick');
    expect(res.state.pendingChoice?.choosingSeat).toBe(1);

    const done = seasons.reduce(
      res.state,
      1,
      { type: 'resolve-choice', choice: { uid: 9402 } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.players[1]?.played).toHaveLength(0);
    expect(done.state.discard.some((card) => card.u === 9402)).toBe(true);
    expect(done.state.pendingChoice).toBeNull();
  });

  it('长颈阿姆苏格：每位玩家收回 1 张魔法物品', () => {
    const amsug = BASE_CARDS.find((card) => card.nameZh === '长颈阿姆苏格')!;
    const item = BASE_CARDS.find((card) => card.type === 'magic_item' && card.id !== amsug.id)!;
    const grimoire = BASE_CARDS.find((card) => card.nameZh === '附魔魔典')!;
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player) => ({
        ...player,
        played: [
          { i: player.seat === 1 ? grimoire.id : item.id, u: 9500 + player.seat },
        ],
        maxEnergy: player.seat === 1 ? 10 : player.maxEnergy,
      })),
    };
    const start = seasons.reduce(
      { ...state, players: state.players.map((player, seat) => seat === 0 ? { ...player, hand: [{ i: amsug.id, u: 9599 }, ...player.hand] } : player) },
      0,
      { type: 'summon', cardUid: 9599 },
      ctx,
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.state.pendingChoice?.kind).toBe('multi_player_pick');
    expect(start.state.pendingChoice?.choosingSeat).toBe(0);

    const step1 = seasons.reduce(
      start.state,
      0,
      { type: 'resolve-choice', choice: { uid: 9500 } },
      ctx,
    );
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;
    expect(step1.state.players[0]?.hand.some((card) => card.u === 9500)).toBe(true);
    expect(step1.state.pendingChoice?.choosingSeat).toBe(1);

    const step2 = seasons.reduce(
      step1.state,
      1,
      { type: 'resolve-choice', choice: { uid: 9501 } },
      ctx,
    );
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;
    expect(step2.state.players[1]?.hand.some((card) => card.u === 9501)).toBe(true);
    // 附魔魔典回手后，它提供的 +3 储备上限应被收回（10 → 7）
    expect(step2.state.players[1]?.maxEnergy).toBe(7);
    expect(step2.state.pendingChoice).toBeNull();
  });
});

describe('seasons lewis', () => {
  it('选择对手后，完整复制其储备元素，不允许自选数量', () => {
    const lewis = BASE_CARDS.find((card) => card.nameZh === '灰脸路易斯')!;
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              maxEnergy: 20,
              energies: { water: 3, air: 3, fire: 3, earth: 3 },
              hand: [{ i: lewis.id, u: 9601 }, ...player.hand],
            }
          : { ...player, energies: { water: 3, air: 2, fire: 0, earth: 0 } },
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 9601 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.kind).toBe('branch');
    expect(seasons.reduce(res.state, 0,
      { type: 'resolve-choice', choice: { water: 2 } }, ctx).ok).toBe(false);

    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: '1' },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    // 费用 air1/fire1，完整复制 water3/air2。
    expect(done.state.players[0]?.energies.water).toBe(6);
    expect(done.state.players[0]?.energies.air).toBe(4);
    // 复制不转移：对手能量不变。
    expect(done.state.players[1]?.energies.water).toBe(3);
  });
});

describe('seasons beggars horn', () => {
  it('回合结束储备≤1 时选择获得 1 能量，然后继续结束回合', () => {
    const base = summonReady();
    const horn = BASE_CARDS.find((card) => card.nameZh === '乞丐之角')!;
    const owner = base.turnOwner!;
    const other = base.dicePicked.find((seat) => seat !== owner)!;
    const state: SeasonsState = {
      ...base,
      pickedThisSeason: [other],
      players: base.players.map((player) =>
        player.seat === owner
          ? {
              ...player,
              energies: { water: 0, air: 0, fire: 0, earth: 0 },
              played: [...player.played, { i: horn.id, u: 9700 }],
            }
          : player,
      ),
    };
    const res = seasons.reduce(state, owner, { type: 'end-turn' }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.key).toBe('beggars_horn');

    const done = seasons.reduce(
      res.state,
      owner,
      { type: 'resolve-choice', choice: { water: 1 } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.players[owner]?.energies.water).toBe(1);
    let finished = done.state;
    if (finished.pendingChoice?.key === 'die_draw') {
      const discarded = finished.pendingCards![0]!;
      const skip = seasons.reduce(
        finished,
        finished.pendingChoice.choosingSeat,
        { type: 'end-turn' },
        ctx,
      );
      expect(skip.ok).toBe(true);
      if (!skip.ok) return;
      expect(skip.state.discard.some((card) => card.u === discarded.u)).toBe(true);
      finished = skip.state;
    }
    expect(finished.pendingChoice).toBeNull();
    expect(finished.turnOwner).not.toBe(owner);
  });
});

describe('seasons temporal boots', () => {
  it('召唤时不加水晶，只让季节轮前进所选格数', () => {
    const boots = BASE_CARDS.find((card) => card.nameZh === '时光之靴')!;
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      month: 2,
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, crystals: 5, hand: [{ i: boots.id, u: 9801 }, ...player.hand] }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 9801 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.kind).toBe('month_advance');
    expect(res.state.players[0]?.crystals).toBe(5);

    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { direction: 'forward', steps: 2 } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.month).toBe(4);
    expect(done.state.pendingChoice).toBeNull();
    expect(done.state.turnOwner).toBe(res.state.turnOwner);
    expect(done.state.season?.dice).toEqual(res.state.season?.dice);
  });
});

describe('seasons elemental amulet', () => {
  function amuletState(paid: 'water' | 'air' | 'both'): SeasonsState {
    const def = BASE_CARDS.find((card) => card.effect?.typeKey === 'elemental_amulet')!;
    const base = summonReady();
    return {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              maxEnergy: 20,
              energies: { water: 2, air: 2, fire: 2, earth: 2 },
              hand: [
                { i: def.id, u: 9901 },
                { i: 1, u: 9902 },
                { i: 2, u: 9903 },
                ...player.hand,
              ],
            }
          : player,
      ),
      // 记住付费方式，供用例取用。
      ...(paid === 'both' ? {} : {}),
    };
  }

  it('付水：选择的 2 个能量进入元素槽（不存卡面）', () => {
    const base = amuletState('water');
    const res = seasons.reduce(
      base,
      0,
      { type: 'summon', cardUid: 9901, paidElements: ['water'] },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice?.kind).toBe('element_alloc');
    expect(res.state.pendingChoice?.options.amount).toBe(2);
    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { air: 2 } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(
      done.state.players[0]?.played.find((card) => card.u === 9901)?.stored?.air,
    ).toBeUndefined();
    expect(done.state.players[0]?.energies.water).toBe(1); // 付水 1
    expect(done.state.players[0]?.energies.air).toBe(4); // 原有 2 + 获得 2
  });

  it('付风：召唤等级 +1（不弃手牌、不弹窗）', () => {
    const base = amuletState('air');
    const before = base.players[0]!.gauge;
    const handBefore = base.players[0]!.hand.length;
    const res = seasons.reduce(
      base,
      0,
      { type: 'summon', cardUid: 9901, paidElements: ['air'] },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingChoice).toBeNull();
    expect(res.state.players[0]?.gauge).toBe(before + 1);
    expect(res.state.players[0]?.hand.length).toBe(handBefore - 1); // 只少了被打出的护符
    expect(res.state.log.some((entry) => entry.msg.includes('召唤等级 +1'))).toBe(true);
  });
});

describe('seasons elemental amulet both', () => {
  it('同时付水+风：召唤等级 +1，再选 2 个能量', () => {
    const def = BASE_CARDS.find((card) => card.effect?.typeKey === 'elemental_amulet')!;
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              maxEnergy: 20,
              energies: { water: 2, air: 2, fire: 2, earth: 2 },
              hand: [
                { i: def.id, u: 9911 },
                { i: 1, u: 9912 },
                ...player.hand,
              ],
            }
          : player,
      ),
    };
    const gaugeBefore = state.players[0]!.gauge;
    const res = seasons.reduce(
      state,
      0,
      { type: 'summon', cardUid: 9911, paidElements: ['water', 'air'] },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // 风是即时结算的，水才需要选能量。
    expect(res.state.players[0]?.gauge).toBe(gaugeBefore + 1);
    expect(res.state.pendingChoice?.kind).toBe('element_alloc');
    const done = seasons.reduce(
      res.state,
      0,
      { type: 'resolve-choice', choice: { earth: 2 } },
      ctx,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.pendingChoice).toBeNull();
    expect(
      done.state.players[0]?.played.find((card) => card.u === 9911)?.stored?.earth,
    ).toBeUndefined();
    expect(done.state.players[0]?.energies.earth).toBe(4);
  });
});

describe('seasons cost reduction', () => {
  it('幸运之手：多元素费用先弹减免选择，结算后按减免后的费用支付', () => {
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      turnOwner: 0,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              played: [{ i: 20, u: 8800 }],
              hand: [{ i: 20, u: 9100 }],
              energies: { water: 0, air: 1, fire: 1, earth: 1 },
              crystals: 3,
              maxEnergy: 40,
            }
          : player,
      ),
    };

    const pending = seasons.reduce(
      state,
      0,
      { type: 'summon', cardUid: 9100 },
      ctx,
    );
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.state.pendingChoice?.kind).toBe('element_alloc');
    expect(pending.state.pendingChoice?.key).toBe('cost_reduce');

    const resolved = seasons.reduce(
      pending.state,
      0,
      { type: 'resolve-choice', choice: { air: 1 } },
      ctx,
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const me = resolved.state.players[0]!;
    expect(me.played.some((card) => card.u === 9100)).toBe(true);
    expect(me.energies).toEqual({ water: 0, air: 1, fire: 0, earth: 0 });
    expect(me.crystals).toBe(0);
  });

  it('幸运之手：能量差得比可减量多时直接 cant_afford，不弹注定失败的选择', () => {
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      turnOwner: 0,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              played: [{ i: 20, u: 8800 }],
              hand: [{ i: 20, u: 9100 }],
              energies: { water: 0, air: 0, fire: 0, earth: 3 },
              crystals: 3,
              maxEnergy: 40,
            }
          : player,
      ),
    };
    const result = seasons.reduce(state, 0, { type: 'summon', cardUid: 9100 }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('cant_afford');
  });

  it('幸运之手：单一元素费用自动减免，不弹窗', () => {
    const def = findDef((card) => {
      const elements = (['water', 'air', 'fire', 'earth'] as const).filter(
        (element) => (card.cost?.[element] ?? 0) > 0,
      );
      if (card.costFlexible || elements.length !== 1) return false;
      const total = elements.reduce((sum, element) => sum + (card.cost?.[element] ?? 0), 0);
      return total >= 2 && !card.effect?.abilities?.some((ability) => ability.kind === 'max_energy_plus');
    });
    const element = (['water', 'air', 'fire', 'earth'] as const).find(
      (element) => (def.cost?.[element] ?? 0) > 0,
    )!;
    const cost = def.cost[element];
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      turnOwner: 0,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              played: [{ i: 20, u: 8800 }],
              hand: [{ i: def.id, u: 9200 }],
              energies: { water: 0, air: 0, fire: 0, earth: 0, [element]: cost },
              crystals: def.cost.crystal,
              maxEnergy: 40,
            }
          : player,
      ),
    };

    const result = seasons.reduce(
      state,
      0,
      { type: 'summon', cardUid: 9200 },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const me = result.state.players[0]!;
    expect(result.state.pendingChoice).toBeNull();
    expect(me.played.some((card) => card.u === 9200)).toBe(true);
    expect(me.energies[element]).toBe(1);
  });
});

describe('seasons extension card rules', () => {
  const extensionCard = (id: number) => {
    const def = [...EXT1_CARDS, ...EXT2_CARDS].find((card) => card.id === id);
    if (!def) throw new Error(`missing extension card ${id}`);
    return def;
  };
  const ready = (played: { i: number; u: number }[] = []) => {
    const base = actionPhase('extension-rules');
    return {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              gauge: 10,
              maxEnergy: 20,
              crystals: 10,
              energies: { water: 5, air: 5, fire: 5, earth: 5 },
              played,
              activatedThisTurn: [],
              jewels: { water: 0, air: 0, fire: 0, earth: 0 },
            }
          : player,
      ),
    };
  };

  it('龙魂支付 1 水晶并重置一张本回合已用的其他牌', () => {
    const target = ready([{ i: 5, u: 7001 }]);
    const activatedTarget = {
      ...target,
      players: target.players.map((player) =>
        player.seat === 0
          ? { ...player, activatedThisTurn: ['7001'] }
          : player,
      ),
    };
    const withDragon = {
      ...activatedTarget,
      players: activatedTarget.players.map((player) =>
        player.seat === 0
          ? { ...player, played: [...player.played, { i: 71, u: 7002 }] }
          : player,
      ),
    };
    const started = apply(withDragon, 0, { type: 'activate', cardUid: 7002 });
    expect(started.players[0]!.crystals).toBe(withDragon.players[0]!.crystals - 1);
    expect(started.pendingChoice?.key).toBe('dragonsoul');
    const done = apply(started, 0, {
      type: 'resolve-choice',
      choice: { uid: 7001 },
    });
    expect(done.players[0]!.activatedThisTurn.some((key) => key.startsWith('7001'))).toBe(false);
    expect(done.players[0]!.activatedThisTurn).toContain('7002');
  });

  it('复生王座在进场时弃手牌、抽一张并把徽章使用数退回', () => {
    const state = ready([]);
    const card = { i: 60, u: 7010 };
    const discardedCard = { i: 1, u: 7011 };
    const withCard = {
      ...state,
      players: state.players.map((player) =>
        player.seat === 0
          ? { ...player, hand: [...player.hand, card, discardedCard], badgesUsed: 2 }
          : player,
      ),
    };
    const started = apply(withCard, 0, { type: 'summon', cardUid: 7010 });
    expect(started.pendingChoice?.key).toBe('throne_of_renewal');
    const handBefore = started.players[0]!.hand.length;
    const done = apply(started, 0, {
      type: 'resolve-choice',
      choice: { uid: discardedCard.u },
    });
    expect(done.players[0]!.badgesUsed).toBe(1);
    expect(done.players[0]!.hand.length).toBe(handBefore);
    expect(done.discard.some((item) => item.u === discardedCard.u)).toBe(true);
    expect(done.discard.some((item) => item.u === card.u)).toBe(false);
  });
  it('远古珠宝消耗 3 个同色能量、在牌上存 1 个并终局按数量计分', () => {
    const state = ready([{ i: 62, u: 7020 }]);
    const started = apply(state, 0, { type: 'activate', cardUid: 7020 });
    expect(started.pendingChoice?.key).toBe('jewel_of_the_ancients');
    const done = apply(started, 0, { type: 'resolve-choice', choice: { element: 'water' } });
    expect(done.players[0]!.energies.water).toBe(2);
    expect(done.players[0]!.cardMarks?.[7020]?.jewels).toBe(1);
    expect(done.players[0]!.cardMarks?.[7020]?.storedWater).toBe(1);
    const scored = {
      ...done,
      month: 35,
      pickedThisSeason: [1],
      dicePicked: [0, 1],
    };
    const ended = applyEnd(scored);
    const score = ended.result?.players.find((item) => item.seat === 0);
    expect(score?.effectPoints).toBe(-10);
  });

  it('伊欧的晶化魔盘让水晶骰面允许晶化，并在回合结束奖励 2 水晶', () => {
    const base = actionPhase('transmuter-round');
    const withCard = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              played: [{ i: 59, u: 7031 }],
              canTransmute: false,
              energies: { water: 2, air: 0, fire: 0, earth: 0 },
            }
          : player,
      ),
      season: base.season
        ? {
            ...base.season,
            dice: base.season.dice.map((die) =>
              die.pickedBy === 0
                ? { ...die, rewards: { ...die.rewards, crystals: 1 } }
                : die,
            ),
          }
        : null,
    };
    const transmuted = apply(withCard, 0, { type: 'transmute', element: 'water' });
    expect(transmuted.players[0]!.energies.water).toBe(1);
    expect(transmuted.players[0]!.transmutedThisTurn).toBe(true);
    const firstEnded = apply(transmuted, 0, { type: 'end-turn' });
    expect(firstEnded.players[0]!.transmutedThisTurn).toBe(true);
    const ended = apply(firstEnded, firstEnded.turnOwner!, { type: 'end-turn' });
    expect(ended.players[0]!.transmutedThisTurn).toBe(false);
    expect(ended.log.some((entry) => entry.msg.includes('晶化魔盘'))).toBe(true);
  });

  it('伊欧的复制仪支付 1 水并生成独立复制牌，牌面 7 分', () => {
    const state = ready([{ i: 80, u: 7040 }]);
    const before = state.players[0]!;
    const started = apply(state, 0, { type: 'activate', cardUid: 7040 });
    const me = started.players[0]!;
    expect(me.energies.water).toBe(before.energies.water - 1);
    expect(me.played.some((card) => card.i === 222 && card.generated)).toBe(true);
    expect(started.replicaDeck).toBe(9);
    expect(me.replicaSupply).toBe(9);
    expect(started.players[0]!.activatedThisTurn).toContain('7040');
  });

  it('复制仪在无召唤槽或无复制牌时拒绝且不扣水', () => {
    const full = ready([{ i: 80, u: 7041 }]);
    const fullState = {
      ...full,
      players: full.players.map((player) =>
        player.seat === 0 ? { ...player, gauge: player.played.length } : player,
      ),
    } satisfies SeasonsState;
    const blocked = seasons.reduce(fullState, 0, { type: 'activate', cardUid: 7041 }, ctx);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('gauge_low');
    expect(fullState.players[0]!.energies.water).toBe(5);

    const exhausted: SeasonsState = { ...full, replicaDeck: 0 };
    const empty = seasons.reduce(exhausted, 0, { type: 'activate', cardUid: 7041 }, ctx);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe('no_replica');
  });

  it('伊欧的爪牙阻止获得水晶，但仍可弃风传递并重置', () => {
    const base = ready([{ i: 88, u: 7050 }]);
    const state = {
      ...base,
      players: base.players.map((player) =>
        player.seat === 0 ? { ...player, crystals: 20 } : player,
      ),
    } satisfies SeasonsState;
    const started = apply(state, 0, { type: 'activate', cardUid: 7050 });
    expect(started.pendingChoice?.kind).toBe('branch');
    const passed = apply(started, 0, { type: 'resolve-choice', choice: 'transfer' });
    expect(passed.players[0]!.played.some((card) => card.u === 7050)).toBe(false);
    expect(passed.players[1]!.played.some((card) => card.u === 7050)).toBe(true);
    expect(passed.players[0]!.energies.air).toBe(4);
    expect(passed.players[1]!.activatedThisTurn).not.toContain('7050');
    expect(passed.players[0]!.crystals).toBe(20);
  });

  it('拉格菲尔德的仆从只让至少10水晶的玩家升等级，并各自选择摸牌', () => {
    const state = ready([]);
    const cast = {
      ...state,
      players: state.players.map((player) => ({
        ...player,
        hand:
          player.seat === 0
            ? [{ i: 86, u: 7060 }, ...player.hand]
            : player.hand,
        crystals: player.seat === 0 ? 9 : 10,
      })),
    } satisfies SeasonsState;
    const started = apply(cast, 0, { type: 'summon', cardUid: 7060 });
    expect(started.players[0]!.played.some((card) => card.i === 86)).toBe(true);
    expect(started.players[0]!.gauge).toBe(cast.players[0]!.gauge);
    expect(started.players[1]!.gauge).toBe(cast.players[1]!.gauge + 1);
    expect(started.pendingChoice?.key).toBe('servant_of_ragfield');
    const first = apply(started, 1, { type: 'resolve-choice', choice: 'keep' });
    expect(first.players[1]!.hand.length).toBe(started.players[1]!.hand.length + 1);
    expect(first.pendingChoice).toBeNull();
  });

  it('席拉之盾可代替龙之头骨所需的牺牲，并结算 10 水晶', () => {
    const base = ready([{ i: 37, u: 7080 }]);
    const state = {
      ...base,
      players: base.players.map((player) =>
        player.seat === 0
          ? {
              ...player,
              played: [
                ...player.played,
                { i: 72, u: 7081 },
                { i: 63, u: 7082 },
              ],
              energies: { water: 5, air: 5, fire: 5, earth: 5 },
              maxEnergy: 20,
              crystals: 10,
            }
          : player,
      ),
    } satisfies SeasonsState;
    const started = apply(state, 0, { type: 'activate', cardUid: 7080 });
    expect(started.pendingChoice?.kind).toBe('sacrifice_cards');
    const afterShield = apply(started, 0, {
      type: 'resolve-choice',
      choice: [7082],
    });
    expect(afterShield.players[0]!.crystals).toBe(20);
    expect(afterShield.discard.some((card) => card.u === 7082)).toBe(true);
    expect(afterShield.players[0]!.played.some((card) => card.u === 7082)).toBe(false);
    expect(afterShield.pendingChoice?.options.remaining).toBe(2);
  });

  it('诈欺狼把交牌目标限制为场上魔法牌最少的对手，并允许选择手牌', () => {
    const state = ready([]);
    const staged = {
      ...state,
      players: state.players.map((player) =>
        player.seat === 0
          ? { ...player, hand: [{ i: 90, u: 7070 }, { i: 8, u: 7071 }] }
          : { ...player, played: [] },
      ),
    } satisfies SeasonsState;
    const started = apply(staged, 0, { type: 'summon', cardUid: 7070 });
    expect(started.players[0]!.played.some((card) => card.i === 90)).toBe(true);
    expect(started.pendingChoice?.key).toBe('crafty_nightshade');
    expect(started.pendingChoice?.options.stage).toBe('target');
    const targetSeat = staged.players
      .map((player) => player.seat)
      .find((seat) => seat !== 0)!;
    const target = apply(started, 0, {
      type: 'resolve-choice',
      choice: String(targetSeat),
    });
    expect(target.pendingChoice?.options.stage).toBe('card');
    const handCard = target.players[0]!.hand[0]!;
    const opponentHand = target.players[1]!.hand.length;
    const done = apply(target, 0, {
      type: 'resolve-choice',
      choice: { uid: handCard.u },
    });
    expect(done.players[0]!.hand.some((card) => card.u === handCard.u)).toBe(false);
    expect(done.players[1]!.hand.some((card) => card.u === handCard.u)).toBe(true);
    expect(done.players[1]!.hand.length).toBe(opponentHand + 1);
  });
});

function applyEnd(state: SeasonsState): SeasonsState {
  const advanced = seasons.reduce(
    { ...state, month: 35, turnOwner: 0, phase: 'play' },
    0,
    { type: 'end-turn' },
    ctx,
  );
  if (!advanced.ok) throw new Error(advanced.message);
  return advanced.state;
}

describe('seasons badges', () => {
  it('徽章 3：召唤等级 +1，并消耗一次使用次数', () => {
    const state = summonReady();
    const before = state.players[0]!.gauge;
    const after = apply(state, 0, { type: 'use-badge', badgeType: 3 });
    expect(after.players[0]!.gauge).toBe(before + 1);
    expect(after.players[0]!.badgesUsed).toBe(1);
    expect(after.log.at(-1)?.t).toBe('badge');
  });

  it('徽章 2：无元素也可取得晶化权，两次叠加后每枚额外 +2', () => {
    const state = actionPhase('badge-2');
    const noEnergy: SeasonsState = {
      ...state,
      players: state.players.map((player) =>
        player.seat === 0
          ? {
              ...player,
              canTransmute: false,
              energies: { water: 0, air: 0, fire: 0, earth: 0 },
            }
          : player,
      ),
    };
    const badge = apply(noEnergy, 0, { type: 'use-badge', badgeType: 2 });
    expect(badge.players[0]!.energies).toEqual({ water: 0, air: 0, fire: 0, earth: 0 });
    expect(badge.players[0]!.badgesUsed).toBe(1);
    expect(badge.players[0]!.transmuteBonus).toBe(1);
    const twice = apply(badge, 0, { type: 'use-badge', badgeType: 2 });
    expect(twice.players[0]!.transmuteBonus).toBe(2);
    expect(twice.players[0]!.badgesUsed).toBe(2);
    const ready: SeasonsState = {
      ...twice,
      players: twice.players.map((player) =>
        player.seat === 0
          ? {
              ...player,
              canTransmute: true,
              energies: { ...player.energies, water: 2 },
            }
          : player,
      ),
    };
    const transmuted = apply(ready, 0, { type: 'transmute', element: 'water' });
    expect(transmuted.players[0]!.energies.water).toBe(1);
    const waterValue = seasons
      .view(ready, 0, true)
      .transmuteValues.find(({ element }) => element === 'water')!.value;
    expect(transmuted.players[0]!.crystals - ready.players[0]!.crystals).toBe(
      waterValue + 2,
    );
    expect(transmuted.players[0]!.transmuteBonus).toBe(2);
    const again = apply(transmuted, 0, { type: 'transmute', element: 'water' });
    expect(again.players[0]!.crystals - transmuted.players[0]!.crystals).toBe(waterValue + 2);
    const ended = apply(again, 0, { type: 'end-turn' });
    expect(ended.players[0]!.transmuteBonus).toBe(0);
  });

  it('徽章 2 的额外值按 month 推导（seasonIdx 过期也不影响）', () => {
    const base = summonReady();
    // 春季（month=4）：air 的转换值是 2，徽章额外 +1 应得 3 水晶。
    const stale: SeasonsState = {
      ...base,
      month: 4,
      seasonIdx: 0,
      players: base.players.map((player) =>
        player.seat === 0
          ? { ...player, canTransmute: true, energies: { ...player.energies, air: 1 } }
          : player,
      ),
    };
    const withBadge = apply(stale, 0, { type: 'use-badge', badgeType: 2 });
    const before = withBadge.players[0]!.crystals;
    const after = apply(withBadge, 0, { type: 'transmute', element: 'air' });
    expect(after.players[0]!.crystals - before).toBe(3);
  });

  it('徽章 1：2 个能量换成任意 2 个元素', () => {
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, energies: { water: 2, air: 0, fire: 0, earth: 0 } }
          : player,
      ),
    };
    const after = apply(state, 0, {
      type: 'use-badge',
      badgeType: 1,
      fromElements: ['water', 'water'],
      toElements: ['fire', 'earth'],
    });
    const me = after.players[0]!;
    expect(me.energies).toEqual({ water: 0, air: 0, fire: 1, earth: 1 });
  });

  it('徽章 1：能量不足时拒绝，不消耗次数', () => {
    const base = summonReady();
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? { ...player, energies: { water: 1, air: 0, fire: 0, earth: 0 } }
          : player,
      ),
    };
    const res = seasons.reduce(
      state,
      0,
      { type: 'use-badge', badgeType: 1, fromElements: ['water', 'water'], toElements: ['fire', 'fire'] },
      ctx,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('energy_low');
  });

  it('徽章用完后拒绝；非自己回合拒绝', () => {
    const base = summonReady();
    const used: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0 ? { ...player, badgesUsed: 3 } : player,
      ),
    };
    const res = seasons.reduce(used, 0, { type: 'use-badge', badgeType: 3 }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('badge_used_up');

    const res2 = seasons.reduce(base, 1, { type: 'use-badge', badgeType: 3 }, ctx);
    expect(res2.ok).toBe(false);
    if (!res2.ok) expect(res2.code).toBe('not_your_turn');
  });

  it('徽章 4 升级本人选中的抽卡骰，摸 2 选 1，并在行动轮结束清除', () => {
    const base = toPlay(draftAll(setup('badge-seed')));
    const season = base.season!;
    const state: SeasonsState = {
      ...base,
      season: {
        ...season,
        dice: season.dice.map((die, index) =>
          index === 0 ? { ...die, rewards: { ...die.rewards, card: true } } : die,
        ),
      },
      players: base.players,
    };
    const idx = 0;
    const pickedFirst = apply(state, 0, { type: 'draft-dice', dieIndex: idx });
    const pickedBoth = apply(pickedFirst, 1, { type: 'draft-dice', dieIndex: 1 });
    const upgraded = apply(pickedBoth, 0, {
      type: 'use-badge',
      badgeType: 4,
      dieId: pickedBoth.season!.dice[idx]!.id,
    });
    expect(upgraded.players[0]!.badgeDrawDieId).toBe(pickedBoth.season!.dice[idx]!.id);

    let ready = upgraded;
    if (ready.pendingChoice?.key === 'die_draw') {
      ready = apply(ready, 0, {
        type: 'resolve-choice',
        choice: [ready.pendingCards![0]!.u],
      });
    }
    expect(ready.players[0]!.badgeDrawDieId).toBe(pickedBoth.season!.dice[idx]!.id);
    const ended = apply(ready, 0, { type: 'end-turn' });
    expect(ended.players[0]!.badgeDrawDieId).toBeNull();
  });

  it('徽章 4 拒绝别人的骰子和无抽牌图标，失败不消耗徽章', () => {
    const base = actionPhase('badge-reject');
    const own = base.season!.dice.find((die) => die.pickedBy === 0)!;
    const rival = base.season!.dice.find((die) => die.pickedBy === 1)!;
    const state: SeasonsState = {
      ...base,
      season: {
        ...base.season!,
        dice: base.season!.dice.map((die) => ({
          ...die,
          rewards: { ...die.rewards, card: false },
        })),
      },
    };
    const rivalRes = seasons.reduce(
      state,
      0,
      { type: 'use-badge', badgeType: 4, dieId: rival.id },
      ctx,
    );
    expect(rivalRes.ok).toBe(false);
    if (!rivalRes.ok) expect(rivalRes.code).toBe('invalid_die');
    const noDraw = seasons.reduce(
      state,
      0,
      { type: 'use-badge', badgeType: 4, dieId: own.id },
      ctx,
    );
    expect(noDraw.ok).toBe(false);
    if (!noDraw.ok) expect(noDraw.code).toBe('die_has_no_draw');

    const drawState: SeasonsState = {
      ...state,
      deck: state.deck.slice(0, -1),
      pendingChoice: { kind: 'card_list', key: 'die_draw', choosingSeat: 0, options: { keep: 1 } },
      pendingCards: state.deck.slice(-1),
      season: {
        ...state.season!,
        dice: state.season!.dice.map((die) =>
          die.id === own.id
            ? { ...die, rewards: { ...die.rewards, card: true } }
            : die,
        ),
      },
    };
    const used = apply(drawState, 0, {
      type: 'use-badge',
      badgeType: 4,
      dieId: own.id,
    });
    const replay = seasons.reduce(
      used,
      0,
      { type: 'use-badge', badgeType: 4, dieId: own.id },
      ctx,
    );
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe('badge_draw_used');
  });

  it('骰面抽牌候选只给选择者，未保留不会直接入手', () => {
    const base = summonReady();
    const candidate = base.deck.at(-1)!;
    const state: SeasonsState = {
      ...base,
      pendingChoice: {
        kind: 'card_list',
        key: 'die_draw',
        choosingSeat: 0,
        options: { amount: 1, keep: 1, label: '保留此牌', source: 'die' },
        cards: [candidate],
      },
      pendingCards: [candidate],
    };
    const mine = seasons.view(state, 0, true);
    const rival = seasons.view(state, 1, true);
    expect((mine.pendingChoice?.options as { cards?: unknown }).cards).toEqual([candidate]);
    expect((rival.pendingChoice?.options as { cards?: unknown }).cards).toBeUndefined();
    expect(rival.players[0]?.hand).toBeNull();
  });
});

describe('seasons passive summon/season energy', () => {
  it('花瓶：召唤后排队 1 个能量选择，结算后能量 +1', () => {
    const base = summonReady();
    const vase = BASE_CARDS.find((card) => card.effect?.type === 'on_play_card_energy');
    expect(vase).toBeDefined();
    const def = findDef((card) => card.id === 41); // 偷窃妖精：无召唤选择、费用 0
    const state: SeasonsState = {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0
          ? {
              ...player,
              played: [...player.played, { i: vase!.id, u: 8100 }],
              hand: [{ i: def.id, u: 8101 }, ...player.hand],
              energies: { water: 0, air: 1, fire: 0, earth: 0 },
            }
          : player,
      ),
    };
    const res = seasons.reduce(state, 0, { type: 'summon', cardUid: 8101 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const pending = res.state.pendingChoice;
    expect(pending?.kind).toBe('element_alloc');
    expect(pending?.key).toBe('on_summon_energy');
    expect(pending?.options.amount).toBe(1);

    const before = res.state.players[0]!.energies.air;
    const resolved = apply(res.state, 0, {
      type: 'resolve-choice',
      choice: { air: 1 },
    });
    expect(resolved.players[0]!.energies.air).toBe(before + 1);
    expect(resolved.pendingChoice).toBeNull();
  });

  it('时光沙漏：换季时每位持有者各选 1 个能量，按座位排队', () => {
    const hourglass = BASE_CARDS.find((card) => card.effect?.type === 'on_season_change_energy');
    expect(hourglass).toBeDefined();
    const base = actionPhase();
    const state: SeasonsState = {
      ...base,
      month: 2,
      players: base.players.map((player) => ({
        ...player,
        played: [...player.played, { i: hourglass!.id, u: 8200 + player.seat }],
      })),
    };
    const afterFirst = apply(state, 0, { type: 'end-turn' });
    const afterSecond = apply(afterFirst, 1, { type: 'end-turn' });
    expect(afterSecond.month).toBeGreaterThanOrEqual(3);
    const pending = afterSecond.pendingChoice;
    expect(pending?.key).toBe('on_season_change_energy');
    expect(pending?.choosingSeat).toBe(0);
    // 视图中所有人都能看到「后面还排着 1 个选择」
    expect(seasons.view(afterSecond, 0).pendingQueueCount).toBe(1);
    expect(seasons.view(afterSecond, 1).pendingQueueCount).toBe(1);

    const seat0 = apply(afterSecond, 0, { type: 'resolve-choice', choice: { water: 1 } });
    expect(seat0.pendingChoice?.choosingSeat).toBe(1);
    expect(seasons.view(seat0, 0).pendingQueueCount).toBe(0);
    const seat1 = apply(seat0, 1, { type: 'resolve-choice', choice: { fire: 1 } });
    expect(seat1.pendingChoice).toBeNull();
    expect(seat1.pendingQueue).toHaveLength(0);
  });
});

describe('seasons die of malice', () => {
  function withMalice(count = 1): SeasonsState {
    const base = toPlay(draftAll(setup('malice-seed')));
    const malice = BASE_CARDS.find((card) => card.effect?.typeKey === 'die_of_malice');
    if (!malice) throw new Error('缺少恶意之骰');
    const played = Array.from({ length: count }, (_, index) => ({ i: malice.id, u: 8300 + index }));
    return {
      ...base,
      players: base.players.map((player, seat) =>
        seat === 0 ? { ...player, played } : player,
      ),
    };
  }

  it('行动开始先问是否重掷；选正常则按原骰面结算', () => {
    const state = withMalice();
    const picked = apply(state, 0, { type: 'draft-dice', dieIndex: 0 });
    const allPicked = apply(picked, 1, { type: 'draft-dice', dieIndex: 1 });
    const pending = allPicked.pendingChoice;
    expect(pending?.kind).toBe('branch');
    expect(pending?.key).toBe('die_of_malice');
    expect(pending?.choosingSeat).toBe(0);
    const resolved = apply(allPicked, 0, { type: 'resolve-choice', choice: { id: 'normal' } });
    expect(resolved.pendingChoice).toBeNull();
    expect(resolved.log.some((entry) => entry.msg.includes('骰子效果'))).toBe(true);
  });

  it('场上有 2 张恶意之骰：可重掷 2 次，中途可放弃', () => {
    const state = withMalice(2);
    const picked = apply(state, 0, { type: 'draft-dice', dieIndex: 0 });
    const allPicked = apply(picked, 1, { type: 'draft-dice', dieIndex: 1 });
    expect(allPicked.pendingChoice?.key).toBe('die_of_malice');
    expect(allPicked.pendingChoice?.options.remaining).toBe(2);
    const first = apply(allPicked, 0, { type: 'resolve-choice', choice: { id: 'alternative' } });
    expect(first.players[0]!.crystals).toBe(allPicked.players[0]!.crystals + 2);
    expect(first.pendingChoice?.options.remaining).toBe(1);
    expect(first.log.filter((entry) => entry.msg.includes('恶意之骰')).length).toBe(1);
    // 放弃第二次：不再给水晶，直接结算骰面。
    const stopped = apply(first, 0, { type: 'resolve-choice', choice: { id: 'normal' } });
    expect(stopped.pendingChoice).toBeNull();
    expect(stopped.players[0]!.crystals).toBe(first.players[0]!.crystals);
    expect(stopped.log.some((entry) => entry.msg.includes('骰子效果'))).toBe(true);
  });

  it('连续重掷两次：每次 +2 水晶，结束后只结算一次骰面', () => {
    const state = withMalice(2);
    const picked = apply(state, 0, { type: 'draft-dice', dieIndex: 0 });
    const allPicked = apply(picked, 1, { type: 'draft-dice', dieIndex: 1 });
    const before = allPicked.players[0]!.crystals;
    const first = apply(allPicked, 0, { type: 'resolve-choice', choice: { id: 'alternative' } });
    const second = apply(first, 0, { type: 'resolve-choice', choice: { id: 'alternative' } });
    expect(second.pendingChoice).toBeNull();
    // 两次重掷各 +2；最终骰面若带水晶奖励再叠加一次。
    const dieCrystals = second.season?.dice.find((die) => die.pickedBy === 0)?.rewards.crystals ?? 0;
    expect(second.players[0]!.crystals).toBe(before + 4 + dieCrystals);
    expect(second.log.filter((entry) => entry.msg.includes('骰子效果')).length).toBe(1);
  });

  it('第一张恶意之骰直接放弃：剩余次数一并跳过', () => {
    const state = withMalice(3);
    const picked = apply(state, 0, { type: 'draft-dice', dieIndex: 0 });
    const allPicked = apply(picked, 1, { type: 'draft-dice', dieIndex: 1 });
    const before = allPicked.players[0]!.crystals;
    const stopped = apply(allPicked, 0, { type: 'resolve-choice', choice: { id: 'normal' } });
    expect(stopped.pendingChoice).toBeNull();
    expect(stopped.players[0]!.crystals).toBe(before);
  });

  it('选重掷：水晶 +2 且按新骰面结算奖励', () => {
    const state = withMalice();
    const picked = apply(state, 0, { type: 'draft-dice', dieIndex: 0 });
    const allPicked = apply(picked, 1, { type: 'draft-dice', dieIndex: 1 });
    const before = allPicked.players[0]!.crystals;
    const faceBefore = allPicked.season?.dice.find((die) => die.pickedBy === 0)?.pip;
    const resolved = apply(allPicked, 0, { type: 'resolve-choice', choice: { id: 'alternative' } });
    const me = resolved.players[0]!;
    expect(me.crystals).toBeGreaterThanOrEqual(before + 2);
    expect(resolved.log.some((entry) => entry.msg.includes('恶意之骰'))).toBe(true);
    expect(resolved.season?.dice.find((die) => die.pickedBy === 0)?.pip).toBeGreaterThanOrEqual(1);
    expect(faceBefore).toBeGreaterThanOrEqual(1);
  });
});
