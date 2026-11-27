import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardArt } from '../art';
import { CARD_COPY } from '../card-copy';
import { useDialog } from '../useDialog';

export function InspectionDetail({ cardId, onClose, anchor }: {
  cardId: number; onClose: () => void; anchor: { x: number; y: number };
}) {
  const ref = useDialog(onClose);
  const [position, setPosition] = useState({ x: 12, y: 12 });
  useLayoutEffect(() => {
    const place = () => {
      const box = ref.current?.getBoundingClientRect();
      if (box) setPosition({ x: Math.max(8, Math.min(anchor.x + 12, window.innerWidth - box.width - 8)),
        y: Math.max(8, Math.min(anchor.y, window.innerHeight - box.height - 8)) });
    };
    place(); const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [anchor.x, anchor.y]);
  const copy = CARD_COPY[cardId];
  return createPortal(<div className="ss-inspect-backdrop" onPointerDown={onClose}>
    <div ref={ref} className="ss-inspect" role="dialog" aria-modal="true"
      aria-label={`${copy?.nameZh ?? cardId} 卡牌详情`}
      style={{ left: position.x, top: position.y }} onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" onClick={onClose} aria-label="关闭卡牌详情">×</button>
      <img src={cardArt(cardId)} alt={copy?.nameZh} />
      <div><h3>{copy?.nameZh}</h3><p>{copy?.desc?.replace(/\\n/g, '\n')}</p></div>
    </div>
  </div>, document.body);
}
