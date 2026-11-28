import { describe, expect, it } from 'vitest';
import type { SeasonsPendingChoiceView } from '@bgx/protocol/games/seasons';
import { seasons } from './engine.js';
import { createRng } from '../../random.js';

/**
 * H06：他人抽牌/选牌时的信息隔离。
 * 规则：只有 choosingSeat 能看到候选牌、手牌、储备明细等私有选项；
 * 其他玩家与观战者只能看到“有人在选择”这一事实。
 */
function base() {
  return seasons.setup(2, {}, createRng('privacy-seed'));
}

function withPending(
  state: ReturnType<typeof base>,
  pending: {
    kind: SeasonsPendingChoiceView['kind'];
    key: string;
    options: Record<string, unknown>;
  },
  pendingCards: ReturnType<typeof base>['players'][number]['hand'] | null,
) {
  return {
    ...state,
    pendingChoice: {
      kind: pending.kind,
      key: pending.key,
      choosingSeat: 0,
      options: pending.options,
    } as unknown as NonNullable<ReturnType<typeof base>['pendingChoice']>,
    pendingCards,
  };
}

describe('seasons 选择隐私（H06）', () => {
  it('card_pick：只有应答者能看到候选牌', () => {
    const state = base();
    const cards = state.players[0].draftHand.slice(0, 3);
    const next = withPending(
      state,
      { kind: 'card_pick', key: 'divine_chalice', options: { title: '选 1 张保留', keep: 1 } },
      cards,
    );

    const mine = seasons.view(next, 0);
    expect(mine.pendingChoice?.options.cards).toHaveLength(3);

    const other = seasons.view(next, 1);
    const optionsJson = JSON.stringify(other.pendingChoice?.options ?? {});
    for (const card of cards) {
      expect(optionsJson).not.toContain(`"u":${card.u}`);
    }
    expect(optionsJson).not.toContain('cards');

    const spectator = JSON.stringify(seasons.view(next, null));
    for (const card of cards) expect(spectator).not.toContain(`"u":${card.u}`);
  });

  it('card_list：对手只能看到等待提示', () => {
    const state = base();
    const cards = state.players[0].draftHand.slice(0, 4);
    const next = withPending(
      state,
      { kind: 'card_list', key: 'naria', options: { title: '保留 1 张，其余分配', keep: 1 } },
      cards,
    );
    expect(seasons.view(next, 0).pendingChoice?.options.cards).toHaveLength(4);
    const other = seasons.view(next, 1);
    expect(JSON.stringify(other.pendingChoice?.options)).not.toContain('cards');
  });

  it('energy_swap：储备与本轮获得的明细不公开', () => {
    const state = base();
    const next = withPending(
      state,
      {
        kind: 'energy_swap',
        key: 'energy_swap',
        options: {
          title: '储备区将超上限',
          amount: 5,
          total: 7,
          pool: 9,
          current: { water: 3, air: 2, fire: 1, earth: 1 },
          incoming: { water: 2, air: 0, fire: 0, earth: 0 },
        },
      },
      null,
    );
    const mine = seasons.view(next, 0);
    expect(mine.pendingChoice?.options.current).toBeTruthy();
    const otherJson = JSON.stringify(seasons.view(next, 1).pendingChoice?.options);
    expect(otherJson).not.toContain('current');
    expect(otherJson).not.toContain('incoming');
  });

  it('energy_discard：可弃置明细不公开', () => {
    const state = base();
    const next = withPending(
      state,
      {
        kind: 'energy_discard',
        key: 'energy_discard',
        options: {
          title: '储备上限变为 7，请弃掉 2 个能量',
          amount: 2,
          available: { water: 3, air: 1, fire: 0, earth: 0 },
        },
      },
      null,
    );
    const otherJson = JSON.stringify(seasons.view(next, 1).pendingChoice?.options);
    expect(otherJson).not.toContain('available');
    expect(otherJson).not.toContain('"water":3');
  });

  it('vampiric_crown：牌堆顶的牌不公开', () => {
    const state = base();
    const top = state.deck[state.deck.length - 1];
    const next = withPending(
      state,
      {
        kind: 'branch',
        key: 'vampiric_crown',
        options: {
          title: '吸血鬼王冠：抽或弃',
          branches: [
            { id: 'draw', label: '抽入手牌' },
            { id: 'discard', label: '弃掉' },
          ],
          card: top,
        },
      },
      null,
    );
    const otherJson = JSON.stringify(seasons.view(next, 1).pendingChoice?.options);
    expect(otherJson).not.toContain(`"u":${top.u}`);
    expect(otherJson).not.toContain('"card":');
  });

  it('crystal_orb 看牌：只有应答者能看到牌堆顶的卡，其他人只看到等待', () => {
    const state = base();
    const card = state.deck[state.deck.length - 1]!;
    const next = withPending(
      state,
      { kind: 'branch', key: 'crystal_orb', options: { title: '看牌堆顶', card, branches: [{ id: 'keep' }, { id: 'summon' }] } },
      null,
    );
    const chooser = seasons.view(next, 0).pendingChoice;
    expect((chooser?.options as { card?: unknown }).card).toMatchObject({ u: card.u, i: card.i });
    const other = seasons.view(next, 1).pendingChoice;
    expect((other?.options as { card?: unknown }).card).toBeUndefined();
    expect(other?.options.title).toBe('等待玩家完成选择');
    const spectator = seasons.view(next, null).pendingChoice;
    expect((spectator?.options as { card?: unknown }).card).toBeUndefined();
  });
});
