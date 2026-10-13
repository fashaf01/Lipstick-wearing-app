import type { Pt } from './face';

// ---------- colour space ----------
// Makeup is blended in linear light, which is how pigment and light actually combine.
export const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const ENC_N = 4095;
const ENC = new Uint8ClampedArray(ENC_N + 1);
for (let i = 0; i <= ENC_N; i++) {
  const v = i / ENC_N;
  ENC[i] = Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
}
/** linear 0..1 -> sRGB byte */
export const enc = (v: number) => ENC[((v < 0 ? 0 : v > 1 ? 1 : v) * ENC_N + 0.5) | 0];
export const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function hexToLin(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [LIN[(n >> 16) & 255], LIN[(n >> 8) & 255], LIN[n & 255]];
}

// ---------- small maths ----------
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** GLSL-style smoothstep; works for a > b too (inverted ramp). */
export function smooth(a: number, b: number, x: number) {
  const t = (x - a) / (b - a);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Chromaticity (r, g share of the total): brightness-independent colour used to tell skin from lips/hair. */
export const chroma = (r: number, g: number, b: number): [number, number] => {
  const s = r + g + b + 1e-6;
  return [r / s, g / s];
};

// ---------- noise (stable: depends only on the coordinates it is given) ----------
export function hash(ix: number, iy: number) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  return mix(mix(hash(ix, iy), hash(ix + 1, iy), sx), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx), sy);
}

// ---------- sampling ----------
/** Mean colour (linear) of a small square patch of the current frame. */
export function patchMean(ctx: CanvasRenderingContext2D, p: Pt, r: number): [number, number, number] | null {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const x0 = Math.max(0, Math.round(p.x - r));
  const y0 = Math.max(0, Math.round(p.y - r));
  const x1 = Math.min(W, Math.round(p.x + r) + 1);
  const y1 = Math.min(H, Math.round(p.y + r) + 1);
  if (x1 <= x0 || y1 <= y0) return null;
  const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let sr = 0, sg = 0, sb = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    sr += LIN[d[i]];
    sg += LIN[d[i + 1]];
    sb += LIN[d[i + 2]];
  }
  return [sr / n, sg / n, sb / n];
}

export function meanRgb(list: ([number, number, number] | null)[]): [number, number, number] | null {
  const ok = list.filter((x): x is [number, number, number] => !!x);
  if (!ok.length) return null;
  return [
    ok.reduce((s, c) => s + c[0], 0) / ok.length,
    ok.reduce((s, c) => s + c[1], 0) / ok.length,
    ok.reduce((s, c) => s + c[2], 0) / ok.length,
  ];
}

/** Separable box blur (one horizontal + one vertical pass), edge-clamped. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * k;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * k;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Exponential smoothing for per-frame measurements (stops reference colours from flickering). */
export class Smoother {
  private m = new Map<string, number[]>();
  blend(key: string, v: number[], k = 0.2): number[] {
    const p = this.m.get(key);
    if (!p) {
      this.m.set(key, v.slice());
      return v;
    }
    for (let i = 0; i < v.length; i++) p[i] += (v[i] - p[i]) * k;
    return p;
  }
  reset() {
    this.m.clear();
  }
}
