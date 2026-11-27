# 四季物语：GPT 交付分支整合计划

> 交付：`bgx_seasons/Angel-develop` @ `f47aa07`，用户已验收；**未合入两仓 main、未部署**。
> 本文是整合清单与验证步骤，执行前需用户确认（见 `TO_GPT.md` §0）。
> 最后核对：2026-11-28 01:15（Asia/Shanghai）

## 0. 基线

| 仓库 | main | 说明 |
| --- | --- | --- |
| `boardgamex`（宿主） | `8b46de9` | 含前端 F1–F10.2、骰面修正 |
| `bgx_seasons`（插件镜像） | `00fee09` | 同上 + `TO_DS.md` |
| 交付分支 | `f47aa07` | 完整 BGX 工作区，955 tests 通过 |

交付分支相对宿主 main 有 263 个路径差异（含 201 张 `cards-bga/*.png` 素材）。不能整仓覆盖：
分支里 docs 路径、`MANIFEST.md`、`.gitmodules` 与插件 main 不同，直接合并会丢文档与子模块。

## 1. 第一步：插件文件合入 `bgx_seasons`

从 `f47aa07` 取以下文件（覆盖或新增），保留 main 上的 `TO_DS.md`、`MANIFEST.md`、`.gitmodules`、`docs/seasons-*.md`：

**协议 / 卡表**
- `packages/protocol/src/games/seasons.ts`
- `packages/protocol/src/games/seasons-cards.ts`
- `packages/protocol/src/games/seasons-cards-all.ts`
- `packages/protocol/src/games/seasons-cards-ext.ts`（新增，50+20+20 卡表）

**引擎**
- `apps/server/src/games/seasons/engine.ts`
- `apps/server/src/games/seasons/rules/state.ts`
- `apps/server/src/games/seasons/cards/{base,effects,support}.ts`
- `apps/server/src/games/seasons/cards/{activation-handlers,event-handlers}.ts`（新增）
- `apps/server/src/seasons-protocol.test.ts`
- `apps/server/src/games/seasons/{engine.test,card-workbook.test,rework.test}.ts`

**前端**
- `apps/web/src/games/seasons/**`（含新增 `ReserveBank.tsx`、`card-copy.ts`、`cards/TableCard.tsx`、`cards/InspectionDetail.tsx`、`table.css`）
- `apps/web/src/assets/seasons/cards-bga/**`（201 张 PNG）

**脚本**
- `scripts/{verify-seasons-assets,qa-seasons-browser,rebuild-seasons-full-faces,extract-seasons-markers,start-seasons-local}.mjs`
- `docs/seasons-assets.json`

**资料**
- `docs/reference/**`（规则 PDF、卡表 xlsx、atlas；xlsx SHA-256 与交付说明一致）

**不要从分支取**：`docs/games/*`（分支删除了三份文档）、`MANIFEST.md`、`.gitmodules`、`TO_DS.md`、`README.md`、`.gitignore`（改为人工合并差异）。

合并后在 `bgx_seasons` 跑：`pnpm --filter @bgx/protocol build && pnpm --filter @bgx/server test`；如前端 build 依赖新素材，跑 `pnpm --filter @bgx/web build`。

## 2. 第二步：宿主改动合入 `boardgamex`

| 文件 | 交付内容 | 风险 |
| --- | --- | --- |
| `apps/server/src/auth.ts`、`src/auth-session.test.ts` | 修复重复同名 Cookie、会话就绪顺序 | 影响其他游戏登录，需全量 server test |
| `apps/server/src/http.ts` | 诊断摘要、Cookie 不明文 | 中 |
| `apps/server/src/index.ts` | 退出时关闭数据库 | 低 |
| `apps/server/src/matches.ts` | 卡池错误表达为设置错误 | 中 |
| `packages/protocol/src/index.ts` | 选项 disabled / 元信息契约 | 影响所有游戏 |
| `apps/web/src/games/types.ts` | `GameUiMeta.fullBleed` | 其他游戏布局需回归 |
| `apps/web/src/pages/MatchPage.tsx` | 全宽牌桌、房间不存在隔离 | 中 |
| `apps/web/src/components/GameOptions.tsx` | 选项禁用提示 | 低 |
| `apps/web/src/lib/{api,socket}.ts` | 重连/会话就绪 | 中 |
| `apps/web/vite.config.ts` | 直接解析 protocol 源码，排除预构建 | 构建一致性 |
| `package.json`、`pnpm-lock.yaml` | 依赖与脚本 | 需重新 install |

宿主改动逐项合入后，前滚 `bgx_seasons` 子模块指针，再更新 `docs/games/seasons-migration.md` §0/§9/§12 与前端计划 §0/§5/§7。

## 3. 验证（按顺序，失败即停）

1. `pnpm install --frozen-lockfile`
2. 三包构建：protocol / server / web（`NODE_OPTIONS=--max-old-space-size=384/384/512`）
3. `pnpm --filter @bgx/server test` —— 目标 9 文件 955 项
4. `node scripts/verify-seasons-assets.mjs` —— 90 卡图 / 120 骰面
5. `pnpm --filter @bgx/web smoke` —— **旧断言需改写**（`ss-band-top` 已换为新布局），改 `apps/web/scripts/seasons-render-smoke.mjs` 入口断言，不得为过旧断言恢复旧 UI
6. 旧脚本复核：`oracle-seasons.mjs`、`oracle-seasons-l1.mjs`、`seasons-soak.mjs` 的卡表假设（50 张 → 90 张），通过/不适用分别记录
7. `seasons-90-v2` 兼容性：不迁移线上旧对局；确认 `DB_PATH` 旧数据不影响新局创建
8. （可选，资源充足时）`scripts/qa-seasons-browser.mjs` 真浏览器 16 项

## 4. 部署与回滚

- 用户点头后：`bash scripts/deploy-local.sh`，记录入口哈希、健康检查、`/api/games`。
- 回滚：保留部署前的 `/opt/bgx/app` 与 `/var/www/bgx` 快照；或 `git reset --hard <旧提交>` 后重跑部署脚本。
- 交付分支不删除；整合完成后在 `TO_GPT.md` 记录「已合并/已部署」与两仓提交。

## 6. 本地整合演练结果（2026-11-28 04:00–04:40，分支 `integrate-f47aa07`）

已把交付的插件 + 宿主改动摘录到 `bgx` 的本地分支 `integrate-f47aa07`（未合并 main、未推送、未部署），结果：

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @bgx/protocol build` | ✅ |
| `pnpm --filter @bgx/server test` | ✅ **9 文件 955 项全绿**（engine 160 / rework 471 / card-workbook 271 / sessions 2 / protocol 6 / 其他） |
| `pnpm --filter @bgx/server build` | ✅ |
| `pnpm --filter @bgx/web build` | ✅ 725.42 kB JS + 59.92 kB CSS |
| `pnpm --filter @bgx/web smoke` | ✅ 1194 次渲染（**断言已改写**：新布局无 `ss-band-top`/`ss-spectator`/`ss-hints`/`ss-modal`，改为 `ss-table`/`ss-log-tools`/`ss-inline-choice`/`ss-die-`；能量重分配候选按 `current+incoming` 上限生成） |
| 90 张卡图 + 91 个 labelled 文件 sha256 对照 `docs/seasons-assets.json` | ✅ miss 0 / bad 0 |
| 骰面 120 张 | ✅ 保留 main 的冬季 2 号骰 4/6 修正，未被交付分支覆盖 |
| 旧 `oracle-seasons.mjs` | ⚠️ 不适用：其基线是旧 50 卡数据，交付按 Excel 改了 33 张费用/分数；由 `card-workbook.test.ts`（271 项）取代 |
| 旧 `oracle-seasons-l1.mjs` | ⚠️ 不适用：同上，且新 `energy_swap` 选择形状变了；不再作为验收门槛 |
| `verify-seasons-assets.mjs` | ⏸ 需要 `sharp` devDependency，本次未安装（用 node crypto 手动校验哈希通过） |

结论：**技术上可以整合**。剩余动作：确认是否把 `integrate-f47aa07` 合入 main、是否安装 sharp/playwright、是否部署。

## 7. 与交付方的差异（并入 main 时需要说明）

- 保留我方 F9.2/F10.1/F10.2 的能力（观战跟随、骰面图例、手牌排序）与冬季骰面修正；交付分支没有这些，合并时不要回退。
- 交付 UI 用内联选择条（`ss-inline-choice`）取代弹窗，术语浮层/卡牌详情/结算表均重写；旧 smoke 断言已按新 UI 改写。
- 交付新增 `card-workbook.test.ts` 作为卡表真源（Excel 271 断言），旧 50 卡 oracle 降级为历史脚本。

## 5. 已知缺口

- 旧 SSR smoke 断言未更新（交付方如实标注，不算通过）。
- oracle/L1 依赖旧 50 卡假设，需按 90 卡重核。
- 交付分支 docs 与插件 main 路径不一致，合并时只取 `docs/reference/`，不覆盖 `docs/games/`。
- 201 张 `cards-bga` PNG 会增大仓库；确认是否全部需要（卡图 90 张 + 扩展背面等）。
