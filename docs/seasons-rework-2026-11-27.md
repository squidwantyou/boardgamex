# Seasons Local Rework

Accepted on 2026-11-27, Asia/Shanghai. Delivery branch: `Angel-develop`
in `squidwantyou/bgx_seasons`. No deployment or merge to main is authorized.

## Baseline and Integration

- Latest boardgamex main: `70e55da4da459fbbb44f0c5dc9bc04bf3ace2d95`.
- Latest bgx_seasons main: `1fbee84e133ebeb1e4d880f00d9d3ce001ba6d86`.
- Common ancestor: `ed00523f5285c0d4b9d66ba0d4162edef32df53d`.
- Target: `Work/seasons-gpt`, branch `Angel-develop`.
- After acceptance, the user requested deletion of all other Work contents,
  without backups. The accepted tree now has standalone Git metadata and
  locally installed dependencies; it no longer depends on other Work trees.
- Historical local requirements were compared against both remote trees. Latest
  remote behavior was retained where it already fulfilled the requirement.
- Remote base-card fixes, corrected winter die faces, special pools, card
  sorting, log filters, spectator following and score breakdowns remain.
- The accepted code is published only on the delivery branch. Main receives
  `TO_DS.md` only. No deployment, old database rewrite or saved-card-ID migration.

## Requirements and Evidence

| Area | Implemented outcome | Evidence |
| --- | --- | --- |
| Table | Wheel left, dice/selected draft center, full-height log right; full-width open hand above player rows; own row first | Five populated responsive screenshots |
| Hand/field | Nine complete desktop hand cards, tenth wraps; ten field cards per desktop row; at least two-row field height; exact gauge empties, over-gauge cards retained | Browser geometry assertions at 1280/1440/1920/390/360 |
| Player panel | Single left identity, crystals/printed points, chosen die, actual capacity/token slots, gauge, hand count, 2x2 badges, independent II/III libraries | Browser fixtures and real room |
| Actions | Ordinary summons pay automatically; meaningful cost/source choices and all other reserve payments use actual token slots; locked/sealed sources excluded | 270 browser-to-engine summons and full activation chains |
| Details | No hover popup; right-click, ContextMenu/Shift-F10, touch long-press; clamped portal, Escape/focus restore, drag/scroll/second-touch cancellation | Browser interaction assertions |
| Private choices | Draw candidates at the hand's left, keep-one/discard-all; old hand cards never selectable; badge 4 only upgrades the current private die draw; future libraries inspect but cannot summon | Browser fixtures and protocol tests |
| Badges | Shared three-use quota; exchange 2 for 2; crystallization access plus stacking bonus for this action round; gauge +1; draw-two-keep-one | Engine tests |
| Draft | Selected-card display without dice, grouped year previews, reset and explicit confirmation | Two independent browser clients |
| Logs/results | Descending stable sequence, Chinese workbook names and nicknames, filters retained, score breakdown retained | Browser and engine checks |
| Assets | 90 mapped table/detail faces, narrow Chinese title labels, visible energy images, real badge/year images, calibrated wheel markers, all 120 dice faces, separate generated Replica | Hashes plus table/detail pixel comparison |
| Rules | Base 50 + expansion 20 + expansion 20; ordinary 100/140/140/180 decks; retained special pools; Replica 222 never drafted | Pool and per-card tests |
| Isolation | `rulesVersion: seasons-90-v2`; fresh isolated local database; other games and missing-room pages retain normal layout | Browser navigation, reconnect and observer assertions |

## Rule Corrections

The user's local sixth-revision bilingual workbook is authoritative for costs,
points and effects. No cost or rule is inferred from image colors or BGA data.
Source: `docs/reference/四季中英文对照牌表 带效果(第六次修订).xlsx`, sheet `全卡卡表`.
Base cards are rows 50:99, expansion 1 rows 29:48 and expansion 2 rows 8:27.
Columns E:H are Air/Fire/Earth/Water, I crystals and J points.
Workbook SHA-256:
`c3ff5198f11ea027235c33fa51e4371d1ea96ee0aa107114de4bc4697cf8e874`.

The workbook was read directly with local Node using ZIP/XML parsers, without
editing it. All 90 identities and 270 player-count costs were compared.
`card-workbook.test.ts` records the independent expected costs and printed points.
This replaced an incorrect image-based oracle: 33 cards had wrong costs,
including swapped Air/Fire and Chrono-Ring's Water and 2/1/0 crystal scaling.
Twist of Fate's "/" printed score remains nonnumeric in the source, rather than
being invented. The companion local bug-explanation workbook was also inspected.

Behavior corrections include:

- Balance uses three identical energy for nine crystals; insufficient activation
  rejects atomically. Its summon cost is the workbook's two crystals.
- Lewis chooses an actual opponent and copies the complete reserve, not a
  player-chosen partial amount. Life Potion converts all spendable reserve
  energy, not selected types only. Fountain pays the latest workbook's three
  crystals. D12 changed from two to three during this work; the final check
  adopted that update, with no other nonempty cell values changed.
- Naria distributes one chosen card to every actual opponent; Chest checks at
  common round end; Kriss accepts hand or field familiars; Titus checks all
  opponents before charging, and Fairies steals one plus one additional crystal.
- Water Amulet energy remains spendable; sealed Cauldron/Jewel/Heart/Chalice
  energy cannot pay unrelated costs. Grimoire capacity is a single shared +3,
  including copied, locked, returned and sacrificed instances.
- Round-end effects wait until every player has finished, then resolve in
  starting-player order before month advancement. Each subsequent effect checks
  current resources after earlier choices. Multiple mandatory payments cannot
  create phantom energy choices; Heart returns before Chest; Carnivora/Beggar's
  Horn can become eligible after a later payment.
- Raven copies effects/costs but keeps its familiar category, original printed
  points and identity when leaving. Multiple lock sources persist until the
  last source leaves; locking a copied Grimoire suspends only its actual capacity
  contribution. Locked passive dice rerolls are suppressed.
- Cage interrupts normal/free/generated entry before effects; alternate
  sacrifice resumes exactly once. Chalice draws exactly four, including when
  the Chalice itself consumes the last summon slot.
- Winter Staff substitutions retain actual token identities. Minion blocks each
  crystal gain without refunding fees or undoing losses. Harp/Jewel reject
  insufficient matching tokens before opening a choice.
- Extension searches, discard ordering, top-of-deck operations, shield
  substitution, leftover-die rerolls, cumulative Chrono-Ring movement, Otus
  public pool and generated Replica supply have dedicated regression coverage.
- Magma Core's fixed Fire reward is automatic; overflow is resolved before
  subsequent summon choices. Queued gains refresh their reserve snapshot rather
  than overwriting earlier gains. Overflow selects discarded tokens, including
  new tokens, never the retained majority.
- Dreams and Ancient potion full-reserve payments also use clicked reserve slots.
  Mirror preserves the exact selected reserve/card sources through target choice.
- Workbook rules are preserved: Magma Core costs 1/2/3 Fire, Warden discards four
  reserve energy, and Crown operates on the actual deck top.
- Vite resolves protocol imports to the shared source and excludes protocol
  prebundling. This prevents stale browser cost data disagreeing with the server.

## Verification

- `pnpm run build`: protocol, server and production web build.
- `pnpm --filter @bgx/server test`: 955 passing tests in nine files, including
  271 independent workbook assertions, the existing 160-test engine suite,
  all original card entries, every activatable card and targeted interactions.
- Complete 2/3/4-player three-year simulations cover both simple progression and
  actual paid summons/activations, unique instances, nonnegative resources,
  pending choices, year libraries and finite final scores.
- `node scripts/verify-seasons-assets.mjs`: 90 matching table/detail faces, hashes,
  120 dice, four badge markers, II/III markers and separate Replica.
- `node scripts/qa-seasons-browser.mjs`: 16 browser checks, two real players,
  independent spectator, refresh/reconnect, populated five-width geometry,
  detail gestures, 270 UI-to-engine summons, special cost reductions, Mirror,
  Life/Dreams/Ancient potion payments, crystallization, overflow, gain icons,
  readonly libraries, die draw controls and other-game/missing-room isolation.
  Browser errors must be empty.
- Local outputs are generated under `.local/`; old databases, logs and
  screenshots were deleted during the user-authorized cleanup.
- Tests exercise implemented behavior; they do not claim exhaustive proof of
  every possible 90-card combination.
- Packaging recheck after cleanup: the frozen lockfile install, production
  build, 955 server tests and read-only asset verification pass with independent
  project dependencies. The legacy `pnpm --filter @bgx/web smoke` still fails
  on its obsolete `ss-band-top` layout assertion. It is not a passing check and
  was not rewritten during this packaging-only handoff.

## Local Run

Open `http://127.0.0.1:5174/bgx/`.

`node scripts/start-seasons-local.mjs` starts backend 8787 and Vite 5174, using a
new `.local/seasons-v2/seasons-<timestamp>.db`. Existing databases are retained,
not automatically erased. `.local` databases, logs and screenshots are ignored
by Git. Set `SEASONS_DB_PATH` to restart with a selected existing isolated
database. After recompiling backend changes, restart this local launcher.

Install dependencies with `pnpm install --frozen-lockfile`, then build with
`pnpm run build`. QA dependencies Playwright and Sharp are declared in the root
package. Install the browser with `pnpm exec playwright install chromium` when
needed. Browser QA accepts `SEASONS_ORIGIN` and `CHROMIUM_PATH`. No dependency,
script or Git metadata references a deleted Work tree.

The authoritative workbooks, base/expansion rulebooks and source card atlas are
retained under `docs/reference/`. Asset verification is read-only and uses the
checked-in manifest; regenerating detail faces uses the retained atlas.

## Next Work

The user's eight post-acceptance requests are handed off in main's `TO_DS.md`.
They are future work, not fixes included in this accepted snapshot. Wait for the
user's specific development instruction; do not infer deployment permission from
the older `TO_GPT.md`.
