export interface V2 {
  x: number;
  y: number;
}

export const v2 = (x: number, y: number): V2 => ({ x, y });
export const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: V2, k: number): V2 => ({ x: a.x * k, y: a.y * k });
export const lerp = (a: V2, b: V2, t: number): V2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const dot = (a: V2, b: V2) => a.x * b.x + a.y * b.y;
export const len = (a: V2) => Math.hypot(a.x, a.y);
export const dist = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: V2): V2 => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
/** Rotate +90° (in image coordinates, y down: right -> down). */
export const perp = (a: V2): V2 => ({ x: -a.y, y: a.x });
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Distance from p to the segment a-b. */
export function distToSegment(p: V2, a: V2, b: V2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  const t = l2 === 0 ? 0 : clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / l2, 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Distance from p to a convex polygon (0 inside). Works for either winding. */
export function distToPolygon(p: V2, poly: V2[]): number {
  let inside = true;
  let sign = 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (sign === 0) sign = cross >= 0 ? 1 : -1;
    else if ((cross >= 0 ? 1 : -1) !== sign) inside = false;
    best = Math.min(best, distToSegment(p, a, b));
  }
  return inside ? 0 : best;
}

/**
 * Inverse of the bilinear map P(s,t) = (1-t)((1-s)P00 + s P10) + t((1-s)P01 + s P11).
 * Newton iterations from the parallelogram solution; fine for the near-convex quads used here.
 */
export function inverseBilinear(p: V2, p00: V2, p10: V2, p11: V2, p01: V2): { s: number; t: number } {
  let s = 0.5;
  let t = 0.5;
  for (let i = 0; i < 8; i++) {
    const a = lerp(p00, p10, s);
    const b = lerp(p01, p11, s);
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    const rx = px - p.x;
    const ry = py - p.y;
    // d/ds
    const dax = p10.x - p00.x;
    const day = p10.y - p00.y;
    const dbx = p11.x - p01.x;
    const dby = p11.y - p01.y;
    const dsx = dax + (dbx - dax) * t;
    const dsy = day + (dby - day) * t;
    // d/dt
    const dtx = b.x - a.x;
    const dty = b.y - a.y;
    const det = dsx * dty - dsy * dtx;
    if (Math.abs(det) < 1e-9) break;
    const ds = (rx * dty - ry * dtx) / det;
    const dt = (dsx * ry - dsy * rx) / det;
    s -= ds;
    t -= dt;
    if (Math.abs(ds) + Math.abs(dt) < 1e-6) break;
  }
  return { s, t };
}
