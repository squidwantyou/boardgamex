import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { seasons } from '../apps/server/dist/games/seasons/engine.js';
import { createRng } from '../apps/server/dist/random.js';
import { CARD_BY_ID } from '../packages/protocol/dist/games/seasons-cards-all.js';
import { ELEMENTS } from '../packages/protocol/dist/games/seasons.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const origin = process.env.SEASONS_ORIGIN ?? 'http://127.0.0.1:5174';
const output = path.join(root, '.local/qa');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const other = await browser.newContext();
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
const api = async (context, endpoint, data) => {
  const response = data === undefined
    ? await context.request.get(`${origin}/bgx/api${endpoint}`)
    : await context.request.post(`${origin}/bgx/api${endpoint}`, { data });
  assert(response.ok(), `${endpoint}: ${response.status()}`);
  return response.json();
};
let room;
const evidence = [];
try {
  await api(context, '/me'); await api(other, '/me');
  room = (await api(context, '/matches', { gameId: 'seasons', visibility: 'private',
    options: { extensions: ['base', 'ext1', 'ext2'] } })).match.id;
  await api(other, `/matches/${room}/join`, {});
  await api(context, `/matches/${room}/start`, {});
  await page.goto(`${origin}/bgx/m/${room}`);
  const peer = await other.newPage();
  await peer.goto(`${origin}/bgx/m/${room}`);
  await page.waitForSelector('.ss-hand-track .ss-card');
  assert.equal(await page.locator('.ss-hand-track .ss-card').count(), 9);
  assert.equal(await page.locator('.ss-dice-panel .ss-die').count(), 0);
  await page.screenshot({ path: path.join(output, 'draft-1440.png'), fullPage: true });
  for (let round = 0; round < 9; round++) {
    await page.locator('.ss-hand-track > .ss-card-wrap .ss-card').first().click();
    await peer.locator('.ss-hand-track > .ss-card-wrap .ss-card').first().click();
    await page.waitForTimeout(80);
  }
  // A drafted Twist is a private replacement decision before organizing.
  for (let attempt = 0; attempt < 4; attempt++) for (const p of [page, peer]) {
    const replacement = p.locator('.ss-inline-choice:has-text("天命不凡")');
    if (await replacement.count()) {
      await replacement.locator('.ss-card').first().click();
      await replacement.getByRole('button', { name: '保留', exact: true }).click();
      await p.waitForTimeout(80);
    }
  }
  for (let year = 0; year < 2; year++) for (const p of [page, peer]) {
    for (let index = 0; index < 3; index++) await p.locator('.ss-hand-track > .ss-card-wrap .ss-card').nth(index).click();
    await p.getByRole('button', { name: '确认分组', exact: true }).click();
    await p.waitForTimeout(80);
  }
  await page.locator('.ss-table-status').filter({ hasText: '冬季' }).waitFor();
  assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('bgx-fullbleed')), true);
  await page.screenshot({ path: path.join(output, 'play-1440.png'), fullPage: true });
  const snapshot = await page.locator('.ss-shell').evaluate((el) => {
    let fiber = el[Object.keys(el).find((key) => key.startsWith('__reactFiber$'))];
    while (fiber && !fiber.memoizedProps?.view?.game) fiber = fiber.return;
    return fiber.memoizedProps.view;
  });
  evidence.push('two-player draft, organize confirmation, real websocket play screen');
  await page.reload();
  await page.locator('.ss-shell').waitFor();
  const restored = await page.locator('.ss-shell').evaluate((el) => {
    let fiber = el[Object.keys(el).find((key) => key.startsWith('__reactFiber$'))];
    while (fiber && !fiber.memoizedProps?.view?.game) fiber = fiber.return;
    return fiber.memoizedProps.view;
  });
  assert.equal(restored.seq, snapshot.seq);
  assert.equal(restored.game.phase, 'play');
  const observerContext = await browser.newContext();
  await api(observerContext, '/me');
  const observer = await observerContext.newPage();
  observer.on('pageerror', (error) => errors.push(error.message));
  await observer.goto(`${origin}/bgx/m/${room}`);
  await observer.locator('.ss-shell').waitFor();
  const observed = await observer.locator('.ss-shell').evaluate((el) => {
    let fiber = el[Object.keys(el).find((key) => key.startsWith('__reactFiber$'))];
    while (fiber && !fiber.memoizedProps?.view?.game) fiber = fiber.return;
    return fiber.memoizedProps.view;
  });
  assert(observed.game.players.every((p) => p.hand === null && p.library2 === null && p.library3 === null));
  assert.equal(await observer.getByRole('checkbox', { name: '跟随当前玩家' }).count(), 1);
  evidence.push('refresh/reconnect preserves seat and sequence; independent spectator receives no private hands or libraries');
  const fixture = structuredClone(snapshot);
  fixture.game.turnOwner = 0; fixture.game.myTurn = true; fixture.game.pendingChoice = null;
  const me = fixture.game.players[0];
  me.hand = Array.from({ length: 10 }, (_, i) => ({ i: i + 1, u: 1000 + i }));
  me.handCount = 10; me.played = Array.from({ length: 21 }, (_, i) => ({ i: i + 1, u: 2000 + i }));
  me.gauge = 24; me.energies = { water: 3, air: 2, earth: 2, fire: 2 }; me.maxEnergy = 10;
  me.crystals = 123; me.library2 = [{ i: 58, u: 3058 }, { i: 68, u: 3068 }, { i: 78, u: 3078 }]; me.library2Count = 3;
  const stress = await context.newPage();
  stress.on('pageerror', (error) => errors.push(error.message));
  await stress.goto(`${origin}/bgx/`);
  const mount = async (view) => {
    await stress.evaluate(async (view) => {
      const React = (await import('/bgx/node_modules/.vite/deps/react.js')).default;
      const dom = (await import('/bgx/node_modules/.vite/deps/react-dom_client.js')).default;
      const { SeasonsPanel } = await import('/bgx/src/games/seasons/Panel.tsx');
      if (!window.qaRoot) {
        const el = document.createElement('div'); document.body.append(el);
        document.getElementById('root').style.display = 'none';
        document.body.classList.add('bgx-fullbleed');
        window.qaRoot = dom.createRoot(el);
      }
      window.qaActions = [];
      window.qaRoot.render(React.createElement(SeasonsPanel, {
        key: `${view.seq}-${view.game.pendingChoice?.key ?? ''}-${window.qaMount = (window.qaMount ?? 0) + 1}`,
        view, mySeat: 0, disabled: false, onAction: (action) => window.qaActions.push(action),
      }));
    }, view);
    await stress.waitForTimeout(100);
  };
  for (const width of [1280, 1440, 1920, 390, 360]) {
    await stress.setViewportSize({ width, height: width < 600 ? 844 : 1080 });
    await mount(fixture);
    const boxes = await stress.evaluate(() => {
      const rect = (el) => el.getBoundingClientRect().toJSON();
      return {
        width: innerWidth, scroll: document.documentElement.scrollWidth,
        hand: [...document.querySelectorAll('.ss-hand-track > .ss-card-wrap')].map(rect),
        field: [...document.querySelectorAll('.ss-player-row:first-child .ss-summon-slot')].map(rect),
        rows: [...document.querySelectorAll('.ss-player-row')].map(rect),
        empty: document.querySelectorAll('.ss-player-row:first-child .ss-summon-slot:not(.ss-summon-filled)').length,
      };
    });
    assert(boxes.scroll <= width, `horizontal overflow at ${width}: ${boxes.scroll}`);
    assert.equal(boxes.empty, 3);
    assert(boxes.rows[1].top >= boxes.field.at(-1).bottom, `field overlap at ${width}`);
    if (width >= 1280) {
      assert(boxes.hand.slice(0, 9).every((box) => box.y === boxes.hand[0].y));
      assert(boxes.hand[9].y > boxes.hand[0].y);
      assert(boxes.field.slice(0, 10).every((box) => box.y === boxes.field[0].y));
      assert(boxes.field[10].y > boxes.field[0].y);
    }
    await stress.screenshot({ path: path.join(output, `stress-${width}.png`), fullPage: true });
    evidence.push(`layout ${width}: no horizontal overflow, correct slots, no field overlap`);
  }
  await stress.setViewportSize({ width: 390, height: 844 });
  await mount(fixture);
  const card = stress.locator('.ss-hand-track .ss-card').first();
  await card.hover(); await stress.waitForTimeout(550);
  assert.equal(await stress.locator('.ss-inspect').count(), 0);
  await card.click({ button: 'right' });
  const detail = await stress.locator('.ss-inspect').boundingBox();
  assert(detail.x >= 8 && detail.x + detail.width <= 382 && detail.y >= 8 && detail.y + detail.height <= 836);
  await stress.keyboard.press('Escape');
  assert(await card.evaluate((el) => el === document.activeElement));
  await card.press('Shift+F10');
  assert.equal(await stress.locator('.ss-inspect').count(), 1);
  await stress.keyboard.press('Escape');
  const pointer = { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 20, clientY: 300 };
  await card.dispatchEvent('pointerdown', pointer); await stress.waitForTimeout(550);
  assert.equal(await stress.locator('.ss-inspect').count(), 1);
  await card.dispatchEvent('pointerup', pointer);
  await stress.keyboard.press('Escape');
  await card.dispatchEvent('click');
  assert.equal(await stress.locator('.ss-op-prompt').count(), 0, 'long press must suppress subsequent click');
  await card.dispatchEvent('pointerdown', pointer);
  await card.dispatchEvent('pointermove', { ...pointer, clientX: 40 }); await stress.waitForTimeout(550);
  assert.equal(await stress.locator('.ss-inspect').count(), 0);
  await card.dispatchEvent('pointerup', pointer);
  await card.dispatchEvent('click');
  assert.equal((await stress.evaluate(() => window.qaActions)).length, 0);
  assert.equal(await stress.locator('.ss-op-prompt').count(), 0, 'drag cancellation must suppress click');
  await card.dispatchEvent('pointerdown', pointer);
  await stress.locator('body').dispatchEvent('pointerdown', { ...pointer, pointerId: 2, isPrimary: false });
  await stress.waitForTimeout(550);
  assert.equal(await stress.locator('.ss-inspect').count(), 0);
  await card.dispatchEvent('pointerup', pointer);
  await card.dispatchEvent('click');
  assert.equal((await stress.evaluate(() => window.qaActions)).length, 0);
  assert.equal(await stress.locator('.ss-op-prompt').count(), 0, 'second touch must suppress click');
  await card.dispatchEvent('pointerdown', pointer);
  await stress.locator('body').dispatchEvent('scroll');
  await stress.waitForTimeout(550);
  assert.equal(await stress.locator('.ss-inspect').count(), 0);
  await card.dispatchEvent('pointerup', pointer);
  await card.dispatchEvent('click');
  assert.equal(await stress.locator('.ss-op-prompt').count(), 0, 'scroll cancellation must suppress click');
  evidence.push('no hover detail; right-click/keyboard/long-press; Escape focus restore; clamped portal; drag/second-finger cancellation');
  await stress.setViewportSize({ width: 1440, height: 1000 });
  const paymentFixture = structuredClone(fixture);
  paymentFixture.seq += 10;
  paymentFixture.game.players[0].played.find((card) => card.i === 4).stored = { water: 2 };
  paymentFixture.game.pendingChoice = { key: 'estorian_harp', kind: 'element_pick', choosingSeat: 0,
    options: { amount: 2, title: '竖琴支付', label: '支付', mode: 'pay' } };
  await mount(paymentFixture);
  assert(await stress.getByRole('button', { name: '支付', exact: true }).isDisabled());
  await stress.locator('.ss-card-sources button').nth(0).click();
  await stress.locator('.ss-card-sources button').nth(1).click();
  await stress.getByRole('button', { name: '支付', exact: true }).click();
  const paid = await stress.evaluate(() => window.qaActions.at(-1).choice.paidSources);
  assert.deepEqual(paid.map((source) => source.slot), [0, 1]);
  assert(paid.every((source) => source.source === 'card' && source.cardUid === 2003));
  const lockedFixture = structuredClone(paymentFixture);
  lockedFixture.seq++;
  lockedFixture.game.players[0].played.find((card) => card.i === 4).lockedBy = 999;
  await mount(lockedFixture);
  assert.equal(await stress.locator('.ss-card-sources button').count(), 0);
  evidence.push('inline payment requires exact selected token slots and excludes locked card sources');
  const automaticFixture = structuredClone(fixture);
  automaticFixture.seq += 15;
  automaticFixture.game.players[0].played = [];
  await mount(automaticFixture);
  await stress.locator('.ss-hand-track .ss-card').first().click();
  assert.deepEqual(await stress.evaluate(() => window.qaActions), [{ type: 'summon', cardUid: 1000 }]);
  assert.equal(await stress.locator('.ss-op-prompt').count(), 0);
  evidence.push('ordinary summon sends directly to server without a payment picker');
  const activationFixture = structuredClone(fixture);
  activationFixture.seq += 20;
  activationFixture.game.players[0].played = [{ i: 80, u: 8080 }, { i: 4, u: 8004, stored: { water: 1 } }];
  await mount(activationFixture);
  await stress.locator('.ss-player-row-me .ss-summon-filled .ss-card').first().click();
  await stress.locator('.ss-card-sources button').first().click();
  await stress.getByRole('button', { name: '确认', exact: true }).click();
  assert.deepEqual(await stress.evaluate(() => window.qaActions.at(-1)), {
    type: 'activate', cardUid: 8080, paidSources: [{ source: 'card', element: 'water', cardUid: 8004, slot: 0 }],
  });
  await mount({ ...fixture, seq: fixture.seq + 30 });
  await stress.locator('.ss-player-row-me').getByRole('button', { name: '查看第 2 年手牌' }).click();
  const library = stress.locator('.ss-year-overlay .ss-card');
  assert.equal(await library.count(), 3);
  await library.first().click({ force: true });
  assert.equal((await stress.evaluate(() => window.qaActions)).length, 0);
  await library.first().click({ button: 'right', force: true });
  assert.equal(await stress.locator('.ss-inspect').count(), 1);
  await stress.keyboard.press('Escape');
  const drawFixture = structuredClone(fixture);
  drawFixture.seq += 40;
  drawFixture.game.pendingChoice = { kind: 'card_list', key: 'die_draw', choosingSeat: 0,
    options: { cards: [{ i: 20, u: 9020 }, { i: 21, u: 9021 }], keep: 1, title: '骰面抽牌' } };
  drawFixture.game.dice[0].pickedBy = 0;
  drawFixture.game.dice[0].rewards.card = true;
  await mount(drawFixture);
  assert.equal(await stress.locator('.ss-draw-candidates .ss-card').count(), 2);
  assert(await stress.locator('.ss-player-row-me [data-badge="4"]').isEnabled());
  await stress.locator('.ss-hand-track > .ss-card-wrap .ss-card').first().click({ force: true });
  assert(await stress.getByRole('button', { name: '保留此牌', exact: true }).isDisabled());
  await stress.locator('.ss-draw-candidates .ss-card').first().click();
  await stress.locator('.ss-hand-track > .ss-card-wrap .ss-card').last().click({ force: true });
  await stress.getByRole('button', { name: '保留此牌', exact: true }).click();
  assert.deepEqual(await stress.evaluate(() => window.qaActions.at(-1)), { type: 'resolve-choice', choice: [9020] });
  evidence.push('fixed activation selects source; future libraries inspect but never summon; die draw candidates keep one inline');
  const overflowFixture = structuredClone(fixture);
  overflowFixture.seq += 50;
  overflowFixture.game.players[0].energies = { water: 7, fire: 0, air: 0, earth: 0 };
  overflowFixture.game.players[0].maxEnergy = 7;
  overflowFixture.game.pendingChoice = { kind: 'energy_swap', key: 'energy_swap', choosingSeat: 0,
    options: { title: '储备区超上限：弃置 2 个元素', total: 7, pool: 9, discardAmount: 2,
      current: { water: 7 }, incoming: { fire: 2 } } };
  for (const width of [1440, 390]) {
    await stress.setViewportSize({ width, height: 1000 });
    await mount(overflowFixture);
    assert.equal(await stress.locator('.ss-player-row-me .ss-reserve button').count(), 9);
    assert.equal(await stress.locator('.ss-card-sources').count(), 0);
    await stress.getByRole('button', { name: '储备火元素 1', exact: true }).click();
    await stress.getByRole('button', { name: '储备火元素 2', exact: true }).click();
    await stress.getByRole('button', { name: '弃置所选', exact: true }).click();
    assert.deepEqual(await stress.evaluate(() => window.qaActions.at(-1).choice.discard),
      { water: 0, air: 0, fire: 2, earth: 0 });
    assert.equal(await stress.locator('.ss-inline-choice button').count(), 1);
    await stress.screenshot({ path: path.join(output, `overflow-discard-${width}.png`), fullPage: true });
  }
  const gainFixture = structuredClone(overflowFixture);
  gainFixture.seq++;
  gainFixture.game.pendingChoice = { kind: 'element_alloc', key: 'amulet_energy', choosingSeat: 0,
    options: { title: '获得元素', amount: 2, target: 'reserve' } };
  await mount(gainFixture);
  assert.equal(await stress.locator('.ss-alloc-row').count(), 4);
  assert(await stress.locator('.ss-alloc-row img').evaluateAll((images) => images.every((image) =>
    image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width >= 20)));
  assert(await stress.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await stress.screenshot({ path: path.join(output, 'gain-icons-390.png'), fullPage: true });
  evidence.push('overflow selects discarded tokens in reserve, including new gains; four gain icons render at desktop/mobile');

  await stress.setViewportSize({ width: 1440, height: 1000 });
  const names = { water: '水', air: '风', fire: '火', earth: '土' };
  const rng = createRng('browser-payments');
  const ctx = { now: 0, rng };
  for (const count of [2, 3, 4]) {
    const base = seasons.setup(count, { extensions: ['base', 'ext1', 'ext2'] }, rng);
    for (let id = 1; id <= 90; id++) {
      const state = { ...structuredClone(base), phase: 'play', turnOwner: 0, currentPicker: 0,
        pendingChoice: null, pendingCards: null, pendingQueue: [], dicePicked: [0],
        players: base.players.map((player, seat) => ({ ...structuredClone(player),
          hand: [{ i: id, u: 10000 + id }], played: seat === 0
            ? [{ i: 4, u: 7004, stored: { water: 2, air: 2, fire: 2, earth: 2 } }] : [],
          gauge: 40, crystals: 100, maxEnergy: 100, activatedThisTurn: [], cardMarks: {},
          energies: { water: 10, air: 10, fire: 10, earth: 10 } })) };
      const view = { ...snapshot, seq: 1000 + count * 100 + id, game: seasons.view(state, 0, true) };
      await mount(view);
      await stress.locator('.ss-hand-track .ss-card').first().click();
      const def = CARD_BY_ID.get(id);
      const cost = { ...def.cost, ...def.costByPlayers?.[String(count)] };
      const tokens = def.costFlexible ? ['water'] : ELEMENTS.flatMap((element) => Array(cost[element]).fill(element));
      const slots = {};
      for (const element of tokens) {
        const slot = slots[element] = (slots[element] ?? 0) + 1;
        await stress.locator('.ss-player-row-me').getByRole('button',
          { name: `储备${names[element]}元素 ${slot}`, exact: true }).click();
      }
      if (tokens.length) {
        const confirm = stress.getByRole('button', { name: '确认', exact: true });
        assert(await confirm.isEnabled(), `${count} players #${id}: correct tokens should enable confirmation`);
        await confirm.click();
      } else assert.equal(await stress.locator('.ss-op-prompt').count(), 0);
      const action = await stress.evaluate(() => window.qaActions.at(-1));
      const result = seasons.reduce(state, 0, action, ctx);
      assert(result.ok, `${count} players #${id}: ${JSON.stringify(action)} -> ${result.code}: ${result.message}`);
    }
  }
  evidence.push('270 browser-to-engine summons: all 90 cards at 2/3/4 players accept clicked tokens or automatic zero-element payments');
  let actionCase = 0;
  const readyState = (played, hand = []) => {
    const base = seasons.setup(2, { extensions: ['base', 'ext1', 'ext2'] }, rng);
    return { ...base, phase: 'play', turnOwner: 0, currentPicker: 0,
      pendingChoice: null, pendingCards: null, pendingQueue: [], dicePicked: [0],
      players: base.players.map((player, seat) => ({ ...player, hand: seat === 0 ? hand : [],
        played: seat === 0 ? played : [], gauge: 40, crystals: 100, maxEnergy: 100,
        activatedThisTurn: [], cardMarks: {}, energies: { water: 1, air: 1, fire: 1, earth: 1 } })) };
  };
  const showState = (state) => mount({ ...snapshot, seq: 2000 + actionCase++, game: seasons.view(state, 0, true) });
  const applyClick = async (state) => {
    const action = await stress.evaluate(() => window.qaActions.at(-1));
    assert(action, 'UI must send an action');
    const result = seasons.reduce(state, 0, action, ctx);
    assert(result.ok, `${JSON.stringify(action)}: ${result.code}: ${result.message}`);
    return result.state;
  };
  for (const id of [7, 22]) {
    let automatic = readyState([{ i: 20, u: 7020 }, { i: 78, u: 7078 },
      { i: 4, u: 7004, stored: { water: 1 } }], [{ i: id, u: 8000 + id }]);
    await showState(automatic);
    await stress.locator('.ss-hand-track .ss-card').click();
    assert.equal(await stress.locator('.ss-op-prompt').count(), 0);
    automatic = await applyClick(automatic);
    assert(automatic.players[0].played.some((card) => card.u === 8000 + id));
  }
  let special = readyState([{ i: 20, u: 7020 }, { i: 78, u: 7078 }, { i: 4, u: 7004, stored: { water: 1 } }],
    [{ i: 18, u: 8018 }]);
  await showState(special);
  await stress.locator('.ss-hand-track .ss-card').click();
  await stress.locator('.ss-player-row-me').getByRole('button', { name: '储备火元素 1', exact: true }).click();
  await stress.getByRole('button', { name: '确认', exact: true }).click();
  special = await applyClick(special);
  assert(special.players[0].played.some((card) => card.u === 8018));
  assert.equal(special.players[0].energies.fire, 0);

  special = readyState([{ i: 47, u: 7047 }, { i: 4, u: 7004, stored: { water: 1 } }]);
  await showState(special);
  await stress.locator('.ss-player-row-me .ss-summon-filled .ss-card').first().click();
  special = await applyClick(special);
  await showState(special);
  await stress.locator('.ss-player-row-me').getByRole('button', { name: '储备水元素 1', exact: true }).click();
  await stress.locator('.ss-card-sources button').click();
  assert.equal(await stress.locator('.ss-inline-choice button').count(), 1);
  await stress.getByRole('button', { name: '确认', exact: true }).click();
  special = await applyClick(special);
  assert.equal(special.pendingChoice.options.step, 'target');
  await showState(special);
  await stress.locator('.ss-inline-choice').getByRole('button', { name: '风', exact: true }).click();
  special = await applyClick(special);
  assert.equal(special.players[0].energies.water, 0);
  assert.equal(special.players[0].energies.air, 3);
  assert.equal(special.players[0].played[1].stored.water, 0);
  assert.equal(special.players[0].crystals, 98);

  special = readyState([{ i: 26, u: 7026 }, { i: 4, u: 7004, stored: { water: 1 } }]);
  await showState(special);
  await stress.locator('.ss-player-row-me .ss-summon-filled .ss-card').first().click();
  special = await applyClick(special);
  await showState(special);
  await stress.locator('.ss-player-row-me').getByRole('button', { name: '储备水元素 1', exact: true }).click();
  assert.equal(await stress.locator('.ss-player-row-me .ss-slot-selected').count(), 1);
  assert(await stress.getByRole('button', { name: '转换', exact: true }).isDisabled());
  await stress.locator('.ss-card-sources button').click();
  for (const element of ['风', '火', '土']) {
    await stress.locator('.ss-player-row-me').getByRole('button', { name: `储备${element}元素 1`, exact: true }).click();
  }
  assert.equal(await stress.locator('.ss-player-row-me .ss-slot-selected').count(), 5);
  assert.equal(await stress.locator('.ss-inline-choice button').count(), 1);
  await stress.getByRole('button', { name: '转换', exact: true }).click();
  special = await applyClick(special);
  assert.equal(special.players[0].energies.water, 0);
  assert.equal(special.players[0].energies.air, 0);
  assert.equal(special.players[0].crystals, 120);

  special = readyState([{ i: 78, u: 7078 }, { i: 4, u: 7004, stored: { water: 1 } }]);
  special.players[0].canTransmute = true;
  await showState(special);
  await stress.getByRole('button', { name: '晶化', exact: true }).click();
  await stress.locator('.ss-card-sources button').click();
  await stress.getByRole('button', { name: '确认', exact: true }).click();
  special = await applyClick(special);
  assert.equal(special.players[0].energies.water, 1);
  assert.equal(special.players[0].played[1].stored.water, 0);
  assert.equal(special.players[0].crystals, 103);
  evidence.push('cost reduction + Winter Staff, Mirror, Life Potion and crystallization: full browser-to-engine chains use exact reserve/card tokens');
  for (const id of [24, 74]) {
    special = readyState([{ i: id, u: 7000 + id }, { i: 4, u: 7004, stored: { water: 1 } }],
      [{ i: 29, u: 8029 }]);
    await showState(special);
    await stress.locator('.ss-player-row-me .ss-summon-filled .ss-card').first().click();
    special = await applyClick(special);
    if (id === 74) {
      await showState(special);
      await stress.locator('.ss-inline-choice').getByRole('button', { name: /晶化.*4/ }).click();
      special = await applyClick(special);
    }
    await showState(special);
    assert.equal(await stress.locator('.ss-card-sources').count(), 0);
    for (const element of ['水', '风', '火', '土']) {
      await stress.locator('.ss-player-row-me').getByRole('button', { name: `储备${element}元素 1`, exact: true }).click();
    }
    await stress.locator('.ss-inline-choice').getByRole('button', { name: id === 24 ? '支付' : '晶化', exact: true }).click();
    special = await applyClick(special);
    assert.deepEqual(special.players[0].energies, { water: 0, air: 0, fire: 0, earth: 0 });
    assert.equal(special.players[0].played.find((card) => card.i === 4).stored.water, 1);
    assert.equal(special.players[0].crystals, id === 24 ? 100 : 116);
    assert.equal(special.pendingChoice.key, id === 24 ? 'potion_dreams' : 'potion_of_the_ancients');
  }
  evidence.push('Dreams and Ancient potion full-reserve payments select actual reserve slots and preserve non-reserve tokens');
  const otherGame = (await api(context, '/matches', { gameId: 'reversi', visibility: 'private', options: {} })).match.id;
  await page.goto(`${origin}/bgx/m/${otherGame}`);
  await page.waitForTimeout(250);
  assert.equal(await page.locator('body.bgx-fullbleed').count(), 0);
  await page.goto(`${origin}/bgx/m/nonexistent-seasons-qa`);
  await page.waitForTimeout(250);
  assert.equal(await page.locator('body.bgx-fullbleed').count(), 0);
  evidence.push('Seasons full-bleed styles do not affect another game lobby or a missing-room page');
  const loaded = await stress.locator('.ss-card img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0));
  assert(loaded, 'all rendered card assets load');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'browser-report.json'), JSON.stringify({ room, evidence, errors }, null, 2));
  console.log(JSON.stringify({ room, passed: evidence.length, evidence, errors }, null, 2));
} finally {
  await browser.close();
}
