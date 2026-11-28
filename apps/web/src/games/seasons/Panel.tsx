import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { CARD_BY_ID } from '@bgx/protocol/games/seasons-cards-all';
import {
  ELEMENTS,
  type Element,
  type SeasonsAction,
  type SeasonsCardView,
  type SeasonsDieView,
  type SeasonsElementSource,
  type SeasonsGameView,
  type SeasonsPlayerView,
} from '@bgx/protocol/games/seasons';
import type { GamePanelProps } from '../types';
import { cardArt, cardFullArt, dieArt, elementArt, starArt, tableArt } from './art';
import { CARD_COPY } from './card-copy';
import { ChoiceModal } from './ChoiceModal';
import { TableCard, CardInspection } from './cards/TableCard';
import { InspectionDetail } from './cards/InspectionDetail';
import { ReserveBank } from './ReserveBank';
import { LogPanel } from './LogPanel';
import { FeedbackDialog } from './FeedbackDialog';
import { ResultScreen } from './ResultScreen';
import { Glossary } from './Glossary';
import { markerArt } from './art';
import './styles.css';
import './table.css';

const ELEMENT_NAME: Record<Element, string> = {
  water: '水',
  air: '风',
  fire: '火',
  earth: '土',
};

const MAX_BADGES = 3;
const BASE_ENERGY_SLOTS = 7;

function sourceCount(
  player: SeasonsPlayerView,
  element: Element,
  selected: readonly SeasonsElementSource[],
  cardUid: number,
): number {
  const used = selected.filter(
    (source) => source.element === element && (source.cardUid ?? 0) === cardUid,
  ).length;
  if (cardUid === 0) return player.energies[element] - used;
  const card = player.played.find((item) => item.u === cardUid);
  return (card?.stored?.[element] ?? 0) - used;
}

function sourceKey(source: SeasonsElementSource): string {
  return `${source.source}:${source.cardUid ?? 0}:${source.slot ?? 0}:${source.element}`;
}

/** 400×400 季节轮素材上的月份轨道中心（从 1 月顺时针）。 */
const MONTH_PLACEMENT = [
  [246, 28], [326, 74], [372, 154], [372, 246],
  [326, 326], [246, 372], [154, 372], [74, 326],
  [28, 246], [28, 154], [74, 74], [154, 28],
] as const;

/** 三个印刷年份圆的外轮廓中心；只描边，不覆盖数字。 */
const YEAR_PLACEMENT = [
  { x: 166, y: 200, size: 30 },
  { x: 199, y: 200, size: 30 },
  { x: 231, y: 200, size: 30 },
] as const;

const BADGE_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: '换能量',
  2: '能量换水晶',
  3: '召唤等级 +1',
  4: '抽卡升级',
};

type BadgeType = 1 | 2 | 3 | 4;
type DrawDecision = {
  cards: SeasonsCardView[];
  keep: number;
  titled: string;
};

function cardName(id: number): string {
  return CARD_COPY[id]?.nameZh ?? CARD_BY_ID.get(id)?.nameZh ?? `卡牌 #${id}`;
}

function cardDescription(id: number): string {
  return CARD_COPY[id]?.desc ?? CARD_BY_ID.get(id)?.desc ?? '这张牌目前没有效果说明。';
}

function isFlexCard(id: number): boolean {
  return Boolean(CARD_BY_ID.get(id)?.costFlexible);
}

function isActivatable(id: number): boolean {
  const effect = CARD_BY_ID.get(id)?.effect;
  return Boolean(effect && (effect.trigger === 'activation' || effect.triggers.includes('activation')));
}

function abilityOptions(id: number): { key: string; label: string }[] {
  return (CARD_BY_ID.get(id)?.effect?.abilities ?? [])
    .filter((ability) => ability.kind === 'activation_ability' && ability.key)
    .map((ability) => ({ key: ability.key!, label: ability.label ?? ability.key! }));
}

function playerName(view: GamePanelProps<SeasonsGameView>['view'], seat: number): string {
  return view.players.find((player) => player.seat === seat)?.name ?? `玩家 ${seat + 1}`;
}

/**
 * 基础槽固定七格。实际储备超过七项时继续追加可见槽；
 * 槽内容只表示已获得的元素，不显示数量或上限。
 */
function energySlots(player: SeasonsPlayerView): (Element | null)[] {
  const elements: Element[] = [];
  for (const element of ELEMENTS) {
    for (let index = 0; index < player.energies[element]; index += 1) elements.push(element);
  }
  return Array.from(
    { length: Math.max(BASE_ENERGY_SLOTS, player.maxEnergy, elements.length) },
    (_, index) => elements[index] ?? null,
  );
}

function reserveSources(
  player: SeasonsPlayerView,
  selected: readonly SeasonsElementSource[],
): SeasonsElementSource[] {
  const result: SeasonsElementSource[] = [];
  for (const element of ELEMENTS) {
    const used = selected.filter(
      (source) => source.source === 'reserve' && source.element === element,
    ).length;
    for (let index = used; index < player.energies[element]; index += 1) {
      result.push({ element, source: 'reserve', slot: index });
    }
  }
  return result;
}

function CardFace(props: {
  card: SeasonsCardView; onClick?: () => void; disabled?: boolean; selected?: boolean; label?: string;
  onInspect?: (card: SeasonsCardView, x: number, y: number) => void;
  reserve?: Partial<Record<Element, number>>;
}) { return <TableCard {...props} />; }

function PlayerIdentity({
  player,
  name,
  isMe,
  canAct,
  drawUpgrade,
  selectedDice,
  onBadge,
  onInspect,
  onSend,
  payment,
  paying,
  onSource,
  reserveOnly,
}: {
  player: SeasonsPlayerView;
  name: string;
  isMe: boolean;
  canAct: boolean;
  drawUpgrade: boolean;
  selectedDice: SeasonsDieView[];
  onBadge: (type: BadgeType, dieId?: number) => void;
  onInspect: (card: SeasonsCardView, x: number, y: number) => void;
  onSend: (action: SeasonsAction) => void;
  payment: readonly SeasonsElementSource[];
  paying: boolean;
  onSource: (source: SeasonsElementSource) => void;
  reserveOnly: boolean;
}) {
  const [library, setLibrary] = useState<2 | 3 | null>(null);
  const used = Math.min(MAX_BADGES, player.badgesUsed);
  const cardPoints = player.played.reduce((sum, card) => sum + (CARD_BY_ID.get(card.printedId ?? card.i)?.points ?? 0), 0);
  const count = library === 2 ? player.library2Count : library === 3 ? player.library3Count : 0;
  const cards = library === 2 ? player.library2 : library === 3 ? player.library3 : null;
  const badges = tableArt('bonuses');

  return (
    <section className={`ss-identity${isMe ? ' ss-identity-me' : ''}`}>
      <span className="ss-identity-crystal">◈ {player.crystals}</span>
      <span className="ss-identity-points">{cardPoints}</span>
      <span className="ss-avatar" aria-hidden>{name.slice(0, 1)}</span>
      <b className="ss-identity-name" title={name}>{name}</b>
      <span className="ss-identity-dice" aria-label={`${name} 已选择的季节骰`}>
        {selectedDice.map((die) => {
          const art = dieArt(die.letter, die.id, die.face);
          return art ? (
            <img key={die.id} src={art} alt="" draggable={false} />
          ) : (
            <i key={die.id} aria-hidden />
          );
        })}
      </span>
      <ReserveBank player={player} selected={payment} paying={paying} onSelect={onSource} reserveOnly={reserveOnly} />
      <div className="ss-badge-grid" aria-label="徽章行动">
        {[1, 2, 3, 4].map((type) => (
          <button
            key={type}
            type="button"
            className={`ss-badge${used >= MAX_BADGES ? ' ss-badge-used' : ''}`}
            disabled={!isMe || (!canAct && !(type === 4 && drawUpgrade)) || used >= MAX_BADGES}
            title={`${BADGE_LABEL[type as BadgeType]}${used >= MAX_BADGES ? '（已用完）' : ''}`}
            aria-label={BADGE_LABEL[type as BadgeType]}
            onClick={() => onBadge(type as BadgeType)}
            data-badge={type}
            style={badges ? ({ '--ss-bonus-image': `url("${badges}")` } as CSSProperties) : undefined}
          >
            <img src={markerArt(`badge-${type}`)} alt="" />
          </button>
        ))}
      </div>
      <div className="ss-year-pips">
        {[2, 3].map((year) => (
          <button
            key={year}
            type="button"
            className={library === year ? 'ss-year-active' : undefined}
            onClick={() => setLibrary((current) => (current === year ? null : (year as 2 | 3)))}
            title={`查看第 ${year} 年手牌`}
            aria-label={`查看第 ${year} 年手牌`}
            aria-pressed={library === year}
          >
            <img src={markerArt(`year-${year}`)} alt="" />
          </button>
        ))}
      </div>
      {library !== null && (
        <div className="ss-year-overlay">
          <header>
            <b>第 {library} 年</b>
            <span>{count} 张</span>
            <button type="button" onClick={() => setLibrary(null)} aria-label="关闭年份手牌">×</button>
          </header>
          <div>
            {isMe && cards
              ? cards.map((card) => (
                  <TableCard key={card.u} card={card} />
                ))
              : Array.from({ length: Math.min(count, 9) }, (_, index) => (
                  <span className="ss-card-back" key={index} aria-label="隐藏的年份手牌" />
                ))}
          </div>
        </div>
      )}
    </section>
  );
}

function AbilityPicker({
  card,
  onPick,
  onCancel,
}: {
  card: SeasonsCardView;
  onPick: (key: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="ss-inline-choice" role="group" aria-label="选择激活效果">
        <h3>选择激活效果 · {cardName(card.i)}</h3>
        <div className="ss-modal-actions ss-modal-column">
          {abilityOptions(card.i).map((ability) => (
            <button type="button" className="ss-button" key={ability.key} onClick={() => onPick(ability.key)}>
              {ability.label}
            </button>
          ))}
          <button type="button" className="ss-button ss-button-ghost" onClick={onCancel}>取消</button>
        </div>
    </div>
  );
}

export function SeasonsPanel({ view, mySeat, disabled, onAction }: GamePanelProps<SeasonsGameView>) {
  const game = view.game;
  const me = mySeat === null ? null : game.players.find((player) => player.seat === mySeat) ?? null;
  const [hovered, setHovered] = useState<SeasonsCardView | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [detailOpen, setDetailOpen] = useState(false);
  const [abilityCard, setAbilityCard] = useState<SeasonsCardView | null>(null);
  const [organizePicked, setOrganizePicked] = useState<number[]>([]);
  const [actionStage, setActionStage] = useState<
    | { kind: 'summon'; card: SeasonsCardView; otus?: boolean }
    | { kind: 'activate'; card: SeasonsCardView }
    | { kind: 'transmute' }
    | { kind: 'badge'; type: BadgeType }
    | null
  >(null);
  const [actionPayment, setActionPayment] = useState<SeasonsElementSource[]>([]);
  const [actionReceived, setActionReceived] = useState<Element[]>([]);
  const [draftKeep, setDraftKeep] = useState<SeasonsCardView | null>(null);
  const [drawDecision, setDrawDecision] = useState<DrawDecision | null>(null);
  const [handSort, setHandSort] = useState('default');
  const [handFilter, setHandFilter] = useState('all');
  const [glossary, setGlossary] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [follow, setFollow] = useState(true);
  const closeDetail = useCallback(() => setDetailOpen(false), []);
  const logText = (text: string) =>
    text
      .replace(/(?:座位|玩家) (\d+)/g, (_match, seat: string) => playerName(view, Number(seat) - 1))
      .replace(/（点数 \d+）/g, '')
      .replace(/季季/g, '季');
  useEffect(() => {
    if (mySeat === null && follow && game.turnOwner !== null) {
      document.querySelector(`[data-player-seat="${game.turnOwner}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [game.turnOwner, follow, mySeat]);

  const send = (action: SeasonsAction) => {
    if (disabled || view.status !== 'active') return;
    onAction(action);
  };

  const boardArt = tableArt('board-bg');
  const yearIcons = tableArt('icons2022');
  const isMyPendingChoice = game.pendingChoice?.choosingSeat === mySeat;
  const winterStaff = Math.floor(game.month / 3) % 4 === 0 &&
    !!me?.played.some((card) => card.i === 78 && !card.lockedBy);
  const canOrganize =
    !disabled && view.status === 'active' && game.phase === 'organize' && game.myTurn && !isMyPendingChoice;
  const canPickDie =
    !disabled &&
    view.status === 'active' &&
    game.phase === 'play' &&
    game.turnOwner === null &&
    game.currentPicker === mySeat &&
    !isMyPendingChoice;
  const canPlay =
    !disabled &&
    view.status === 'active' &&
    game.phase === 'play' &&
    game.turnOwner === mySeat &&
    !game.pendingChoice &&
    !me?.badgeDraw?.length;
  const canPickDraft =
    !disabled &&
    view.status === 'active' &&
    game.phase === 'draft' &&
    game.myTurn &&
    !isMyPendingChoice;

  const inspect = (card: SeasonsCardView, x: number, y: number) => {
    setHovered(card);
    setHoverPos({
      x: Math.min(Math.max(12, x), Math.max(12, window.innerWidth - 430)),
      y: Math.min(Math.max(12, y - 80), Math.max(12, window.innerHeight - 580)),
    });
    setDetailOpen(true);
  };
  const leaveHover = () => setDetailOpen(false);
  const activate = (card: SeasonsCardView) => {
    if (!canPlay || card.lockedBy) return;
    if ([50, 80, 88].includes(card.i)) {
      setActionPayment([]);
      setActionStage({ kind: 'activate', card });
      return;
    }
    const options = abilityOptions(card.i);
    if (options.length > 1) setAbilityCard(card);
    else send({
      type: 'activate',
      cardUid: card.u,
      ...(options[0] ? { abilityKey: options[0].key } : {}),
    });
  };
  const summon = (card: SeasonsCardView, otus = false) => {
    if (!canPlay) return;
    const def = CARD_BY_ID.get(card.i);
    const cost = def ? { ...def.cost, ...def.costByPlayers?.[String(game.playerCount) as '2'] } : undefined;
    const energyCost = cost ? ELEMENTS.reduce((sum, element) => sum + cost[element], 0) : 0;
    const hasChoice = def?.costFlexible || (energyCost > 0 && (
      (winterStaff && (cost?.earth ?? 0) > 0) ||
      me?.played.some((item) => {
        if (item.lockedBy) return false;
        const abilities = CARD_BY_ID.get(item.i)?.effect?.abilities ?? [];
        return (energyCost > 1 && abilities.some((ability) => ability.kind === 'cost_reduction')) ||
          (abilities.some((ability) => ability.kind === 'reserve_slot') &&
            !abilities.some((ability) => ability.kind === 'sealed_energy') &&
            ELEMENTS.some((element) => (item.stored?.[element] ?? 0) > 0 && (cost?.[element] ?? 0) > 0));
      })
    ));
    if (!hasChoice) {
      send({ type: otus ? 'summon-otus' : 'summon', cardUid: card.u });
      return;
    }
    setActionPayment([]);
    setActionStage({ kind: 'summon', card, otus });
  };
  const organize = (card: SeasonsCardView) => {
    if (!canOrganize) return;
    const serverPicked = me?.organizeYear1 ?? [];
    const current = organizePicked.filter((uid) => !serverPicked.includes(uid));
    const next = current.includes(card.u)
      ? current.filter((uid) => uid !== card.u)
      : [...current, card.u];
    if (next.length <= 3) setOrganizePicked(next);
  };
  const badgeAction = (type: BadgeType, dieId?: number) => {
    if (!canPlay && !(type === 4 && game.pendingChoice?.key === 'die_draw' && isMyPendingChoice)) return;
    if (type === 3) {
      send({ type: 'use-badge', badgeType: type });
      return;
    }
    if (type === 2) {
      send({ type: 'use-badge', badgeType: 2 });
      return;
    }
    if (type === 4) {
      const drawDie = game.dice.find(
        (die) => die.pickedBy === me?.seat && die.rewards.card,
      );
      if (!drawDie) return;
      send({ type: 'use-badge', badgeType: 4, dieId: drawDie.id });
      return;
    }
    setActionPayment([]);
    setActionReceived([]);
    setActionStage({ kind: 'badge', type });
  };
  const paymentRequirement = (() => {
    if (!me) return null;
    if (!actionStage && isMyPendingChoice && game.pendingChoice) {
      const pending = game.pendingChoice;
      if (pending.kind === 'energy_swap' || pending.kind === 'energy_discard') {
        const amount = pending.kind === 'energy_swap'
          ? Number(pending.options.discardAmount ?? Number(pending.options.pool) - Number(pending.options.total))
          : Number(pending.options.amount);
        return { amount, maxAmount: amount, maxPerType: amount, reserveOnly: true,
          kind: 'any', title: '', hint: '' };
      }
      if (pending.kind === 'element_multi') {
        const amount = Number(pending.options.amount ?? 0);
        return { amount, maxAmount: amount, maxPerType: amount, kind: 'any', title: '', hint: '' };
      }
      if (pending.key === 'mirror_of_seasons' && pending.options.step !== 'target') {
        return { amount: 1, maxAmount: me.crystals, maxPerType: me.crystals,
          perType: pending.options.step === 'amount' ? { [String(pending.options.source)]: me.crystals } : undefined,
          kind: 'same', title: '', hint: '' };
      }
    }
    if (!actionStage && isMyPendingChoice && (game.pendingChoice?.kind === 'element_pick' ||
      game.pendingChoice?.options.mode === 'pay')) {
      const amount = Number(game.pendingChoice.options.amount ?? 1);
      const flex = game.pendingChoice.options.flexible as { maxPerType: number } | undefined;
      return { amount, maxAmount: Number(game.pendingChoice.options.maxAmount ?? amount),
        maxPerType: flex?.maxPerType ?? amount,
        reserveOnly: game.pendingChoice.options.reserveOnly === true,
        perType: game.pendingChoice.options.maxPerElement as Partial<Record<Element, number>> | undefined,
        earthWild: winterStaff && game.pendingChoice.key === 'raven_payment',
        kind: game.pendingChoice.kind === 'element_pick' && !(winterStaff &&
          ['balance_of_ishtar', 'estorian_harp', 'jewel_of_the_ancients'].includes(game.pendingChoice.key)) ? 'same' : 'any',
        title: '', hint: '' };
    }
    if (!actionStage) return null;
    if (actionStage.kind === 'activate' || actionStage.kind === 'transmute') {
      const element = actionStage.kind === 'activate' ? actionStage.card.i === 88 ? 'air' : 'water' : undefined;
      return { amount: 1, maxAmount: 1, maxPerType: 1, perType: element ? { [element]: 1 } : undefined,
        earthWild: false,
        kind: 'fixed', title: actionStage.kind === 'transmute' ? '元素晶化'
          : `激活「${cardName(actionStage.card.i)}」`, hint: '' };
    }
    if (actionStage.kind === 'summon') {
      const def = CARD_BY_ID.get(actionStage.card.i);
      if (def?.costFlexible) {
        return {
          amount: def.costFlexible.min,
          maxAmount: Math.min(def.costFlexible.max || 4, ELEMENTS.length),
          maxPerType: def.costFlexible.maxPerType || 1,
          kind: 'flex',
          title: `召唤「${cardName(actionStage.card.i)}」`,
          hint: `从储备中选择 ${def.costFlexible.min}~${Math.min(def.costFlexible.max || 4, ELEMENTS.length)} 种元素`,
        };
      }
      const cost = def ? { ...def.cost, ...def.costByPlayers?.[String(game.playerCount) as '2'] } : undefined;
      const elements = ELEMENTS.flatMap((element) =>
        Array.from({ length: cost?.[element] ?? 0 }, () => element),
      );
      const crystal = cost?.crystal ?? 0;
      const reduction = me.played.reduce((sum, card) => sum + (card.lockedBy ? 0 : CARD_BY_ID.get(card.i)?.effect?.abilities
        ?.filter((ability) => ability.kind === 'cost_reduction').reduce((n, ability) => n + (ability.amount ?? 0), 0) ?? 0), 0);
      const amount = Math.max(elements.length ? 1 : 0, elements.length - reduction);
      return elements.length > 0 || crystal > 0
        ? {
            amount,
            maxAmount: amount,
            maxPerType: Math.max(1, ...ELEMENTS.map((element) => cost?.[element] ?? 0)),
            perType: cost,
            earthWild: winterStaff,
            kind: 'fixed',
            title: `召唤「${cardName(actionStage.card.i)}」`,
            hint: [
              elements.length > 0 ? `元素 ${amount} 个${amount < elements.length ? '（已减费）' : ''}` : '',
              crystal > 0 ? `水晶 ${crystal}` : '',
            ].filter(Boolean).join('，'),
          }
        : {
            amount: 0,
            maxAmount: 0,
            maxPerType: 0,
            kind: 'fixed',
            title: `召唤「${cardName(actionStage.card.i)}」`,
            hint: crystal > 0 ? `水晶 ${crystal}` : '无需支付',
          };
    }
    if (actionStage.kind === 'badge' && actionStage.type === 1) {
      return {
        amount: 2,
        maxAmount: 2,
        maxPerType: 2,
        kind: 'exchange',
        title: '徽章①：元素互换',
        hint: '选择要支付的 2 个储备元素',
      };
    }
    return null;
  })();
  const toggleActionPayment = (source: SeasonsElementSource) => {
    if (!paymentRequirement || !me) return;
    if (paymentRequirement.reserveOnly && source.source !== 'reserve') return;
    const index = actionPayment.findIndex(
      (item) => sourceKey(item) === sourceKey(source),
    );
    if (index >= 0) {
      setActionPayment((current) => current.filter((_, item) => item !== index));
      return;
    }
    if (
      actionPayment.length < paymentRequirement.maxAmount &&
      (paymentRequirement.kind !== 'same' || !actionPayment.length || source.element === actionPayment[0]!.element) &&
      (!['horn_of_plenty', 'fairy_monolith_store', 'chalice_of_eternity_store'].includes(game.pendingChoice?.key ?? '') || source.source === 'reserve') &&
      (game.pendingChoice?.kind === 'energy_swap' ||
        sourceCount(me, source.element, actionPayment, source.cardUid ?? 0) > 0) &&
      (paymentRequirement.earthWild && paymentRequirement.perType
        ? ELEMENTS.reduce((sum, element) => sum + (element === 'earth'
          ? [...actionPayment, source].filter((item) => item.element === element).length
          : Math.max(0, [...actionPayment, source].filter((item) => item.element === element).length -
            (paymentRequirement.perType?.[element] ?? 0))), 0) <= (paymentRequirement.perType.earth ?? 0)
        : actionPayment.filter((item) => item.element === source.element).length <
          (paymentRequirement.perType ? paymentRequirement.perType[source.element] ?? 0 : paymentRequirement.maxPerType))
    ) {
      setActionPayment((current) => [...current, source]);
    }
  };
  const toggleActionReceived = (element: Element) => {
    setActionReceived((current) =>
      current.length < 2 ? [...current, element] : current,
    );
  };
  const cancelAction = () => {
    setActionStage(null);
    setAbilityCard(null);
    setActionPayment([]);
    setActionReceived([]);
  };
  const confirmAction = () => {
    if (!actionStage) return;
    if (actionPayment.length < (paymentRequirement?.amount ?? 0)) return;
    if (actionStage.kind === 'activate') {
      send({ type: 'activate', cardUid: actionStage.card.u, paidSources: actionPayment });
      cancelAction();
      return;
    }
    if (actionStage.kind === 'transmute') {
      send({ type: 'transmute', element: winterStaff ? 'earth' : actionPayment[0]!.element, paidSources: actionPayment });
      cancelAction();
      return;
    }
    if (actionStage.kind === 'summon') {
      const def = CARD_BY_ID.get(actionStage.card.i);
      send({
        type: actionStage.otus ? 'summon-otus' : 'summon',
        cardUid: actionStage.card.u,
        ...(def?.costFlexible
          ? { paidSources: actionPayment }
          : actionPayment.length > 0
            ? { paidSources: actionPayment }
            : {}),
      });
      cancelAction();
      return;
    }
    if (actionStage.kind === 'badge') {
      if (actionStage.type === 1) {
        if (actionReceived.length !== 2) return;
        send({
          type: 'use-badge',
          badgeType: 1,
           paidSources: actionPayment,
          fromElements: [actionPayment[0]!.element, actionPayment[1]!.element],
          toElements: [actionReceived[0]!, actionReceived[1]!],
        });
      } else if (actionStage.type === 3) {
        send({ type: 'use-badge', badgeType: 3 });
      }
    }
    cancelAction();
  };

  useEffect(() => {
    setOrganizePicked([]);
  }, [game.draftRound, game.phase, game.month]);
  useEffect(() => {
    setActionPayment([]);
    setActionReceived([]);
    setActionStage(null);
    setAbilityCard(null);
  }, [game.month, game.turnOwner, game.pendingChoice?.kind, game.pendingChoice?.key,
    JSON.stringify(game.pendingChoice?.options)]);
  useEffect(() => {
    setDraftKeep(null);
    if (game.pendingChoice?.key !== 'die_draw') {
      setDrawDecision(null);
      return;
    }
    const cards = Array.isArray(game.pendingChoice.options.cards)
      ? (game.pendingChoice.options.cards as SeasonsCardView[])
      : [];
    setDrawDecision({
      cards,
      keep: typeof game.pendingChoice.options.keep === 'number'
        ? game.pendingChoice.options.keep
        : 1,
      titled: game.pendingChoice.options.title as string,
    });
  }, [game.pendingChoice]);
  useEffect(() => {
    if (!detailOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [detailOpen]);

  const organizedYear1 = game.phase === 'organize' ? me?.organizeYear1 ?? [] : [];
  const organizedYear2 = game.phase === 'organize' ? me?.organizeYear2 ?? [] : [];
  const organized = [...organizedYear1, ...organizedYear2];
  const visibleDrafted =
    game.phase === 'organize' ? me?.organizeRemaining ?? [] : me?.drafted ?? [];
  const handCards =
    (game.phase === 'draft'
      ? me?.draftHand
      : game.phase === 'organize'
        ? visibleDrafted
         : me?.hand) ?? [];
  const sortedHand = handCards.filter((card) => game.phase !== 'play' || handFilter === 'all' ||
    CARD_BY_ID.get(card.i)?.type === handFilter).sort((a, b) => {
    if (handSort === 'default' || game.phase !== 'play') return 0;
    const ac = CARD_BY_ID.get(a.i)!; const bc = CARD_BY_ID.get(b.i)!;
    const total = (cost: typeof ac.cost) => ELEMENTS.reduce((sum, element) => sum + cost[element], 0);
    return (handSort === 'type' ? ac.type.localeCompare(bc.type) : 0) ||
      total(ac.cost) - total(bc.cost) || ac.cost.crystal - bc.cost.crystal;
  });
  const handStyle = {
    '--ss-hand-count': String(Math.max(1, Math.min(10, handCards.length))),
  } as CSSProperties;
  const fullArt = hovered ? cardFullArt(hovered.i) ?? cardArt(hovered.i) : undefined;
  const wheelIndex = ((game.month % 12) + 12) % 12;
  const [markerX, markerY] = MONTH_PLACEMENT[wheelIndex] ?? MONTH_PLACEMENT[0];
  const markerStyle = {
    left: `${(markerX / 400) * 100}%`,
    top: `${(markerY / 400) * 100}%`,
  };
  const yearMarker = YEAR_PLACEMENT[Math.min(2, Math.max(0, game.year - 1))] ?? YEAR_PLACEMENT[0];
  const yearStyle = {
    left: `${((yearMarker.x - yearMarker.size / 2) / 400) * 100}%`,
    top: `${((yearMarker.y - yearMarker.size / 2) / 400) * 100}%`,
    width: `${(yearMarker.size / 400) * 100}%`,
  };
  const myReserve = me ? energySlots(me) : [];
  const actionReady =
    !!actionStage &&
    !!paymentRequirement &&
    actionPayment.length >= paymentRequirement.amount &&
    (actionStage.kind !== 'badge' || actionStage.type !== 1 || actionReceived.length === 2);

  const actionBar = (<div className="ss-opbar">
            {actionStage && paymentRequirement ? (
              <>
                <b className="ss-op-prompt">{paymentRequirement.title}</b>
                <span className="ss-op-label">
                  已选 {actionPayment.length} / {paymentRequirement.amount}
                </span>
                {actionPayment.map((source, index) => (
                  <img
                    className="ss-op-element"
                    key={`paid-${index}`}
                    src={elementArt(source.element)}
                    alt={ELEMENT_NAME[source.element]}
                  />
                ))}
                {actionStage.kind === 'badge' && actionStage.type === 1 && (
                  <>
                    <span className="ss-op-label">获得</span>
                    {[0, 1].map((index) =>
                      actionReceived[index] ? (
                        <span className="ss-op-action" key={`received-${index}`}>
                          <img src={elementArt(actionReceived[index]!)} alt={ELEMENT_NAME[actionReceived[index]!]} />
                        </span>
                      ) : (
                        <span className="ss-op-placeholder" key={`received-${index}`}>＋</span>
                      ),
                    )}
                    {ELEMENTS.map((element) => (
                      <button
                        type="button"
                        className="ss-op-action"
                        key={`receive-${element}`}
                        aria-label={`获得${ELEMENT_NAME[element]}元素`}
                        onClick={() => toggleActionReceived(element)}
                      >
                        <img src={elementArt(element)} alt="" />
                      </button>
                    ))}
                  </>
                )}
                <button
                  type="button"
                  className="ss-op-action ss-op-primary"
                  disabled={!actionReady}
                  onClick={confirmAction}
                >
                  确认
                </button>
                <button type="button" className="ss-op-action" onClick={cancelAction}>
                  取消
                </button>
                <small className="ss-op-label">{paymentRequirement.hint}</small>
              </>
             ) : abilityCard ? (
               <AbilityPicker card={abilityCard} onCancel={() => setAbilityCard(null)}
                 onPick={(abilityKey) => { send({ type: 'activate', cardUid: abilityCard.u, abilityKey }); setAbilityCard(null); }} />
             ) : game.pendingChoice?.choosingSeat === mySeat ? (
              game.pendingChoice.key === 'die_draw'
                ? <b className="ss-op-prompt">骰面抽牌</b>
                 : <ChoiceModal game={game} mySeat={mySeat!} onSend={send}
                     paidSources={actionPayment} payTokens={!!paymentRequirement} />
            ) : game.phase === 'play' ? (
              <>
                {me?.canTransmute && (
                  <span className="ss-op-label">
                    元素晶化{me.transmuteBonus ? `（徽章每枚 +${me.transmuteBonus}）` : ''}
                  </span>
                )}
                {me?.canTransmute && <button type="button" className="ss-op-action" disabled={!canPlay}
                  onClick={() => { setActionPayment([]); setActionStage({ kind: 'transmute' }); }}>晶化</button>}
                {me?.canTransmute && <span className="ss-transmute-rates">{game.transmuteValues.map(({ element, value }) =>
                  <span key={element}><img src={elementArt(element)} alt={ELEMENT_NAME[element]} />{value}</span>)}</span>}
                {me?.canTransmute && <span className="ss-op-divider" />}
                <button
                  type="button"
                  className="ss-op-action ss-op-primary"
                  disabled={!canPlay}
                  onClick={() => send({ type: 'end-turn' })}
                >
                  结束回合
                </button>
              </>
            ) : (
              <b>
                {game.phase === 'draft'
                  ? `轮抽 · 第 ${game.draftRound + 1} / 9 轮`
                  : game.phase === 'organize'
                    ? `组牌 · 剩余 ${handCards.length} 张`
                    : game.phase === 'ended'
                      ? '对局结束'
                      : ''}
              </b>
            )}
          </div>);
  return (
    <CardInspection inspect={(id, anchor) => inspect({ i: id, u: -id }, anchor.x, anchor.y)}>
    <div
      className="ss-shell"
      style={{
        ...(boardArt ? { '--ss-board': `url("${boardArt}")` } : {}),
        ...(yearIcons ? { '--ss-year-image': `url("${yearIcons}")` } : {}),
      } as CSSProperties}
    >
      <div className="ss-stage">
        <main
          className="ss-table"
          style={{
            ...(boardArt ? { '--ss-board': `url("${boardArt}")` } : {}),
            ...(yearIcons ? { '--ss-year-image': `url("${yearIcons}")` } : {}),
          } as CSSProperties}
        >
          <div className="ss-table-top">
            <section className="ss-wheel" aria-label="季节轮">
              <img src={tableArt('season-wheel')} alt="" draggable={false} />
              <span className="ss-month-cube" style={markerStyle} title={`第 ${game.month + 1} 月`} />
              <span
                className={`ss-year-highlight ss-year-highlight-${game.year}`}
                style={yearStyle}
                aria-label={`第 ${game.year} 年`}
              />
            </section>
            <section className="ss-center">
              <div className="ss-table-status"><strong>四季物语</strong>
                <span>{game.phase === 'play' ? `第 ${game.year} 年 · ${game.season?.name ?? ''}` : game.phase === 'draft' ? '轮抽' : '组牌'}</span>
                <span>牌堆 {game.deckCount} · 弃牌 {game.discardCount}</span>
                {mySeat === null && <label><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />跟随当前玩家</label>}

                <button type="button" className="ss-icon-button" aria-label="意见反馈" title="意见反馈" onClick={() => setFeedback(true)}>✉</button>
                <button type="button" className="ss-icon-button" aria-label="术语与骰面图例" title="术语与骰面图例" onClick={() => setGlossary(true)}>?</button>
              </div>
              <section className="ss-dice-panel" aria-label={game.phase === 'play' ? '季节骰' : '轮抽候选'}>
                {game.phase === 'play' ? (
                  game.dice.map((die, index) => {
                    const art = dieArt(die.letter, die.id, die.face);
                    const pickable = canPickDie && die.pickedBy === null;
                    return (
                      <button
                        type="button"
                        key={die.id}
                        className={`ss-die ss-die-${die.letter}${die.pickedBy !== null ? ' ss-die-picked' : ''}`}
                        disabled={!pickable}
                        onClick={() => send({ type: 'draft-dice', dieIndex: index })}
                        aria-label={
                          die.rewards.summon
                            ? '召唤等级 +1 骰子'
                            : die.rewards.card
                              ? '抽牌骰子'
                              : `骰子 ${die.letter.toUpperCase()}`
                        }
                      >
                        {art ? (
                          <img src={art} alt="" draggable={false} />
                        ) : (
                          <span className="ss-die-fallback">
                            {die.rewards.summon ? (
                              <b aria-label="召唤等级 +1">✦+1</b>
                            ) : die.rewards.card ? (
                              <b aria-label="抽牌">▣</b>
                            ) : (
                              ELEMENTS.filter((element) => (die.rewards[element] ?? 0) > 0).map(
                                (element) => (
                                  <img
                                    key={element}
                                    src={elementArt(element)}
                                    alt={ELEMENT_NAME[element]}
                                    draggable={false}
                                  />
                                ),
                              )
                            )}
                          </span>
                        )}
                        {die.pickedBy !== null && (
                          <span className="ss-die-picked-mark" aria-hidden>
                            已选
                          </span>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <>
                    {visibleDrafted.map((card) => (
                      <div className="ss-picked-card" key={card.u}>
                        <CardFace card={card} disabled onInspect={inspect} />
                      </div>
                    ))}
                    {!visibleDrafted.length && (
                      <span className="ss-empty-copy">
                        {game.phase === 'draft' ? `已选 ${visibleDrafted.length} 张 · 等待其他玩家` : '组牌'}
                      </span>
                    )}
                  </>
                )}
              </section>

              {(game.otusPool?.length ?? 0) > 0 && <div className="ss-otus-pool" aria-label="猫头鹰贤者中央牌">
                {game.otusPool!.map((card) => <TableCard key={card.u} card={card}
                  disabled={!canPlay || (game.otusUsedThisRound?.[mySeat!] ?? 0) > 0}
                  onClick={() => summon(card, true)} />)}
              </div>}
            </section>

          </div>
          <section className="ss-hand" aria-label="手牌">
                <header>
                  <b>{game.phase === 'draft' ? '轮抽手牌' : game.phase === 'organize' ? '组牌' : '你的手牌'}</b>
                  <small>
                    {game.pendingChoice?.key === 'die_draw'
                      ? `抽牌候选 ${drawDecision?.cards.length ?? 0} 张`
                      : `手牌 ${handCards.length}`}
                  </small>
                  {game.phase === 'play' && <select aria-label="手牌类型" value={handFilter} onChange={(event) => setHandFilter(event.target.value)}>
                    <option value="all">全部类型</option><option value="magic_item">魔器</option><option value="familiar">神仆</option>
                  </select>}
                  {game.phase === 'play' && <select aria-label="手牌排序" value={handSort} onChange={(event) => setHandSort(event.target.value)}>
                    <option value="default">原始顺序</option><option value="cost">按费用</option><option value="type">按类型</option>
                  </select>}
                </header>
                <div className="ss-hand-track" style={handStyle}>
                   {game.pendingChoice?.key === 'die_draw' && <div className="ss-draw-candidates">
                     {(drawDecision?.cards ?? []).map((card) => (
                      <CardFace
                        key={`draw-${card.u}`}
                        card={card}
                        selected={draftKeep?.u === card.u}
                        disabled={!isMyPendingChoice}
                        onClick={() => isMyPendingChoice && setDraftKeep(card)}
                        onInspect={inspect}
                      />
                     ))}</div>}
                  {sortedHand.map((card) => {
                    const canChooseHand =
                      me?.badgeDraw || game.pendingChoice?.key === 'die_draw'
                        ? false
                        : game.phase === 'draft'
                          ? canPickDraft
                          : game.phase === 'organize'
                            ? canOrganize
                            : canPlay;
                    return (
                      <CardFace
                        key={card.u}
                        card={card}
                        selected={
                          game.pendingChoice?.key === 'die_draw' ? false : organizePicked.includes(card.u)
                        }
                        disabled={!canChooseHand}
                        onClick={canChooseHand
                          ? () => {
                              if (game.phase === 'draft') send({ type: 'draft-pick', cardUid: card.u });
                              else if (game.phase === 'organize') organize(card);
                              else summon(card);
                            }
                          : undefined}
                        onInspect={inspect}
                      />
                    );
                  })}
                </div>
                 {game.phase === 'organize' && me && <div className="ss-organize-preview">
                   <div className="ss-organize-controls">
                     <b>第 {(me.organizeYear1?.length ?? 0) === 3 ? 2 : 1} 年 · 已选 {organizePicked.length}/3</b>
                     <button type="button" className="ss-button" disabled={!canOrganize || organizePicked.length !== 3}
                       onClick={() => { send({ type: 'organize', cardUids: organizePicked as [number, number, number] }); setOrganizePicked([]); }}>确认分组</button>
                     <button type="button" className="ss-button" disabled={!canOrganize}
                       onClick={() => { setOrganizePicked([]); send({ type: 'organize-reset' }); }}>重置</button>
                   </div>
                   {[organizedYear1, organizedYear2, (me.organizeYear2?.length ?? 0) === 3 ? visibleDrafted.map((card) => card.u) : []].map((uids, index) =>
                     <div className="ss-year-preview" key={index}><b>{['I', 'II', 'III'][index]}</b>
                       {uids.map((uid) => <TableCard key={uid} card={me.drafted?.find((card) => card.u === uid) ?? { u: uid, i: 0 }} disabled />)}
                     </div>)}
                 </div>}
                 {(drawDecision || me?.badgeDraw) && (
                  <div className="ss-keep-actions" role="group" aria-label="选择保留的抽牌">
                    <button
                      type="button"
                      className="ss-op-action ss-op-primary"
                      disabled={!draftKeep || !(drawDecision?.cards ?? me?.badgeDraw ?? []).some((card) => card.u === draftKeep.u)}
                      onClick={() => {
                        if (!draftKeep) return;
                        if (me?.badgeDraw) {
                          send({ type: 'badge-keep', cardUid: draftKeep.u });
                        } else if (game.pendingChoice?.key === 'die_draw') {
                          send({
                            type: 'resolve-choice',
                            choice: [draftKeep.u],
                          });
                        }
                        setDrawDecision(null);
                        setDraftKeep(null);
                      }}
                    >
                      {drawDecision?.keep === 1 ? '保留此牌' : '保留所选'}
                    </button>
                    {game.pendingChoice?.key === 'die_draw' && (
                      <button
                        type="button"
                        className="ss-op-action"
                        onClick={() => {
                          cancelAction();
                          setDrawDecision(null);
                          setDraftKeep(null);
                          send({ type: 'resolve-choice', choice: [] });
                        }}
                      >
                        全部弃置
                      </button>
                    )}
                  </div>
                )}
              </section>
<div className="ss-player-board">
            {[...game.players]
              .sort((left, right) => Number(right.seat === mySeat) - Number(left.seat === mySeat))
              .map((player) => (
              <section
                className={`ss-player-row${player.seat === mySeat ? ' ss-player-row-me' : ''}`}
                data-player-seat={player.seat}
                key={player.seat}
              >
                <PlayerIdentity
                  player={player.seat === mySeat && game.pendingChoice?.kind === 'energy_swap' && isMyPendingChoice
                    ? { ...player, energies: Object.fromEntries(ELEMENTS.map((element) =>
                      [element, Number((game.pendingChoice!.options.current as Partial<Record<Element, number>>)?.[element] ?? player.energies[element]) +
                        Number((game.pendingChoice!.options.incoming as Partial<Record<Element, number>>)?.[element] ?? 0)])) as Record<Element, number> }
                    : player}
                  name={playerName(view, player.seat)}
                  isMe={player.seat === mySeat}
                   canAct={player.seat === mySeat && canPlay}
                    drawUpgrade={player.seat === mySeat && game.pendingChoice?.key === 'die_draw' && isMyPendingChoice &&
                      game.dice.some((die) => die.pickedBy === mySeat && die.rewards.card)}
                  selectedDice={game.phase === 'play'
                    ? game.dice.filter((die) => die.pickedBy === player.seat)
                    : []}
                  onBadge={badgeAction}
                  onInspect={inspect}
                  onSend={send}
                  payment={player.seat === mySeat ? actionPayment : []}
                   paying={player.seat === mySeat && !!paymentRequirement}
                  onSource={toggleActionPayment}
                  reserveOnly={!!paymentRequirement?.reserveOnly ||
                    ['horn_of_plenty', 'fairy_monolith_store', 'chalice_of_eternity_store'].includes(game.pendingChoice?.key ?? '')}
                />
                <div className="ss-player-field">
                   {player.seat === mySeat ? actionBar : null}
                 <div className="ss-summon-slots" aria-label={`${playerName(view, player.seat)} 的场牌，每行最多 10 张`}>
                  {player.played.length === 0 && player.gauge === 0 && (
                    <span className="ss-field-empty">尚未召唤</span>
                  )}
                  {player.played.map((card) => (
                    <div className="ss-summon-slot ss-summon-filled" key={card.u}>
                      <CardFace
                        card={card}
                        reserve={card.stored}
                        disabled={player.seat !== mySeat || !canPlay || !isActivatable(card.i) || card.used || !!card.lockedBy}
                        onClick={player.seat === mySeat && canPlay && isActivatable(card.i) && !card.used && !card.lockedBy
                          ? () => activate(card)
                          : undefined}
                        onInspect={inspect}
                      />
                    </div>
                  ))}
                  {Array.from(
                    { length: Math.max(0, player.gauge - player.played.length) },
                    (_, index) => (
                      <span className="ss-summon-slot" key={`empty-${index}`} aria-label="空召唤位" />
                    ),
                  )}
                </div>
                </div>
              </section>
              ))}
          </div>
        </main>
        <LogPanel game={game} formatMessage={logText} />
      </div>
      {detailOpen && hovered && (
        <InspectionDetail cardId={hovered.i} anchor={hoverPos} onClose={closeDetail} />
      )}
      {game.phase === 'ended' && game.result && (
        <ResultScreen game={game} mySeat={mySeat} playerName={(seat) => playerName(view, seat)} />
      )}
      {glossary && <Glossary onClose={() => setGlossary(false)} />}
      {feedback && <FeedbackDialog onClose={() => setFeedback(false)} />}
      {me && me.badgeDraw && me.badgeDraw.length > 0 && (
        <div className="ss-modal-backdrop" role="presentation">
          <div className="ss-modal" role="dialog" aria-modal="true">
            <h3>选择保留的牌</h3>
            <div className="ss-badge-keep-row">
              {me.badgeDraw.map((card) => (
                <CardFace
                  key={card.u}
                  card={card}
                  onClick={() => send({ type: 'badge-keep', cardUid: card.u })}
                  onInspect={inspect}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
    </CardInspection>
  );
}
