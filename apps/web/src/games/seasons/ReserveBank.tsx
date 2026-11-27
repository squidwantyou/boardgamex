import { ELEMENTS, type SeasonsElementSource, type SeasonsPlayerView } from '@bgx/protocol/games/seasons';
import { CARD_BY_ID } from '@bgx/protocol/games/seasons-cards-all';
import { elementArt, starArt } from './art';
import { CARD_COPY } from './card-copy';

export const sourceKey = (source: SeasonsElementSource) =>
  `${source.source}:${source.cardUid ?? 0}:${source.slot ?? 0}:${source.element}`;
export function ReserveBank({ player, selected, paying, onSelect, reserveOnly = false }: {
  player: SeasonsPlayerView; selected: readonly SeasonsElementSource[]; paying: boolean;
  reserveOnly?: boolean;
  onSelect: (source: SeasonsElementSource) => void;
}) {
  const ids = new Set(selected.map(sourceKey));
  const reserve = ELEMENTS.flatMap((element) => Array.from({ length: player.energies[element] },
    (_, slot) => ({ element, slot, source: 'reserve' as const })));
  const stored = player.played.filter((card) => !card.lockedBy &&
    !CARD_BY_ID.get(card.i)?.effect?.abilities?.some((a) => a.kind === 'sealed_energy') &&
    CARD_BY_ID.get(card.i)?.effect?.abilities?.some((a) => a.kind === 'reserve_slot'))
    .flatMap((card) => ELEMENTS.flatMap((element) => Array.from({ length: card.stored?.[element] ?? 0 },
      (_, slot) => ({ element, slot, source: 'card' as const, cardUid: card.u }))));
  const names = { water: '水', air: '风', fire: '火', earth: '土' };
  const token = (source: SeasonsElementSource) => <button type="button" key={sourceKey(source)}
    className={`ss-slot${ids.has(sourceKey(source)) ? ' ss-slot-selected' : ''}`} disabled={!paying}
    aria-pressed={ids.has(sourceKey(source))}
    aria-label={`${source.cardUid ? `${CARD_COPY[player.played.find((c) => c.u === source.cardUid)!.i]?.nameZh}上的` : '储备'}${names[source.element]}元素 ${source.slot! + 1}`}
    onClick={() => onSelect(source)}><img src={elementArt(source.element)} alt="" /></button>;
  return <>
    <div className="ss-reserve" aria-label="元素储备">{reserve.map(token)}
      {Array.from({ length: Math.max(0, player.maxEnergy - reserve.length) },
        (_, index) => <span key={`empty-${index}`} className="ss-slot" aria-label="空元素槽" />)}
    </div>
    {paying && !reserveOnly && stored.length > 0 && <div className="ss-card-sources" aria-label="卡上可支付元素">{stored.map(token)}</div>}
    <div className="ss-identity-stats"><span><img src={starArt()} alt="唤能" />{player.gauge}</span><span>手牌 {player.handCount}</span>
      <span>徽章 {player.badgesUsed}/3</span></div>
  </>;
}
