export interface Pt {
  x: number;
  y: number;
}
export interface Landmark {
  x: number;
  y: number;
  z?: number;
}
/** Face landmark index -> pixel position. */
export type FacePts = Map<number, Pt>;

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const unit = (a: Pt): Pt => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const mean = (pts: Pt[]): Pt => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// MediaPipe face mesh indices. "Right"/"left" are the subject's own sides, and every
// contour runs from the outer corner / temple towards the nose.
export const OUTER_LIP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
export const INNER_LIP = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
export const MOUTH_CORNER_L = 61;
export const MOUTH_CORNER_R = 291;

export const EYE_R = {
  upper: [33, 246, 161, 160, 159, 158, 157, 173, 133],
  lower: [33, 7, 163, 144, 145, 153, 154, 155, 133],
  browLower: [46, 53, 52, 65, 55],
  browUpper: [70, 63, 105, 66, 107],
  iris: 468,
};
export const EYE_L = {
  upper: [263, 466, 388, 387, 386, 385, 384, 398, 362],
  lower: [263, 249, 390, 373, 374, 380, 381, 382, 362],
  browLower: [276, 283, 282, 295, 285],
  browUpper: [300, 293, 334, 296, 336],
  iris: 473,
};
export type EyeIdx = typeof EYE_R;

export const FACE_EDGE_R = 234;
export const FACE_EDGE_L = 454;
export const NOSE_BOTTOM = 2;
export const CHIN = 152;
export const GLABELLA = 168; // bare skin between the brows
export const MOUTH_CORNERS = [MOUTH_CORNER_L, MOUTH_CORNER_R];

const NEEDED = [
  ...new Set([
    ...OUTER_LIP,
    ...INNER_LIP,
    ...[EYE_R, EYE_L].flatMap((e) => [...e.upper, ...e.lower, ...e.browLower, ...e.browUpper, e.iris]),
    FACE_EDGE_R,
    FACE_EDGE_L,
    NOSE_BOTTOM,
    CHIN,
    GLABELLA,
  ]),
];

export function toPoints(lm: Landmark[], w: number, h: number): FacePts | null {
  const m: FacePts = new Map();
  for (const i of NEEDED) {
    const l = lm[i];
    if (!l) return null;
    m.set(i, { x: l.x * w, y: l.y * h });
  }
  return m;
}

/** Light temporal smoothing that follows fast motion but removes landmark jitter. */
export class FaceSmoother {
  private prev: FacePts | null = null;

  reset() {
    this.prev = null;
  }

  update(lm: Landmark[], w: number, h: number): FacePts | null {
    const next = toPoints(lm, w, h);
    if (!next) return null;
    const prev = this.prev;
    if (!prev) {
      this.prev = next;
      return next;
    }
    const faceW = Math.max(1, dist(next.get(FACE_EDGE_R)!, next.get(FACE_EDGE_L)!));
    for (const [i, p] of next) {
      const q = prev.get(i)!;
      const a = clamp(0.25 + (dist(p, q) / faceW) * 30, 0.25, 1);
      q.x += (p.x - q.x) * a;
      q.y += (p.y - q.y) * a;
    }
    return prev;
  }
}
