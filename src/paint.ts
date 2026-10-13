import type { Pt } from './face';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Pass {
  op: GlobalCompositeOperation;
  alpha: number;
}
type Ctx = CanvasRenderingContext2D;

function newCanvas() {
  const c = document.createElement('canvas');
  return { c, x: c.getContext('2d')! };
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

/**
 * Shared two-canvas painter used by every makeup type.
 *
 *  1. `begin` + `feather` build a soft-edged alpha mask of where the product goes.
 *  2. `paint` / `paintCustom` fill a colour layer, clip it to the mask and composite it on the frame.
 */
export class Painter {
  private mask = newCanvas();
  private layer = newCanvas();
  private w = 0;

  begin(w: number, h: number) {
    for (const { c } of [this.mask, this.layer]) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    }
    this.w = w;
    this.mask.x.clearRect(0, 0, w, h);
  }

  /**
   * Draws a soft-edged shape onto the mask. The shape is drawn far off-canvas and only its blurred
   * shadow lands in view, which works on every browser (unlike ctx.filter on Safari). `draw` must
   * build its path using the supplied x offset and call fill()/stroke() itself.
   */
  feather(blur: number, draw: (c: Ctx, dx: number) => void, passes = 2) {
    const c = this.mask.x;
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

  /** Solid colour clipped to the mask, optionally reshaped by `mod` (e.g. a fade gradient). */
  paint(ctx: Ctx, bb: BBox, hex: string, passes: Pass[], mod?: (l: Ctx) => void) {
    const l = this.layer.x;
    l.globalCompositeOperation = 'source-over';
    l.clearRect(bb.x, bb.y, bb.w, bb.h);
    l.fillStyle = hex;
    l.fillRect(bb.x, bb.y, bb.w, bb.h);
    this.clip(l, bb);
    if (mod) {
      mod(l);
      l.globalCompositeOperation = 'source-over';
    }
    this.composite(ctx, bb, passes);
  }

  /** Arbitrary drawing (highlights, sparkles) clipped to the mask. */
  paintCustom(ctx: Ctx, bb: BBox, draw: (l: Ctx) => void, passes: Pass[]) {
    const l = this.layer.x;
    l.globalCompositeOperation = 'source-over';
    l.clearRect(bb.x, bb.y, bb.w, bb.h);
    draw(l);
    this.clip(l, bb);
    this.composite(ctx, bb, passes);
  }

  /** Arbitrary drawing straight to the frame, no mask (soft radial gradients like blush). */
  paintFree(ctx: Ctx, bb: BBox, draw: (l: Ctx) => void, passes: Pass[]) {
    const l = this.layer.x;
    l.globalCompositeOperation = 'source-over';
    l.clearRect(bb.x, bb.y, bb.w, bb.h);
    draw(l);
    this.composite(ctx, bb, passes);
  }

  private clip(l: Ctx, bb: BBox) {
    l.globalCompositeOperation = 'destination-in';
    l.drawImage(this.mask.c, bb.x, bb.y, bb.w, bb.h, bb.x, bb.y, bb.w, bb.h);
    l.globalCompositeOperation = 'source-over';
  }

  private composite(ctx: Ctx, bb: BBox, passes: Pass[]) {
    ctx.save();
    for (const p of passes) {
      if (p.alpha <= 0) continue;
      ctx.globalCompositeOperation = p.op;
      ctx.globalAlpha = Math.min(1, p.alpha);
      ctx.drawImage(this.layer.c, bb.x, bb.y, bb.w, bb.h, bb.x, bb.y, bb.w, bb.h);
    }
    ctx.restore();
  }
}
