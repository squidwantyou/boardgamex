import { useEffect, useState } from 'react';
import { CARD_BY_ID } from '@bgx/protocol/games/seasons-cards-all';
import {
  ELEMENTS,
  type Element,
  type SeasonsAction,
  type SeasonsCardView,
  type SeasonsGameView,
  type SeasonsElementSource,
} from '@bgx/protocol/games/seasons';
import { cardArt } from './art';
import { ElementPips, ElementRow } from './energy/ElementStack';
import { TableCard } from './cards/TableCard';
import './styles.css';

const ELEMENT_NAME: Record<Element, string> = { water: '水', air: '风', fire: '火', earth: '土' };

function nameOf(card: SeasonsCardView): string {
  return CARD_BY_ID.get(card.i)?.nameZh ?? `卡牌 #${card.i}`;
}

function ChoiceCardButton({
  card,
  selected,
  onClick,
}: {
  card: SeasonsCardView;
  selected: boolean;
  onClick: () => void;
}) {
  return <TableCard card={card} selected={selected} onClick={onClick} />;
}

interface ChoiceModalProps {
  game: SeasonsGameView;
  mySeat: number;
  onSend: (action: SeasonsAction) => void;
  paidSources?: SeasonsElementSource[];
  payTokens?: boolean;
}

export function ChoiceModal({ game, mySeat, onSend, paidSources = [], payTokens = false }: ChoiceModalProps) {
  const pending = game.pendingChoice;
  const [alloc, setAlloc] = useState<Record<Element, number>>({ water: 0, air: 0, fire: 0, earth: 0 });
  const [selectedCards, setSelectedCards] = useState<number[]>([]);
  const [steps, setSteps] = useState(1);

  const choiceKey = pending ? `${pending.kind}:${pending.key}:${JSON.stringify(pending.options)}` : '';
  useEffect(() => {
    setAlloc({ water: 0, air: 0, fire: 0, earth: 0 });
    setSelectedCards([]);
    setSteps(1);
  }, [choiceKey]);

  if (!pending || pending.choosingSeat !== mySeat) return null;

  const options = pending.options;
  const title = typeof options.title === 'string' ? options.title : '请选择';
  const label = typeof options.label === 'string' ? options.label : '确认';
  const kind = pending.kind;
  const cards = Array.isArray(options.cards) ? (options.cards as SeasonsCardView[]) : [];
  const chooser = game.players.find((player) => player.seat === pending.choosingSeat);
  const amount = typeof options.amount === 'number' ? options.amount : kind === 'element_pick' ? 1 : 0;
  const keep = typeof options.keep === 'number' ? options.keep : 1;
  const maxPerElement = (options.maxPerElement ?? {}) as Partial<Record<Element, number>>;
  const allowPartial = options.allowPartial === true;
  const step = typeof options.step === 'string' ? options.step : null;
  const STEP_LABEL: Record<string, string> = {
    source: '第 1/3 步 · 选择源能量',
    amount: '第 2/3 步 · 选择转换数量',
    target: '第 3/3 步 · 选择目标能量',
  };
  const allocTotal = ELEMENTS.reduce((sum, element) => sum + alloc[element], 0);
  const allocValid = allowPartial
    ? allocTotal >= Number(options.minAmount ?? 0) && allocTotal <= amount : allocTotal === amount;

  const toggleCard = (uid: number) => {
    setSelectedCards((current) => {
      if (current.includes(uid)) return current.filter((item) => item !== uid);
      if (current.length >= keep) return current;
      return [...current, uid];
    });
  };

  const submit = (choice: unknown) => onSend({ type: 'resolve-choice', choice });

  let body: React.ReactNode = null;

  if (payTokens || ['energy_swap', 'energy_discard', 'element_pick', 'element_multi'].includes(kind) || options.mode === 'pay') {
    const discarding = kind === 'energy_swap' || kind === 'energy_discard';
    const mirror = pending.key === 'mirror_of_seasons';
    const required = kind === 'energy_swap' ? Number(options.discardAmount ?? Number(options.pool) - Number(options.total))
      : mirror ? 1 : amount;
    const maximum = mirror ? Infinity
      : typeof options.maxAmount === 'number' ? options.maxAmount : required;
    const counts = Object.fromEntries(ELEMENTS.map((element) =>
      [element, paidSources.filter((source) => source.element === element).length]));
    body = <div className="ss-choice-row">
      <ElementRow counts={counts} size="sm" />
      <span>{discarding ? '弃置' : '已选'} {paidSources.length}{Number.isFinite(maximum) ? ` / ${required}` : ''}</span>
      <button type="button" className="ss-button ss-button-primary" disabled={paidSources.length < required || paidSources.length > maximum}
        onClick={() => submit(kind === 'energy_swap' ? { discard: counts, paidSources }
          : kind === 'element_multi' ? { elements: [...new Set(paidSources.map((source) => source.element))], paidSources }
          : mirror ? { id: options.step === 'amount' ? String(paidSources.length) : paidSources[0]?.element,
            amount: paidSources.length, paidSources }
          : kind === 'element_pick'
          ? { element: paidSources[0]?.element, paidSources }
          : { ...counts, paidSources })}>{discarding ? '弃置所选' : label}</button>
    </div>;
  } else if (kind === 'element_alloc') {
    body = (
      <div className="ss-alloc">
        {ELEMENTS.map((element) => {
          const cap = maxPerElement[element] ?? amount;
          return (
            <div className="ss-alloc-row" key={element}>
              <ElementPips element={element} count={cap} size="sm" showEmpty />
              <button
                type="button"
                className="ss-button"
                disabled={alloc[element] <= 0}
                onClick={() => setAlloc((current) => ({ ...current, [element]: current[element] - 1 }))}
              >
                −
              </button>
              <ElementPips element={element} count={alloc[element]} size="sm" showEmpty />
              <button
                type="button"
                className="ss-button"
                disabled={alloc[element] >= cap || allocTotal >= amount}
                onClick={() => setAlloc((current) => ({ ...current, [element]: current[element] + 1 }))}
              >
                ＋
              </button>
            </div>
          );
        })}
        <p className="ss-muted">
          共 {allocTotal} / {amount}
          {allowPartial ? '（可以少选）' : ''}
        </p>
        <button
          type="button"
          className="ss-button ss-button-primary"
          disabled={!allocValid}
          onClick={() => submit(alloc)}
        >
          {label}
        </button>
      </div>
    );
  } else if (kind === 'card_pick' || kind === 'card_list' || kind === 'sacrifice_cards') {
    const pool =
      kind === 'sacrifice_cards'
        ? options.source === 'hand_or_play'
          ? [...(chooser?.played ?? []), ...(chooser?.hand ?? [])].filter(
              (card) => CARD_BY_ID.get(card.printedId ?? card.i)?.type === 'familiar',
            )
          : (chooser?.played ?? []).filter((card) => !options.cageResolution || card.u !== options.summonedUid)
        : kind === 'card_pick' && options.purpose === 'discard'
          ? (chooser?.hand ?? [])
          : cards;
    body = (
      <div className="ss-choice-cards">
        {pool.map((card) => (
          <ChoiceCardButton
            key={card.u}
            card={card}
            selected={selectedCards.includes(card.u)}
            onClick={() => toggleCard(card.u)}
          />
        ))}
        <button
          type="button"
          className="ss-button ss-button-primary"
          disabled={options.variable ? false : selectedCards.length !== keep}
          onClick={() =>
            submit(kind === 'card_list' ? selectedCards : { uid: selectedCards[0],
              ...((pool.find((card) => card.u === selectedCards[0]) as SeasonsCardView & { seat?: number })?.seat !== undefined
                ? { seat: (pool.find((card) => card.u === selectedCards[0]) as SeasonsCardView & { seat: number }).seat } : {}) })
          }
        >
          {label}
        </button>
      </div>
    );
  } else if (kind === 'multi_player_pick') {
    body = (
      <div className="ss-choice-cards">
        {(chooser?.played ?? []).map((card) => (
          <ChoiceCardButton
            key={card.u}
            card={card}
            selected={selectedCards.includes(card.u)}
            onClick={() => setSelectedCards([card.u])}
          />
        ))}
        <button
          type="button"
          className="ss-button ss-button-primary"
          disabled={selectedCards.length !== 1}
          onClick={() => submit({ uid: selectedCards[0] })}
        >
          {label}
        </button>
      </div>
    );
  } else if (kind === 'branch') {
    const branches = Array.isArray(options.branches)
      ? (options.branches as { id: string; label?: string; enabled?: boolean }[])
      : [];
    body = (
      <div className="ss-choice-row">
        {cards.length > 0 && <div className="ss-choice-preview">{cards.map((card) => <TableCard key={card.u} card={card} />)}</div>}
        {branches.map((branch) => (
          <button
            key={branch.id}
            type="button"
            className="ss-button"
             aria-label={ELEMENTS.includes(branch.id as Element) ? ELEMENT_NAME[branch.id as Element] : branch.label ?? branch.id}
            disabled={branch.enabled === false}
            onClick={() => submit({ id: branch.id })}
          >
            {ELEMENTS.includes(branch.id as Element)
              ? <ElementPips element={branch.id as Element} count={1} size="sm" />
              : branch.label ?? branch.id}
          </button>
        ))}
      </div>
    );
  } else if (kind === 'month_advance') {
    body = (
      <div className="ss-choice-row">
        {[1, 2, 3].map((step) => (
          <span key={step} className="ss-choice-row">
            <button
              type="button"
              className={`ss-button${steps === step ? ' ss-button-primary' : ''}`}
              onClick={() => setSteps(step)}
            >
              {step} 格
            </button>
          </span>
        ))}
        <button type="button" className="ss-button" onClick={() => submit({ direction: 'backward', steps })}>
          后退 {steps}
        </button>
        <button type="button" className="ss-button" onClick={() => submit({ direction: 'forward', steps })}>
          前进 {steps}
        </button>
      </div>
    );
  } else {
    body = <p className="ss-muted">暂不支持的选择类型：{kind}</p>;
  }

  return (
    <div className="ss-inline-choice" role="group" aria-label={title}>
        <h3>{title}</h3>
        {step && <p className="ss-choice-step">{STEP_LABEL[step] ?? step}</p>}
        {body}
        {options.optional === true && <button type="button" className="ss-button" onClick={() => submit('skip')}>放弃</button>}
    </div>
  );
}
