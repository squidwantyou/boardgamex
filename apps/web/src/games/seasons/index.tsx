import {
  seasonsCatalog,
  type SeasonsAction,
  type SeasonsGameView,
} from '@bgx/protocol/games/seasons';
import { SeasonsPanel } from './Panel';
import type { GameUiPlugin } from '../types';

const PHASE_NAME: Record<string, string> = {
  draft: '轮抽',
  organize: '组牌',
  play: '行动',
  ended: '已结束',
};

export const plugin: GameUiPlugin<SeasonsGameView> = {
  meta: {
    ...seasonsCatalog,
    title: seasonsCatalog.name,
    icon: '🍂',
    seats: ['甲', '乙', '丙', '丁'],
    fullBleed: true,
  },
  Panel: SeasonsPanel,
  headline(view, mySeat) {
    const game = view.game;
    if (view.status === 'finished' || game.phase === 'ended') {
      const winner = game.result?.winner ?? view.winner;
      if (winner === null || winner === undefined) return '对局结束';
      if (mySeat === null) {
        const name = view.players.find((player) => player.seat === winner)?.name ?? '对手';
        return `${name} 获胜`;
      }
      return winner === mySeat ? '你赢了' : '这局输了';
    }
    if (mySeat === null) return '观战中';
    if (game.myTurn) return `轮到你 · ${PHASE_NAME[game.phase] ?? game.phase}`;
    return `等待对手 · ${PHASE_NAME[game.phase] ?? game.phase}`;
  },
  statusLine(view) {
    const game = view.game;
    if (game.phase === 'ended') return '对局已结束';
    const who = game.turnOwner !== null ? `座位 ${game.turnOwner + 1} 行动` : '选骰中';
    return `第 ${game.year} 年 · ${game.season?.name ?? '筹备中'} · 第 ${game.month + 1} 月 · ${who}`;
  },
  playerBadge(view, seat) {
    const game = view.game;
    if (view.status !== 'active') return null;
    if (game.turnOwner === seat) return '行动中';
    if (game.pendingChoice?.choosingSeat === seat) return '选择中';
    return null;
  },
  spectatorNote() {
    return '你正在观战，牌桌会实时同步。';
  },
  eventMessage(event) {
    if (event.type === 'match_started') return { text: '对局开始，进入轮抽', tone: 'success' };
    if (event.type === 'summon') return { text: '有玩家召唤了卡牌' };
    if (event.type === 'game_over') return { text: '对局结束' };
    return null;
  },
};

export type { SeasonsAction };
