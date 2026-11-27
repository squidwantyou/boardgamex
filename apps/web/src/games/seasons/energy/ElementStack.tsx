import { memo } from 'react';
import { ELEMENTS, type Element } from '@bgx/protocol/games/seasons';
import { elementArt } from '../art';

/**
 * 元素「堆叠」展示：用可数的小圆片（pip）表示数量，最多显示 5 个；
 * 超过 5 个时折叠为「5 + n」。空值在 showEmpty 时显示淡色 0。
 * 设计约定：界面里不再出现「元素符号 + 数字」的文本。
 */

const ELEMENT_NAME: Record<Element, string> = {
  water: '水',
  air: '风',
  fire: '火',
  earth: '土',
};

const MAX_VISIBLE = 5;

export const ElementPips = memo(function ElementPips({
  element,
  count,
  size = 'md',
  showEmpty = false,
}: {
  element: Element;
  count: number;
  size?: 'sm' | 'md' | 'lg';
  showEmpty?: boolean;
}) {
  const safe = Math.max(0, Math.floor(count));
  const visible = Math.min(safe, MAX_VISIBLE);
  const extra = safe - visible;
  return (
    <span
      className={`ss-pips ss-pips-${element} ss-pips-${size}`}
      title={`${ELEMENT_NAME[element]} × ${safe}`}
      aria-label={`${ELEMENT_NAME[element]}能量 ${safe} 个`}
    >
      {visible === 0 && showEmpty ? (
        <img className="ss-pip ss-pip-empty" src={elementArt(element)} alt="" />
      ) : (
        Array.from({ length: visible }, (_, index) => (
          <img className="ss-pip" src={elementArt(element)} key={index} alt="" />
        ))
      )}
      {extra > 0 && <span className="ss-pip-more">+{extra}</span>}
    </span>
  );
});

/** 四种元素按固定顺序排成一行；用于储备区、骰面奖励、费用摘要。 */
export function ElementRow({
  counts,
  size = 'md',
  showEmpty = true,
  label,
}: {
  counts: Partial<Record<Element, number>>;
  size?: 'sm' | 'md' | 'lg';
  showEmpty?: boolean;
  label?: string;
}) {
  return (
    <div className="ss-element-row" aria-label={label ?? '元素'}>
      {ELEMENTS.map((element) => (
        <ElementPips
          key={element}
          element={element}
          count={counts[element] ?? 0}
          size={size}
          showEmpty={showEmpty}
        />
      ))}
    </div>
  );
}

/** 卡牌费用：只显示非零元素，横向排列；水晶单独用文字角标。 */
export function ElementCost({
  counts,
  crystal = 0,
  size = 'sm',
}: {
  counts: Partial<Record<Element, number>>;
  crystal?: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className="ss-element-cost" aria-label="费用">
      {ELEMENTS.filter((element) => (counts[element] ?? 0) > 0).map((element) => (
        <ElementPips key={element} element={element} count={counts[element] ?? 0} size={size} />
      ))}
      {crystal > 0 && <span className="ss-element-cost-crystal">💎{crystal}</span>}
    </span>
  );
}

/** 元素 + 数量的可点击按钮内容（支付、徽章、护符选择等）。 */
export function ElementChoice({
  element,
  count,
  selected = false,
  size = 'sm',
}: {
  element: Element;
  count: number;
  selected?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className={`ss-element-choice${selected ? ' ss-element-choice-selected' : ''}`}>
      <ElementPips element={element} count={count} size={size} showEmpty />
      <span className="ss-element-choice-name">{ELEMENT_NAME[element]}</span>
    </span>
  );
}
