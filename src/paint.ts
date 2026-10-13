import type { Pt } from './face';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box of some points, padded and clamped to the frame. */
export function bboxOf(groups: Pt[][], pad: number, w: number, h: number): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of groups) {
    for (const p of g) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const x = Math.max(0, Math.floor(minX - pad));
  const y = Math.max(0, Math.floor(minY - pad));
  const bw = Math.min(w, Math.ceil(maxX + pad)) - x;
  const bh = Math.min(h, Math.ceil(maxY + pad)) - y;
  return bw > 0 && bh > 0 ? { x, y, w: bw, h: bh } : null;
}

type Ctx = CanvasRenderingContext2D;

/** Smooth closed curve through the midpoints of the given points. */
export function traceClosed(c: Ctx, pts: Pt[], dx = 0) {
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

/** Smooth open curve through the given points. */
export function traceOpen(c: Ctx, pts: Pt[], dx = 0) {
  c.moveTo(pts[0].x + dx, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const m = { x: (pts[i].x + pts[i + 1].x) / 2 + dx, y: (pts[i].y + pts[i + 1].y) / 2 };
    c.quadraticCurveTo(pts[i].x + dx, pts[i].y, m.x, m.y);
  }
  const last = pts[pts.length - 1];
  c.lineTo(last.x + dx, last.y);
}

/** Moves every vertex of a closed ring along its outward normal by `d` pixels (negative = shrink). */
export function offsetRing(ring: Pt[], d: number): Pt[] {
  const n = ring.length;
  const c = ring.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n }), { x: 0, y: 0 });
  return ring.map((p, i) => {
    const a = ring[(i + n - 1) % n];
    const b = ring[(i + 1) % n];
    let nx = b.y - a.y;
    let ny = a.x - b.x;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    if (nx * (p.x - c.x) + ny * (p.y - c.y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { x: p.x + nx * d, y: p.y + ny * d };
  });
}

function newMask() {
  const c = document.createElement('canvas');
  return { c, x: c.getContext('2d', { willReadFrequently: true })! };
}

/**
 * Builds small anti-aliased alpha masks (where a product may go) that the per-pixel renderers read.
 * Edges use an off-canvas `shadowBlur` trick so soft edges also work on Safari (no ctx.filter).
 */
export class Painter {
  private masks = [newMask(), newMask(), newMask()];
  private dirty: BBox | null = null;
  private w = 0;

  begin(w: number, h: number, bb: BBox) {
    for (const m of this.masks) {
      if (m.c.width !== w || m.c.height !== h) {
        m.c.width = w;
        m.c.height = h;
        this.dirty = null;
      } else if (this.dirty) {
        m.x.clearRect(this.dirty.x, this.dirty.y, this.dirty.w, this.dirty.h);
      }
    }
    this.w = w;
    const pad = 12;
    const x = Math.max(0, bb.x - pad);
    const y = Math.max(0, bb.y - pad);
    this.dirty = { x, y, w: Math.min(w, bb.x + bb.w + pad) - x, h: Math.min(h, bb.y + bb.h + pad) - y };
  }

  /** `draw` builds a path using the supplied x offset and must call fill()/stroke() itself. */
  feather(which: 0 | 1 | 2, blur: number, draw: (c: Ctx, dx: number) => void, passes = 1) {
    const c = this.masks[which].x;
    const off = this.w + 400 + blur * 4;
    c.save();
    c.shadowColor = '#000';
    c.shadowBlur = blur;
    c.shadowOffsetX = off;
    c.fillStyle = '#000';
    c.strokeStyle = '#000';
    for (let i = 0; i < passes; i++) {
      c.beginPath();
      draw(c, -off);
    }
    c.restore();
  }

  /** Mask alpha (0..1) for a box, row-major. */
  read(which: 0 | 1 | 2, bb: BBox): Float32Array {
    const d = this.masks[which].x.getImageData(bb.x, bb.y, bb.w, bb.h).data;
    const out = new Float32Array(bb.w * bb.h);
    for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] / 255;
    return out;
  }
}
