export interface Shade {
  id: string;
  name: string;
  family: string;
  hex: string;
}

export type FinishId = 'matte' | 'satin' | 'gloss' | 'sheer';

export interface Finish {
  label: string;
  /** Strength of the hue/saturation ("color" blend) pass. */
  tint: number;
  /** Strength of the opaque pigment pass that covers the natural lip color. */
  cover: number;
  /** Strength of the multiply pass that deepens dark shades. */
  depth: number;
  /** Strength of the specular highlights. */
  shine: number;
}

export const FINISHES: Record<FinishId, Finish> = {
  matte: { label: 'Matte', tint: 0.9, cover: 0.34, depth: 0.26, shine: 0 },
  satin: { label: 'Satin', tint: 0.9, cover: 0.26, depth: 0.18, shine: 0.3 },
  gloss: { label: 'Gloss', tint: 0.85, cover: 0.18, depth: 0.1, shine: 0.8 },
  sheer: { label: 'Sheer', tint: 0.65, cover: 0.06, depth: 0, shine: 0.3 },
};

export const FINISH_ORDER: FinishId[] = ['matte', 'satin', 'gloss', 'sheer'];

export const SHADES: Shade[] = [
  { id: 'petal-nude', name: 'Petal Nude', family: 'Nude', hex: '#c9877a' },
  { id: 'warm-beige', name: 'Warm Beige', family: 'Nude', hex: '#b46f5c' },
  { id: 'mocha', name: 'Mocha', family: 'Nude', hex: '#8d4f45' },
  { id: 'baby-pink', name: 'Baby Pink', family: 'Pink', hex: '#e58ba0' },
  { id: 'rose', name: 'Rose', family: 'Pink', hex: '#d4587a' },
  { id: 'hot-pink', name: 'Hot Pink', family: 'Pink', hex: '#e0338a' },
  { id: 'fuchsia', name: 'Fuchsia', family: 'Pink', hex: '#c2185b' },
  { id: 'peach', name: 'Peach', family: 'Coral', hex: '#f2907a' },
  { id: 'coral', name: 'Coral', family: 'Coral', hex: '#ee6a5b' },
  { id: 'tomato', name: 'Tomato', family: 'Red', hex: '#e03a2d' },
  { id: 'classic-red', name: 'Classic Red', family: 'Red', hex: '#c8102e' },
  { id: 'cherry', name: 'Cherry', family: 'Red', hex: '#a8112b' },
  { id: 'brick', name: 'Brick', family: 'Red', hex: '#9c2f2a' },
  { id: 'mauve', name: 'Mauve', family: 'Berry', hex: '#9a5a7a' },
  { id: 'orchid', name: 'Orchid', family: 'Berry', hex: '#b04fa0' },
  { id: 'berry', name: 'Berry', family: 'Berry', hex: '#8e1b4b' },
  { id: 'wine', name: 'Wine', family: 'Berry', hex: '#6d1230' },
  { id: 'plum', name: 'Plum', family: 'Berry', hex: '#5e1f4a' },
];

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
