import type { SeasonsGameView, SeasonsPlayerScore } from '@bgx/protocol/games/seasons';

const SEAT_TINTS = ['#e8c26a', '#5fb0e6', '#7fd6a8', '#e08a6a'] as const;

/** 同分并列：名次 = 比他高的人数 + 1（与引擎 rankings 的 competition ranking 一致）。 */
function rankOf(all: SeasonsPlayerScore[], score: SeasonsPlayerScore): number {
  return 1 + all.filter((other) => other.score > score.score).length;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0';
}

/**
 * F8.1 终局结算：按名次排列表格，总分 + 分数构成条 + 逐项明细。
 * 纯前端渲染，数据全部来自 SeasonsResultView，不新增协议字段。
 */
export function ResultScreen({
  game,
  mySeat,
  playerName = (seat: number) => `座位 ${seat + 1}`,
}: {
  game: SeasonsGameView;
  mySeat: number | null;
  playerName?: (seat: number) => string;
}) {
  const result = game.result;
  if (!result) return null;

  const sorted = [...result.players].sort((a, b) => b.score - a.score || a.seat - b.seat);
  const positives = (score: SeasonsPlayerScore) => [
    { key: 'crystal', label: '水晶', value: score.crystals, cls: 'ss-seg-crystal' },
    { key: 'cards', label: '卡牌', value: score.cardPoints, cls: 'ss-seg-card' },
    { key: 'effect', label: '效果', value: score.effectPoints, cls: 'ss-seg-effect' },
  ];
  const minutes = (score: SeasonsPlayerScore) => [
    { key: 'hand', label: `手牌 ${score.handSize} 张`, value: score.handPenalty },
    { key: 'badge', label: `徽章 ${score.badgesUsed}`, value: score.badgePenalty },
  ];

  return (
    <section className="ss-result" aria-label="终局结算">
      <header className="ss-result-head">
        <div>
          <h3>{result.draw ? '平局' : '终局结算'}</h3>
          <p className="ss-result-sub">
            {result.draw
              ? '最高分并列，本局平局'
              : result.winner !== null
                ? `${playerName(result.winner)} 获胜`
                : '对局结束'}
          </p>
        </div>
        <span className="ss-result-rounds">{game.year} 年 · 第 {game.month + 1} 月</span>
      </header>

      <ol className="ss-result-list">
        {sorted.map((score) => {
          const rank = rankOf(result.players, score);
          const isWinner = !result.draw && score.seat === result.winner;
          const isMe = mySeat === score.seat;
          const parts = positives(score);
          const posTotal = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0);
          return (
            <li
              key={score.seat}
              className={`ss-result-row${isWinner ? ' ss-result-first' : ''}${isMe ? ' ss-result-me' : ''}`}
              style={{ ['--seat-tint' as string]: SEAT_TINTS[score.seat % SEAT_TINTS.length] }}
            >
              <div className="ss-result-line">
                <span className="ss-result-rank" aria-label={`第 ${rank} 名`}>
                  {rank}
                </span>
                <span className="ss-result-seat">
                  {playerName(score.seat)}
                  {isMe && <em>你</em>}
                  {isWinner && <em className="ss-result-crown">胜</em>}
                </span>
                <span className="ss-result-total">
                  {score.score}
                  <small>分</small>
                </span>
              </div>

              <div
                className="ss-result-bar"
                role="img"
                aria-label={parts.map((part) => `${part.label} ${part.value}`).join('，')}
              >
                {posTotal === 0 ? (
                  <span className="ss-result-bar-empty">无正分</span>
                ) : (
                  parts
                    .filter((part) => part.value > 0)
                    .map((part) => (
                      <span
                        key={part.key}
                        className={`ss-seg ${part.cls}`}
                        style={{ flexGrow: part.value }}
                        title={`${part.label} +${part.value}`}
                      />
                    ))
                )}
              </div>

              <dl className="ss-result-breakdown">
                {parts.map((part) => (
                  <div key={part.key}>
                    <dt>{part.label}</dt>
                    <dd>{signed(part.value)}</dd>
                  </div>
                ))}
                {minutes(score).map((part) => (
                  <div key={part.key} className="ss-result-minus">
                    <dt>{part.label}</dt>
                    <dd>−{part.value}</dd>
                  </div>
                ))}
              </dl>

              <p className="ss-result-extra">
                场上 {score.cardsInPlay} 张 · 剩余能量 {score.energyLeft}
              </p>
            </li>
          );
        })}
      </ol>

      <p className="ss-result-note">
        计分：水晶 + 卡牌分 + 效果分 − 手牌数 × 5 − 徽章惩罚（0 / 5 / 12 / 20）
      </p>
    </section>
  );
}
