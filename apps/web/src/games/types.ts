import type { ComponentType } from 'react';
import type { GameEvent, GameOptionDefinition, MatchView } from '@bgx/protocol';

/** waiting 阶段没有引擎状态；对局页只在 game 非空时调用插件。 */
export type StartedMatchView<V = unknown> = MatchView<V> & { game: V };

/** 大厅与对局页共用的展示元信息；由游戏模块自带。 */
export interface GameUiMeta {
  id: string;
  title: string;
  tagline: string;
  description: string;
  icon: string;
  /** 每个座位的短标签，例如 ['黑','白'] 或 ['甲','乙'] */
  seats: string[];
  rules: string[];
  /** 开局选项；没有选项给空数组 */
  options: GameOptionDefinition[];
  /** 是否使用铺满对局页的棋盘，隐藏框架的对局标题、玩家栏和提示栏 */
  fullBleed?: boolean;
}

export interface GamePanelProps<V = unknown> {
  view: StartedMatchView<V>;
  mySeat: number | null;
  disabled: boolean;
  /** 游戏动作由插件自己构造，框架只负责发送 */
  onAction: (action: unknown) => void;
}

/**
 * 一个前端游戏插件。
 *
 * 对局页不直接认识任何具体游戏：标题、状态、比分/棋盘、玩家徽标、观战提示
 * 都从插件读取。新增游戏只需新建 games/<id>/index.tsx 并导出 plugin。
 */
export interface GameUiPlugin<V = unknown> {
  meta: GameUiMeta;
  Panel: ComponentType<GamePanelProps<V>>;
  headline(view: StartedMatchView<V>, mySeat: number | null): string;
  statusLine(view: StartedMatchView<V>): string;
  playerBadge?(view: StartedMatchView<V>, seat: number): string | null;
  spectatorNote?(view: StartedMatchView<V>): string;
  /** 把引擎事件翻译成玩家可读的提示；返回 null 表示不提示。 */
  eventMessage?(event: GameEvent): { text: string; tone?: 'info' | 'error' | 'success' } | null;
}
