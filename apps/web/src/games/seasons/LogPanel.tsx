import { useEffect, useMemo, useRef, useState } from 'react';
import type { SeasonsGameView, SeasonsLogEntry } from '@bgx/protocol/games/seasons';

type FilterId = 'all' | 'move' | 'draft' | 'season' | 'score';

type Filter = {
  id: FilterId;
  label: string;
  tags: SeasonsLogEntry['t'][] | null;
};

const FILTERS: Filter[] = [
  { id: 'all', label: '全部', tags: null },
  { id: 'move', label: '行动', tags: ['summon', 'activate', 'transmute', 'badge', 'choice', 'effect'] },
  { id: 'draft', label: '轮抽/组牌', tags: ['draft', 'organize'] },
  { id: 'season', label: '季节', tags: ['month', 'season'] },
  { id: 'score', label: '计分', tags: ['score'] },
];

const COLLAPSED = 8;
const MAX_SHOWN = 80;

/**
 * F8.3a 复盘日志：按类别筛选、展开全部、自动滚到最新。
 * 只读 SeasonsLogEntry，不新增协议字段。
 */
export function LogPanel({ game, formatMessage = (message) => message }: {
  game: SeasonsGameView; formatMessage?: (message: string) => string;
}) {
  const [filter, setFilter] = useState<FilterId>('all');
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLOListElement | null>(null);

  const active = FILTERS.find((item) => item.id === filter) ?? FILTERS[0];
  const filtered = useMemo(() => {
    if (!active.tags) return game.log;
    return game.log.filter((entry) => active.tags?.includes(entry.t));
  }, [game.log, active]);

  const limit = expanded ? MAX_SHOWN : COLLAPSED;
  const shown = filtered.slice(-limit).reverse();
  const counts = useMemo(() => {
    const map = new Map<FilterId, number>();
    for (const item of FILTERS) {
      map.set(
        item.id,
        item.tags ? game.log.filter((entry) => item.tags?.includes(entry.t)).length : game.log.length,
      );
    }
    return map;
  }, [game.log]);

  useEffect(() => {
    if (!expanded) return;
    const node = listRef.current;
    if (node) node.scrollTop = 0;
  }, [expanded, game.log.length]);

  return (
    <section className="ss-log">
      <div className="ss-log-head">
        <h3>对局记录</h3>
        <div className="ss-log-tools">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="ss-log-filter"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <em>{counts.get(item.id) ?? 0}</em>
            </button>
          ))}
          <button
            type="button"
            className="ss-log-expand"
            aria-pressed={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '收起' : '展开全部'}
          </button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="ss-muted">这个分类还没有记录</p>
      ) : (
        <ol ref={listRef} reversed start={shown[0]?.seq ?? game.log.length} className={expanded ? 'ss-log-full' : undefined}>
          {shown.map((entry, index) => (
            <li
              key={`${entry.t}-${index}-${entry.msg.slice(0, 8)}`}
              value={entry.seq ?? game.log.indexOf(entry) + 1}
              className={`ss-log-${entry.t}`}
            >
              {formatMessage(entry.msg)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
