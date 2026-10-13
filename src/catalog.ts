import { FINISHES, FINISH_ORDER, SHADES } from './shades';

export type CategoryId = 'lips' | 'eyes' | 'liner' | 'blush' | 'brows';

export interface Product {
  id: string;
  name: string;
  family: string;
  hex: string;
}
export interface FinishOpt {
  id: string;
  label: string;
}
export interface Category {
  id: CategoryId;
  label: string;
  products: Product[];
  finishes: FinishOpt[];
}
export interface LayerState {
  /** null = this product is switched off */
  productId: string | null;
  finish: string;
  /** 0..100 */
  intensity: number;
}
export type Look = Record<CategoryId, LayerState>;

export const CATEGORY_ORDER: CategoryId[] = ['lips', 'eyes', 'liner', 'blush', 'brows'];

const p = (id: string, name: string, family: string, hex: string): Product => ({ id, name, family, hex });

export const CATEGORIES: Record<CategoryId, Category> = {
  lips: {
    id: 'lips',
    label: 'Lips',
    products: SHADES,
    finishes: FINISH_ORDER.map((id) => ({ id, label: FINISHES[id].label })),
  },
  eyes: {
    id: 'eyes',
    label: 'Eyes',
    finishes: [
      { id: 'matte', label: 'Matte' },
      { id: 'shimmer', label: 'Shimmer' },
      { id: 'smoky', label: 'Smoky' },
    ],
    products: [
      p('champagne', 'Champagne', 'Neutral', '#e6c9a8'),
      p('peach', 'Peach', 'Warm', '#f2b49a'),
      p('rose-gold', 'Rose Gold', 'Warm', '#d99a8b'),
      p('copper', 'Copper', 'Warm', '#b8693f'),
      p('bronze', 'Bronze', 'Warm', '#8a5a2b'),
      p('gold', 'Gold', 'Warm', '#cfa23a'),
      p('taupe', 'Taupe', 'Neutral', '#8b6f6a'),
      p('pink', 'Petal Pink', 'Pink', '#e48aa6'),
      p('mauve', 'Mauve', 'Berry', '#a8708a'),
      p('plum', 'Plum', 'Berry', '#6a2c5d'),
      p('lilac', 'Lilac', 'Cool', '#a98bd1'),
      p('teal', 'Teal', 'Cool', '#1f7f86'),
      p('emerald', 'Emerald', 'Cool', '#1f7a5c'),
      p('navy', 'Navy', 'Cool', '#243a73'),
      p('smoke', 'Smoke', 'Smoky', '#5a5560'),
      p('charcoal', 'Charcoal', 'Smoky', '#2d2b30'),
    ],
  },
  liner: {
    id: 'liner',
    label: 'Liner',
    finishes: [
      { id: 'thin', label: 'Thin' },
      { id: 'classic', label: 'Classic' },
      { id: 'winged', label: 'Winged' },
    ],
    products: [
      p('black', 'Black', 'Classic', '#141214'),
      p('espresso', 'Espresso', 'Brown', '#3a2218'),
      p('bronze', 'Bronze', 'Brown', '#8a5a2b'),
      p('navy', 'Midnight Navy', 'Cool', '#14213d'),
      p('plum', 'Plum', 'Berry', '#4a1942'),
      p('emerald', 'Emerald', 'Cool', '#0b5d4b'),
      p('cobalt', 'Cobalt', 'Bold', '#1f4fbf'),
    ],
  },
  blush: {
    id: 'blush',
    label: 'Blush',
    finishes: [
      { id: 'matte', label: 'Matte' },
      { id: 'glow', label: 'Glow' },
    ],
    products: [
      p('peach', 'Peach', 'Warm', '#f5a58e'),
      p('coral', 'Coral', 'Warm', '#ef7a6a'),
      p('rose', 'Rose', 'Pink', '#e0657f'),
      p('pink', 'Petal Pink', 'Pink', '#f08fa8'),
      p('mauve', 'Mauve', 'Berry', '#b9758c'),
      p('berry', 'Berry', 'Berry', '#b23a62'),
      p('bronze', 'Bronze', 'Warm', '#b07048'),
    ],
  },
  brows: {
    id: 'brows',
    label: 'Brows',
    finishes: [{ id: 'natural', label: 'Natural' }],
    products: [
      p('blonde', 'Blonde', 'Light', '#c8a46a'),
      p('light-brown', 'Light Brown', 'Brown', '#8a6a46'),
      p('taupe', 'Taupe', 'Neutral', '#6e5a4a'),
      p('brown', 'Brown', 'Brown', '#4a3425'),
      p('auburn', 'Auburn', 'Warm', '#7a3b22'),
      p('dark-brown', 'Dark Brown', 'Dark', '#2f2018'),
      p('black', 'Black', 'Dark', '#17120f'),
    ],
  },
};

export const productOf = (cat: CategoryId, l: LayerState): Product | undefined =>
  l.productId ? CATEGORIES[cat].products.find((x) => x.id === l.productId) : undefined;

const off = (cat: CategoryId): LayerState => ({
  productId: null,
  finish: CATEGORIES[cat].finishes[0].id,
  intensity: 60,
});

export function defaultLook(): Look {
  return {
    lips: { productId: 'classic-red', finish: 'satin', intensity: 80 },
    eyes: off('eyes'),
    liner: off('liner'),
    blush: off('blush'),
    brows: off('brows'),
  };
}

export const clearedLook = (): Look => ({
  lips: off('lips'),
  eyes: off('eyes'),
  liner: off('liner'),
  blush: off('blush'),
  brows: off('brows'),
});

// ---------- one-tap looks ----------
type Part = { productId: string; finish?: string; intensity: number };
export interface Preset {
  id: string;
  name: string;
  parts: Partial<Record<CategoryId, Part>>;
}

export const PRESETS: Preset[] = [
  {
    id: 'natural',
    name: 'Natural Glow',
    parts: {
      lips: { productId: 'petal-nude', finish: 'satin', intensity: 60 },
      eyes: { productId: 'champagne', finish: 'matte', intensity: 40 },
      blush: { productId: 'peach', finish: 'glow', intensity: 50 },
      brows: { productId: 'taupe', intensity: 50 },
    },
  },
  {
    id: 'rosy-day',
    name: 'Rosy Day',
    parts: {
      lips: { productId: 'rose', finish: 'satin', intensity: 70 },
      eyes: { productId: 'rose-gold', finish: 'shimmer', intensity: 55 },
      liner: { productId: 'espresso', finish: 'thin', intensity: 60 },
      blush: { productId: 'rose', finish: 'matte', intensity: 55 },
      brows: { productId: 'brown', intensity: 55 },
    },
  },
  {
    id: 'classic-red',
    name: 'Classic Red',
    parts: {
      lips: { productId: 'classic-red', finish: 'matte', intensity: 90 },
      eyes: { productId: 'champagne', finish: 'matte', intensity: 45 },
      liner: { productId: 'black', finish: 'winged', intensity: 90 },
      blush: { productId: 'peach', finish: 'matte', intensity: 35 },
      brows: { productId: 'brown', intensity: 60 },
    },
  },
  {
    id: 'smoky-night',
    name: 'Smoky Night',
    parts: {
      lips: { productId: 'wine', finish: 'matte', intensity: 70 },
      eyes: { productId: 'charcoal', finish: 'smoky', intensity: 85 },
      liner: { productId: 'black', finish: 'classic', intensity: 90 },
      blush: { productId: 'bronze', finish: 'matte', intensity: 40 },
      brows: { productId: 'dark-brown', intensity: 65 },
    },
  },
  {
    id: 'berry-bold',
    name: 'Berry Bold',
    parts: {
      lips: { productId: 'berry', finish: 'satin', intensity: 85 },
      eyes: { productId: 'plum', finish: 'matte', intensity: 60 },
      liner: { productId: 'plum', finish: 'winged', intensity: 80 },
      blush: { productId: 'mauve', finish: 'matte', intensity: 50 },
      brows: { productId: 'brown', intensity: 60 },
    },
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    parts: {
      lips: { productId: 'coral', finish: 'gloss', intensity: 75 },
      eyes: { productId: 'gold', finish: 'shimmer', intensity: 75 },
      liner: { productId: 'bronze', finish: 'thin', intensity: 70 },
      blush: { productId: 'coral', finish: 'glow', intensity: 55 },
      brows: { productId: 'auburn', intensity: 55 },
    },
  },
];

export function applyPreset(preset: Preset): Look {
  const look = clearedLook();
  for (const id of CATEGORY_ORDER) {
    const part = preset.parts[id];
    if (part) look[id] = { productId: part.productId, finish: part.finish ?? CATEGORIES[id].finishes[0].id, intensity: part.intensity };
  }
  return look;
}

/** Up to three representative colours for a preset's preview chip. */
export function presetColors(preset: Preset): string[] {
  return (['lips', 'eyes', 'blush'] as CategoryId[])
    .map((id) => {
      const part = preset.parts[id];
      return part ? CATEGORIES[id].products.find((x) => x.id === part.productId)?.hex : undefined;
    })
    .filter((x): x is string => !!x);
}

/** Sanitises a stored look: unknown products/finishes fall back to safe values. */
export function sanitizeLook(raw: unknown): Look {
  const look = defaultLook();
  if (!raw || typeof raw !== 'object') return look;
  const src = raw as Partial<Record<CategoryId, Partial<LayerState>>>;
  for (const id of CATEGORY_ORDER) {
    const s = src[id];
    if (!s) continue;
    const cat = CATEGORIES[id];
    look[id] = {
      productId: s.productId && cat.products.some((x) => x.id === s.productId) ? s.productId : s.productId === null ? null : look[id].productId,
      finish: s.finish && cat.finishes.some((f) => f.id === s.finish) ? s.finish : look[id].finish,
      intensity: typeof s.intensity === 'number' ? Math.min(100, Math.max(0, s.intensity)) : look[id].intensity,
    };
  }
  return look;
}
