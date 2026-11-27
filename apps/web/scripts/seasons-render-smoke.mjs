#!/usr/bin/env node
/**
 * 四季物语前端渲染冒烟（无需浏览器）：
 * 用 Vite 的 ssrLoadModule 加载真实的 Panel.tsx / index.tsx，把引擎跑出的每个
 * 状态用 react-dom/server 渲染成静态 HTML，覆盖轮抽/组牌/选骰/行动/各类弹窗/
 * 终局/观战视图。能抓住「JSX 里访问不存在字段」「组件崩溃」这类构建查不出的问题。
 *
 * 不进 CI（依赖 vite + 真实引擎）；用法（在 apps/web 下）：
 *   pnpm --filter @bgx/server build
 *   node scripts/seasons-render-smoke.mjs [局数]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { seasons } from '../../server/dist/games/seasons/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GAMES = Number(process.argv[2] ?? 2);
const ELEMENTS = ['water', 'air', 'fire', 'earth'];

function makeRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return {
    next,
    int: (max) => Math.floor(next() * max),
    pick: (a) => a[Math.floor(next() * a.length)],
    shuffle: (a) => [...a].sort(() => next() - 0.5),
  };
}

/** 通用选择候选（与 soak 脚本同思路，只为把对局推进下去）。 */
function candidates(state) {
  const p = state.pendingChoice;
  const seat = p.choosingSeat;
  const me = state.players[seat];
  if (p.kind === 'branch') return (p.options.branches ?? []).map((branch) => ({ id: branch.id }));
  if (p.kind === 'month_advance') return [{ direction: 'forward', steps: 1 }];
  if (p.kind === 'card_pick') {
    const pool = p.options.purpose === 'discard' ? me.hand : (state.pendingCards ?? []);
    return pool.map((card) => ({ uid: card.u }));
  }
  if (p.kind === 'card_list') {
    const cards = state.pendingCards ?? [];
    const keep = typeof p.options.keep === 'number' ? p.options.keep : 1;
    return keep === 1 ? cards.map((card) => [card.u]) : [cards.slice(0, keep).map((card) => card.u)];
  }
  if (p.kind === 'multi_player_pick') return me.played.map((card) => ({ uid: card.u }));
  if (p.kind === 'element_multi') {
    return [(p.options.elements ?? []).map((item) => item.element)];
  }
  if (p.kind === 'element_pick') {
    return ELEMENTS.filter((element) => me.energies[element] > 0).map((element) => ({ element }));
  }
  if (p.kind === 'sacrifice_cards') return me.played.map((card) => card.u);
  if (p.kind === 'energy_discard') {
    const total = typeof p.options.amount === 'number' ? p.options.amount : 0;
    const available = p.options.available ?? {};
    const out = { water: 0, air: 0, fire: 0, earth: 0 };
    let left = total;
    for (const element of ELEMENTS) {
      const take = Math.min(available[element] ?? 0, left);
      out[element] = take;
      left -= take;
    }
    return [out];
  }
  if (p.kind === 'energy_swap') {
    const total = typeof p.options.total === 'number' ? p.options.total : 0;
    const current = p.options.current ?? {};
    const incoming = p.options.incoming ?? {};
    const pool = {};
    for (const element of ELEMENTS) pool[element] = (current[element] ?? 0) + (incoming[element] ?? 0);
    const out = { water: 0, air: 0, fire: 0, earth: 0 };
    let left = total;
    for (const element of ELEMENTS) {
      out[element] = Math.min(pool[element], left);
      left -= out[element];
      if (left <= 0) break;
    }
    return [out];
  }
  const amount = typeof p.options.amount === 'number' ? p.options.amount : 1;
  const caps = p.options.maxPerElement ?? {};
  const out = { water: 0, air: 0, fire: 0, earth: 0 };
  let left = amount;
  for (const element of ELEMENTS) {
    out[element] = Math.min(left, typeof caps[element] === 'number' ? caps[element] : left);
    left -= out[element];
    if (left <= 0) break;
  }
  if (left > 0) out.water += left;
  return [out];
}

const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
});

const warnings = [];
const originalError = console.error;
console.error = (...args) => {
  warnings.push(args.map(String).join(' '));
  originalError(...args);
};

function makeView(state, seat) {
  const game = seasons.view(state, seat);
  const status = state.phase === 'ended' ? 'finished' : 'active';
  return {
    matchId: 'render-smoke',
    gameId: 'seasons',
    gameName: '四季物语',
    status,
    visibility: 'public',
    seq: 1,
    version: 1,
    players: state.players.map((player) => ({
      seat: player.seat,
      userId: `p${player.seat}`,
      name: `玩家${player.seat}`,
      isYou: player.seat === seat,
    })),
    hostId: 'p0',
    minPlayers: 2,
    maxPlayers: 4,
    options: {},
    you: { userId: seat === null ? 'p0' : `p${seat}`, seat, spectator: seat === null },
    currentSeat: seasons.turn(state),
    winner: seasons.winner(state),
    aborted: false,
    canResign: seat === null ? false : seasons.resignable(state, seat),
    createdAt: 0,
    startedAt: 0,
    endedAt: status === 'finished' ? 0 : null,
    game,
  };
}

let renders = 0;
const pendingSeen = new Set();
try {
  const panelMod = await server.ssrLoadModule('/src/games/seasons/Panel.tsx');
  const pluginMod = await server.ssrLoadModule('/src/games/seasons/index.tsx');
  const Panel = panelMod.SeasonsPanel;
  const plugin = pluginMod.plugin;
  if (typeof Panel !== 'function') throw new Error('Panel.tsx 未导出 SeasonsPanel');

  const ctx = { now: 0, rng: makeRng(7) };
  const apply = (state, seat, action) => {
    const result = seasons.reduce(state, seat, action, ctx);
    if (!result.ok) throw new Error(`${action.type} 失败：${result.code} ${result.message}`);
    return result.state;
  };

  const durs = [];
  const renderState = (state, where) => {
    if (state.pendingChoice) pendingSeen.add(state.pendingChoice.kind);
    for (const seat of [0, 1, null]) {
      const view = makeView(state, seat);
      try {
        const started = performance.now();
        const html = renderToStaticMarkup(
          createElement(Panel, {
            view,
            mySeat: seat,
            disabled: false,
            onAction: () => {},
          }),
        );
        durs.push(performance.now() - started);
        if (!html.includes('ss-board')) throw new Error('Panel 输出缺少 ss-board 根节点');
        if (seat === 0) {
          for (const marker of ['术语与骰面图例', 'ss-table', 'ss-log-tools']) {
            if (!html.includes(marker)) throw new Error(`Panel 输出缺少关键入口：${marker}`);
          }
        }
        if (seat === 0 && state.phase === 'play' && !html.includes('ss-die-')) {
          throw new Error('骰池缺少骰子按钮（ss-die-）');
        }
        if (seat === 0 && state.phase === 'play' && (view.players[0].hand?.length ?? 0) > 1 && !html.includes('手牌排序')) {
          throw new Error('手牌缺少排序入口');
        }
        if (state.phase === 'ended') {
          for (const marker of ['ss-result', 'ss-result-row']) {
            if (!html.includes(marker)) throw new Error(`终局结算缺少 ${marker}`);
          }
        }
        renders += 1;
      } catch (error) {
        throw new Error(`渲染失败（${where}，座位 ${seat === null ? '观战' : seat}）：${error.message}`);
      }
      // 插件文案函数也跑一遍：headline/statusLine/playerBadge/eventMessage
      const text = [
        plugin.headline(view, seat),
        plugin.statusLine(view, seat),
        ...state.players.map((player) => plugin.playerBadge?.(view, player.seat) ?? ''),
      ];
      if (text.some((entry) => typeof entry !== 'string' || entry.includes('undefined'))) {
        throw new Error(`文案异常（${where}，座位 ${seat === null ? '观战' : seat}）：${JSON.stringify(text)}`);
      }
    }
  };

  for (let game = 0; game < GAMES; game += 1) {
    const playerCount = game === 0 ? 2 : 4;
    let state = seasons.setup(playerCount, {}, makeRng(50 + game));
    let guard = 0;
    renderState(state, `game=${game} 开局`);
    while (state.phase !== 'ended' && guard++ < 20000) {
      if (state.pendingChoice) {
        renderState(state, `game=${game} 待选 ${state.pendingChoice.kind}`);
        const seat = state.pendingChoice.choosingSeat;
        let next = null;
        const tried = [];
        for (const choice of candidates(state)) {
          const result = seasons.reduce(state, seat, { type: 'resolve-choice', choice }, ctx);
          if (result.ok) {
            next = result.state;
            break;
          }
          tried.push([result.code, result.message, JSON.stringify(choice)]);
        }
        if (!next) throw new Error(`resolve-choice 全部候选失败：${JSON.stringify(state.pendingChoice)} ${JSON.stringify(tried)}`);
        state = next;
        continue;
      }
      if (state.phase === 'draft') {
        const seat = state.players.findIndex((player) => player.drafted.length === state.draftRound);
        state = apply(state, seat, { type: 'draft-pick', cardUid: state.players[seat].draftHand[0].u });
      } else if (state.phase === 'organize') {
        const seat = state.players.findIndex((player) => !player.organizeDone);
        const me = state.players[seat];
        const taken = new Set(me.organizeYear1);
        const uids = me.drafted.filter((card) => !taken.has(card.u)).slice(0, 3).map((card) => card.u);
        state = apply(state, seat, { type: 'organize', cardUids: uids });
      } else if (state.turnOwner === null) {
        const seat = state.currentPicker;
        state = apply(state, seat, {
          type: 'draft-dice',
          dieIndex: state.season.dice.findIndex((die) => die.pickedBy === null),
        });
      } else {
        const seat = state.turnOwner;
        let acted = false;
        for (const card of state.players[seat].hand) {
          const result = seasons.reduce(state, seat, { type: 'summon', cardUid: card.u }, ctx);
          if (result.ok) {
            state = result.state;
            acted = true;
            break;
          }
        }
        if (!acted) state = apply(state, seat, { type: 'end-turn' });
      }
      renderState(state, `game=${game} step=${guard} phase=${state.phase}`);
    }
    if (state.phase !== 'ended') throw new Error(`game=${game} 未跑完（guard=${guard}）`);
    renderState(state, `game=${game} 终局`);
  }

  // 插件事件文案：确保每种事件都不抛错，返回 null 或 {text}。
  const eventSamples = [
    { type: 'summon', seat: 0, cardUid: 1, cardId: 18 },
    { type: 'activate', seat: 0, cardUid: 1, cardId: 34 },
    { type: 'transmute', seat: 1, element: 'water', amount: 2 },
    { type: 'end-turn', seat: 1 },
    { type: 'resign', seat: 1 },
    { type: 'choice', seat: 0, kind: 'element_alloc' },
    { type: 'score', seat: 0, points: 3 },
  ];
  for (const event of eventSamples) {
    const message = plugin.eventMessage?.(event) ?? null;
    if (message !== null && (typeof message.text !== 'string' || message.text.length === 0)) {
      throw new Error(`eventMessage 返回异常：${JSON.stringify(event)} → ${JSON.stringify(message)}`);
    }
  }

  // 合成各类 pendingChoice，直接渲染 ChoiceModal，覆盖真实对局里不一定触发的分支。
  const choiceMod = await server.ssrLoadModule('/src/games/seasons/ChoiceModal.tsx');
  const ChoiceModal = choiceMod.ChoiceModal;
  const modalState = seasons.setup(2, {}, makeRng(9));
  const modalView = makeView(modalState, 0);
  const cardPool = modalState.players[0].hand.slice(0, 3);
  const synthetic = [
    { kind: 'element_alloc', key: 'test_alloc', choosingSeat: 0, options: { title: '选 2 个能量', amount: 2, label: '确定', maxPerElement: { water: 1 } } },
    { kind: 'element_pick', key: 'test_pick', choosingSeat: 0, options: { title: '选择一种能量', amount: 1, label: '确定' } },
    { kind: 'element_multi', key: 'test_multi_element', choosingSeat: 0, options: { title: '选择要转换的能量类型', label: '转换', elements: [{ element: 'water', count: 2 }, { element: 'air', count: 1 }] } },
    { kind: 'card_pick', key: 'test_card_pick', choosingSeat: 0, options: { title: '选 1 张牌', label: '选择', cards: cardPool } },
    { kind: 'card_list', key: 'test_card_list', choosingSeat: 0, options: { title: '保留 1 张', keep: 1, label: '保留', cards: cardPool } },
    { kind: 'sacrifice_cards', key: 'test_sacrifice', choosingSeat: 0, options: { title: '选择要牺牲的卡', label: '牺牲', remaining: 1, chosen: [] } },
    { kind: 'multi_player_pick', key: 'test_multi', choosingSeat: 0, options: { title: '选择每位玩家的一张牌', label: '确定', players: [1] } },
    { kind: 'branch', key: 'test_branch', choosingSeat: 0, options: { title: '选择分支', label: '确定', branches: [{ id: 'normal', label: '正常结算', enabled: true }, { id: 'alternative', label: '重掷骰子', enabled: false }] } },
    { kind: 'month_advance', key: 'test_month', choosingSeat: 0, options: { title: '季节轮前进/后退', label: '确定' } },
    { kind: 'energy_discard', key: 'test_discard', choosingSeat: 0, options: { title: '储备上限变为 7，请弃掉 2 个能量', amount: 2, available: { water: 3, air: 1, fire: 0, earth: 0 }, label: '弃掉' } },
    { kind: 'energy_swap', key: 'test_swap', choosingSeat: 0, options: { title: '储备区将超上限', amount: 2, total: 7, pool: 9, current: { water: 3, air: 2, fire: 1, earth: 1 }, incoming: { water: 2, air: 0, fire: 0, earth: 0 } } },
  ];
  for (const pending of synthetic) {
    const game = { ...modalView.game, pendingChoice: pending, myTurn: true };
    let html;
    try {
      html = renderToStaticMarkup(createElement(ChoiceModal, { game, mySeat: 0, onSend: () => {} }));
    } catch (error) {
      throw new Error(`ChoiceModal 渲染失败（${pending.kind}）：${error.message}`);
    }
    if (!html.includes('ss-inline-choice')) throw new Error(`ChoiceModal 输出缺少 ss-inline-choice（${pending.kind}）`);
    renders += 1;
    pendingSeen.add(pending.kind);
  }

  durs.sort((a, b) => a - b);
  // 术语浮层里的骰面图例（F10.1）：SSR 直接渲染一次，确认图例与说明都在。
  const glossaryMod = await server.ssrLoadModule('/src/games/seasons/Glossary.tsx');
  const Glossary = glossaryMod.Glossary;
  const glossaryHtml = renderToStaticMarkup(createElement(Glossary, { onClose: () => {} }));
  renders += 1;
  for (const marker of ['骰面符号', '召唤等级 +1', '外圈描边', '底部小点']) {
    if (!glossaryHtml.includes(marker)) throw new Error(`术语浮层缺少 ${marker}`);
  }

  const avg = durs.reduce((sum, value) => sum + value, 0) / Math.max(1, durs.length);
  const p95 = durs[Math.floor(durs.length * 0.95)] ?? 0;
  if (avg > 6) {
    throw new Error(`SSR 单次渲染平均 ${avg.toFixed(2)}ms，超过 6ms 预算（本地 SSR 基线约 3ms）`);
  }
  console.log(`SSR 渲染耗时：平均 ${avg.toFixed(3)}ms，p95 ${p95.toFixed(3)}ms，样本 ${durs.length}`);
  console.log(`OK 渲染冒烟：${renders} 次渲染，覆盖弹窗 ${[...pendingSeen].sort().join('/') || '无'}`);
  if (warnings.length > 0) {
    console.error(`注意：React 输出 ${warnings.length} 条 console.error（可能是 key 警告）：`);
    for (const warning of warnings.slice(0, 5)) console.error(`  - ${warning.slice(0, 300)}`);
  }
} finally {
  console.error = originalError;
  await server.close();
}
