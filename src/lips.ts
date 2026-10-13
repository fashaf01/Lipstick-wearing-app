import { FINISHES, hexToRgb, type FinishId } from './shades';

export interface Pt {
  x: number;
  y: number;
}
export interface Landmark {
  x: number;
  y: number;
  z?: number;
}
/** Lip landmark index -> pixel position. */
export type LipPts = Map<number, Pt>;

// MediaPipe face mesh indices, in drawing order around each contour.
export const OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
export const INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
const ALL = [...OUTER, ...INNER];

const CORNER_L = 61;
const CORNER_R = 291;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function toPoints(lm: Landmark[], w: number, h: number): LipPts | null {
  const m: LipPts = new Map();
  for (const i of ALL) {
    const l = lm[i];
    if (!l) return null;
    m.set(i, { x: l.x * w, y: l.y * h });
  }
  return m;
}

/** Light temporal smoothing that follows fast motion but removes landmark jitter. */
export class LipSmoother {
  private prev: LipPts | null = null;

  reset() {
    this.prev = null;
  }

  update(lm: Landmark[], w: number, h: number): LipPts | null {
    const next = toPoints(lm, w, h);
    if (!next) return null;
    const prev = this.prev;
    if (!prev) {
      this.prev = next;
      return next;
    }
    const mouthW = Math.max(1, dist(next.get(CORNER_L)!, next.get(CORNER_R)!));
    for (const [i, p] of next) {
      const q = prev.get(i)!;
      const a = clamp(0.25 + (dist(p, q) / mouthW) * 10, 0.25, 1);
      q.x += (p.x - q.x) * a;
      q.y += (p.y - q.y) * a;
    }
    return prev;
  }
}

export interface LipStyle {
  hex: string;
  finish: FinishId;
  /** 0..1 */
  intensity: number;
}

function newCanvas() {
  const c = document.createElement('canvas');
  const x = c.getContext('2d')!;
  return { c, x };
}

/** Smooth closed curve through the midpoints of the given points. */
function trace(c: CanvasRenderingContext2D, pts: Pt[], dx: number) {
  const n = pts.length;
  const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2 + dx, y: (a.y + b.y) / 2 });
  const s = mid(pts[n - 1], pts[0]);
  c.moveTo(s.x, s.y);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % n]);
    c.quadraticCurveTo(p.x + dx, p.y, m.x, m.y);
  }
  c.closePath();
}

function glint(c: CanvasRenderingContext2D, at: Pt, angle: number, rx: number, ry: number, alpha: number) {
  if (rx < 1 || ry < 0.5) return;
  c.save();
  c.translate(at.x, at.y);
  c.rotate(angle);
  c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.4})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, rx, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/**
 * Paints lipstick onto an already-drawn camera frame.
 * Pipeline: feathered lip mask -> colour layer -> blend passes (hue, pigment, depth) -> specular glints.
 */
export class LipRenderer {
  private mask = newCanvas();
  private layer = newCanvas();

  render(ctx: CanvasRenderingContext2D, w: number, h: number, pts: LipPts, style: LipStyle) {
    if (style.intensity <= 0) return;
    const outer = OUTER.map((i) => pts.get(i)!);
    const inner = INNER.map((i) => pts.get(i)!);
    const P = (i: number) => pts.get(i)!;

    const mouthW = dist(P(CORNER_L), P(CORNER_R));
    if (mouthW < 8) return;
    const blur = Math.max(2, mouthW * 0.04);
    const pad = Math.ceil(blur * 2 + 6);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of outer) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const bx = Math.max(0, Math.floor(minX - pad));
    const by = Math.max(0, Math.floor(minY - pad));
    const bw = Math.min(w, Math.ceil(maxX + pad)) - bx;
    const bh = Math.min(h, Math.ceil(maxY + pad)) - by;
    if (bw <= 0 || bh <= 0) return;

    for (const { c } of [this.mask, this.layer]) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    }

    const finish = FINISHES[style.finish];
    const I = clamp(style.intensity, 0, 1);
    const [r, g, b] = hexToRgb(style.hex);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

    // 1. Feathered mask. The shape is drawn far off-canvas and only its blurred shadow lands
    //    in view (works everywhere, unlike ctx.filter). Even-odd keeps the open mouth clear.
    const m = this.mask.x;
    const off = w + pad * 4 + 400;
    m.clearRect(0, 0, w, h);
    m.save();
    m.shadowColor = '#000';
    m.shadowBlur = blur;
    m.shadowOffsetX = off;
    m.fillStyle = '#000';
    for (let pass = 0; pass < 2; pass++) {
      m.beginPath();
      trace(m, outer, -off);
      trace(m, inner, -off);
      m.fill('evenodd');
    }
    m.restore();

    // 2. Colour layer clipped to the mask.
    const l = this.layer.x;
    l.globalCompositeOperation = 'source-over';
    l.clearRect(bx, by, bw, bh);
    l.fillStyle = style.hex;
    l.fillRect(bx, by, bw, bh);
    l.globalCompositeOperation = 'destination-in';
    l.drawImage(this.mask.c, bx, by, bw, bh, bx, by, bw, bh);
    l.globalCompositeOperation = 'source-over';

    // 3. Blend onto the frame.
    ctx.save();
    ctx.globalCompositeOperation = 'color';
    ctx.globalAlpha = finish.tint * I;
    ctx.drawImage(this.layer.c, bx, by, bw, bh, bx, by, bw, bh);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = finish.cover * I;
    ctx.drawImage(this.layer.c, bx, by, bw, bh, bx, by, bw, bh);
    if (finish.depth > 0) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = clamp(finish.depth * I * (1.15 - lum), 0, 1);
      ctx.drawImage(this.layer.c, bx, by, bw, bh, bx, by, bw, bh);
    }

    // 4. Specular glints on the lower and upper lip, clipped to the lips.
    if (finish.shine > 0) {
      l.clearRect(bx, by, bw, bh);
      const angle = Math.atan2(P(CORNER_R).y - P(CORNER_L).y, P(CORNER_R).x - P(CORNER_L).x);
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const lowerT = dist(P(14), P(17));
      const upperT = dist(P(0), P(13));
      const lowerC = lerp(P(14), P(17), 0.45);
      const upperC = lerp(P(0), P(13), 0.55);
      glint(l, lowerC, angle, mouthW * 0.2, lowerT * 0.3, 0.95);
      glint(l, { x: lowerC.x - ux * mouthW * 0.2, y: lowerC.y - uy * mouthW * 0.2 }, angle, mouthW * 0.08, lowerT * 0.2, 0.5);
      glint(l, { x: lowerC.x + ux * mouthW * 0.2, y: lowerC.y + uy * mouthW * 0.2 }, angle, mouthW * 0.08, lowerT * 0.2, 0.5);
      glint(l, upperC, angle, mouthW * 0.14, upperT * 0.28, 0.6);
      l.globalCompositeOperation = 'destination-in';
      l.drawImage(this.mask.c, bx, by, bw, bh, bx, by, bw, bh);
      l.globalCompositeOperation = 'source-over';
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = clamp(finish.shine * (0.5 + 0.5 * I), 0, 1);
      ctx.drawImage(this.layer.c, bx, by, bw, bh, bx, by, bw, bh);
    }
    ctx.restore();
  }
}
