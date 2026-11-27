import type { Element } from '@bgx/protocol/games/seasons';

/**
 * 四季物语的静态美术资源。
 *
 * 图片由 `apps/web/scripts/build-seasons-assets.py` 从旧项目
 * （`/home/squid/seasons_web/seasons-web/public/assets`）转成 webp，
 * 放到 `src/assets/seasons/`。这里用 `import.meta.glob` 收集 URL，
 * 构建时由 Vite 输出带 hash 的静态文件。
 */

const labelledCardModules = import.meta.glob<string>(
  '../../assets/seasons/cards-labelled/*.jpg',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
);

const cardModules = import.meta.glob<string>(
  ['../../assets/seasons/cards/*.webp', '../../assets/seasons/cards/*.jpg'],
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
);

const fullCardModules = import.meta.glob<string>(
  '../../assets/seasons/cards-bga/*.png',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
);

const diceModules = import.meta.glob<string>('../../assets/seasons/dice/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const elementModules = import.meta.glob<string>('../../assets/seasons/elements/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const tableModules = import.meta.glob<string>(
  ['../../assets/seasons/table/*.webp', '../../assets/seasons/table/*.png'],
  {
  eager: true,
  query: '?url',
  import: 'default',
  },
);

/** 从 glob 的键里取文件名（不含扩展名）。 */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.(webp|jpe?g|png)$/i, '');
}

function byName(modules: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(modules).map(([path, url]) => [baseName(path), url]));
}

const cards = byName(cardModules);
const labelledCards = byName(labelledCardModules);
const fullCards = byName(fullCardModules);
const dice = byName(diceModules);
const elements = byName(elementModules);
const table = byName(tableModules);
const starModule = import.meta.glob<string>('../../assets/seasons/star.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** 卡牌正面图；未知 id（例如扩展包还没接入）返回 undefined。 */
export function cardArt(cardId: number): string | undefined {
  return labelledCards.get(String(cardId));
}

/** 完整 BGA 卡面（含原图文字），仅用于卡牌详情/放大查看。 */
export function cardFullArt(cardId: number): string | undefined {
  return fullCards.get(String(cardId));
}

/** 牌背。 */
export function cardBackArt(): string | undefined {
  return cards.get('back');
}

/** 骰面图：letter 为 w/s/u/f，die 为 1–5，face 为 1–6。 */
export function dieArt(letter: string, die: number, face: number): string | undefined {
  return dice.get(`${letter}${die}r${face}`);
}

/** 元素图标。 */
export function elementArt(element: Element): string | undefined {
  return elements.get(element);
}

export function tableArt(name: 'board-bg' | 'season-wheel' | 'parchment' | 'abilityTokens' | 'bonuses' | 'icons' | 'icons2022'): string | undefined {
  return table.get(name);
}

export function starArt(): string | undefined {
  return Object.values(starModule)[0];
}
const markerModules = import.meta.glob<string>('../../assets/seasons/markers/*.png', {
  eager: true, query: '?url', import: 'default',
});
const markers = byName(markerModules);
export function markerArt(name: string): string | undefined { return markers.get(name); }

/** 已打包的资源数量，测试/调试用。 */
export const SEASONS_ART_COUNTS = {
  cards: cards.size,
  fullCards: fullCards.size,
  dice: dice.size,
  elements: elements.size,
} as const;
