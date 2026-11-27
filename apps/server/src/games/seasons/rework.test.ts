import { describe, expect, it } from 'vitest';
import { ELEMENTS, type Element, type CardRef, type SeasonsAction } from '@bgx/protocol/games/seasons';
import { SEASONS_CARDS } from './cards/base.js';
import { createRng } from '../../random.js';
import { seasons, type SeasonsState, type CardInstance } from './engine.js';
import { resolveCost } from './rules/play.js';

const ctx = { now: 0, rng: createRng('rework') };
const ref = (i: number, u = 8000 + i): CardRef => ({ i, u });
function act(state: SeasonsState, action: SeasonsAction, seat = 0): SeasonsState {
  const result = seasons.reduce(state, seat, action, ctx);
  if (!result.ok) throw new Error(`${action.type}: ${result.code}: ${result.message}`);
  return result.state;
}
function choose(state: SeasonsState, choice: unknown, seat = state.pendingChoice?.choosingSeat ?? 0) {
  return act(state, { type: 'resolve-choice', choice }, seat);
}
function endRound(state: SeasonsState): SeasonsState {
  const month = state.month;
  for (let step = 0; step < state.players.length && state.month === month && !state.pendingChoice; step++) {
    if (state.turnOwner === null) break;
    state = act(state, { type: 'end-turn' }, state.turnOwner);
  }
  return state;
}
function ready(played: CardInstance[] = [], hand: CardRef[] = []): SeasonsState {
  let state = seasons.setup(2, { extensions: ['base'] }, createRng('rework'));
  while (state.phase === 'draft') for (let seat = 0; seat < 2; seat++) {
    state = act(state, { type: 'draft-pick', cardUid: state.players[seat]!.draftHand[0]!.u }, seat);
  }
  for (let seat = 0; seat < 2; seat++) for (const start of [0, 3]) {
    const ids = state.players[seat]!.drafted.slice(start, start + 3).map((card) => card.u);
    state = act(state, { type: 'organize', cardUids: ids as [number, number, number] }, seat);
  }
  return {
    ...state, turnOwner: 0, currentPicker: 0, dicePicked: [0, 1],
    pendingChoice: null, pendingCards: null, pendingQueue: [],
    season: { ...state.season!, dice: state.season!.dice.map((die, i) => ({
      ...die, pickedBy: i < 2 ? i : null, rewards: {}, pip: 1,
    })) },
    players: state.players.map((player, seat) => ({
      ...player, hand: seat === 0 ? hand : [ref(1, 9001)], played: seat === 0 ? played : [],
      energies: { water: 10, air: 10, fire: 10, earth: 10 }, maxEnergy: 100,
      gauge: 40, crystals: 100, activatedThisTurn: [], cardMarks: {},
    })),
  };
}
function summon(id: number, state = ready([], [ref(id), ref(1, 9991)])) {
  const def = SEASONS_CARDS.find((card) => card.id === id)!;
  return act(state, { type: 'summon', cardUid: ref(id).u,
    ...(def.costFlexible ? { paidElements: ['water'] } : {}) });
}

describe('payment regression matrix', () => {
  for (const count of [2, 3, 4]) for (const def of SEASONS_CARDS) {
    it(`${count} players: ${def.id} accepts printed cost from exact reserve slots and automatic payment`, () => {
      const initial = ready([], [ref(def.id)]);
      const state = { ...initial, players: Array.from({ length: count }, (_, seat) => ({
        ...structuredClone(initial.players[seat % 2]!), seat,
      })) };
      const cost = resolveCost(def, count);
      const paidSources = def.costFlexible
        ? [{ source: 'reserve' as const, element: 'water' as const, slot: 0 }]
        : ELEMENTS.flatMap((element) => Array.from({ length: cost[element] },
          (_, slot) => ({ source: 'reserve' as const, element, slot })));
      const explicit = seasons.reduce(state, 0, { type: 'summon', cardUid: ref(def.id).u, paidSources }, ctx);
      expect(explicit.ok, explicit.ok ? '' : `${explicit.code}: ${explicit.message}`).toBe(true);
      const automatic = seasons.reduce(state, 0, { type: 'summon', cardUid: ref(def.id).u,
        ...(def.costFlexible ? { paidSources } : {}) }, ctx);
      expect(automatic.ok, automatic.ok ? '' : `${automatic.code}: ${automatic.message}`).toBe(true);
      if (explicit.ok && automatic.ok) expect(explicit.state.players[0]).toEqual(automatic.state.players[0]);
    });
  }
  it('two automatic Magma rewards at capacity retain both gains across successive discards', () => {
    let state = ready([], [ref(6)]);
    state.players[1]!.played = [ref(72, 9072), ref(72, 9073)];
    state.players[1]!.energies = { water: 7, air: 0, fire: 0, earth: 0 };
    state.players[1]!.maxEnergy = 7;
    state = act(state, { type: 'summon', cardUid: ref(6).u });
    expect(state.pendingChoice?.kind).toBe('energy_swap');
    expect(state.pendingChoice?.options.discardAmount).toBe(1);
    state = choose(state, { discard: { water: 1 }, paidSources: [{ source: 'reserve', element: 'water', slot: 6 }] });
    expect(state.pendingChoice?.options.current).toEqual({ water: 6, air: 0, fire: 1, earth: 0 });
    state = choose(state, { discard: { water: 1 }, paidSources: [{ source: 'reserve', element: 'water', slot: 5 }] });
    expect(state.players[1]!.energies).toEqual({ water: 5, air: 0, fire: 2, earth: 0 });
    expect(state.pendingChoice).toBeNull();
  });
  it('overflow can discard newly received elements, but rejects duplicate or card sources', () => {
    let state = ready([], [ref(6)]);
    state.players[1]!.played = [ref(72, 9072), { ...ref(4, 9004), stored: { fire: 1 } }];
    state.players[1]!.energies = { water: 7, air: 0, fire: 0, earth: 0 };
    state.players[1]!.maxEnergy = 7;
    state = act(state, { type: 'summon', cardUid: ref(6).u });
    const before = structuredClone(state);
    const invalid = seasons.reduce(state, 1, { type: 'resolve-choice',
      choice: { discard: { fire: 1 }, paidSources: [{ source: 'card', cardUid: 9004, element: 'fire', slot: 0 }] } }, ctx);
    expect(invalid.ok).toBe(false);
    expect(state).toEqual(before);
    state = choose(state, { discard: { fire: 1 }, paidSources: [{ source: 'reserve', element: 'fire', slot: 0 }] });
    expect(state.players[1]!.energies).toEqual({ water: 7, air: 0, fire: 0, earth: 0 });
    expect(state.players[1]!.played.find((card) => card.u === 9004)?.stored?.fire).toBe(1);
  });
  it('draw-die decisions reject a preexisting hand card and keep only the new candidate', () => {
    let state = ready([], [ref(1)]);
    state.pendingCards = [ref(2, 9992)];
    state.pendingChoice = { kind: 'card_list', key: 'die_draw', choosingSeat: 0, options: { keep: 1 } };
    expect(seasons.reduce(state, 0, { type: 'resolve-choice', choice: [ref(1).u] }, ctx).ok).toBe(false);
    state = choose(state, [9992]);
    expect(state.players[0]!.hand.map((card) => card.u)).toEqual([ref(1).u, 9992]);
  });
  it('Mirror converts exactly the selected reserve/card sources without touching matching unselected tokens', () => {
    let state = ready([ref(47), { ...ref(4), stored: { water: 2 } }]);
    state = act(state, { type: 'activate', cardUid: ref(47).u });
    state = choose(state, { id: 'water', amount: 2, paidSources: [
      { source: 'reserve', element: 'water', slot: 7 },
      { source: 'card', cardUid: ref(4).u, element: 'water', slot: 1 },
    ] });
    expect(state.pendingChoice?.options.step).toBe('target');
    state = choose(state, { id: 'fire' });
    expect(state.players[0]!.energies.water).toBe(9);
    expect(state.players[0]!.energies.fire).toBe(12);
    expect(state.players[0]!.played.find((card) => card.i === 4)?.stored?.water).toBe(1);
    expect(state.players[0]!.crystals).toBe(98);
  });
  it('Life potion requires every spendable reserve token and rejects partial or duplicate sources', () => {
    let state = ready([ref(26), { ...ref(4), stored: { water: 1 } }]);
    state.players[0]!.energies = { water: 1, air: 1, fire: 0, earth: 0 };
    state = act(state, { type: 'activate', cardUid: ref(26).u });
    const sources = [
      { source: 'reserve' as const, element: 'water' as const, slot: 0 },
      { source: 'card' as const, element: 'water' as const, cardUid: ref(4).u, slot: 0 },
      { source: 'reserve' as const, element: 'air' as const, slot: 0 },
    ];
    expect(seasons.reduce(state, 0, { type: 'resolve-choice',
      choice: { elements: ['water'], paidSources: sources.slice(0, 1) } }, ctx).ok).toBe(false);
    expect(seasons.reduce(state, 0, { type: 'resolve-choice',
      choice: { elements: ['water', 'air'], paidSources: [sources[0], sources[0], sources[2]] } }, ctx).ok).toBe(false);
    state = choose(state, { elements: ['water', 'air'], paidSources: sources });
    expect(state.players[0]!.energies).toEqual({ water: 0, air: 0, fire: 0, earth: 0 });
    expect(state.players[0]!.played.find((card) => card.i === 4)?.stored?.water).toBe(0);
    expect(state.players[0]!.crystals).toBe(112);
  });
  it('Life potion can finish with an empty reserve without inventing a payment', () => {
    let state = ready([ref(26)]);
    state.players[0]!.energies = { water: 0, air: 0, fire: 0, earth: 0 };
    state = act(state, { type: 'activate', cardUid: ref(26).u });
    expect(state.pendingChoice?.options.amount).toBe(0);
    state = choose(state, { elements: [], paidSources: [] });
    expect(state.pendingChoice).toBeNull();
    expect(state.players[0]!.crystals).toBe(100);
  });
  for (const id of [24, 74]) it(`potion #${id} pays all actual reserve slots before its next effect`, () => {
    let state = ready([ref(id), { ...ref(4), stored: { water: 1 } }], [ref(29)]);
    state.players[0]!.energies = { water: 1, air: 1, fire: 0, earth: 0 };
    state = act(state, { type: 'activate', cardUid: ref(id).u });
    if (id === 74) state = choose(state, 'transmute');
    const sources = [
      { source: 'reserve' as const, element: 'water' as const, slot: 0 },
      { source: 'reserve' as const, element: 'air' as const, slot: 0 },
    ];
    expect(state.pendingChoice?.options.mode).toBe('pay');
    expect(seasons.reduce(state, 0, { type: 'resolve-choice', choice: { water: 1, air: 1,
      paidSources: [sources[0], { source: 'card', element: 'air', cardUid: ref(4).u, slot: 0 }] } }, ctx).ok).toBe(false);
    state = choose(state, { water: 1, air: 1, paidSources: sources });
    expect(state.players[0]!.energies).toEqual({ water: 0, air: 0, fire: 0, earth: 0 });
    expect(state.players[0]!.played.find((card) => card.i === 4)?.stored?.water).toBe(1);
    expect(state.players[0]!.crystals).toBe(id === 74 ? 108 : 100);
    expect(state.pendingChoice?.key).toBe(id === 74 ? 'potion_of_the_ancients' : 'potion_dreams');
  });
  for (const count of [3, 4]) it(`Lewis copies the selected last opponent in a ${count}-player game`, () => {
    const initial = ready([], [ref(21)]);
    let state = { ...initial, players: Array.from({ length: count }, (_, seat) => ({
      ...structuredClone(initial.players[seat % 2]!), seat,
      energies: seat === count - 1 ? { water: 2, air: 1, fire: 0, earth: 3 }
        : { water: 0, air: 1, fire: 1, earth: 0 },
    })) };
    state = summon(21, state);
    expect(state.pendingChoice?.options.branches).toHaveLength(count - 1);
    expect(seasons.reduce(state, 0, { type: 'resolve-choice', choice: '0' }, ctx).ok).toBe(false);
    state = choose(state, String(count - 1));
    expect(state.players[0]!.energies).toEqual({ water: 2, air: 1, fire: 0, earth: 3 });
    expect(state.players[count - 1]!.energies).toEqual({ water: 2, air: 1, fire: 0, earth: 3 });
  });
  it('Magma overflow finishes before Lewis reads that opponent reserve', () => {
    let state = ready([], [ref(21)]);
    state.players[0]!.energies = { water: 0, air: 1, fire: 1, earth: 0 };
    state.players[1]!.energies = { water: 7, air: 0, fire: 0, earth: 0 };
    state.players[1]!.maxEnergy = 7;
    state.players[1]!.played = [ref(72, 9072)];
    state = summon(21, state);
    expect(state.pendingChoice?.choosingSeat).toBe(1);
    state = choose(state, { discard: { water: 1 },
      paidSources: [{ source: 'reserve', element: 'water', slot: 0 }] });
    expect(state.pendingChoice?.key).toBe('lewis');
    state = choose(state, '1');
    expect(state.players[0]!.energies).toEqual({ water: 6, air: 0, fire: 1, earth: 0 });
  });
});
function drain(state: SeasonsState): SeasonsState {
  for (let step = 0; state.pendingChoice && step < 40; step++) {
    const pending = state.pendingChoice;
    const player = state.players[pending.choosingSeat]!;
    const options = pending.options;
    const amount = Number(options.amount ?? 0);
    const choices: unknown[] = [];
    if (pending.kind === 'element_alloc' || pending.kind === 'energy_swap' || pending.kind === 'energy_discard') {
      const total = pending.kind === 'energy_swap' ? Number(options.total) : amount;
      const current = options.current as Record<string, number> | undefined;
      const incoming = options.incoming as Record<string, number> | undefined;
      const caps = (options.maxPerElement ?? options.available) as Record<string, number> | undefined;
      const alloc: Record<string, number> = {};
      let left = total;
      for (const element of ELEMENTS) {
        alloc[element] = Math.min(left, pending.kind === 'energy_swap'
          ? (current?.[element] ?? 0) + (incoming?.[element] ?? 0) : caps?.[element] ?? total);
        left -= alloc[element]!;
      }
      const paidSources = ELEMENTS.flatMap((element) => Array.from({ length: alloc[element] ?? 0 },
        (_, slot) => ({ source: 'reserve' as const, element, slot })));
      choices.push(options.mode === 'pay' ? { ...alloc, paidSources } : alloc);
      if (pending.key === 'cost_reduce') {
        for (let water = 0; water <= amount; water++) for (let air = 0; air <= amount - water; air++) {
          for (let fire = 0; fire <= amount - water - air; fire++) {
            choices.push({ water, air, fire, earth: amount - water - air - fire });
          }
        }
      }
    }
    if (pending.kind === 'card_list') {
      choices.push((state.pendingCards ?? []).slice(0, Number(options.keep ?? 1)).map((card) => card.u));
    }
    if (pending.kind === 'element_pick') {
      const reserve = ELEMENTS.flatMap((element) => Array.from({ length: player.energies[element] },
        (_, slot) => ({ source: 'reserve' as const, element, slot })));
      const stored = player.played.flatMap((card) => {
        const def = SEASONS_CARDS.find((item) => item.id === card.i);
        const abilities = def?.effect?.abilities ?? [];
        if (player.cardMarks?.[card.u]?.lockSource || !abilities.some((item) => item.kind === 'reserve_slot') ||
          abilities.some((item) => item.kind === 'sealed_energy')) return [];
        return ELEMENTS.flatMap((element) => Array.from({ length: card.stored?.[element] ?? 0 },
          (_, slot) => ({ source: 'card' as const, element, slot, cardUid: card.u })));
      });
      const tokens = [...reserve, ...stored];
      for (const element of ELEMENTS) {
        choices.push({ element, paidSources: tokens.filter((token) => token.element === element).slice(0, amount) });
      }
      if (Math.floor(state.month / 3) % 4 === 0 && player.played.some((card) =>
        card.i === 78 && !player.cardMarks?.[card.u]?.lockSource)) {
        choices.push({ element: 'earth', paidSources: tokens.slice(0, amount) });
      }
    }
    choices.push({ direction: 'forward', steps: 1 });
    if (pending.kind === 'element_multi') choices.push(
      (options.elements as { element: Element }[]).map((item) => item.element));
    for (const branch of (options.branches ?? []) as { id: string; enabled?: boolean }[]) {
      if (branch.enabled !== false) choices.push({ id: branch.id }, branch.id);
    }
    for (const element of ELEMENTS) choices.push({ element }, element);
    for (const card of [...(state.pendingCards ?? []), ...player.played, ...player.hand]) {
      choices.push({ uid: card.u }, card.u, [card.u]);
    }
    for (let seat = 0; seat < state.players.length; seat++) choices.push({ seat }, { targetSeat: seat }, String(seat));
    if (options.optional) choices.push('skip', null);
    let accepted: SeasonsState | null = null;
    for (const choice of choices) {
      const result = seasons.reduce(state, pending.choosingSeat, { type: 'resolve-choice', choice }, ctx);
      if (result.ok) { accepted = result.state; break; }
    }
    if (!accepted) throw new Error(`No legal continuation for ${pending.key}/${pending.kind}: ${JSON.stringify(options)}`);
    state = accepted;
  }
  expect(state.pendingChoice?.key, 'all summon continuations terminate').toBeUndefined();
  return state;
}

describe('90-card entry and rejection matrix', () => {
  it('Idol gains its printed ten crystals on entry, not only its activation reward', () => {
    expect(summon(43).players[0]!.crystals).toBe(110);
  });
  for (const def of SEASONS_CARDS.filter((card) => card.id !== 73)) {
    it(`#${def.id} ${def.nameZh}: legal paid entry, capacity and actor rejection are atomic`, () => {
      const state = ready([ref(5)], [ref(def.id), ref(1, 9991)]);
      state.players[1]!.played = [ref(6, 9992), ref(23, 9993)];
      const before = JSON.stringify(state);
      const wrongActor = seasons.reduce(state, 1, { type: 'summon', cardUid: ref(def.id).u }, ctx);
      expect(wrongActor.ok).toBe(false);
      const full = { ...state, players: state.players.map((p, i) => i === 0 ? { ...p, gauge: 1 } : p) };
      expect(seasons.reduce(full, 0, { type: 'summon', cardUid: ref(def.id).u }, ctx).ok).toBe(false);
      expect(JSON.stringify(state)).toBe(before);
      const result = summon(def.id, state);
      expect(result.players[0]!.played.some((card) => card.u === ref(def.id).u)).toBe(true);
      expect(result.players[0]!.hand.some((card) => card.u === ref(def.id).u)).toBe(false);
      expect(result.players.every((p) => p.crystals >= 0 && p.gauge >= 0)).toBe(true);
      if (result.pendingChoice) {
        const observer = seasons.view(result, null, false);
        expect(observer.pendingChoice?.options.cards).toBeUndefined();
        expect(observer.players.every((p) => p.hand === null)).toBe(true);
      }
      drain(result);
    });
  }
  it('#73 is replaced in draft and never remains in the live deck', () => {
    let state = seasons.setup(2, { extensions: ['base', 'ext2'] }, createRng('draft-twist'));
    const special = state.deck.find((card) => card.i === 73)!;
    const other = state.players[0]!.draftHand[0]!;
    state = { ...state, deck: state.deck.map((c) => c.u === special.u ? other : c),
      players: state.players.map((p, i) => i === 0 ? { ...p, draftHand: [special, ...p.draftHand.slice(1)] } : p) };
    while (state.phase === 'draft') for (let seat = 0; seat < 2; seat++) {
      state = act(state, { type: 'draft-pick', cardUid: state.players[seat]!.draftHand[0]!.u }, seat);
    }
    expect(state.deck.some((card) => card.i === 73)).toBe(false);
    expect(state.pendingChoice?.key).toBe('draft_twist');
    expect(state.pendingCards).toHaveLength(2);
    const rejected = seasons.reduce(state, 1, { type: 'resolve-choice', choice: { uid: state.pendingCards![0]!.u } }, ctx);
    expect(rejected.ok).toBe(false);
    while (state.pendingChoice?.key === 'draft_twist') state = choose(state, { uid: state.pendingCards![0]!.u });
    expect(state.players.every((p) => p.drafted.length === 9 && p.drafted.every((c) => c.i !== 73))).toBe(true);
  });
});

describe('all activatable cards', () => {
  for (const id of [62, 81]) {
    it(`#${id} rejects insufficient matching tokens before creating a payment choice`, () => {
      const state = ready([ref(id)]);
      state.month = 3;
      state.players[0]!.energies = { water: 1, air: 1, fire: 0, earth: 0 };
      const before = JSON.stringify(state);
      expect(seasons.reduce(state, 0, { type: 'activate', cardUid: ref(id).u }, ctx).ok).toBe(false);
      expect(JSON.stringify(state)).toBe(before);
    });
  }
  for (const def of SEASONS_CARDS.filter((card) => card.effect?.triggers.includes('activation'))) {
    const abilities = def.effect?.abilities?.filter((ability) => ability.kind === 'activation_ability') ?? [];
    for (const ability of abilities.length ? abilities : [undefined]) {
      it(`#${def.id} ${ability?.key ?? 'default'}: resolves, rejects wrong actor and repeated activation`, () => {
        const played = [ref(def.id), ref(1, 9201), ref(2, 9202), ref(16, 9216)];
        played[0] = { ...played[0]!, stored: { water: def.id === 77 ? 4 : 2 } } as CardInstance;
        let state = ready(played, [ref(1, 9301), ref(6, 9306)]);
        state.discard = [ref(6, 9406), ref(23, 9423)];
        if (def.id === 71) state.players[0]!.activatedThisTurn = ['9216'];
        const action: SeasonsAction = { type: 'activate', cardUid: ref(def.id).u,
          ...(ability?.key ? { abilityKey: ability.key } : {}) };
        const before = JSON.stringify(state);
        expect(seasons.reduce(state, 1, action, ctx).ok).toBe(false);
        expect(JSON.stringify(state)).toBe(before);
        state = drain(act(state, action));
        expect(state.players.every((p) => ELEMENTS.every((e) => p.energies[e] >= 0))).toBe(true);
        if (state.players[0]!.played.some((card) => card.u === ref(def.id).u)) {
          expect(seasons.reduce(state, 0, action, ctx).ok).toBe(false);
        }
      });
    }
  }
});

describe('multi-player complete games', () => {
  for (const count of [2, 3, 4]) it(`${count} players: paid summons and activations survive a full three-year game`, () => {
    let state = seasons.setup(count, { extensions: ['base', 'ext1', 'ext2'] }, createRng(`active-full-${count}`));
    while (state.phase === 'draft') for (let seat = 0; seat < count; seat++) {
      state = act(state, { type: 'draft-pick', cardUid: state.players[seat]!.draftHand[0]!.u }, seat);
    }
    state = drain(state);
    for (let seat = 0; seat < count; seat++) for (const start of [0, 3]) {
      state = act(state, { type: 'organize',
        cardUids: state.players[seat]!.drafted.slice(start, start + 3).map((card) => card.u) as [number, number, number] }, seat);
    }
    let steps = 0;
    let movesThisTurn = 0;
    let turn = '';
    let summons = 0;
    let activations = 0;
    while (state.phase !== 'ended' && steps++ < 1500) {
      if (state.pendingChoice) state = drain(state);
      else if (state.turnOwner === null) {
        state = act(state, { type: 'draft-dice',
          dieIndex: state.season!.dice.findIndex((die) => die.pickedBy === null) }, state.currentPicker!);
      } else {
        const seat = state.turnOwner;
        const key = `${state.month}:${seat}`;
        if (turn !== key) { turn = key; movesThisTurn = 0; }
        const me = state.players[seat]!;
        const candidates: SeasonsAction[] = movesThisTurn < 3 ? [
          ...me.hand.map((card): SeasonsAction => {
            const def = SEASONS_CARDS.find((item) => item.id === card.i)!;
            return { type: 'summon', cardUid: card.u, ...(def.costFlexible ? {
              paidElements: ELEMENTS.filter((element) => me.energies[element] > 0).slice(0, def.costFlexible.max),
            } : {}) };
          }),
          ...me.played.map((card): SeasonsAction => ({ type: 'activate', cardUid: card.u })),
        ] : [];
        let moved = false;
        for (const action of candidates) {
          const result = seasons.reduce(state, seat, action, ctx);
          if (!result.ok) continue;
          state = result.state;
          movesThisTurn++;
          if (action.type === 'summon') summons++;
          else activations++;
          moved = true;
          break;
        }
        if (!moved) state = act(state, { type: 'end-turn' }, seat);
      }
      const physical = [...state.deck, ...state.discard,
        ...state.players.flatMap((p) => [...p.hand, ...p.library2, ...p.library3, ...p.played])];
      expect(new Set(physical.map((card) => card.u)).size).toBe(physical.length);
      expect(state.players.every((p) => p.crystals >= 0 && p.maxEnergy >= 0 &&
        ELEMENTS.every((element) => Number.isInteger(p.energies[element]) && p.energies[element] >= 0))).toBe(true);
    }
    expect(state.phase).toBe('ended');
    expect(summons).toBeGreaterThan(0);
    expect(activations).toBeGreaterThan(0);
    expect(state.result!.players.every((player) => Number.isFinite(player.score))).toBe(true);
  });
  for (const count of [2, 3, 4]) it(`${count} players: draft through year three without dead choices or duplicate instances`, () => {
    let state = seasons.setup(count, { extensions: ['base', 'ext1', 'ext2'] }, createRng(`full-${count}`));
    expect(state.rulesVersion).toBe('seasons-90-v2');
    while (state.phase === 'draft') for (let seat = 0; seat < count; seat++) {
      state = act(state, { type: 'draft-pick', cardUid: state.players[seat]!.draftHand[0]!.u }, seat);
    }
    state = drain(state);
    for (let seat = 0; seat < count; seat++) for (const start of [0, 3]) {
      state = act(state, { type: 'organize',
        cardUids: state.players[seat]!.drafted.slice(start, start + 3).map((c) => c.u) as [number, number, number] }, seat);
    }
    let actions = 0;
    while (state.phase !== 'ended' && actions++ < 1200) {
      if (state.pendingChoice) state = drain(state);
      else if (state.turnOwner === null) {
        state = act(state, { type: 'draft-dice',
          dieIndex: state.season!.dice.findIndex((die) => die.pickedBy === null) }, state.currentPicker!);
      } else state = act(state, { type: 'end-turn' }, state.turnOwner);
      const refs = [...state.deck, ...state.discard, ...(state.pendingCards ?? []),
        ...state.players.flatMap((p) => [...p.hand, ...p.library2, ...p.library3, ...p.played])];
      expect(new Set(refs.map((card) => card.u)).size).toBe(refs.length);
    }
    expect(state.phase).toBe('ended');
    expect(state.month).toBe(36);
    expect(state.result?.players).toHaveLength(count);
    expect(state.players.every((p) => p.library2.length === 0 && p.library3.length === 0)).toBe(true);
    expect(seasons.view(state, null, false).players.every((p) => p.hand === null)).toBe(true);
  });
});

describe('cross-card accounting', () => {
  it('a locked Die of Malice cannot offer its passive reroll', () => {
    let state = ready([ref(15)]);
    state.players[0]!.cardMarks = { [ref(15).u]: { lockSource: 9087, lockSources: [9087] } };
    state.players[1]!.played = [ref(87, 9087)];
    state.turnOwner = null;
    state.dicePicked = [];
    state.season = { ...state.season!, dice: state.season!.dice.map((die) => ({
      ...die, pickedBy: null, rewards: {},
    })) };
    state = act(state, { type: 'draft-dice', dieIndex: 0 });
    state = act(state, { type: 'draft-dice', dieIndex: 1 }, 1);
    expect(state.pendingChoice?.key).not.toBe('die_of_malice');
  });
  it('two Grimoires share one capacity bonus; returning one keeps it until the last leaves', () => {
    let state = ready([ref(18)], [ref(18, 8118), ref(54), ref(54, 8154)]);
    state.players[0]!.maxEnergy = 10;
    state.players[0]!.energies = { water: 2, air: 2, fire: 0, earth: 2 };
    state = act(state, { type: 'summon', cardUid: 8118 });
    state = choose(state, { water: 2 });
    expect(state.players[0]!.maxEnergy).toBe(10);
    state = choose(summon(54, state), { uid: ref(18).u });
    expect(state.players[0]!.maxEnergy).toBe(10);
    state = act(state, { type: 'summon', cardUid: 8154 });
    state = choose(state, { uid: 8118 });
    expect(state.players[0]!.maxEnergy).toBe(7);
  });
  it('locking a Raven copied Grimoire cannot remove a second active Grimoire capacity bonus', () => {
    let state = ready([ref(18)], [ref(87)]);
    state.players[1]!.played = [ref(18, 9068), ref(18, 9118)];
    state.players[1]!.cardMarks = { 9068: { ravenOriginalId: 68, ravenTarget: ref(18).u } };
    state.players[1]!.maxEnergy = 10;
    state.players[1]!.energies = { water: 0, air: 0, fire: 0, earth: 0 };
    state = choose(summon(87, state), { seat: 1, uid: 9068 });
    expect(state.players[1]!.maxEnergy).toBe(10);
    state.players[0]!.played = state.players[0]!.played.filter((card) => card.i !== 87);
    state = act(state, { type: 'use-badge', badgeType: 3 });
    expect(state.players[1]!.maxEnergy).toBe(10);
  });
  for (const [id, delta] of [[13, 3], [39, 1], [50, -3], [56, 3], [75, 3]] as const) {
    it(`#${id} waits for every player before applying its common round-end crystals`, () => {
      let state = ready([ref(id)]);
      state = act(state, { type: 'end-turn' });
      expect(state.players[0]!.crystals).toBe(100);
      expect(state.month).toBe(0);
      state = act(state, { type: 'end-turn' }, 1);
      expect(state.players[0]!.crystals).toBe(100 + delta);
      expect(state.month).toBeGreaterThan(0);
    });
  }
  it('a later player can change the Chest reserve condition before common settlement', () => {
    let state = ready([ref(13)]);
    state.players[0]!.energies = { water: 4, air: 0, fire: 0, earth: 0 };
    state.players[1]!.hand = [ref(70, 9070)];
    state = act(state, { type: 'end-turn' });
    state = act(state, { type: 'summon', cardUid: 9070 }, 1);
    state = choose(state, { water: 2 });
    expect(state.players[0]!.energies.water).toBe(2);
    state = act(state, { type: 'end-turn' }, 1);
    expect(state.players[0]!.crystals).toBe(100);
  });
  it('Heart returns its sealed token before Chest checks four energy, not when the owner ends their action', () => {
    let state = ready([ref(51), ref(13), ref(23)]);
    state.players[0]!.energies = { earth: 3, water: 0, air: 0, fire: 0 };
    state = act(state, { type: 'activate', cardUid: ref(23).u });
    expect(state.players[0]!.energies.earth).toBe(3);
    state = act(state, { type: 'end-turn' });
    expect(state.players[0]!.energies.earth).toBe(3);
    expect(state.players[0]!.crystals).toBe(100);
    state = act(state, { type: 'end-turn' }, 1);
    expect(state.players[0]!.energies.earth).toBe(4);
    expect(state.players[0]!.crystals).toBe(103);
  });
  it('sequential mandatory Horn payments recheck the current reserve and never ask for phantom energy', () => {
    let state = ready([ref(52), ref(52, 8152)]);
    state.players[0]!.energies = { water: 1, air: 0, fire: 0, earth: 0 };
    state = endRound(state);
    const month = state.month;
    expect(state.pendingChoice?.key).toBe('horn_of_plenty');
    state = choose(state, { element: 'water' });
    expect(state.pendingChoice?.key).not.toBe('horn_of_plenty');
    expect(state.players[0]!.energies.water).toBe(0);
    expect(state.month).toBeGreaterThan(month);
  });
  it('Carnivora becomes eligible after a later Horn payment and still resolves only once', () => {
    let state = ready([ref(84), ref(52)]);
    state.players[0]!.energies = { water: 1, air: 0, fire: 0, earth: 0 };
    state.discard = [ref(3)];
    state = endRound(state);
    expect(state.pendingChoice?.key).toBe('horn_of_plenty');
    state = choose(state, { element: 'water' });
    expect(state.pendingChoice?.key).toBe('carnivora_strombosea');
    state = choose(state, 'deck');
    expect(state.pendingChoice).toBeNull();
    expect(state.deck.at(-1)).toEqual(ref(3));
  });
  it('Chalice draws exactly four with one spare gauge, not eight', () => {
    let state = ready([], [ref(9)]);
    state.players[0]!.gauge = 2;
    const deckCount = state.deck.length;
    state = act(state, { type: 'summon', cardUid: ref(9).u });
    expect(state.pendingCards).toHaveLength(4);
    expect(state.deck).toHaveLength(deckCount - 4);
    expect(state.discard).toHaveLength(0);
    state = choose(state, { uid: state.pendingCards![0]!.u });
    state = drain(state);
    expect(state.discard).toHaveLength(3);
  });
  it('reserve-only end-turn effects do not create impossible mandatory choices from stored tokens', () => {
    let state = ready([ref(52), ref(53), ref(77), { ...ref(4), stored: { water: 2 } }]);
    state.players[0]!.energies = { water: 0, air: 0, fire: 0, earth: 0 };
    state = act(state, { type: 'end-turn' });
    expect(state.pendingChoice).toBeNull();
    expect(state.turnOwner).toBe(1);
  });
  it('Minion blocks each gain without refunding paid crystals or canceling losses', () => {
    let state = ready([ref(88), ref(6), ref(50), ref(56)], [ref(47)]);
    state = act(state, { type: 'summon', cardUid: ref(47).u });
    expect(state.players[0]!.crystals).toBe(97);
    state = endRound(state);
    expect(state.players[0]!.crystals).toBe(94);
  });
  it('Minion suppresses Harp crystals, but not its gauge reward', () => {
    let state = ready([ref(88), ref(81)]);
    state = choose(act(state, { type: 'activate', cardUid: ref(81).u }), { element: 'water' });
    expect(state.players[0]!.gauge).toBe(41);
    expect(state.players[0]!.crystals).toBe(100);
  });
  it('a newly gained fixed energy at full capacity is chosen, never silently dropped', () => {
    let state = ready([{ ...ref(4), stored: { air: 1 } }], [ref(88)]);
    state.players[0]!.energies = { water: 7, air: 0, fire: 0, earth: 0 };
    state.players[0]!.maxEnergy = 7;
    state = act(state, { type: 'summon', cardUid: ref(88).u,
      paidSources: [{ source: 'card', element: 'air', cardUid: ref(4).u, slot: 0 }] });
    expect(state.pendingChoice?.key).toBe('energy_discard');
    state = choose(state, { water: 1 });
    expect(state.players[0]!.energies).toEqual({ water: 6, air: 1, fire: 0, earth: 0 });
  });
  it('winter Staff permits actual non-Earth tokens for Earth cost only in winter', () => {
    const source = [{ source: 'reserve' as const, element: 'fire' as const, slot: 0 }];
    let state = ready([ref(78)], [ref(49)]);
    state.players[0]!.energies = { water: 0, air: 0, fire: 1, earth: 0 };
    state = act(state, { type: 'summon', cardUid: ref(49).u, paidSources: source });
    expect(state.players[0]!.energies.fire).toBe(0);
    const spring = ready([ref(78)], [ref(49)]);
    spring.month = 3;
    expect(seasons.reduce(spring, 0, { type: 'summon', cardUid: ref(49).u, paidSources: source }, ctx).ok).toBe(false);
  });
  for (const id of [5, 62, 81]) it(`winter Staff permits mixed physical tokens for #${id} identical-element payment`, () => {
    const amount = id === 81 ? 2 : 3;
    let state = ready([ref(78), ref(id)]);
    state.players[0]!.energies = { water: 1, air: 1, fire: 1, earth: 0 };
    const sources = ELEMENTS.filter((e) => e !== 'earth').slice(0, amount)
      .map((element) => ({ source: 'reserve' as const, element, slot: 0 }));
    state = choose(act(state, { type: 'activate', cardUid: ref(id).u }),
      { element: 'water', paidSources: sources });
    expect(ELEMENTS.reduce((sum, e) => sum + state.players[0]!.energies[e], 0)).toBe(3 - amount);
  });
  it('crystallization honors the selected card token and winter Earth substitution', () => {
    let state = ready([ref(78), { ...ref(4), stored: { water: 1 } }]);
    state.players[0]!.canTransmute = true;
    const before = state.players[0]!.energies.water;
    state = act(state, { type: 'transmute', element: 'earth',
      paidSources: [{ source: 'card', cardUid: ref(4).u, element: 'water', slot: 0 }] });
    expect(state.players[0]!.energies.water).toBe(before);
    expect(state.players[0]!.played.find((card) => card.i === 4)?.stored?.water).toBe(0);
  });
  it('fixed activation uses the selected card token, not a same-kind reserve token', () => {
    let state = ready([ref(80), { ...ref(4), stored: { water: 1 } }]);
    state = act(state, { type: 'activate', cardUid: ref(80).u,
      paidSources: [{ source: 'card', cardUid: ref(4).u, element: 'water', slot: 0 }] });
    expect(state.players[0]!.energies.water).toBe(10);
    expect(state.players[0]!.played.find((card) => card.i === 4)?.stored?.water).toBe(0);
    expect(state.players[0]!.played.some((card) => card.i === 222)).toBe(true);
  });
  it('Replica triggers a cage, but never ordinary summon rewards', () => {
    let state = ready([ref(80), ref(6)]);
    state.players[1]!.played = [ref(85, 9085)];
    state.players[1]!.cardMarks = { 9085: { trapArmed: true } };
    state = act(state, { type: 'activate', cardUid: ref(80).u });
    expect(state.pendingChoice?.key).toBe('urmian_psychic_cage');
    expect(state.players[0]!.crystals).toBe(100);
    state = choose(state, { id: 'discard_summoned' });
    expect(state.discard.some((card) => card.i === 222)).toBe(true);
    expect(state.players[0]!.crystals).toBe(100);
  });
  it('Ratty may take zero or one and never manufactures source energy', () => {
    let state = summon(70);
    state = choose(state, { water: 1 });
    expect(state.players[1]!.energies.water).toBe(9);
    state = choose(summon(70), {});
    expect(state.players[1]!.energies.water).toBe(10);
  });
  it('a sacrificed copied Raven remains a familiar and discards as its original card', () => {
    let state = ready([ref(44), ref(6, ref(68).u)]);
    state.players[0]!.cardMarks = { [ref(68).u]: { ravenOriginalId: 68, ravenTarget: 9006 } };
    state.players[1]!.played = [ref(6, 9006)];
    state = act(state, { type: 'activate', cardUid: ref(44).u });
    state = choose(state, { uid: ref(68).u });
    expect(state.discard).toContainEqual(ref(68));
    expect(state.players[0]!.cardMarks?.[ref(68).u]).toBeUndefined();
    expect(state.pendingChoice?.key).toBe('necrotic_kriss');
  });
  it('a copied Raven counts as a familiar, not as the copied magic item', () => {
    let state = ready([ref(43), ref(6, ref(68).u)], [ref(54)]);
    state.players[0]!.cardMarks = { [ref(68).u]: { ravenOriginalId: 68, ravenTarget: 9006 } };
    state.players[1]!.played = [ref(6, 9006)];
    state = act(state, { type: 'activate', cardUid: ref(43).u });
    expect(state.players[0]!.crystals).toBe(101);
    state = summon(54, state);
    expect(state.pendingCards?.some((card) => card.u === ref(68).u)).toBe(false);
    if (state.pendingChoice) {
      expect(seasons.reduce(state, 0, { type: 'resolve-choice', choice: { uid: ref(68).u } }, ctx).ok).toBe(false);
    }
  });
  it('the printed categories and Sid points match their original card faces', () => {
    for (const id of [86, 87, 88, 89]) {
      expect(SEASONS_CARDS.find((card) => card.id === id)?.type).toBe('familiar');
    }
    expect(SEASONS_CARDS.find((card) => card.id === 58)?.type).toBe('magic_item');
    expect(SEASONS_CARDS.find((card) => card.id === 49)?.points).toBe(6);
  });
});

describe('extension continuations and source boundaries', () => {
  it('Horn pays a reserve token; winter Staff treats it as Earth and awards five crystals', () => {
    let state = ready([ref(52), ref(78)]);
    state = endRound(state);
    expect(state.pendingChoice?.key).toBe('horn_of_plenty');
    state = choose(state, { element: 'fire', paidSources: [{ source: 'reserve', element: 'fire', slot: 3 }] });
    expect(state.players[0]!.energies.fire).toBe(9);
    expect(state.players[0]!.crystals).toBe(105);
  });
  it('Goddess statue reduces capacity and its season peek is private and does not draw', () => {
    let state = summon(57);
    expect(state.players[0]!.maxEnergy).toBe(99);
    state.month = 2;
    state = { ...state, turnOwner: 1, pickedThisSeason: [0],
      season: { ...state.season!, dice: state.season!.dice.map((die) => die.pickedBy === null ? { ...die, pip: 1 } : die) } };
    state = act(state, { type: 'end-turn' }, 1);
    expect(state.pendingChoice?.key).toBe('statue_of_eolis');
    state = choose(state, 'crystals');
    expect(state.pendingChoice?.key).toBe('peek_close');
    const deck = [...state.deck];
    expect(seasons.view(state, 1, true).pendingChoice?.options.cards).toBeUndefined();
    expect(seasons.view(state, 0, true).pendingChoice?.options.cards).toHaveLength(1);
    state = choose(state, 'close');
    expect(state.deck).toEqual(deck);
  });
  it('Shield can replace a self-sacrificing potion while the potion resolves and remains used', () => {
    let state = ready([ref(23), ref(63)]);
    state = act(state, { type: 'activate', cardUid: ref(23).u });
    expect(state.pendingChoice?.key).toBe('shield_substitute');
    state = choose(state, `shield:${ref(63).u}`);
    expect(state.players[0]!.played.some((card) => card.i === 23)).toBe(true);
    expect(state.players[0]!.played.some((card) => card.i === 63)).toBe(false);
    expect(state.players[0]!.crystals).toBe(110);
    expect(state.players[0]!.gauge).toBe(42);
    expect(state.players[0]!.activatedThisTurn).toContain(String(ref(23).u));
  });
  it('Steadfast die replaces the entire die reward, not just its energy', () => {
    let state = ready();
    state.turnOwner = null; state.dicePicked = [];
    state.players[0]!.played = [ref(64)];
    state.season = { ...state.season!, dice: state.season!.dice.map((die) => ({
      ...die, pickedBy: null, rewards: { water: 2, crystals: 5, summon: true },
    })) };
    state = act(state, { type: 'draft-dice', dieIndex: 0 });
    state = act(state, { type: 'draft-dice', dieIndex: 1 }, 1);
    expect(state.pendingChoice?.key).toBe('steadfast_die');
    state = choose(state, 'gauge');
    expect(state.players[0]!.gauge).toBe(41);
    expect(state.players[0]!.crystals).toBe(100);
    expect(state.players[0]!.energies.water).toBe(10);
  });
  it('Dial compares total Power cards, rerolls only leftovers, and preserves every chosen die', () => {
    let state = ready([ref(76)]);
    state.players[1]!.played = [ref(10), ref(11)];
    const ended = endRound(state);
    expect(ended.pendingChoice?.key).not.toBe('dial_of_colof');
    state = ready([ref(76), ref(52), ref(23), ref(25)]);
    state.players[1]!.played = [ref(10)];
    state = endRound(state);
    expect(state.pendingChoice?.key).toBe('dial_of_colof');
    const chosen = state.season!.dice.filter((die) => die.pickedBy !== null);
    const cursor = state.rngCursor;
    state = choose(state, 'reroll');
    expect(state.season!.dice.filter((die) => die.pickedBy !== null)).toEqual(chosen);
    expect(state.rngCursor).toBe(cursor + 1);
  });
  it('Winter Staff can discard a hand item but not an unrelated field item', () => {
    let state = ready([ref(78), ref(6)], [ref(1)]);
    state = act(state, { type: 'activate', cardUid: ref(78).u });
    expect(seasons.reduce(state, 0, { type: 'resolve-choice', choice: { uid: ref(6).u } }, ctx).ok).toBe(false);
    state = choose(state, { uid: ref(1).u });
    state = choose(state, { fire: 3 });
    expect(state.players[0]!.energies.fire).toBe(13);
    expect(state.discard).toContainEqual(ref(1));
  });
  it('Harp uses exactly two matching selected sources and rejects mixed elements atomically', () => {
    let state = ready([ref(81), { ...ref(4), stored: { water: 2 } }]);
    state = act(state, { type: 'activate', cardUid: ref(81).u });
    expect(seasons.reduce(state, 0, { type: 'resolve-choice', choice: { element: 'water', paidSources: [
      { source: 'reserve', element: 'water', slot: 0 }, { source: 'reserve', element: 'fire', slot: 0 },
    ] } }, ctx).ok).toBe(false);
    state = choose(state, { element: 'water', paidSources: [
      { source: 'card', cardUid: ref(4).u, element: 'water', slot: 0 },
      { source: 'card', cardUid: ref(4).u, element: 'water', slot: 1 },
    ] });
    expect(state.players[0]!.energies.water).toBe(10);
    expect(state.players[0]!.played.find((card) => card.i === 4)?.stored?.water).toBe(0);
    expect(state.players[0]!.gauge).toBe(41);
    expect(state.players[0]!.crystals).toBe(103);
  });
  it('Chrono ring waits for common round end and sums boot movement with the leftover die', () => {
    let state = ready([ref(82)]);
    state.monthStepsThisRound = [2, 2];
    state = act(state, { type: 'end-turn' });
    expect(state.pendingChoice?.key).not.toBe('chrono_ring');
    state = act(state, { type: 'end-turn' }, 1);
    expect(state.pendingChoice?.key).toBe('chrono_ring');
    state = choose(state, 'crystals');
    expect(state.players[0]!.crystals).toBe(104);
    expect(state.monthStepsThisRound).toEqual([0, 0]);
  });
  it('Carnivora only triggers with no reserve energy and puts the selected discard on the real deck top', () => {
    let state = ready([ref(84)]);
    expect(endRound(state).pendingChoice?.key).not.toBe('carnivora_strombosea');
    state.players[0]!.energies = { water: 0, air: 0, earth: 0, fire: 0 };
    state.discard = [ref(3)];
    state = endRound(state);
    state = choose(state, 'deck');
    expect(state.deck.at(-1)).toEqual(ref(3));
    expect(state.discard).toHaveLength(0);
  });
  it('Tangleweed blocks activation only while its source instance remains on the field', () => {
    let state = ready([], [ref(87)]);
    state.players[1]!.played = [ref(16, 9016)];
    state = summon(87, state);
    state = choose(state, { seat: 1, uid: 9016 });
    state.turnOwner = 1;
    const blocked = seasons.reduce(state, 1, { type: 'activate', cardUid: 9016 }, ctx);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('card_locked');
    state.players[0]!.played = [];
    state = act(state, { type: 'use-badge', badgeType: 3 }, 1);
    state = act(state, { type: 'activate', cardUid: 9016 }, 1);
    expect(state.pendingChoice?.key).toBe('kairn');
  });
  it('two locks on one familiar require both live source instances to leave', () => {
    let state = ready([], [ref(87), ref(87, 8187)]);
    state.players[1]!.played = [ref(16, 9016)];
    state = choose(summon(87, state), { seat: 1, uid: 9016 });
    state = act(state, { type: 'summon', cardUid: 8187 });
    state = choose(state, { seat: 1, uid: 9016 });
    expect(state.players[1]!.cardMarks?.[9016]?.lockSources).toEqual([ref(87).u, 8187]);
    state.players[0]!.played = state.players[0]!.played.filter((card) => card.u !== ref(87).u);
    state = act(state, { type: 'use-badge', badgeType: 3 });
    expect(state.players[1]!.cardMarks?.[9016]?.lockSources).toEqual([8187]);
    state.turnOwner = 1;
    expect(seasons.reduce(state, 1, { type: 'activate', cardUid: 9016 }, ctx).ok).toBe(false);
    state.players[0]!.played = [];
    state = act(state, { type: 'use-badge', badgeType: 3 }, 1);
    state = act(state, { type: 'activate', cardUid: 9016 }, 1);
    expect(state.pendingChoice?.key).toBe('kairn');
  });
  it('locking a Raven copied Grimoire suspends its capacity only once and restores it after the last lock', () => {
    let state = ready([ref(87), ref(87, 8187)]);
    state.players[1]!.played = [ref(18, 9068)];
    state.players[1]!.cardMarks = { 9068: {
      ravenOriginalId: 68, ravenTarget: 8018, lockSource: ref(87).u,
      lockSources: [ref(87).u, 8187],
    } };
    state.players[0]!.played.push(ref(18, 8018));
    state.players[1]!.maxEnergy = 7;
    state.players[1]!.energies = { air: 0, water: 0, fire: 0, earth: 0 };
    state.players[0]!.played = state.players[0]!.played.filter((card) => card.u !== ref(87).u);
    state = act(state, { type: 'use-badge', badgeType: 3 });
    expect(state.players[1]!.maxEnergy).toBe(7);
    state.players[0]!.played = state.players[0]!.played.filter((card) => card.u !== 8187);
    state = act(state, { type: 'use-badge', badgeType: 3 });
    expect(state.players[1]!.maxEnergy).toBe(10);
    expect(state.players[1]!.played[0]!.i).toBe(18);
  });
  it('targeting another Tangleweed removes the lock it had placed', () => {
    let state = ready([ref(16)], [ref(87)]);
    state.players[0]!.cardMarks = { [ref(16).u]: { lockSource: 9087, lockSources: [9087] } };
    state.players[1]!.played = [ref(87, 9087)];
    state = choose(summon(87, state), { seat: 1, uid: 9087 });
    expect(state.players[0]!.cardMarks?.[ref(16).u]?.lockSource).toBeUndefined();
    expect(state.players[1]!.cardMarks?.[9087]?.lockSource).toBeUndefined();
    state = act(state, { type: 'activate', cardUid: ref(16).u });
    expect(state.pendingChoice?.key).toBe('kairn');
  });
  it('Heart charges once for two activations and returns the actual Earth token at common round end', () => {
    let state = ready([ref(51), ref(23), ref(23, 8123)]);
    state = act(state, { type: 'activate', cardUid: ref(23).u });
    state = act(state, { type: 'activate', cardUid: 8123 });
    expect(state.players[0]!.played.find((c) => c.i === 51)?.stored).toEqual({ earth: 1 });
    const earth = state.players[0]!.energies.earth;
    state = endRound(state);
    expect(state.players[0]!.energies.earth).toBe(earth + 1);
    expect(state.players[0]!.played.find((c) => c.i === 51)?.stored).toEqual({});
  });
  it('Monolith stores reserve only, returns a selected subset, rejects phantom tokens', () => {
    let state = ready([ref(53)]);
    state = endRound(state);
    expect(state.pendingChoice?.key).toBe('fairy_monolith_store');
    state = choose(state, { element: 'fire' });
    expect(state.players[0]!.played[0]!.stored).toEqual({ fire: 1 });
    state = { ...state, turnOwner: 0, pendingChoice: null, pendingQueue: [] };
    state = act(state, { type: 'activate', cardUid: ref(53).u });
    expect(seasons.reduce(state, 0, { type: 'resolve-choice', choice: { water: 1 } }, ctx).ok).toBe(false);
    state = choose(state, { fire: 1 });
    expect(state.players[0]!.played[0]!.stored?.fire).toBe(0);
    expect(state.players[0]!.energies.fire).toBe(10);
  });
  it('Selenia returns an energy-cost item and restores its capacity, never the newly summoned codex', () => {
    let state = summon(54, ready([ref(18)], [ref(54)]));
    expect(state.pendingChoice?.key).toBe('selenias_codex');
    expect(seasons.reduce(state, 0, { type: 'resolve-choice', choice: { uid: ref(54).u } }, ctx).ok).toBe(false);
    const capacity = state.players[0]!.maxEnergy;
    state = choose(state, { uid: ref(18).u });
    expect(state.players[0]!.hand).toContainEqual(ref(18));
    expect(state.players[0]!.maxEnergy).toBe(capacity - 3);
  });
  for (const id of [55, 58]) it(`search #${id}: refusal is bounded to one retry and never free-summons`, () => {
    let state = summon(id, { ...ready([], [ref(id)]), deck: [ref(6, 7201), ref(10, 7202), ref(6, 7203), ref(10, 7204)], discard: [] });
    if (id === 55) state = choose(state, 'earth');
    else state = choose(state, 'search');
    expect(state.pendingChoice?.key).toBe(id === 55 ? 'scroll_of_ishtar_result' : 'familiar_catcher_result');
    const first = state.pendingCards![0]!;
    state = choose(state, 'discard');
    expect(state.pendingChoice).toBeNull();
    expect(state.discard.some((card) => card.u === first.u)).toBe(true);
    expect(state.players[0]!.hand).toHaveLength(1);
    expect(state.players[0]!.played).toHaveLength(1);
  });
  it('Lantern cannot be free-summoned; a paid summon reduces capacity and pays end-turn crystals', () => {
    let state = ready([], [ref(56)]);
    state.pendingChoice = { kind: 'card_pick', key: 'potion_dreams', choosingSeat: 0, options: {} };
    state.pendingCards = [ref(56)];
    expect(seasons.reduce(state, 0, { type: 'resolve-choice', choice: { uid: ref(56).u } }, ctx).ok).toBe(false);
    state = summon(56);
    expect(state.players[0]!.maxEnergy).toBe(99);
    const crystals = state.players[0]!.crystals;
    state = endRound(state);
    expect(state.players[0]!.crystals).toBe(crystals + 3);
  });
  it('Resurrection uses the existing top five discard cards, not a new draw or its own sacrificed potion', () => {
    const cards = [1, 2, 3, 4, 5, 6].map((i) => ref(i, 7000 + i));
    let state = { ...ready([ref(61)]), discard: cards };
    const deck = [...state.deck];
    state = act(state, { type: 'activate', cardUid: ref(61).u });
    expect(state.pendingCards).toEqual(cards.slice(-5).reverse());
    state = choose(state, { uid: cards[5]!.u });
    expect(state.deck).toEqual(deck);
    expect(state.players[0]!.hand).toContainEqual(cards[5]);
    expect(state.discard.slice(0, 4)).toEqual(cards.slice(1, 5));
    expect(state.discard.at(-1)?.i).toBe(61);
  });
  it('Time amulet permits X=0 and exchanges exactly the selected hand cards', () => {
    let state = summon(65);
    state = choose(state, { earth: 2 });
    expect(state.pendingChoice?.key).toBe('time_discard');
    const hand = [...state.players[0]!.hand];
    state = choose(state, []);
    expect(state.players[0]!.hand).toEqual(hand);
    expect(state.pendingChoice).toBeNull();
  });
  it('Telescope charges two crystals and preserves chosen top-to-bottom order without drawing cards', () => {
    let state = ready([ref(66)]);
    const hand = [...state.players[0]!.hand];
    const crystal = state.players[0]!.crystals;
    state = act(state, { type: 'activate', cardUid: ref(66).u });
    const top = state.pendingCards!;
    expect(top).toHaveLength(3);
    const order = [top[1]!.u, top[2]!.u, top[0]!.u];
    expect(seasons.view(state, 1, true).pendingChoice?.options.cards).toBeUndefined();
    state = choose(state, order);
    expect(state.deck.slice(-3).reverse().map((card) => card.u)).toEqual(order);
    expect(state.players[0]!.hand).toEqual(hand);
    expect(state.players[0]!.crystals).toBe(crystal - 2);
  });
  it('Hawk sacrifices itself and rewards opponents, not its owner', () => {
    let state = ready([ref(67)]);
    state = act(state, { type: 'activate', cardUid: ref(67).u });
    expect(state.players[0]!.crystals).toBe(100);
    expect(state.players[1]!.crystals).toBe(106);
    expect(state.players[1]!.gauge).toBe(39);
    expect(state.discard).toContainEqual(ref(67));
  });
  it('Raven pays the copied item cost, keeps its own printed points and leaves when its target leaves', () => {
    let state = ready([], [ref(68)]);
    state.players[1]!.played = [ref(6, 9006)];
    state = summon(68, state);
    state = choose(state, { uid: 9006 });
    expect(state.pendingChoice?.key).toBe('raven_payment');
    const cost = SEASONS_CARDS.find((card) => card.id === 6)!.cost;
    const paidSources = ELEMENTS.flatMap((element) => Array.from({ length: cost[element] },
      (_, slot) => ({ source: 'reserve' as const, element, slot })));
    state = choose(state, { paidSources });
    expect(state.players[0]!.played[0]!.i).toBe(6);
    const view = seasons.view(state, 0, true);
    expect(view.players[0]!.played[0]!.copyOf).toBe(6);
    expect(view.players[0]!.played[0]!.printedId).toBe(68);
    state = { ...state, players: state.players.map((p, seat) => seat === 1 ? { ...p, played: [] } : p) };
    state = act(state, { type: 'use-badge', badgeType: 3 });
    expect(state.players[0]!.played).toHaveLength(0);
    expect(state.discard).toContainEqual(ref(68));
  });
  it('Warden queues every player, does not silently free-summon their discarded hand', () => {
    let state = summon(69);
    state = choose(state, 'cards');
    for (const seat of [0, 1]) {
      expect(state.pendingChoice?.choosingSeat).toBe(seat);
      const card = state.players[seat]!.hand[0]!;
      state = choose(state, { uid: card.u });
      expect(state.discard).toContainEqual(card);
    }
    expect(state.pendingChoice).toBeNull();
  });
  it('Ratty takes from the selected opponent only and cannot invent a missing element', () => {
    let state = ready([], [ref(70)]);
    state.players[1]!.energies = { water: 0, air: 2, earth: 0, fire: 0 };
    state = summon(70, state);
    expect(state.pendingChoice?.key).toBe('ratty_steal');
    expect(seasons.reduce(state, 0, { type: 'resolve-choice', choice: { water: 2 } }, ctx).ok).toBe(false);
    const air = state.players[0]!.energies.air;
    state = choose(state, { air: 2 });
    expect(state.players[1]!.energies.air).toBe(0);
    expect(state.players[0]!.energies.air).toBe(air + 2);
  });
  it('Ancient potion resolves two distinct effects and rejects picking the same branch twice', () => {
    let state = ready([ref(74)]);
    state = act(state, { type: 'activate', cardUid: ref(74).u });
    state = choose(state, 'gauge');
    expect(state.players[0]!.gauge).toBe(42);
    expect(state.pendingChoice?.key).toBe('potion_of_the_ancients');
    expect(seasons.reduce(state, 0, { type: 'resolve-choice', choice: 'gauge' }, ctx).ok).toBe(false);
    state = choose(state, 'energy');
    state = choose(state, { fire: 4 });
    expect(state.players[0]!.energies.fire).toBe(14);
    expect(state.pendingChoice).toBeNull();
    expect(state.discard.filter((c) => c.i === 74)).toHaveLength(1);
  });
  it('Fountain pays only with an empty hand', () => {
    expect(endRound(ready([ref(75)])).players[0]!.crystals).toBe(103);
    expect(endRound(ready([ref(75)], [ref(1)])).players[0]!.crystals).toBe(100);
  });
  it('Chalice stores energy, pays four sealed tokens and summons one of four actual draws', () => {
    let state = ready([{ ...ref(77), stored: { fire: 4 } }]);
    state = act(state, { type: 'activate', cardUid: ref(77).u });
    expect(state.pendingCards).toHaveLength(4);
    const cards = [...state.pendingCards!];
    const picked = cards.find((card) => card.i !== 56)!;
    state = choose(state, { uid: picked.u });
    expect(state.players[0]!.played.some((card) => card.u === picked.u)).toBe(true);
    expect(state.players[0]!.played.find((card) => card.i === 77)?.stored?.fire).toBe(0);
    expect(cards.filter((card) => card.u !== picked.u).every((card) => state.discard.some((c) => c.u === card.u))).toBe(true);
  });
  it('Sepulchral amulet uses the discard top three and assigns hand, deck top and bottom', () => {
    const cards = [ref(1, 7101), ref(2, 7102), ref(3, 7103)];
    let state = summon(79, { ...ready([], [ref(79)]), discard: cards });
    state = choose(state, { uid: 7102 });
    state = choose(state, { uid: 7103 });
    expect(state.players[0]!.hand).toContainEqual(cards[1]);
    expect(state.deck.at(-1)).toEqual(cards[2]);
    expect(state.deck[0]).toEqual(cards[0]);
    expect(state.discard).toHaveLength(0);
  });
  it('Arus can discard hand or sacrifice field; Shield substitution grants both rewards', () => {
    let state = summon(83, ready([ref(63)], [ref(83)]));
    const crystal = state.players[0]!.crystals;
    state = choose(state, { uid: ref(63).u });
    expect(state.players[0]!.crystals).toBe(crystal + 22);
    expect(state.discard).toContainEqual(ref(63));
  });
  it('Cage rejects a spell before its effect; accepting another sacrifice resumes it exactly once', () => {
    for (const discard of [true, false]) {
      let state = ready([ref(18)], [ref(29)]);
      state.players[1]!.played = [ref(85, 9085)];
      state.players[1]!.cardMarks = { 9085: { trapArmed: true } };
      const crystal = state.players[0]!.crystals;
      state = summon(29, state);
      expect(state.pendingChoice?.key).toBe('urmian_psychic_cage');
      expect(state.players[0]!.crystals).toBe(crystal);
      state = choose(state, { id: discard ? 'discard_summoned' : 'sacrifice_other' });
      if (!discard) state = choose(state, { uid: ref(18).u });
      expect(state.players[0]!.crystals).toBe(crystal + (discard ? 0 : 20));
      expect(state.players[1]!.cardMarks?.[9085]?.trapArmed).not.toBe(true);
      expect(state.pendingChoice).toBeNull();
    }
  });
  it('sealed cauldron tokens cannot pay summon costs or be transformed by Air Elemental', () => {
    const cauldron = SEASONS_CARDS.find((card) => card.effect?.typeKey === 'glutton_cauldron')!;
    let state = ready([{ ...ref(cauldron.id), stored: { earth: 3 } }], [ref(6)]);
    state.players[0]!.energies = { water: 0, air: 0, earth: 0, fire: 0 };
    expect(seasons.reduce(state, 0, { type: 'summon', cardUid: ref(6).u,
      paidSources: [{ source: 'card', cardUid: ref(cauldron.id).u, slot: 0, element: 'earth' }] }, ctx).ok).toBe(false);
    const air = SEASONS_CARDS.find((card) => card.effect?.typeKey === 'air_elemental')!;
    state = ready([], [ref(air.id)]);
    state.players[1]!.played = [{ ...ref(cauldron.id), stored: { earth: 3 } }];
    state = summon(air.id, state);
    expect(state.players[1]!.played[0]!.stored).toEqual({ earth: 3 });
  });
  it('rejects a forged payment slot and applies cost reduction to the exact chosen source', () => {
    let state = ready([ref(40)], [ref(54)]);
    const invalid = seasons.reduce(state, 0, { type: 'summon', cardUid: ref(54).u,
      paidSources: [{ element: 'water', source: 'reserve', slot: 999 }] }, ctx);
    expect(invalid.ok).toBe(false);
    const lucky = SEASONS_CARDS.find((card) => card.effect?.abilities?.some((a) => a.kind === 'cost_reduction'))!;
    state = ready([ref(lucky.id)], [ref(54)]);
    state = act(state, { type: 'summon', cardUid: ref(54).u,
      paidSources: [{ element: 'water', source: 'reserve', slot: 3 }] });
    expect(state.players[0]!.energies.water).toBe(9);
    expect(state.players[0]!.energies.air).toBe(10);
    expect(state.pendingChoice?.key).toBe('selenias_codex');
  });
});
