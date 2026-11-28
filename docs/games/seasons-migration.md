# Seasons（四季物语）迁移到 BGX —— 选型 / 路线图 / 进度

> 本文件是这次长期任务的**唯一事实来源**。每次开工先读它，收工必须更新它。
> 旧项目：`/home/squid/seasons_web/seasons-web`（只读参考，不改）
> 新位置：`/home/squid/DSH_workspace/bgx`

## 0. 状态速览

> 协作：与 GPT 协作者共同开发。对方文档 `TO_DS.md`，我的说明 `TO_GPT.md`（均在仓库根目录）。每轮开工先读 `TO_DS.md` 与 `docs/games/seasons-frontend-plan.md` §0/§5。

| 项 | 值 |
|---|---|
| 当前阶段 | Phase 6 交付整合完成（GPT `f47aa07` 已合入 main 并部署）：90 张卡（50 基础 + 20 + 20 扩展，按用户 Excel 修正 33 张费用）、新牌桌 UI、955 tests。用户 11-28 授权：合并/部署/决策不必等确认 |
| 当前任务 | 按试玩反馈与 H01–H08（弃牌堆隐藏、批量晶化、整页适配、看牌带图、望远镜拖动、他人抽牌选项隔离、元素护符进元素槽、卡图裁切）继续；F8.3b 逐步回放待后端快照方案；旧 50 卡 oracle/L1 降级为历史脚本 |
| 迷你版目标 | 3 个夜间时段（约 6 次运行）产出「2 人可完整打完一局」 |
| 完整版目标 | 之后约 1 周：基础 50 卡全量 + ext1/ext2 + 打磨 |
| 最后更新 | 2026-11-28 20:15 |

## 1. 目标与边界

### 迷你版（Day 1–3，必须达成）
- 2 人局，基础卡子集（Day1: 0 张 → Day2: 约 20 张 → Day3: 全流程 + 20 张）
- 完整 36 个月流程：选骰 → 召唤/激活/转化 → 结束回合 → 换季 → 结算
- 组牌（organize）阶段（每人从 9 张里分 3/3/3）
- 分数结算与 `rankings()`
- 2 人局可认输（判负）
- 前端可玩：牌桌、手牌、骰子、能量、水晶、召唤槽、弹窗选择

### 非目标（迷你版不做）
- 4 人局平衡性、扩展包、托管/AI、回放 UI、移动端细节打磨、音效

### 完整版（Day 4–10）
- 50 张基础卡全部效果 + 9 种触发时机
- ext1 魔法王国 / ext2 命运之路（各 20 张）
- 3–4 人局、观战视图、e2e 全覆盖、性能与体验打磨

## 2. 技术选型（已定）

| 决策点 | 选择 | 理由 | 否决的备选 |
|---|---|---|---|
| 接入方式 | BGX 三件套插件，**不改框架** | 框架已满足全部需求，改了会拖累上游 | fork 框架 |
| 随机 | **方案 B**：`setup` 里抽一次种子存 state，引擎内 mulberry32 + state 内 cursor | 快照/试算天然隔离；重放不依赖 seq；`ctx.rng` 一次不用 | A: `ctx.rng.fork()`（需改框架）；C: 随机 tape（有耗尽风险） |
| 认输 | 2 人局 `resignable=true`（resign → 对手胜）；3–4 人恒 `false` | 用户决定；多人局中途退出交给房主 `abortMatch` | 弃权名次 / 判负 |
| 语言 | TypeScript strict，规则层零 `any` | 判分/结算容易出错，类型能兜住 | JS |
| 校验 | 动作/选项外壳用 Zod（框架要求），规则内部**不用** Zod，返回 `{ok:false,code,message}` | 避免 67 处 throw 的写法 | 全量 zod |
| 状态模型 | 紧凑 JSON：卡牌实例只存 `{i, u}`（id/uid），定义与效果放引擎常量表 | 旧 state 86KB，目标 <15KB | 原样搬旧 state |
| 前端 | React 19 + TSX + 全局 `styles.css`，类名前缀 `ss-` | 与现有 rev/plane-bomb 一致 | 搬 1931 行 vanilla |
| 图标/资源 | PIL 批处理转 webp（保持原尺寸 455×634），放 `apps/web/src/assets/seasons/`，`import.meta.glob` 引用 | Vite `base=/bgx/` 下写死 `/assets/...` 会 404。已实测：PNG 378KB → webp 32KB，51 张约 1.6MB，全套约 2MB | public/ 直出 |
| 测试 | vitest 单测 + `node` e2e + 差分 oracle | 与 BGX 现有约定一致 | 搬 194KB 旧测试 |
| 移植方式 | **平移规则核心，重写骨架**：旧引擎当 oracle，不逐行照抄 | 50 个 bespoke handler 重写必漂移 | 从零重写 |

## 3. 文件清单（新）

```
packages/protocol/src/games/seasons.ts       catalog / action / view 类型 + zod
apps/server/src/games/seasons/
  index.ts          导出 plugin（meta/actionSchema/actionType/optionSchema/defaultOptions）
  engine.ts         setup / reduce / view / finished / winner / turn / resignable / rankings
  rules/const.ts    常量（季节/转换表/惩罚/张数）
  rules/random.ts   mulberry32 + randomAt(seed,cursor) + randInt(state)
  rules/dice.ts     四季骰子数据（从旧 dice.json 生成）+ 掷骰
  rules/draft.ts    选牌
  rules/organize.ts 组牌
  rules/play.ts     回合主循环（选骰/召唤/激活/转化/结束）
  rules/score.ts    终局结算
  cards/base.ts     50 张卡定义（从旧 cards.json 生成，勿手改）
  cards/effects.ts  效果 handler 注册表（Phase 2 起逐步补）
  cards/abilities.ts 被动能力（费用减免/储能/槽位）
  engine.test.ts
apps/web/src/games/seasons/
  index.tsx         plugin 导出
  Panel.tsx         牌桌
  parts/*.tsx       骰子/手牌/卡牌/弹窗
  art.ts            卡图/骰面/元素图标（import.meta.glob 映射）
  styles.css        局部样式（import 到 index.tsx）
apps/web/src/assets/seasons/   卡图与骰子（webp，由 scripts/build-seasons-assets.py 生成）
apps/web/scripts/build-seasons-assets.py  PIL 转换脚本（旧项目只读）
```

## 4. 状态模型 v1（已落地，2026-11-21）

```ts
type Element = 'water' | 'air' | 'fire' | 'earth';   // 旧数据全用全名，直接对齐
type CardRef = { i: number; u: number };             // 定义 id + 实例 uid(1..100)
interface Player {
  seat: number;
  hand: CardRef[]; library2: CardRef[]; library3: CardRef[];
  played: { i: number; u: number; stored?: Partial<Record<Element, number>>; paid?: Element[] }[];
  energies: Record<Element, number>;
  crystals: number; gauge: number; maxEnergy: number;
  badgesUsed: number; badgeDrawUpgrade: boolean;
  draftHand: CardRef[]; drafted: CardRef[];
  organizeYear1: number[]; organizeYear2: number[]; organizeDone: boolean;
  canTransmute: boolean;
  activatedThisTurn: string[];                       // "<uid>:<abilityKey>"
}
interface State {
  version: 1;
  rngSeed: number; rngCursor: number;
  phase: 'draft' | 'organize' | 'play' | 'ended';
  draftRound: number;                                // 0–9
  players: Player[]; deck: CardRef[]; discard: CardRef[];
  month: number; year: number; seasonIdx: number;
  season: { index: number; dice: DieState[] } | null; // 每季 5 颗骰抽出「人数+1」颗已掷结果
  startPlayer: number; currentPicker: number | null; turnOwner: number | null;
  pickedThisSeason: number[];                        // 本月已行动完的座位
  dicePicked: number[];                              // 本月选骰顺序 = 行动顺序
  pendingChoice: { kind: string; key: string; choosingSeat: number; options: Record<string, unknown> } | null;
  result: ResultView | null; resignedSeat: number | null;
  log: { t: string; msg: string }[];                 // 仅事件摘要，上限 80（view 只给最近 30 条）
}
```
约束：一切随机走 `randInt(state, n)`；所有状态变更返回新对象（浅拷贝 + 必要深拷贝）；`view` 必须裁剪手牌与牌库。
与旧引擎的差异：uid 用整数 1..N（基础 100，含扩展最多 180；旧为 'c1' 字符串）；卡牌只存 `{i,u}`，效果按 `i` 查 `@bgx/protocol` 的合并卡表（`CARD_BY_ID`：基础 50 + ext1/ext2 各 20 种）；扩展包不写进 state，组牌时按 `options.extensions` 一次性决定牌堆。

## 5. 随机实现（方案 B 细节）

```ts
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// setup(playerCount, options, rng) 只取一次
const seed = rng.int(0x7fffffff);
// reduce 内
function randInt(state: S, n: number): [number, S]   // 返回新 state（cursor+1）
```
要点：**不存闭包**，只存 `rngSeed + rngCursor` 两个数字；这样 `structuredClone`/快照回滚自动隔离随机进度，dry-run 不会污染真实路径。洗牌用 Fisher–Yates，逐次 `randInt`。

落地细节（`rules/random.ts`）：`randomAt(seed, cursor)` 用 mulberry32 迭代 `cursor+1` 次取第 cursor 个值（纯函数、O(cursor)，单局总量 < 1000 次可忽略）；`shuffleWithSeed(items, seed, cursor)` 返回消耗后的 cursor；`randInt(state, n)` 返回 `[值, 新state]`。setup 用 `rng.int(0x7fffffff)` 取一次 seed，之后洗牌/掷骰全部走本地 cursor。

## 6. 认输与中止

- `resignable(state, seat)`: `state.phase !== 'ended' && state.players.length === 2`
- `reduce` 处理 `{type:'resign'}`：标记该 seat 认输 → `finished`，`winner` = 对手
- 3–4 人局：`resignable` 恒 false；玩家掉线/退出由房主 `abortMatch` 处理（框架已有 `aborted` 标记）
- `rankings(state)`：2 人局返回 `[{seat:w,rank:1},{seat:l,rank:2}]`

## 7. 差分 oracle 策略（关键质量保障）

不做"逐位比对"——两边随机调用顺序不同必然分叉。改为分层：

- **L1 单点比对（主力）**：构造固定 state（指定 rngSeed/cursor）+ 固定动作，分别跑旧引擎（`import` 旧 `src/games/seasons/index.js`）与新引擎，比对**归约后的状态**（能量/水晶/槽位/手牌 id 集合/牌库张数/月数/阶段）。覆盖：每个 action 的合法与非法分支、每张卡的各触发时机。
- **L2 整局冒烟**：同种子跑 N 局随机对局，只校验**不变式**：卡牌总数守恒、能量非负、gauge ≤ 上限、month 单调、终局分数公式、无死锁（连续 N 步无进展即失败）。
- 旧引擎的 `Math.random` 通过全局替换成可注入 PRNG 来外部控制（旧代码只有 `index.js:125 roll` 与 `effects.js:508 shuffle` 两处）。
- oracle 脚本放 `apps/server/scripts/oracle-seasons.mjs`，不进 CI（会 import 外部路径），但每次改规则后手动跑。

## 8. 路线图

### Phase 1 — 骨架与前半局（Day 1，夜间 4 个时段）—— ✅ 2026-11-21 完成
- T1.1 protocol 类型 + zod schema（11 动作 + resign）与 catalog（选项：扩展包 multi，先只声明 base）
- T1.2 引擎骨架：`setup`（洗牌/发牌/抽种子）+ `view`（裁剪）+ `finished/winner/turn/resignable`
- T1.3 选牌阶段 `draft-pick` + 左右手轮转
- T1.4 组牌阶段 `organize`（两步 3/3/3）+ `organize-reset`
- T1.5 引擎单测：setup/draft/organize/view 裁剪

### Phase 2 — 主循环与计分（Day 2）
- T2.1 骰子定义与 `draft-dice`（选骰、掷骰、重掷钩子留空）
- T2.2 `summon`：费用、槽位、召唤时触发、能量结算
- T2.3 `activate` 与 `transmute`
- T2.4 `end-turn` + 换月/换季 + 年终收入
- T2.5 终局 `score` + `rankings`
- T2.6 首批 20 张卡效果（优先无 choice 的简单卡）
- T2.7 单测：一局 2 人自动打完（脚本驱动）

### Phase 3 — 前端与端到端（Day 3）
- T3.1 资源管线：PIL 转 webp + `import.meta.glob` 映射
- T3.2 Panel：牌桌布局（季节/月/骰池/对手/自己/日志）
- T3.3 交互：选牌/组牌/选骰/出牌/支付/结束回合
- T3.4 弹窗选择组件（先支持 4 种最常用 choice kind）
- T3.5 `headline/statusLine/eventMessage` + 结果页
- T3.6 e2e：两个游客跑完一局

### Phase 4 — 补全与打磨（Day 4–10）
- T4.1 剩余 30 张基础卡 + 全部 14 种 choice kind
- T4.2 ext1/ext2 40 张卡与选项接线
- T4.3 3–4 人局适配（组牌/选骰/计分人数分支）
- T4.4 观战视图、断线重连验证
- T4.5 性能：state 体积、广播频率、view 计算
- T4.6 L1 oracle 全量跑通 + L2 200 局冒烟
- T4.7 移动端与视觉打磨、部署验证

## 9. 进度看板

### Phase 6 交付整合（GPT `f47aa07`）
- [x] T6.1 在本地分支 `integrate-f47aa07` 演练整合：955 tests、三包构建、smoke 改写、素材哈希校验
- [x] T6.2 合入 main、部署（入口 `index-HnEXgQG4.js`）、推送两仓与子模块
- [ ] T6.3 旧 oracle/L1 脚本按 90 卡重写或删除（当前标记为历史脚本）
- [ ] T6.4 H01–H08 用户新需求（见 §0 当前任务）

### Phase 1
- [x] T1.1 protocol 类型 + schema + catalog
- [x] T1.2 引擎骨架 setup/view/元信息
- [x] T1.3 draft-pick
- [x] T1.4 organize
- [x] T1.5 单测（engine.test.ts 21 例 + seasons-protocol.test.ts 6 例）

### Phase 2
- [x] T2.1 draft-dice（掷骰 + 选骰 + 行动顺序；骰面奖励结算并入 T2.2a）
- [x] T2.2 summon
  - [x] T2.2a 召唤外壳：费用校验（含灵活费用）、能量扣除、槽位/上限、骰面奖励结算；7 张无 choice 召唤效果（summon_gauge / gain_crystals / per_magic_item_crystal / demon_of_argos / air_elemental / sid_nightshare / cursed_relic）；元素护符土/火
  - [x] T2.2b-1 选择框架：pendingChoice + resolve-choice + element_alloc（附魔魔典 / 流水护符）
  - [x] T2.2b-2 召唤选择效果：card_list（火焰护符/娜莉亚）、element_alloc（流水护符/附魔魔典/诅咒典籍/吊坠/王冠/路易斯）、card_pick（神圣圣杯/梦境药水）、multi_player_pick（西拉斯/阿姆苏格）、branch（水晶球/四季之镜）、month_advance（时光之靴）、then 链（free_summon / discard_pending / finish_end_turn）
  - [x] T2.2b-3 元素护符：付水 → 获得 2 能量（element_alloc）；付风 → 弃 1 张手牌（card_pick purpose:'discard'）；水+风可链式（then:'amulet_air'）
  - [x] T2.2b-4a 幸运之手 cost_reduction：非灵活费用先算 `min(减免量, 总能量费用-1)`；单一可减元素自动减，多元素挂 `element_alloc/cost_reduce`，结算后带 `costOverride` 重跑召唤（`pendingChoice.options.then='summon_cost'`）
  - [x] T2.2b-4b 花瓶 on_summon_energy（召唤后排队选择）、时光沙漏（换季时每人排队选择）、恶意之骰（行动开始 branch：正常/重掷+2 水晶）；均用 `pendingQueue` 在同一时机按序挂选择
- [x] T2.3a transmute（1 点能量 → 当季水晶，含 transmute_bonus 与卡上 stored 能量）
- [x] T2.3b activate 外壳（费用/每回合一次/双激活 abilityKey；已接 随从偶像、力量药水、毁灭者凯恩、伊什塔尔天平 4 张）
  - [x] T2.3b-2 知识药水 / 生命药水 / 死灵匕首 / 光之树（双激活）；生命药水用新选择 kind `element_multi` 一次多选元素（与旧引擎 `energy_multi` 对齐）
  - [x] T2.3b-3 梦境药水（card_pick 免费召唤）、水晶球（branch + pay 型 element_alloc）、龙之头骨（sacrifice_cards）、四季之镜（三步 branch）、贪吃锅（能量封存 + 满 7 牺牲）；13 张 activation 卡仅恶意之骰（dice_change）未接
- [x] T2.4 end-turn / 月与季节推进（按剩余骰子 pip 前进；跨年取回 library2/3；起始玩家顺转）
- [x] T2.5 计分与 rankings（水晶 + 卡面分 + 特殊计分 - 手牌惩罚 - 徽章惩罚；特殊计分：拉格菲尔德的头盔 +20、希迪特的灯笼 储备×3、乌尔姆的封印宝箱 +20；卡牌离场恢复 `max_energy_plus` 上限、被牺牲时触发 `on_sacrifice` 清储备）
- [x] T2.6 首批 20 张卡（实际已接 24+ 张召唤/激活/被动效果）
- [x] T2.7 2 人整局自动打完 36 个月（engine.test.ts 的 `seasons full game`，含自动选骰/召唤/结束回合）

### Phase 3
- [x] T3.1 资源管线：PIL 转 webp（卡 51 张 320px、骰面 120 张 108px、元素 4 张 120px，共 175 个文件约 1.7MB）+ `src/games/seasons/art.ts` 的 `import.meta.glob` 映射 + 生成脚本 `apps/web/scripts/build-seasons-assets.py`
- [x] T3.2 Panel 布局：顶栏（阶段/年季月/牌堆弃牌）、骰池（点选）、对手/自己区块（水晶/等级/牌库/手牌/徽章/能量/场上牌）、手牌区、日志、终局结算块
- [x] T3.3a 基础交互：点轮抽牌 `draft-pick`、组牌点 3 张自动 `organize`、点骰 `draft-dice`、点手牌 `summon`、点场上牌 `activate`、转化按钮、结束回合、认输
- [x] T3.3b-1 flex 费用支付：点灵活费用卡弹出支付面板（min–max 种、maxPerType、按现有能量禁用）
- [x] T3.3b-2a 幸运之手减费：引擎在召唤时自动/弹窗减免，前端复用 `ChoiceModal` 的 element_alloc，无需新按钮
- [x] T3.3b-2b 徽章：引擎 use-badge（4 种效果）/badge-keep、徽章 4 的「摸 2 选 1」、view 私密 badgeDraw；前端 BadgeBar + BadgeKeepModal
- [x] T3.4a 弹窗选择：element_alloc / element_pick / card_pick / card_list / sacrifice_cards / multi_player_pick / branch / month_advance（`ChoiceModal.tsx`）
- [x] T3.4b 弹窗补全：mirror 三步步骤提示（源/数量/目标）、待选期间他人视图「等待 座位 X 完成选择」+ 队列余量提示（`pendingQueueCount`，全桌可见）
- [x] T3.5 文案与结果页：headline/statusLine/playerBadge/eventMessage + 终局结算块（分数分项）
- [x] T3.6 冒烟：`apps/server/scripts/seasons-ui-flow.mjs` 只用 Panel 会发出的动作形状跑完整局（非浏览器 e2e）
- [x] T3.6c 无浏览器渲染冒烟：`apps/web/scripts/seasons-render-smoke.mjs`（Vite `ssrLoadModule` 加载真实 `Panel.tsx`/`index.tsx`，用 react-dom/server 渲染真实引擎状态 + 合成全部 9 种 ChoiceModal 分支 + 事件文案）→ 1149 次渲染无异常，覆盖 element_alloc/element_pick/card_pick/card_list/sacrifice_cards/multi_player_pick/branch/month_advance/energy_swap
- [x] T3.6b 浏览器 e2e：按用户 2026-11-23 决定**不安装** Playwright/Chromium（机器内存不足），以「引擎整局 + UI 动作契约 ui-flow + 无浏览器渲染冒烟 T3.6c」作为验收

### Phase 4
- [x] T4.1 基础卡效果收尾
  - [x] T4.1a 徽章系统（use-badge / badge-keep / 徽章 4 抽卡升级 / 终局 BADGE_PENALTY 计分已有；11-23 03:20 徽章 1/2/3/4 + badge-keep 已纳入 L1 与旧引擎逐点对照）
  - [x] T4.1b 服务端「选择队列」`pendingQueue`：同一时机多个选择按序结算（花瓶召唤后、沙漏换季、恶意之骰重掷）
  - [x] T4.1c 其余 choice kind：`energy_swap` 已实现（骰面能量奖励 + 所有储备能量获取，含 `discard_pending`/`amulet_air` 后续链路；装不下时弹窗由玩家决定保留组合，旧引擎语义）；旧引擎的 `card_list_grouped`/`card_multi`/`player_list`/`card_distribute`/`energy_multi`/`card_energy` 在新引擎里由 `multi_player_pick`/`card_pick`/`branch`/`card_list` 等价覆盖（西拉斯/阿姆苏格/龙之头骨/娜莉亚/四季之镜/贪吃锅）
- [ ] T4.2 扩展包 —— ❌ 已撤销（用户 2026-11-24 裁定：51–90 全部是 AI 幻觉卡牌，整体删除，`ext1`/`ext2` 选项一并移除；卡池永久只保留基础 50 张）
  - [x] ~~原接线：卡表 `seasons-cards-ext.ts`（id 51–90）+ 合并表~~（文件与选项已删除）
  - [x] ~~原扩展效果（`summon_condition`/`pay_energy_reward`/`turn_*`/`season_*` 等）~~（数据删除后不再可达；`support.ts` 的白名单已收缩到基础 key）
  - 历史上的扩展实现细节保留在下方 §12 日志中，仅作记录`summon_condition`（魔法骑士/魔法巨龙/命运冠军）、`pay_energy_reward`（9 张激活卡：弃能量换水晶/能量/抽牌/扣对手水晶）、`turn_condition_reward`/`turn_flat_reward`/`season_opponent_tax`/`season_draw`/`opponent_action_reward`（召唤与激活两侧）/`fates_spire`（储备上限 +2）/`on_season_change_energy`；`on_summon` 的 gain_crystals/draw_cards/gain_energy/per_magic_item_crystal/per_magic_item_energy/summon_gauge 复用既有实现。逐类单测：命运主宰（回合结束 +2 水晶）、魔法皇冠（3 张魔法物品 +5）、命运之路（储备 ≤1 排队选 2 能量）、魔法法师（换季偷对手 1 水晶）、命运小径（换季抽 1）、小仙灵（对手激活 +1 水晶）、命运尖塔（上限 +2）
  - [x] 未实现的常驻类扩展卡仍由召唤前守卫拦截（`effect_not_implemented`，不扣费），目前白名单已覆盖全部 40 张的 effect 类型
- [x] T4.3 3–4 人局：setup 支持 2–4 人，3 人 4 颗骰 / 4 人 5 颗骰，手牌按 `hands[(i-1+n)%n]` 轮转；`rankings()` 改为同分并列名次（如 [1,1,3]），3–4 人不可认输；前端座位名扩到「甲乙丙丁」
- [ ] T4.4 观战/重连
  - [x] T4.4a 观战视图：`view(state, null)` 只暴露公共信息（手牌/轮抽牌/组牌分配/徽章抽牌均 null，弹窗私有候选牌不下发），有测试覆盖
  - [x] T4.4b 断线重连：框架按 `view()` 重建，无需引擎改动；用户 2026-11-23 决定由本人人肉手测（刷新页面/断网重连），代码侧不再排期
- [x] T4.5 性能
  - [x] T4.5a state 体积：`node apps/server/scripts/seasons-size.mjs` 打完整局采样（133 步），JSON 平均 6.4KB / p50 7.0KB / p95 7.3KB / 最大 7.3KB（目标 <15KB，旧引擎约 86KB）
  - [x] T4.5b view 计算耗时：`node apps/server/scripts/seasons-view-perf.mjs` → 3750 次 view 共 24.2ms，单次约 0.006ms，view JSON 平均 2.8KB / 最大 3.6KB
- [x] T4.6 oracle + 冒烟
  - [x] T4.6a 数据基线 oracle：`node apps/server/scripts/oracle-seasons.mjs` 对照旧 cards.json / cards.ext1.json / cards.ext2.json / dice.json → 50 张基础卡 + 40 张扩展卡（名称/类型/分数/费用/效果元数据/abilities）与 4 季 × 5 骰 × 6 面全部一致
  - [x] T4.6b L2 冒烟：`node apps/server/scripts/seasons-soak.mjs 200` → 200 局自动对局逐步检查不变式（卡牌守恒/uid 唯一/能量上限/水晶非负/队列提升/终局结果）全通过；脚本同时输出「选择分布」，2 人 200 局里 `energy_swap` 触发 3145 次（element_alloc 519 / branch 887 / card_list 124 / month_advance 94 / multi_player_pick 117 / card_pick 14），新选择被大量覆盖
  - [x] T4.6c L1 状态级差分：`node apps/server/scripts/oracle-seasons-l1.mjs`（加 `--ext` 启用扩展包）→ 2/3 人局确定性路径 92–122 个检查点（轮抽 / 组牌 / 每座位最多 3 次召唤 / 转换 / 激活（随从偶像 + 力量药水/凯恩/伊什塔尔天平/知识药水/死灵匕首/生命药水多选/光之树 A·B）/ 能量重分配 energy_swap / 徽章 use-badge 1–4 与 badge-keep / 骰面奖励与回合轮转 / 终局计分）与旧引擎逐步一致；检查点数量随旧引擎那副随机牌堆里「可注入的已实现召唤卡」张数浮动；`--ext` 模式下召唤卡包含扩展卡（如 69 魔法巨龙 / 75 / 86 命运冠军）也逐点一致。骰子随机路径暂由 soak 的不变式覆盖（两边洗牌随机源未对齐，注入旧引擎牌堆绕过）
- [x] T4.7 打磨与部署（T4.7a 移动端样式 ✅；T4.7b 部署验证 ✅ 2026-11-23 12:47 按用户要求部署到 https://thinktwice.top/bgx/，大厅可见「四季物语」）

### Phase 5：卡牌框架（用户 11-23 指定方向）
- [x] T5.5 卡效修正与扩展删除（2026-11-24）：删除 51–90 与 ext 选项；#4 流水护符卡上能量可用于支付/晶化；#7 时光之靴去掉水晶+2；#12 娜莉亚按人数抽、保留 1 张后由使用者逐张指定给对手；#36 吸血鬼王冠改为「抽或弃」二选一；#42 诅咒典籍追加召唤等级+1；#41 偷窃妖精补实现（对手激活时偷 1 并额外 +1）；#49 保持严格领先
- [x] T5.1 储备语义统一：卡上能量（`reserve_slot`）与普通储备完全等价，可支付召唤/激活/徽章等一切费用；卡牌离场导致上限下降时，若超出上限则弹 `energy_discard` 让玩家选择弃掉哪些能量（`normalizeReserve` + `finish(prev,res)`，`promoteQueued` 会跳过已失效的弃置选择）
- [x] T5.2 卡池校验与运行时注册：`validateCardPool`（id 重复/名称/分数整数/费用非负/未登记的 effect key）、`registerCards`/`cardById`（内置 50 张之外可运行时登记）、`customDeck` 选项（逗号分隔 id，任意小卡池自动校验），setup 阶段先校验后建牌堆
- [ ] T5.3 效果处理器注册表：把 `summon` / `activate` / 回合末 / 换季 / 计分 里按 key 分派的 if/switch 抽成 `Record<key, handler>`，新增卡牌只登记数据 + handler，不改引擎主流程
- [x] T5.6 预设卡池（2026-11-25）：游戏选项新增 `pool`（select：`standard` / `five_fortunes`；房间界面只暴露这一个选项，`customDeck` 仅留给脚本/压力测试），五福季节 = 空气护符(1)/火焰护符(2)/大地护符(3)/流水护符(4)/元素护符(31) 各 **20 张**，共 100 张；另加「骰子季节」= 100 张恶意之骰(id 15, Die of Malice)；卡池构建改为 `poolEntries`（每张卡带 `copies`），`customDeck` 优先级最高。soak 第 4 参数也接受 `five_fortunes` / `dice_season` 跑纯预设池对局
- [x] T5.4 卡池压力测试：`seasons-soak.mjs [局数] [人数] [随机池大小]`——第 4 参数给定时从 50 张里随机抽 N 种用 `customDeck` 入池（4 人至少 18 种）；2 人 10/12/20、3 人 14、4 人 20 各若干局全过。顺带修掉「牌堆与弃牌堆都空时抽不到牌、卡_list/card_pick 挂起无候选」的死锁：抽到的牌不足保留数时直接全部保留，空候选直接作废

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 90 张卡效果文本模糊，移植走样 | 规则错但测试不报 | L1 oracle 逐卡比对；拿不准的记入 §12 待人工确认 |
| 选择弹窗（14 种 kind）工作量被低估 | 拖到 Phase 4 | 迷你版只做 4 种，其余先 `autoPick` 兜底 |
| 前端 1931 行逻辑密集 | UI 超时 | 先做"能玩"，视觉后置 |
| 每夜 2 小时时段偏短 | 任务切碎 | 每个任务控制在 1–2 小时，超出就拆 |
| 卡图 21MB | 首屏慢 | **已实测可解**：原图 455×634、378KB，转 webp 后 32KB，全套约 2MB |

## 11. 每次运行的作业流程（夜间任务必须遵守）

> 运行时段：每天 **00:00 / 03:00 / 05:00 / 07:00**（各约 2 小时；刻意避开 02:50 的 seasons_bot 值班，这台机器只有 2GB 内存，vite 构建与评测不要撞车）。
> 任务挂在 DSH 定时任务「推进四季物语迁移到 BGX（夜间分片）」，`new_once` 模式，固定一个工作会话，上下文靠本文件续命。

1. 读本文件 §0 与 §9，找到第一个未完成任务。
2. 若任务超过本次时段预算，**先拆小**并在 §9 下新建子项，再只做第一个子项。
3. 实现 + 跑 `pnpm --filter @bgx/server test`（前端阶段加 `pnpm --filter @bgx/web build`）。
4. 改了 Panel/ChoiceModal 后建议再跑 `pnpm --filter @bgx/web smoke`（需先 `pnpm --filter @bgx/server build`）：无浏览器渲染冒烟，跑整局各状态 × 三个视角 + 9 种弹窗分支。
5. 更新 §9 勾选、§0 的"当前任务/最后更新"，在 §12 追加一条日志（日期、做了什么、遇到的问题、下次从哪继续）。
6. 不要跨阶段抢跑；不要在没有更新文档的情况下结束运行。

## 12. 变更日志

- **2026-11-28 20:00–20:15** 整合 GPT 交付 `f47aa07`（用户已验收）并上线。
  - 交付内容：90 卡引擎（50 基础 + 20 + 20 扩展，按用户 Excel 修正 33 张费用/分数）、重写牌桌 UI（`ss-table`/`ss-inline-choice`/`TableCard`/`ReserveBank`/`table.css`）、宿主改动（auth/http/matches/protocol index/MatchPage/GameOptions/lib/api/socket/vite 源码直连）、201 张美术素材、`scripts/verify-seasons-assets.mjs` 等。
  - 过程：GitHub 22 端口拉包卡死 → `bgx_seasons` 远端改 `ssh.github.com:443`；`git archive` 触发 gc 卡死 → 改为逐文件 `git show` 解包；smoke 旧断言（`ss-band-top`/`ss-spectator`/`ss-hints`/`ss-modal`）与新 UI 不符 → 改写为 `ss-table`/`ss-log-tools`/`ss-die-`/`ss-inline-choice`，能量重分配候选按 `current+incoming` 上限生成。
  - 验证：9 文件 **955 tests** 全绿；protocol/server/web 构建通过（web 752.90 kB JS + 59.91 kB CSS）；smoke **1194 次渲染**（SSR 4.97ms / p95 14.47ms）；91 张卡图 sha256 与 `docs/seasons-assets.json` 全对；冬季 2 号骰 4/6 修正保留。
  - 已知：旧 `oracle-seasons.mjs`/`oracle-seasons-l1.mjs` 按旧 50 卡基线写，已失效，由 `card-workbook.test.ts`（271 断言）取代；`sharp`/`playwright` 因机器内存不足不安装（用户 11-28 明确）。
  - 部署：`bash scripts/deploy-local.sh` → 2026-11-28 20:03:14，入口 `index-HnEXgQG4.js`，healthz ok，线上 options 为 `pool` + `extensions`。
  - 提交：`bgx` main `3ea17eb`（整合演练，已含全部代码）→ 本文档提交；`bgx_seasons` main `fb4414e`（插件镜像同步，含 90 卡引擎与新 UI 素材）；子模块指针前滚到 `fb4414e`。

- **2026-11-20** 建立文档，确定技术选型（随机 B、2 人局可认输、紧凑 state、webp 资源、oracle 分层）。下一步 T1.1。
- **2026-11-21 00:00–00:10** 完成 Phase 1 全部（T1.1–T1.5）+ T2.1 选骰。
  - protocol `packages/protocol/src/games/seasons.ts`：catalog（maxPlayers=2，扩展包只声明 base）、12 种动作 zod、完整视图类型、`SeasonsCardDef/Effect/Ability`。Element 决定用全名（water/air/fire/earth），与旧 cards.json/dice.json 对齐。
  - 卡表：`apps/server/src/games/seasons/cards/base.ts` 从旧 cards.json 生成（50 张，勿手改）；骰表 `rules/dice.ts` 从旧 dice.json 生成（4 季 × 5 颗 × 6 面）。
  - 引擎 `engine.ts`：setup（抽 seed → mulberry32 洗 100 张 → 每人 9 张轮抽手牌，牌堆剩 82）、draft-pick（9 轮，每轮全员选完后手牌传左）、organize（两步 3/3/3，剩余归 library3，可 reset）、resign、view 裁剪（手牌/轮抽牌/已选牌仅本人）、rankings；`rules/random.ts`、`rules/const.ts`。
  - T2.1：全员组牌完成 → `startMonth` 掷「人数+1」颗当季骰；`draft-dice` 按 currentPicker 顺序选骰，选满后 `turnOwner = dicePicked[0]`（行动顺序 = 选骰顺序）。注意：**行动阶段开始时骰面奖励尚未结算**，T2.2a 必须补 `startPlayerAction`。
  - 验证：`pnpm --filter @bgx/protocol build`、`pnpm --filter @bgx/server build` 通过；`pnpm --filter @bgx/server test` 6 文件 72 tests 全绿；node 冒烟确认 loader 注册 `seasons`、setup/view/schema/reduce 正常。
  - 踩坑：① zod `discriminatedUnion` 无法从 `badgeType: z.union([3,4])` 提取判别值（报 "A discriminator value for key `badgeType` could not be extracted"），badge 三变体改用嵌套 `z.union`；② 组牌阶段 `draftPickedThisRound` 必须为空（drafted.length 恰等于 draftRound，不能用 `>` 推导）；③ 旧引擎 uid 是字符串，新引擎改整数 1..100。
  - 下次从 T2.2a 开始：召唤费用（普通/按人数/灵活费用）、能量扣除、槽位与 maxEnergy、骰面奖励结算（summon/transmute/crystal/能量/抽卡；die_effect 重掷钩子留到 T2.x）。

- **2026-11-21 00:10–00:25** 完成 T2.2a。
  - 新增 `rules/play.ts`（费用解析/affordable/addEnergyCapped/ability 查询）、`rules/state.ts`（pushLog/patchPlayer/drawOne/drawToHand）、`cards/effects.ts`（召唤效果注册表 + summonNeedsChoice）。
  - `engine.ts`：`resolveDieRewards` 在选满骰后结算首位玩家骰面（summon/transmute/card/crystals/四元素能量，`badgeDrawUpgrade` 抽 2 暂未接徽章）；`summon` 支持普通/按人数/灵活费用、扣能量与水晶、gauge 槽位校验、maxEnergy 加成（`max_energy_plus`）；需要选择的召唤效果在扣费后、入场前显式拒绝 `effect_not_implemented`（不扣费）。
  - 已实现无 choice 召唤效果 7 张：召唤计量条、水晶、每张其他魔法物品水晶、阿尔戈斯恶魔（对手等级 -1 且抽牌）、空气元素（对手能量转空气）、希德夜影（水晶最多时偷 5）、受诅咒灵魂（+10 水晶 +1 水）。
  - 验证：6 文件 84 tests 全绿（seasons engine 33）；protocol/server build 通过；node 冒烟 loader 注册 seasons。
  - 踩坑：① `drawOne` 里 `let deck = state.deck; deck.pop()` 原地改写旧 state 的 deck 数组（不可变破坏），已在 pop 前 `deck = [...deck]`；② `max_energy` 上限导致测试里 9/9/9/9 能量加不进去，测试需单独放宽 maxEnergy。
  - 下次从 T2.2b-1 开始：pendingChoice 状态 + `resolve-choice` 分发 + `element_alloc`（附魔魔典 2 能量进储备、流水护符 4 能量置于卡上），再接 card_list。

- **2026-11-21 00:20–00:35** 完成选择框架、转换、回合/月份推进、基础计分与整局自动测试。
  - 选择框架：`SeasonsState.pendingCards`（仅选择者可见的私密抽牌）+ `pendingChoice`；`resolve-choice` 分发 `element_alloc`（流水护符 4 能量置卡上、附魔魔典 2 能量进储备）与 `card_list`（火焰护符抽 4 留 1，其余进弃牌堆）。`rules/choice.ts` 负责校验（分配总量/元素上限/uid 合法性/重复/张数）。弹窗期间其他动作返回 `pending_choice`，非选择者返回 `not_your_choice`。
  - 视图：`pendingChoice.options.cards` 只对选择者展开（`view()` 里按 `viewerSeat === choosingSeat` 注入）。
  - `transmute`：消耗 1 点能量（先储备区，再场上 stored）→ 当季水晶，叠加所有在场卡的 `transmute_bonus`。
  - `end-turn`：重置 canTransmute/activatedThisTurn，轮到下一位时结算其骰面奖励；全员行动后起始玩家顺转、按剩余骰 pip 推进月份；跨年取回 library2/library3。
  - 终局：36 月后计分（水晶 + 卡面分 - 手牌×5 - 徽章惩罚），排序并写 result/winner/draw；`effectPoints` 暂为 0。
  - 验证：6 文件 93 tests 全绿，新增「两人局自动打完 36 个月」集成测试；protocol/server build 通过。
  - 下次从 T2.2b-2 剩余召唤效果或 T2.3b activate 开始；activate 需要先读旧 `abilities.js` 与 `applyActivation`。

- **2026-11-21 00:35–00:40** 接入 activate 动作（T2.3b 外壳）。
  - `activate(state,seat,cardUid,abilityKey?)`：校验行动阶段/回合归属/牌在场上/`effect.trigger==='activation'` 或 triggers 含 activation；`activatedThisTurn` 以 `uid:abilityKey` 记录（双激活卡可分别用一次）；支持 `activation_cost`（先储备区、再场上 stored 扣，如诅咒圣物 1 水）。
  - 已实现效果：随从偶像（水晶 + 在场随从数）、力量药水（牺牲、抽 1、gauge +2）、毁灭者凯恩（选择弃 1 能量，对手水晶 -4）、伊什塔尔天平（选择弃 4 个相同能量，水晶 +12）。
  - 新增选择类型 `element_pick`（pendingChoice.options.amount/cardUid/actId），`resolveElementPick` 负责校验与扣除后再结算效果；其余激活卡返回 `effect_not_implemented`。
  - 验证：6 文件 101 tests 全绿（新增 6 个激活用例）；protocol/server build 通过。
  - 下次从 T2.3b-2 剩余激活效果开始；需要 choice 的能量分配/弃牌选择可复用 element_pick 与 element_alloc。

- **2026-11-21 00:40–00:55** 补齐通用被动与回合/换季效果。
  - 新增 `element_alloc` 型的激活选择（知识药水 5 能量、死灵匕首 4 能量、光之树 A 1 能量），`resolveElementAlloc` 通过 `options.actId` 标记本回合已激活。
  - 新增 `element_pick` 结算扩展：生命药水（选一种元素，全部按 4 水晶转换）、光之树 B（弃 1 能量按当季 `TRANSMUTE_VALUE` + `transmute_bonus` 换水晶）。
  - 回合结束效果：`applyTurnEndEffects` 接 奇迹宝箱（储备 ≥4 → 水晶 +3）、深凝视的提图斯（每位对手给 1 水晶；有对手无水晶则牺牲本卡）。`reserveTotal` 计入 `reserve_slot` 卡上能量。
  - 换季效果：`applySeasonChangeEffects` 接 贪婪的菲格里姆（每位对手给 1 水晶），在 `advanceMonth` 换季时触发。
  - 召唤被动：春之杖（每次召唤水晶 +3）、奥术水蛭（对手召唤时给你 1 水晶）。修正 `endTurn` 传给下一位时丢失 `afterTurnEnd` 副作用的 bug。
  - 验证：6 文件 111 tests 全绿；protocol/server build 通过。
  - 已知未接：`cost_reduction`（幸运之手）未减费、花瓶（on_summon_energy）不给能量、乞丐之角/时光沙漏需要月份推进中的选择（留到选择队列机制完善后）。
  - 下次从 T2.3b-3 剩余 5 张激活效果开始；若时间不足优先补 `energy_multi` / `card_multi` 两种选择类型。

- **2026-11-21 00:55–01:00** 收尾激活批次 3。
  - 贪吃锅：`element_pick` 放入 1 能量（储备区/魔典卡上取），卡上能量满 7 时牺牲本卡、能量按上限回储备、水晶 +15。
  - 龙之头骨：新增 `sacrifice_cards` 选择，连续 3 次逐张选在场卡进弃牌，完成 +15 水晶。
  - 水晶球：`branch` 看牌堆顶 → 放回 或 走 `element_alloc`（新增 `mode:'pay'`，真正扣除 4 能量）→ `then:'free_summon'` 免费召唤并跑召唤效果/被动。
  - 四季之镜：`branch` 三步（源元素 → 数量 → 目标元素），扣 X 水晶、转 X 同型能量，不降召唤等级。
  - 梦境药水：`card_pick` 从手牌选 1 张免费召唤（pendingCards 私密），激活时先牺牲并清空储备能量。
  - 验证：6 文件 118 tests 全绿；`tsc --noEmit` 通过。
  - 下次：T2.2b-2 剩余 7 张召唤效果（temporal_boots / divine_chalice / syllas / naria / amsug / lewis / vampiric_crown），之后 Phase 3 前端。

- **2026-11-21 01:00–01:15** 补齐召唤选择批 2 与回合末/月份选择。
  - 吸血鬼王冠：点数>0 → 选 N 个元素获取 N 能量（draw 1 后弃）、`then:'discard_pending'`；点数为 0 时兜底抽 1 弃 1。
  - 神圣圣杯：`card_pick` 抽 4 留 1，其余进弃牌；召唤位不足时不弹窗、抽 4 弃 4。
  - 女先知娜莉亚：`card_list` 抽 人数+1 留 1，未保留的牌按顺序塞给对手手牌（`distribute`）。
  - 忠实的西拉斯：`multi_player_pick` 逐对手选 1 张在场卡牺牲。
  - 长颈阿姆苏格：`multi_player_pick` 每位玩家（含自己）选 1 张在场魔法物品回手。
  - 灰脸路易斯：复制对手储备能量，`element_alloc` + `allowPartial`（可不选满、复制不转移）。
  - 乞丐之角：`endTurn` 拆出 `finishEndTurn`；回合末储备 ≤1 时挂 `element_alloc`（then:'finish_end_turn'）获得 1 能量，结算后继续结束回合。
  - 时光之靴：召唤时水晶 +2，再选择季节轮前进/后退 1–3 格（`month_advance`，调用 `advanceMonth` 直接开新月份）。
  - 自动整局测试补齐 card_pick / multi_player_pick / month_advance 应答；`demon_of_argos` 摸牌仅作示例（无 choice 效果均已覆盖）。
  - 验证：6 文件 126 tests 全绿；protocol/server build 与 `tsc --noEmit` 通过；node 冒烟 `registerDiscoveredGames()` → ['plane-bomb','reversi','seasons']，setup 每人 9 张、deck 82、对手 draftHand 在 view 中为 null。
  - 踩坑：① `addEnergyCapped` 按总能量封顶，测试里给 9×4 能量再验证加能量会加 0，需先把 maxEnergy 调大或清空储备；② 路易斯有 air1/fire1 费用，断言要按扣费后数值写；③ 旧的「时光之靴未接」测试改为元素护符付水，避免实现后回归失败。
  - 下次：T2.2b-3 五张边角卡（元素护符水/风、花瓶被动、幸运之手减费、时光沙漏、恶意之骰）；若判断边角成本高，Phase 3 前端（T3.1 牌桌骨架）可先行，但需在 §9 注明跳过项。

- **2026-11-21 01:15–01:22** 元素护符水/风分支。
  - 付水：`summonChoiceFor` 返回 `element_alloc` amount=2 target reserve；付风：`card_pick` + `purpose:'discard'`（新增 `resolveHandDiscard`，从手牌弃 1，不经过 pendingCards）。
  - 水+风同时支付：先结算水（then:'amulet_air'），再挂起风的弃牌选择。
  - 自动整局测试的 card_pick 应答兼容 purpose:'discard'（从手牌取第一张）。
  - 验证：6 文件 128 tests 全绿（新增 3 例：付水、付风、水+风链式）；旧「元素护符付水被拒绝」用例改写为断言挂起选择。
  - 踩坑：`SummonChoiceRequest` 的 `then`/`purpose` 是字面量联合，新增分支要同步放宽类型，否则 tsc 报 TS2322。
  - 下次：T2.2b-4 四张边角（花瓶被动、幸运之手减费、时光沙漏、恶意之骰）；这些都需要「召唤前/换季时/骰面改变」的新挂起点，成本明显高于前面的卡，可考虑留给 Phase 4 与 T4.1 一起做，Phase 3 前端可先启动（在 §9 注明跳过项即可）。

- **2026-11-21 03:00–03:15** 开始 Phase 3：T3.1 资源管线。
  - 旧项目 `public/assets`：卡图 51 张（455×634 PNG，21MB）、骰面 120 张（108×108，1.8MB）、元素图标 4 张（300×300）。
  - 新增 `apps/web/scripts/build-seasons-assets.py`：卡图缩放 320px 宽、骰面 108px、元素 120px，统一 q80 webp；输出到 `apps/web/src/assets/seasons/{cards,dice,elements}`，共 175 个文件约 1.7MB（卡图单张约 18–30KB）。
  - 新增 `apps/web/src/games/seasons/art.ts`：三个 `import.meta.glob(..., { eager:true, query:'?url', import:'default' })`，导出 `cardArt(id)` / `cardBackArt()` / `dieArt(letter,die,face)` / `elementArt(element)` 与 `SEASONS_ART_COUNTS`。
  - 验证：临时在 App.tsx 引入 art.ts 后 `pnpm --filter @bgx/web build` 通过，卡图带 hash 输出到 dist/assets（已还原 App.tsx）；`tsc --noEmit` 通过。
  - 踩坑：模块只被副作用引入且导出全未使用时，Rollup 会把未用到的 glob 一起摇掉（当时只输出了 51 张卡图）；等 T3.2 真正使用 dieArt/elementArt 后会正常输出。
  - 下次：T3.2 Panel 牌桌骨架（先静态布局 + 自己/对手/骰池/日志）。

- **2026-11-21 03:04–03:09** T3.2 牌桌 + T3.3a 基础交互 + T3.4a 弹窗（同一轮完成）。
  - 卡表单一来源：`BASE_CARDS` 从 `apps/server/src/games/seasons/cards/base.ts` 移到 `packages/protocol/src/games/seasons-cards.ts`（前端要卡名/费用/分数），server 原文件改为 re-export，import 路径全不变；protocol build + server 128 tests 全绿。
  - 新增 `apps/web/src/games/seasons/Panel.tsx`：顶栏阶段胶囊 + 年/季/月 + 牌堆/弃牌；骰池（`dieArt`，显示点数/奖励/归属，行动阶段可点选）；对手/自己区块（水晶、召唤等级、牌库、手牌数、徽章、四元素能量图标、场上牌缩略图，自己场上未激活的牌可点激活）；手牌/轮抽手牌/组牌区（组牌点 3 张自动提交 year1/year2）；对局记录 -8 条；终局结算块；`ChoiceModal` 覆盖 8 种 choice kind。
  - `index.tsx` 插件：meta 复用 `seasonsCatalog`（icon 🍂、seats 甲乙），`headline/statusLine/eventMessage/playerBadge`；`styles.css` 全 `ss-` 前缀（约 200 行）。
  - 验证：`tsc --noEmit` 通过；`pnpm --filter @bgx/web build` 通过（dist 约 1.9MB；51 张卡图 webp 带 hash 输出，骰面/元素因 <4KB 被 Vite 内联成 124 个 data URI）。
  - 已知坑：`game.season` 在开场前可为 null，插件文案用 `game.season?.name ?? '筹备中'`；组牌阶段 `draftPickedThisRound` 为空，不可用 drafted 长度推导。


- **2026-11-21 03:09–03:10** T3.3b-1 flex 支付、T3.5 文案/结果页、T3.6 冒烟脚本。
  - `Panel.tsx` 新增 `PaymentModal`：灵活费用卡（元素护符）点击后弹出支付面板，按 `costFlexible.min/max/maxPerType` 限制，按当前能量禁用；确认后发 `summon { cardUid, paidElements }`。踩坑：一开始用 uid 查卡表（uid 是实例号），改为传 `cardId`。
  - 结果页 `ResultBlock` 展示每人 `score` 与水晶/卡牌/效果/手牌/徽章分项；`headline/statusLine/playerBadge` 覆盖结束、观战、待选、行动中。
  - 新增 `apps/server/scripts/seasons-ui-flow.mjs`：只用前端会发的动作（draft-pick / organize / draft-dice / end-turn）从轮抽自动打到终局，验证 UI 动作契约；结果 `0:-46 1:-47 winner=0`（不打牌所以是负分，属预期）。踩坑：轮抽阶段没有 `currentPicker` 推进，要按 `drafted.length === draftRound` 找该谁选。
  - 待确认（环境限制，非规则问题）：仓库没有 Playwright/Chromium，`T3.6b` 真浏览器 e2e 无法在本机跑；已在 §9 拆出 T3.6b，需要人决定是否装浏览器工具链，还是用现有「引擎整局 + UI 动作契约」作为迷你版验收。
  - 下次：T4.1 拆子项（先选 2–3 张卡补 T2.2b-4：幸运之手减费、花瓶被动、时光沙漏、恶意之骰），再回到 T3.3b-2 的徽章前端。

- **2026-11-21 03:10–03:16** 引擎补 T2.2b-4a：幸运之手减费。
  - `engine.ts` 新增 `costReductionOf(me)`（累加场上 `cost_reduction` 能力）；`summon` 增加内部参数 `costOverride`，非灵活费用先算 `min(减免, 总能量费用−1)`：单一可减元素自动减，多元素时挂 `pendingChoice {kind:'element_alloc', key:'cost_reduce', options:{then:'summon_cost', cardUid, paidElements, cost}}`。
  - `resolveElementAlloc` 增加 `then==='summon_cost'` 分支：按选择折算新费用后清空 pending 再调 `summon(..., reduced)`。
  - 测试 +2（共 130 全绿）：多元素弹窗→选择→按减免后付费；单一元素自动减免不弹窗。
  - 踩坑：分支判断一开始写成 `pending.options.key`（key 在 pendingChoice 顶层，不在 options 里），导致选择被当成普通能量分配、卡没打出去；`pendingChoice.options.then` 这种字段还会让对象成为 thenable，后续别把 options 整个 await。
  - 前端无需改动：`ChoiceModal` 已有 element_alloc（含 maxPerElement），按钮文案取 `options.label`（“减免”）。
  - 下次：T4.1 拆子项；剩 3 张边角（花瓶/沙漏/恶意之骰）各需新挂起点，徽章（use-badge/badge-keep/选徽章抽牌）也需要引擎实现。

- **2026-11-21 03:16–03:20** 徽章系统（T3.3b-2b / T4.1a）。
  - 引擎：`SeasonsPlayerState.badgeDraw: CardRef[] | null`；`resolveDieRewards` 在 `badgeDrawUpgrade` 时抽 2 张放进 `badgeDraw`（不直接入手）并提示「抽卡×2（选 1 保留）」；`useBadge`（徽章 1 换能量 / 2 能量换水晶（当季转换值+1）/ 3 召唤等级+1 / 4 抽卡升级）与 `keepBadge`（保留 1 张入手、另一张进弃牌）；徽章只能在「自己选骰或自己行动」时用，`badgesUsed>=3` 拒绝；有 `badgeDraw` 时其他动作返回 `pending_badge`（badge-keep 除外）。`reserveElementCount` 统计储备区 + reserve_slot 卡上能量。
  - 视图：`SeasonsPlayerView.badgeDraw` 仅本人可见（`SeasonsCardView[] | null`）。
  - 前端：`BadgeBar`（剩余徽章数 + 4 个按钮，徽章 1 两步选 2 换 2、徽章 2 选元素）、`BadgeKeepModal`（两张卡图二选一）；有 badgeDraw 时 `canAct=false`。
  - 测试 +7（共 137 全绿）：徽章 3/2/1 效果、能量不足拒绝、用完/非本回合拒绝、徽章 4 摸 2 选 1 并阻塞其他动作 + badge-keep、badgeDraw 私密性。
  - 踩坑：`draft-dice` 只有全员选完才结算骰面奖励，所以测徽章 4 要先让两个座位各选一颗；`actionPhase()` 已消耗骰子，需从 `toPlay(draftAll(setup(...)))` 起手。
  - 下次：T4.1b 选择队列（花瓶/沙漏/恶意之骰），或 T3.4b 弹窗补全；迷你版「2 人完整对局」已达成（引擎 137 测试 + 整局自动脚本 + web 可玩）。

- **2026-11-21 03:20–03:26** 选择队列 + 3 张边角卡（T2.2b-4b / T4.1b）。
  - `SeasonsState.pendingQueue: SeasonsPendingChoiceState[]`：`queueChoice()` 入队，`reduce` 的每个动作结果经 `finish()` 在 `pendingChoice` 为空时自动出队，让「同一时机多个选择」按序结算（不影响已有 `then` 链）。
  - 花瓶（扬被遗忘的花瓶，id 30）：召唤完成后若场上有 `on_summon_energy` 被动（排除本次召唤的牌），排队 `element_alloc`（key `on_summon_energy`，target reserve）。
  - 时光沙漏（id 27）：`applySeasonChangeEffects` 给每位持有者排队 `element_alloc`（key `on_season_change_energy`），座位顺序结算。
  - 恶意之骰（id 15）：行动开始由 `beginTurn()` 先挂 `branch`（key `die_of_malice`：正常 / 重掷+2 水晶）；选重掷时用 `randInt` 重掷当季骰面并执行新面奖励，日志记录。
  - `finishEndTurn` 改为返回 `ReduceResult`，`draftDice` 与 `endTurn` 的「开始行动」都走 `beginTurn`。
  - 测试 +4（共 141 全绿）：花瓶排队与结算、沙漏两人排队、恶意之骰正常/重掷；整局自动测试的 pendingChoice 应答补 `branch` 分支。
  - 踩坑：`season` 里没有 `element`，重掷要 `SEASONS[season.index].element` 查骰表；测试里召唤 0 费、无召唤选择的牌（偷窃妖精 id 41）避免额外弹窗。
  - 下次：T4.1c 差分 oracle（L1 单点状态比对）或 T4.2 扩展包；T3.4b 弹窗补全、T3.6b 真浏览器 e2e 仍待办（需装 Playwright，待确认）。

- **2026-11-21 03:26–03:29** T4.5a state 体积实测。
  - 新增 `apps/server/scripts/seasons-size.mjs`：自动打完一局并对每步 `JSON.stringify(state).length` 采样（复用前端动作契约的自动应答逻辑）。
  - 结果：115 步，平均 6042B、p50 6671B、p95 6909B、最大 6948B。目标 <15KB 达成（旧引擎约 86KB）。
  - 注意：脚本的 bot 偏向「能召唤就召唤」，步数少于满 36 月的极限局；数字作为量级参考，若后续加扩展包再复测。
  - 下次：T4.1c 差分 oracle 或 T4.2 扩展包；T4.4 观战/重连、T4.5b view 计算耗时仍待做。

- **2026-11-21 05:00–05:15** T3.4b 弹窗补全 + T4.5b view 性能 + T4.6a/b 基线。
  - T3.4b：`SeasonsGameView.pendingQueueCount`（全桌可见，不含选项内容）；Panel 在他人待选时显示「等待 座位 X 完成选择：<标题>」，有排队时显示剩余数量；`ChoiceModal` 对四季之镜显示「第 1/3 步 · 选源能量」等步骤提示。`pendingQueueCount` 有测试覆盖（换季沙漏两人排队）。
  - T4.5b：新增 `apps/server/scripts/seasons-view-perf.mjs` → 单次 view 0.010ms，view JSON 平均 2.7KB、最大 3.3KB。
  - T4.6a：新增 `apps/server/scripts/oracle-seasons.mjs`（不进 CI）对照旧 `cards.json`/`dice.json`：50 张卡的名称/类型/分数/费用/costByPlayers/costFlexible/效果元数据、4 季 × 5 骰 × 6 面的 pip 与奖励全部一致。
  - T4.6b：新增 `apps/server/scripts/seasons-soak.mjs`（N 局自动对局 + 逐步不变式）→ 200 局全通过；顺带发现并修复引擎问题。
  - 引擎修复：幸运之手减费原先在「能量差得比可减量多」时仍弹出减免选择，选完必然 `cant_afford`；现在 `summon` 先用 `energyGap(me, cost)` 判断缺口，缺口 > 可减量或水晶不足时直接 `cant_afford`，不弹注定失败的选择（+1 测试）。
  - 测试：142 全绿；protocol/server/web 三包 build 通过。
  - 下次：T4.6c L1 状态级差分（旧引擎 `Math.random` 仅 roll/shuffle 两处，可注入确定性序列，但两边洗牌顺序需先对齐）或 T4.2 扩展包；T4.3 3–4 人局、T4.4 观战/重连、T3.6b 浏览器 e2e（待确认工具链）仍待办。

- **2026-11-21 05:15–05:20** T4.4a 观战隐私测试。
  - 新增测试：构造「徽章抽牌 + 私有弹窗候选」的状态，断言本人视图能看到 hand/badgeDraw/弹窗 cards，对手与观战者全部拿不到；观战者 `myTurn=false`、`pendingQueueCount=0`。
  - 测试增至 143 全绿。断线重连由框架按 `view()` 重建状态，引擎侧无需改动，留一条真机手测项（T4.4b）。
  - 下次：T4.6c L1 状态级差分或 T4.2 扩展包；T4.3 3–4 人局、T4.4b、T3.6b 待办。

- **2026-11-21 07:00–07:12** T4.3 3–4 人局 + T4.6c L1 状态级差分。
  - T4.3：`seasonsCatalog.maxPlayers` 改为 4，描述改「支持 2–4 人局；2 人局可认输，3–4 人不可」；`setup` 只拒绝 <2 / >4；`rankings()` 改为 competition ranking（同分并列，如 [1,1,3]），认输时按 winner 给 1/2 名；前端座位名扩到「甲乙丙丁」。测试覆盖 2–4 人发牌/骰数/轮转/认输限制/并列名次；`seasons-protocol.test.ts` 的 maxPlayers 断言同步改 4。
  - T4.6c：新增 `apps/server/scripts/oracle-seasons-l1.mjs`（不进 CI）。旧引擎 `Math.random` 洗牌不可复现，改为「以旧引擎洗出的牌堆为准注入新引擎」：读旧 `createGame([{id:'p0',username:'p0'},…])` 的 deck/draftHand，把 uid 映射成 1..N 数字灌进新引擎，之后两边跑同一动作序列并在每步比较 phase/draftRound/month/year/startPlayer/currentPicker/turnOwner/deck/discard/每玩家手牌与场上/energies/crystals/gauge/canTransmute/badgesUsed/result（分数分项）。
  - 覆盖：2 人与 3 人整段轮抽 + 组牌 + 每位玩家 3 次召唤（注入已实现且无需选择的 on_summon 卡）+ 转换 + 激活（随从偶像）+ 人工终局计分，共 81 个检查点全一致。
  - 差分发现并修复真实 bug：新引擎 `newPlayer` 初始 `canTransmute: true`，旧引擎为 false（转换能力只能由骰面奖励获得）；改为初始 false，并在 `resolveDieRewards` 开头清一次，只有骰面 transmute 奖励重新授予。对应测试断言改为 `Boolean(die?.rewards.transmute)`。
  - 踩坑：旧 `createGame` 的 players 必须传对象（传字符串则 `player.id` 为 undefined，`findIndex` 永远命中座位 0）；注入旧卡必须先 `oldState.deck.find` 取带完整 cost/effect 的卡对象，不能自造空卡；旧引擎终局后 month 会因剩余骰子继续前进（38），新引擎夹在 36，快照里终局后统一归一化为 `'ended'`。
  - 验证：146 tests 全绿；protocol/server/web 三包 build 通过；`seasons-soak.mjs 100 2/3/4` 三种人数各 100 局不变式通过；oracle 数据基线与 L1 差分均 OK。
  - 下次：T4.2 扩展包（ext1/ext2 各 20 张，需先定选项多选与卡表结构）；T4.6c 若要覆盖骰子随机路径，需要给旧引擎注入确定性 `Math.random`；T4.4b 断线重连手测、T3.6b 浏览器 e2e（需装 Playwright，待确认）。

- **2026-11-21 07:12–07:24** T4.2 扩展包（ext1/ext2 40 张）接线与效果。
  - 卡表：新增 `packages/protocol/src/games/seasons-cards-ext.ts`（40 张，id 51–90，带 `extension` 字段）与 `seasons-cards-all.ts`（`SEASONS_CARDS`/`CARD_BY_ID`/`cardsForExtensions`/`SEASONS_CARD_BY_ID`）。`buildDeck(extensions)` 改用合并表，`seasonsOptionsSchema` 接受 `['base','ext1','ext2']` 任意组合（base 必选）；catalog 的扩展包选项加 ext1/ext2 两项。
  - 结构坑：`SeasonsCardEffect` 需要补扩展数据字段（`draw/energy/crystals/selfCrystals/opponentCrystals/maxReserve/minCards/minMagic/minFamiliar/cost/requireMagic/requireLeader/triggerKind`），否则协议 tsc 报 TS2353；`apps/server/src/games/seasons/cards/effects.ts` 里原先把卡表写死成 `BASE_CARD_BY_ID`，扩展卡查不到定义、召唤静默不结算——统一改 `CARD_BY_ID` 后一次修好 3 个红测试。
  - 效果：新增 `summon_condition`（requireMagic/requireLeader + selfCrystals/opponentCrystals，对手水晶扣到 0 为止）、`pay_energy_reward`（激活先 `element_alloc mode:'pay'` 弃能量，再结算 crystals/energy/draw/opponentCrystals；额外能量走 `pendingQueue` 的 `pay_energy_reward_energy`）、`turn_condition_reward`/`turn_flat_reward`（回合末，能量奖励排队 `turn_end_energy`）、`season_opponent_tax`/`season_draw`（换季）、`opponent_action_reward`（召唤与激活两侧，按 triggerKind 过滤）、`fates_spire`（maxEnergy +2）。`on_summon` 的 6 种通用效果直接复用已有实现。
  - 守卫：扩展常驻卡白名单 `EXT_PERMANENT_IMPLEMENTED` 覆盖 cost_reduction / max_energy_plus(fates_spire) / 4 种 turn·season / opponent_action_reward；未在白名单的仍旧召唤前拒绝（目前 40 张全部覆盖）。
  - 测试：`engine.test.ts` 新增扩展包 setup（140/180 张、deck 162、缺 base 抛错）与 13 个效果用例；`seasons-protocol.test.ts` 目录/选项断言同步。**162 tests 全绿**。
  - 差分：`seasons-soak.mjs` 支持第 3 个参数（逗号分隔扩展包），2/3/4 人 + ext1+ext2 各 50–100 局全部通过；`oracle-seasons-l1.mjs` 新增 `--ext` 模式（旧引擎 `createGame(..., {extensions:['ext1','ext2']})`，卡表改合并表），2/3 人约 81 个检查点一致，召唤序列含扩展卡 69/75/86，说明扩展召唤效果与旧引擎一致。
  - 顺带修复：减费选择在「总缺口可减、但按元素分布仍付不起」时也不再弹（新增 `affordableAfterReduction()` 枚举可行减费组合）；soak 的 cost_reduce 候选改为只生成真付得起的分配。
  - 验证：protocol/server/web 三包 build 通过；`seasons-ui-flow.mjs` 冒烟 OK。
  - 下次：T4.7 打磨（移动端/视觉/部署验证）；T4.4b 断线重连真机手测；T3.6b 浏览器 e2e 需装 Playwright（见「待确认」）；T4.6c 若要覆盖骰子随机路径，需要给旧引擎注入确定性 `Math.random`。

- **2026-11-21 07:20–07:29** T4.7a 移动端样式。
  - `apps/web/src/games/seasons/styles.css` 增加窄屏断点（≤720px）：牌桌与顶栏间距收紧、骰子 44px、卡面 64px（紧凑 44px）、手牌间隙 6px、日志高度 110px；补 `prefers-reduced-motion` 分支。纯样式改动，`pnpm --filter @bgx/web build` 通过。
  - 未做：T4.7b 部署验证（任务边界明确不部署）；T4.4b 需真机手测；T3.6b 需浏览器工具链（见「待确认」）。
  - 下次：T4.7 剩余视觉打磨（可选）、T4.6c 骰子随机路径差分（需给旧引擎注入确定性 `Math.random`）；或进入维护/交接收尾。

- **2026-11-21 07:30–07:40** T4.2b 补充单测 + L1 扩展激活差分。
  - `engine.test.ts` 新增 5 例扩展常驻效果：命运主宰（回合结束水晶 +2）、魔法皇冠（场上 3 张魔法物品 +5、不足不加）、命运之路（储备 ≤1 时排队选 2 能量）、魔法法师（换季偷对手 1 水晶：对手 −1、持有者 +1，与旧引擎 `stealCrystals` 一致）、命运小径（换季抽 1，牌堆 −1）。构造换季场景的办法：month=2 + 剩余骰 pip=1 + 骰面奖励清零，两人各 end-turn 一次即进入 month=3 春季。
  - `oracle-seasons-l1.mjs` 扩展模式新增「4b 扩展激活」段：注入 `pay_energy_reward` 卡，旧引擎逐点问元素（kind `element`）、新引擎一次 element_alloc，逐点比较；--ext 下 83 个检查点一致（召唤序列含扩展卡）。
  - 结果：167 tests 全绿；L1 基础 80 点 / --ext 83 点一致。踩坑：`season_opponent_tax` 是「偷」不是「扣」，单测初版按扣除写导致断言方向反了。
  - 下次：T4.7 剩余视觉打磨（可选）、T4.6c 骰子随机路径差分（需给旧引擎注入确定性 `Math.random`）、energy_swap 超上限取舍（当前截断，旧引擎弹窗）。

- **2026-11-22 00:00–00:10** T4.1c：`energy_swap` 选择。
  - `engine.ts`：骰面能量奖励若 `reserveTotal + 新获得 > maxEnergy`，不再静默截断，改为挂 `pendingChoice {kind:'energy_swap', options:{amount,total,pool,current,incoming}}`；`resolveEnergySwap` 校验「最终保留总量 == total（容量上限）」后一次性写回储备区，日志「储备区将超上限，重新分配能量：旧 → 新」。无 `then` 链路的储备能量获取（如附魔魔典/沙漏/花瓶/命运之路）同样走该弹窗；带 `then` 的链路（乞丐之角、免费召唤等）仍按上限截断，属已知简化。
  - 隐私：`energy_swap` 的 `current`/`incoming` 只下发给应答者，对手/观战者只能看到 `amount/total/pool`（有测试）。
  - 前端 `ChoiceModal` 增加 `energy_swap` 分配界面（显示当前储备与上限、加号按「当前+新获得」封顶、总量必须等于上限才可提交）。
  - 测试：新增 3 例（骰面溢出挂弹窗并重分配、储备获取溢出挂弹窗、总量不等返回 `choice_amount_mismatch`），`seasons-soak.mjs` 的候选生成补 `energy_swap`；170 tests 全绿，web/server build 通过，soak 2/4 人各 100 局通过。
  - 已知差异（记录备查）：旧引擎把容量上限拆成「储备区 7 + reserve_slot 卡上空间」，我们统一按 `maxEnergy` 记在储备区；当 `maxEnergy > 7` 且没有 reserve_slot 卡时，我们的保留量比旧引擎多（旧引擎多出的部分会丢）。（带 `then` 链路的截断简化已在 03:05 补齐，见下方日志。）
  - `apps/server/scripts/seasons-ui-flow.mjs` 的自动应答补上 `resolve-choice` 全部分支（含 `energy_swap`）：原脚本遇到待选直接抛错，energy_swap 上线后会让脚本崩溃；现在重跑输出 `OK 终局：0:-46 1:-47，winner=0，log=80 条`。
  - L1 脚本补「4c. energy_swap 差分」：把两边骰面奖励都改成 0 号骰 +2 水、0 号位储备 6 水 1 风（容量 7），两人各选一颗骰后两边都挂 `energy_swap`，同一份 `{water:5, air:2}` 结算后逐字段一致；检查点从 81/83 增至 **82–83（基础）/ 84–85（--ext）**（随牌堆浮动）。踩坑：旧引擎的 `canTransmute` 不在 `startPlayerAction` 里清，人工摆状态时要两边一起置 false，否则只差这一个字段。
  - 下次：无代码任务；等 Phase 4 需要人拍板/环境的三项（T4.4b、T3.6b、T4.7b），或按需加打磨。

- **2026-11-22 03:00–03:03** 脚本维护 + 差分补骰面奖励段。
  - `seasons-size.mjs` / `seasons-view-perf.mjs` 的自动应答 bot 原先不认 `energy_swap`，energy_swap 上线后两者都会崩（`choice_amount_mismatch` / 无合法候选）；补上 `{water: total}` 候选后恢复。顺带刷新指标：state 131 步，平均 6.3KB / p95 7.2KB / 最大 7.3KB；view 3750 次 48.7ms，平均 0.013ms/次，JSON 平均 2.8KB / 最大 3.6KB（均远低于目标）。
  - `oracle-seasons-l1.mjs` 新增「4d. 骰面奖励 + 回合轮转 + 月份推进」段：两边注入同一组骰面（0 号骰：召唤+1/水晶+2/抽 1/转换/水 1；1 号骰：土 2；剩余骰 pip=2），依次选骰、结束回合、再结束回合，逐点比较首个行动者的骰面奖励、下一位行动者接续、剩余骰点数推进月份。检查点增至 **88（基础）/ 91（--ext）**，全部一致。
  - 说明：骰子「随机路径」本身（旧引擎 `Math.random` 洗牌/掷骰 vs 新引擎 mulberry32）仍不追求逐随机数对齐；现有覆盖是「同一骰面下的奖励结算与回合/月份推进」，随机分布由 soak 的不变式覆盖。
  - 下次：无代码任务；可选视觉打磨，或等 T4.4b/T3.6b 的环境与拍板。

- **2026-11-22 03:03–03:05** energy_swap 补齐 `then` 链路。
  - `resolveElementAlloc` 的溢出拦截从「仅无 `then`」放宽到 `then==='discard_pending'` / `then==='amulet_air'`：排队时在 options 里带 `after:{kind}`，`resolveEnergySwap` 结算后继续「弃掉暂存牌」或「挂弃手牌 card_pick」。这样王冠/元素护符的所有能量获取都不会再被静默截断。
  - 测试：新增 2 例（王冠链路、护符链路），并把原「吸血鬼王冠」用例改成先应答 `energy_swap` 再断言弃牌；172 tests 全绿。
  - 复测：L1 89（基础）/ 90（--ext）检查点一致；soak 2/3/4 人（含三包）全过；state 133 步平均 6.4KB / p95 7.3KB / 最大 7.3KB；view 3750 次 24.2ms（0.006ms/次）；size/view-perf 两个脚本的 bot 也补了 `energy_swap`（否则会崩）。
  - soak 增加「选择分布」输出：2 人 200 局（基础包）中 `energy_swap` 3145 次、`element_alloc` 519 次、`branch` 887 次、`card_list` 124 次、`month_advance` 94 次、`multi_player_pick` 117 次、`card_pick` 14 次，确认新选择路径被真实对局大量覆盖。
  - 已知简化只剩理论不可达的一处：`finish_end_turn` 链路（乞丐之角，触发条件要求储备 ≤1，+1 不可能超上限）。
  - 下次：无代码任务；可选视觉打磨，或等 T4.4b/T3.6b 的环境与拍板。

- **2026-11-22 05:00–05:20** 补最后一批基础卡规则：特殊计分 + 诅咒圣物。
  - 终局特殊计分（旧 `card-effects.js` 的 score 注册表）落地：`scoreEffectCrystals()` 在 `finishGame` 里算 `effectPoints`——拉格菲尔德的头盔（在场牌数严格多于所有对手 → +20）、希迪特的灯笼（储备能量 × 3）、乌尔姆的封印宝箱（场上无随从 → +20）；`score` 计入 `effectPoints`。此前 `effectPoints` 恒为 0，这三张卡等于白板。
  - 奥尼斯的受诅咒灵魂补齐两条：① `turn_end` 持有者失 3 水晶（不足扣光，日志「水晶 -3」）；② 激活（付 1 水）把控制权强制转移给下一位（`applyActivationEffect` 的 `cursed_relic` 分支，`max_energy_plus` 卡按旧 `transferCard` 同步调整双方上限，不看接收方召唤等级）。此前激活会报「尚未实现」。
  - 测试：+3 例（三张计分卡合并计算、宝箱在有随从时不计分、受诅咒灵魂回合结束扣水晶）+1 例（激活转移控制权），**176 tests 全绿**。
  - L1 差分：终局段给座位 0 注入灯笼/头盔/宝箱三张计分卡并断言 `effectPoints > 0`（防止「两边都没算」的假通过）；新增「4b2 诅咒圣物控制权转移」段。检查点 89–93 全部一致（随旧引擎那副随机牌堆里可注入的召唤卡 / 诅咒圣物是否在牌堆而浮动）。
  - soak / ui-flow：2 人 100 局（三包）选择分布里 `energy_swap` 1724 次等，3/4 人各 60 局、ui-flow 终局冒烟均通过。
  - 下次：基础 50 卡 + 扩展 40 卡的效果面已无已知缺口；剩余仍是 T4.4b（真机重连手测）、T3.6b（Playwright 待拍板）、T4.7b（不部署）。

- **2026-11-22 07:00–07:07** 补卡牌离场规则：`on_sacrifice` 与储备上限恢复。
  - 起因：上一时段发现「勾了但空实现」的先例后做全卡审计，发现旧引擎 `sacrificeCard`/`returnToHand` 会调用 `restoreMaxEnergy`（`max_energy_plus` 卡离场时把上限还回去）与 `applySacrificeInternal`（触发 `on_sacrifice`）；我们两处都没做——附魔魔典/命运尖塔被牺牲后上限白涨，诅咒典籍被牺牲也不清储备。
  - 引擎新增 `cardLeavingPlay(player, card)`（按 `abilityAmount(def,'max_energy_plus')` 下调上限，下限 `BASE_MAX_ENERGY`）与 `cardSacrificed(player, card)`（再触发 `on_sacrifice`：目前诅咒典籍 → 四元素储备清零）。接入 6 处离场点：龙之头骨 `sacrifice_cards`、西拉斯/阿姆苏格 `resolveMultiPlayerPick`（return 用 `cardLeavingPlay`、sacrifice 用 `cardSacrificed`）、`potion_power`、SACRIFICE_ON_ACTIVATE（知识/生命/梦境/死灵匕首）、贪吃锅满 7 自牺牲、诅咒圣物转移（原本已有独立上限调整，保持）。
  - 测试 +1（龙之头骨牺牲附魔魔典 + 诅咒典籍：maxEnergy 43→40、储备清空、场上清空、水晶 +15 与计分一致），并在既有「长颈阿姆苏格」用例里补断言：附魔魔典被收回手牌后上限 10→7（覆盖 return 路径），**177 tests 全绿**。
  - L1 差分新增「4e. 牺牲离场」段：把龙之头骨 + 附魔魔典 + 诅咒典籍注入同一座位（两边 maxEnergy 设为 10、储备各 2），旧引擎逐张提交 `card_multi` 选择、新引擎逐张 `resolve-choice`，最后逐字段比对（上限 10→7、储备清零、场上少 3 张、水晶 +15 一致）。检查点增至 **92（基础）/ 95（--ext）**。
  - 未做：受牺牲卡上的 `stored` 能量本就会随卡进弃牌堆消失（我们的 discard 只存 `{i,u}`，没有把能量带回）；这与旧 `clearCardEnergy` 等价，符合预期。
  - 下次：无代码任务；T4.4b 真机重连手测 / T3.6b Playwright（待拍板）/ T4.7b 部署（不做）。

- **2026-11-23 00:00–00:05** 无浏览器渲染冒烟 + 数据 oracle 扩到扩展卡。
  - 新增 `apps/web/scripts/seasons-render-smoke.mjs`：用 Vite 的 `ssrLoadModule` 在 Node 里加载真实的 `Panel.tsx` / `index.tsx`（`import.meta.glob` 由 Vite 处理），再用 `react-dom/server` 渲染——① 跑 2 人（基础+ext1+ext2）与 4 人（三包）整局，每个状态分别以座位 0 / 座位 1 / 观战者渲染；② 合成 9 种 `pendingChoice` 直接渲染 `ChoiceModal`（真实对局不一定会触发全部分支）；③ 调用 `headline`/`statusLine`/`playerBadge`/`eventMessage` 检查文案不返回 undefined。结果 **1149 次渲染无异常**，无 React console.error。
  - `oracle-seasons.mjs` 扩到扩展卡：新增 `cards.ext1.json` / `cards.ext2.json` 读取与 `EXT_CARDS` 比对，输出 `OK 差分基线一致：50 张基础卡 + 40 张扩展卡 + 4 季 × 5 骰 × 6 面`。
  - 长跑 soak：2/3/4 人 + 三包各 300 局（共 900 局）全部通过不变式；选择分布 4 人局 `energy_swap` 10186 次等。
  - 已知边界不变：渲染冒烟不执行浏览器事件/动画（真实交互仍需 T3.6b）；`energy_swap` 容量与旧引擎的 `reserve_slot` 卡上空间差异仍在 §12 记录。
  - 下次：无代码任务；T4.4b 真机重连手测 / T3.6b Playwright（待拍板）/ T4.7b 部署（不做）。
- **2026-11-23 03:00–03:20** T4.6c 徽章差分 + 季节索引修正。
  - L1 新增「4f. 徽章」段：重置到 play/春季，逐项比对徽章 3（gauge+1）、徽章 2（1 能量换当季转换值+1 水晶）、徽章 1（2 换 2）、徽章 4（抽卡升级）→ 顶牌触发摸 2 → badge-keep（旧 payload 是 `cardId`，新是 `cardUid`，需分别映射）。快照新增 `badgeDraw`（uid 列表）与 `badgeDrawUpgrade`。结果：**105–107 个检查点全部一致**（随旧引擎随机牌堆可注入卡数浮动）。
  - 差分抓到真问题：徽章 2 旧引擎按 `month` 推导季节，新引擎用 `state.seasonIdx`；人工摆状态（month=4 但 seasonIdx=0）时旧给 3 水晶、新给 2。已把四处 `TRANSMUTE_VALUE[...][state.seasonIdx]` 改为 `seasonIndexForMonth(state.month)`：普通转换、徽章 2、光之树 B、view 的 `transmuteValues`；新增单测「徽章 2 的季节按 month 推导」。
  - 坑：`oracle-seasons-l1.mjs` 读的是 `../dist/...`，改 src 后必须先 `pnpm --filter @bgx/protocol build && pnpm --filter @bgx/server build` 再跑，否则测的是旧代码（本次就是先看到旧 dist 的差异才想起来）。
  - 待确认（不猜）：旧引擎 `payCost`/`affordable` 只读 `me.energies`，附魔魔典 `reserve_slot` 放在卡上的能量无法支付召唤费用，只能用于 `addEnergyAuto` 溢出/`reserveTotal` 类判断——卡面写「可储存能量」但费用不读，属旧引擎自相矛盾。新引擎当前统一用 `energies`（上限 maxEnergy）近似，故 `maxEnergy>7` 且无 `reserve_slot` 卡时我们可保留的能量更多（`energy_swap` 的「保留总量」按 maxEnergy）。若要逐点复刻需重构能量存放位置，暂不做。
  - 下次：仅剩人工/环境事项（T4.4b 真机重连、T3.6b Playwright e2e 待拍板、T4.7b 部署按边界不做）；或继续给 L1 增加未被对照的卡牌效果（ext 激活简单卡、`use-badge` 的 energy_swap 溢出路径）。
- **2026-11-23 05:00–05:20** T4.6c 扩「基础激活卡」逐卡对照。
  - L1 新增「4g. 基础激活效果逐卡对照」：力量药水（牺牲+抽1+等级+2，无选择）、毁灭者凯恩（弃1水，对手-4水晶）、伊什塔尔天平（弃4水，+12水晶）、知识药水（选 5 能量）、死灵匕首（选 4 能量）、光之树 A（3 水晶→1 能量）、光之树 B（弃1水→当季转换值水晶）。旧的自动结算/`element_pick` 与新的一次 `resolve-choice` 分别应答后逐字段比较；**119 个检查点全部一致**（基础与 `--ext` 均是）。
  - 脚本增强：`runBaseActivation` 在牌堆里找不到目标卡时，会到所有玩家的 `hand/library2/library3/played` 里找（一次会话里同 id 的两张可能已被前序段抽走），找到后从两边所有区域移除再注入场上，避免「牌堆里没有」的假失败。
  - 已知差异（记录，不擅自改）：生命药水旧引擎的 choice 是 `energy_multi`（可一次勾选多种元素，每种的全部能量各 ×4 水晶），新引擎当前是 `element_pick` 单元素。要完全对齐需要新增「多选元素类型」的选择 kind（协议 + 引擎 + 前端弹窗），本时段未做；单元素场景行为一致。
  - 验证：178 tests；`--ext` 差分 119 点一致；soak 60 局（3 人·三包）通过；`seasons-ui-flow.mjs` → `OK 终局：0:-46 1:-47`。
  - 下次：若继续对齐，可先做生命药水的多选 kind；其余人工/环境事项不变（T4.4b/T3.6b/T4.7b）。
- **2026-11-23 05:20–05:45** 生命药水多选元素（`element_multi`）。
  - 动因：L1 4g 段记录的唯一未对齐效果——旧引擎 `energy_multi` 允许一次勾选多种元素，每种的全部能量各 ×4 水晶；新引擎原来只允许选一种。
  - 引擎：`ActivationRequest` 新增 `{kind:'element_multi', elements:[{element,count}], title, label}`；`potion_life` 的请求改为按 `reserveElementCount` 列出每种可用能量；`reduce` 新增 `case 'element_multi'` → `resolveElementMulti`（校验数组、去重、元素必须有能量；逐个元素用 `takeElementEnergy` 扣完，×4 水晶，`markActivated` 后清空 pending）；旧的单元素 `potion_life` 分支已删除。
  - 前端：`ChoiceModal.tsx` 新增 `element_multi` 分支（「水 ×2」式按钮多选、至少选 1 个才可提交），重置逻辑同步清空选择；`styles.css` 复用现有按钮样式，无新增 CSS。
  - 机器人：`seasons-soak` / `seasons-size` / `seasons-view-perf` / `seasons-ui-flow` / `seasons-render-smoke` 的候选生成都补了 `element_multi`（默认选全部可用元素）；渲染冒烟合成弹窗补一条，覆盖 10 种 kind。
  - 测试：`engine.test.ts` 的生命药水用例改为「选 2 种元素 → 水晶 +(5+5)×4」并断言 pending 的 `elements` 列表；新增「重复/空选择」用例（重复 → `invalid_choice`，空数组 → 允许但 0 水晶）。**179 tests 全绿**。
  - L1：4g 新增 potion_life 场景（水 2 + 风 3，旧 `{choice:['water','air']}`、新 `['water','air']`）→ 基础 121 / `--ext` 122 个检查点全部一致。
  - 验证：179 tests；三包 build；L1 121·122；soak 60 局（2 人·三包）；ui-flow OK；渲染冒烟 1150 次、覆盖 `element_multi`。
  - 下次：无已知规则差异待补；剩 T4.4b 真机重连、T3.6b Playwright e2e（待拍板）、T4.7b 部署（不做）。

- **2026-11-23 10:00–10:30** 用户拍板 + Phase 5 储备语义/卡池框架。
  - 用户四项决定：① 不装 Playwright/Chromium（T3.6b 不做，机器内存不够）；② 附魔魔典卡上能量就是普通储备，一切使用场景同储备区，魔典离场若超出上限要「让玩家选择弃掉哪些」；③ T4.4b 断线重连由用户人肉测试；④ 扩展卡占位图暂缓。用户并指出方向：卡牌组成未来会很灵活，框架要容易加/删卡牌、任意卡池都能稳健运行。
  - T5.1：`summon` 的费用支付（普通 + flex + 幸运之手减费后的校验）全部改为读/扣「储备 = `energies` + `reserve_slot` 卡上 `stored`」（`reserveElementCount` / `takeElementEnergy`）；`takeElementEnergy` 只动带 `reserve_slot` 的卡，贪吃锅的 sealed energy 不会被误扣。`energyGap` / `affordableAfterReduction` 同步改用 `reserveElementCount`。新增 `energy_discard` 选择 kind：`normalizeReserve` 只在「本人 maxEnergy 相对上一状态下降」且超出上限时排队；`resolveEnergyDiscard` 校验总和与各元素上限；`promoteQueued` 跳过已失效（储备已不超上限）的弃置选择，reduce 入口也会清理已提升但失效的 `pendingChoice`。前端 `ChoiceModal` 增加分配界面，5 个脚本机器人同步补齐。新增 3 测（卡上能量付召唤费 / 魔典离场弃能量 / 弃置可用量仅本人可见）。
  - T5.2：新增 `cards/support.ts`（`IMPLEMENTED_EFFECT_KEYS` 全量清单 + `validateCardPool`）与 `cards/registry.ts`（`registerCards` / `unregisterCards` / `cardById`），引擎与 effects 的 50 处 `CARD_BY_ID.get` 换成 `cardById`；协议 options 增加 `customDeck`（逗号分隔 id 字符串，兼容 `GameOptionValues`），`setup` 流程改为 `poolCards → assertCardPool → buildDeck`，未知 id/卡池不足/未实现效果都给明确中文错误。新增 4 测（90 张卡校验为空、假卡未实现 key 被 setup 拦下、12 张自定义池正常发牌、未知 id 与卡池不足报错）。
  - 踩坑：① 卡池校验最初要求分数非负，诅咒典籍/受诅咒灵魂是负分，改为「必须是整数」；② 自定义卡池最初想用 `customCards: number[]`，但 `GameOptionValues` 不接受 number[]，改成逗号分隔字符串；③ L1 在 4e 段（牺牲魔典降到 7 上限、随后诅咒典籍清空能量）留下过期 `energy_discard`，导致 energy_swap 段 draft-dice 报 `pending_choice`——修法是 `promoteQueued` 跳过失效弃置 + reduce 入口清理，另把 4f 徽章段摆位上限从 7 调到 8（4×2 能量装得下）。
  - 验证：**186 tests 全绿**；三包 build；L1 基础 119 / `--ext` 122 个检查点一致；soak 2/3/4 人各 80 局（三包）全过；ui-flow `OK 终局：0:-46 1:-47`；state 133 步 avg 6.4KB/p95 7.3KB/max 7.3KB；view 3750 次约 0.017ms/次；渲染冒烟覆盖 11 种弹窗（新增 energy_discard）。
  - 下次：T5.3 把效果分派抽成注册表（改引擎主流程，需先跑通现有测试再逐段迁移）；T5.4 随机卡池 stress；T4.4b 由用户手测断线重连。
  - 10:30–10:45 追加：T5.4 卡池压力测试（soak 第 4 参数 = 随机池大小，`optionsFor(seed)` 随机抽 N 种卡拼 `customDeck`）；2 人 10/12/20 种窄池、4 人 20/30 种、3 人三包各 60 局全部通过。压力测试立刻暴露一个真实死锁：牌堆和弃牌堆都空时，`draw_cards`/`card_pick` 抽不到牌却仍挂起「选 1 张保留」，soak 找不到任何候选。修法：`summon` 里抽到的牌 ≤ 保留数时直接全部入手、不挂弹窗（日志「抽到的牌不足以舍弃，全部保留」），`finish()` 再统一作废「card_pick/card_list 且 pendingCards 为空」的失效选择。新增单测（牌堆+弃牌堆清空后召唤火焰护符：无 pendingChoice、卡正常入场）→ **187 tests 全绿**。另修 soak 的 `EXTENSIONS` 作用域 bug（移出循环，否则 `optionsFor` 取不到）。
  - 验证（10:45）：187 tests；三包 build；L1 基础 121 / `--ext` 122 检查点一致；soak 3 人三包 60 局、4 人随机池 20/30 各 60 局全过；ui-flow `OK 终局：0:-46 1:-47`；渲染冒烟 1151 次覆盖 11 种弹窗。
  - 下次：T5.3 把效果分派抽成注册表（改引擎主流程，建议逐段迁移：先 summon → 再 activate → 再回合末/换季/计分）；之后可选 T5.4 把随机池纳入常规冒烟。
- **2026-11-23 12:47** 部署到本机 BGX（用户要求）。
  - 按 `docs/games/developing-games.md` §8：`pnpm build` → `bash scripts/deploy.sh`（构建并 rsync 到 `/opt/bgx/app` 与 `/var/www/bgx`，重装 bgx.service、reload Apache、健康检查）。脚本可重复执行；中途一次调用被环境中断但未产生部分部署，确认旧 index 未变后重跑成功。
  - 验证：`/bgx/api/games` 返回 `seasons`（名称/描述/6 条规则/扩展包选项/2–4 人）；`/bgx/` 200 且 index 哈希更新为 `index-DHBotQVF.js`；61 个卡图 webp 可访问；bgx.service 12:47:57 重启后 `/healthz` ok；`/opt/bgx/app` 的 dist 含 `energy_discard`（确认部署的是当前版本），用它 setup 三包 2 人得 deck 162、各 9 张手牌。
  - 未做：没有创建测试房间（避免往线上库塞数据）；真实对局留给用户手测。数据库 `/var/lib/bgx/bgx.db` 未改动。

- **2026-11-24 17:48–18:10** 用户裁定：删除扩展卡 + 修正 5 张卡效果。
  - 用户逐条裁定：#4 卡上能量可支付/晶化；#7 时光之靴无水晶+2；#12 娜莉亚抽 N 张（N=人数）、保留 1 张后由使用者指定分给各对手；#36 吸血鬼王冠入场二选一「抽」或「弃」，再按声望得能量；#42 诅咒典籍追加召唤等级+1；#49 夜行者希德严格多于所有对手；51–88（经确认含 89/90）全部删除。
  - 执行：协议卡表 `seasons-cards-all.ts` 重写为基础 50 张、删除 `seasons-cards-ext.ts`；catalog/schema 去掉 `extensions`，只保留 `customDeck`；`support.ts` 白名单收缩到基础 key；引擎 `poolCards` 无自定义池时返回 `SEASONS_CARDS`，移除扩展常驻守卫。
  - 卡上能量语义：#4 等非封印卡上的 `stored` 计入 `reserveElementCount`/`reserveTotal`，可支付召唤费用、可 `transmute` 晶化；`normalizeReserve` 超限只按 `energies` 判断（卡上是额外容量）；`sealed_energy`（贪吃锅）仍不可用。
  - 解析改动：`resolveCardList` 支持 `distribute:'choose'`（娜莉亚保留后逐张 queue `card_pick purpose:'distribute'`，玩家指定交给哪位对手）；`resolveBranch` 支持 `vampiric_crown`（抽/弃牌堆顶 + 按声望选能量，非应答者视图隐藏顶牌）。
  - 测试：删除两个扩展 describe；重写王冠/娜莉亚/时光之靴用例；新增卡上能量付费、卡上能量晶化、诅咒典籍 +1 等级、偷窃妖精触发 4 例。**169 tests 全绿**；protocol/server/web 三包 build 通过。
  - 脚本：`oracle-seasons.mjs` / `oracle-seasons-l1.mjs` / `soak` / `size` / `view-perf` / `ui-flow` / `render-smoke` 全部改为 base-only（`customDeck` 仍支持随机小池）。结果：数据基线 50 卡一致；L1 **118–121 个检查点**一致（旧引擎随机牌序导致浮动；4g 若目标牌已被前面段落消耗，会按 `cards.json` 合成一张 9000+ uid 的临时牌，避免随机失败）；soak 2/3/4 人（含 14/20 种随机池）全过；ui-flow `OK 终局：0:-46 1:-47`；渲染冒烟 1187 次、11 种弹窗；state 136 步 avg 6386B/p95 7295B/max 7318B；view 3750 次 avg 0.0118ms。
  - 未做：`docs/card-effects.md` 与 `bgx_seasons` 副本已同步更新为 50 张；**未部署**（用户要求：除非明确指令否则不同步 BGX 线上）。
  - 下次：T5.3 效果处理器注册表（可选重构）；或等用户继续核对卡效（39/44/9/21/40 仍有已知差异/二义）。

- **2026-11-25 10:35** 用户确认 44 死灵匕首 / 39 提图斯规则并实装。
  - 44 死灵匕首（卡面：「激活：弃手牌 1 随从或牺牲在场 1 随从，得 4 任意能量」）：改为二选一——弃 1 张手牌随从，或牺牲 1 张在场随从；**本卡不牺牲**，随后进入 `element_alloc` 选 4 个任意能量。实现上新增 `sacrifice_cards` 的 `source:'hand_or_play'`（候选 = 手牌随从 + 场上随从；手牌只进弃牌，场上走 `cardSacrificed` 恢复上限），结算完 queue 带 `actId` 的能量分配；没有随从时 `activate` 直接 `invalid_choice`。
  - 39 提图斯：先检查所有对手，只要有一位水晶为 0 就牺牲本卡、**不向任何人收水晶**；全部付得起时才每位对手给 1。此前是「边收边判、付不起也收其他人的」。
  - 测试：死灵匕首 3 例（弃手牌随从、牺牲场上随从、无随从被拒），提图斯断言改为「对手 0 水晶时自己仍是 10」。**171 tests 全绿**；三包 build 通过。
  - L1：死灵匕首移出 4g（旧引擎实现的是「牺牲本卡」，与卡面不一致；按用户裁定以卡面为准，改由单测覆盖）；L1 稳定 116–119 检查点。
  - 部署（2026-11-25 10:40）：三包 build（内存守卫下 protocol/server/web 均通过），rsync web dist → `/var/www/bgx`、仓库 → `/opt/bgx/app`（排除 .git/data/apps/web/src/dist/bgx_seasons），重装 `bgx.service` 并重启，`/healthz` ok。线上验证：入口 `index-DIcHmn62.js`；`/bgx/api/games` 的 seasons 为 2–4 人、options 只剩 `customDeck`；`/opt/bgx/app` 的 engine.js 含 `hand_or_play`；51 张卡图 webp 可访问。
  - 验证汇总：171 tests；L1 116–119 检查点；soak 2 人 100 局 + 3/4 人各 40 局（随机池）全过；ui-flow、渲染冒烟 1187 次、数据基线 50 卡全部通过。

- **2026-11-25 11:10–11:20** 新增预设卡池「五福季节」（用户需求）。
  - 用户确认：五张牌 = 空气护符(id 1) / 火焰护符(2) / 大地护符(3) / 流水护符(4) / 元素护符(31)；每种 20 张共 100 张；作为新选项「标准卡池 / 五福季节」二选一。
  - 实现：`seasons.ts` 新增 `SeasonsPool = 'standard' | 'five_fortunes'` 与 `pool` 选项（默认 `standard`），schema `pool: z.enum([...]).optional()`；引擎把卡池构建改成 `poolEntries(options): {def, copies}[]`（标准 50×2、五福 5×20、customDeck 每种 2），`buildDeck` 按 `copies` 展开。优先级：`customDeck` > `pool` > 标准。
  - 测试：setup 2 人五福季节 → 100 张、发牌后 deck 82、每 id 恰好 20 张；协议测试覆盖 pool 选项与非法值。**172 tests 全绿**。
  - 对局验证：soak 支持第 4 参数传 `five_fortunes`，2 人 60 局、3 人 40 局、4 人 40 局全部通过（纯护符牌池也能打完并结算）。
  - 部署（2026-11-25 11:22，用户指令）：protocol/server/web 三包 build（内存守卫下）通过，rsync web dist → `/var/www/bgx`、仓库 → `/opt/bgx/app`，重装并重启 `bgx.service`，`/healthz` ok。线上验证：入口 `index--blNl5_w.js`；`/bgx/api/games` 的 seasons options 含 `pool`（standard / five_fortunes）与 `customDeck`；`/opt/bgx/app` 的 engine.js/protocol dist 含 `five_fortunes`；51 张卡图可访问。

- **2026-11-25 11:28–11:30** 修「卡池选项导致无法开局」。
  - 现象：房间创建界面同时出现「自定义卡池」下拉（唯一选项为空串、默认空串），与 schema 的 `customDeck` 正则冲突，导致无法开局。
  - 修复：从 `seasonsCatalog.options` 移除 `customDeck`，界面只剩「卡池（标准 / 五福季节）」；`seasonsOptionsSchema` 仍保留可选 `customDeck`（脚本/压力测试直接调用引擎时用），引擎优先级不变（customDeck > pool > 标准）。
  - 验证：172 tests 全绿（协议测试改为断言 options 只有 pool）；重新构建三包并部署，线上 `/bgx/api/games` 的 seasons 只剩 `pool` 一个选项，入口 `index-Cmr8seir.js`，`/healthz` ok。

- **2026-11-25 12:10–12:20** 新增预设卡池「骰子季节」并部署。
  - 需求：牌库 = 100 张 Die of Malice（恶意之骰，id 15，0 费、8 分、行动开始可重掷骰子并得 2 水晶）。
  - 实现：`SeasonsPool` 增加 `'dice_season'`，卡池选项加「骰子季节（100 张恶意之骰）」；引擎 `DICE_SEASON_ID=15 / DICE_SEASON_COPIES=100` 单条目卡池；soak 第 4 参数支持 `dice_season`。界面仍只有「卡池」一个选项。
  - 验证：173 tests 全绿；纯恶意之骰对局可正常打完——soak 2 人 60 局、3 人 40 局、4 人 40 局全过（选择分布主要是 die_of_malice 的 branch 与能量重分配）；三包 build 通过。
  - 部署（12:22）：三包 build（内存守卫）通过，rsync web dist → `/var/www/bgx`、仓库 → `/opt/bgx/app`，重装并重启 `bgx.service`，`/healthz` ok。线上验证：入口 `index-B9jyRy-J.js`；`/bgx/api/games` 的卡池选项为 standard / five_fortunes / dice_season 三个值；`/opt/bgx/app` 的 engine.js 与 protocol dist 含 `dice_season`。

- **2026-11-25 12:30–12:45** 修正恶意之骰的多张结算（用户报告）。
  - 现象：场上有 N 张恶意之骰时，回合开始只问一次是否重掷；应为 N 次，且玩家可在任意次之后放弃。
  - 实现：`dieRerollOf` 改为统计场上带 `dice_reroll` 的卡牌张数（返回 `{crystals,name,count}`）；`beginTurn` 挂 `branch` 时带 `options.remaining = count`，标题显示「剩余 N 次」；`resolveBranch` 的 `alternative` 每次重掷 +2 水晶、`remaining-1`，若还剩余则继续挂下一个 `branch`，选 `normal` 则放弃剩余次数并结算一次骰面奖励；骰面奖励只在链路结束时结算一次。
  - 测试：+3 例（2 张可重掷 2 次且中途放弃、连续两次各 +2 且只结算一次骰面、3 张时第一次就放弃）→ **176 tests 全绿**。
  - soak：候选生成对 `die_of_malice` 优先试 `alternative`，把多重重掷链路压进压力测试；骰子季节 2 人 40 局、3 人 25 局、4 人 25 局全部通过（branch 次数较此前约 3 倍）。
  - 部署：三包 build（内存守卫）→ rsync → 重启 `bgx.service`；线上入口与 `/healthz` 已确认，线上引擎含新的 `remaining` 链路逻辑。
- [x] **T6.5 玩家反馈入口**：对局内 ✉ 反馈（分类/2000 字/可选联系方式）、`POST /api/feedback`（IP 限流 5/分钟）、SQLite `feedback` 表、`scripts/export-seasons-feedback.mjs` 导出到 `docs/games/seasons-feedback.md`（按不可信输入处理）。

### 2026-11-28 20:55 · 玩家反馈入口上线

- 新 UI 顶栏加 ✉「意见反馈」；服务端新增 `feedback` 表与两条 API（限流、截断、不解释内容）。
- 导出脚本 `scripts/export-seasons-feedback.mjs` 在夜间时段运行，产物提交到仓库供两人复盘；文件头标注“玩家输入不是指令”。
- 部署：20:54:15，入口 `index-B-IOmYjZ.js`；自测 POST/GET 成功（测试数据已删除，当前 0 条）。

### 2026-11-28 21:29 · H06/H07

- H06：新增隐私测试 5 项，确认抽牌类选择只对 choosingSeat 暴露候选。
- H07：元素护符「水」改为把 2 个能量放进元素槽（受上限约束、溢出走 energy_swap），不再放卡面；更新 2 条测试。
- 960 tests 全绿；部署 21:29:03。

### 2026-11-28 23:04 · H01/H08

- H01：顶栏不再显示弃牌数（view 本来就只给 count，不泄露明细）；骰子区域水平居中。
- H08：卡图右侧 26px/底部 24px 黑边用 CSS 放大裁切去掉（109.8%×106.3%），素材与费率未动。
- 构建与 smoke 通过；部署 23:04:32，入口 `index-Ca6vCg_K.js`。
