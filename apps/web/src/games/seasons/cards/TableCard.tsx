import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { SeasonsCardView } from '@bgx/protocol/games/seasons';
import { cardArt, elementArt } from '../art';
import { CARD_COPY } from '../card-copy';

type Inspect = (id: number, anchor: { x: number; y: number }) => void;
const Inspection = createContext<Inspect>(() => {});
export function CardInspection({ inspect, children }: { inspect: Inspect; children: ReactNode }) {
  return <Inspection.Provider value={inspect}>{children}</Inspection.Provider>;
}
export function TableCard({ card, onClick, selected = false, disabled = false, label }: {
  card: SeasonsCardView; onClick?: () => void; selected?: boolean; disabled?: boolean; label?: string;
}) {
  const inspect = useContext(Inspection);
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppress = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const cancel = () => { if (timer.current) suppress.current = true; clear(); };
  useEffect(() => {
    window.addEventListener('scroll', cancel, true);
    window.addEventListener('pointerdown', cancel, true);
    return () => { clear(); window.removeEventListener('scroll', cancel, true); window.removeEventListener('pointerdown', cancel, true); };
  }, []);
  const printedId = card.printedId ?? card.i;
  const open = (x: number, y: number) => { ref.current?.focus(); inspect(printedId, { x, y }); };
  const name = CARD_COPY[printedId]?.nameZh ?? `卡牌 ${printedId}`;
  return <span className={`ss-card-wrap${selected ? ' ss-card-selected' : ''}${card.used ? ' ss-card-is-used' : ''}`}>
    <button ref={ref} type="button" className="ss-card" aria-disabled={disabled || !onClick}
      aria-label={`${name}${card.used ? '，本回合已激活' : ''}`} aria-pressed={selected}
      onContextMenu={(event) => { event.preventDefault(); clear(); open(event.clientX, event.clientY); }}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault(); const box = ref.current!.getBoundingClientRect(); open(box.right, box.top);
        }
      }}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse') { suppress.current = false; clear(); return; }
        if (!event.isPrimary) { cancel(); return; }
        suppress.current = false; origin.current = { x: event.clientX, y: event.clientY };
        timer.current = setTimeout(() => {
          suppress.current = true; timer.current = null; open(origin.current.x, origin.current.y);
        }, 480);
      }}
      onPointerMove={(event) => { if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 9) cancel(); }}
      onPointerUp={clear} onPointerCancel={cancel}
      onClick={(event) => {
        if (suppress.current) { suppress.current = false; event.preventDefault(); return; }
        if (!disabled) onClick?.();
      }}>
      <img src={cardArt(printedId)} alt="" draggable={false} />
      {card.copyOf && <span className="ss-card-hint">复制：{CARD_COPY[card.i]?.nameZh}</span>}
      {label && <span className="ss-card-hint">{label}</span>}
      {card.used && <span className="ss-card-used">已激活</span>}
      {card.stored && <span className="ss-card-reserve">{Object.entries(card.stored).flatMap(([element, count]) =>
        Array.from({ length: count ?? 0 }, (_, index) =>
          <img key={`${element}-${index}`} src={elementArt(element as 'water')} alt={element} />))}</span>}
    </button>
  </span>;
}
