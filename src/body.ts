import { add, dist, lerp, mul, norm, perp, sub, v2, type V2 } from './geom';
import type { Landmark } from './pose';

// ---------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------

/** One Euro filter: heavy smoothing while still, little lag while moving. */
class OneEuro {
  private x = 0;
  private dx = 0;
  private t = 0;
  private ready = false;
  constructor(
    private minCutoff = 1.4,
    private beta = 14,
    private dCutoff = 1.0,
  ) {}
  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(value: number, t: number): number {
    if (!this.ready) {
      this.ready = true;
      this.x = value;
      this.dx = 0;
      this.t = t;
      return value;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const dRaw = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

export interface Pt33 {
  x: number;
  y: number;
  v: number;
}

/** Smooths all 33 pose landmarks and converts them to pixel coordinates. */
export class PoseSmoother {
  private fx: OneEuro[] = [];
  private fy: OneEuro[] = [];
  private fv: number[] = [];
  constructor() {
    this.reset();
  }
  reset() {
    this.fx = Array.from({ length: 33 }, () => new OneEuro());
    this.fy = Array.from({ length: 33 }, () => new OneEuro());
    this.fv = new Array(33).fill(-1);
  }
  update(lm: Landmark[], w: number, h: number, tSec: number): Pt33[] {
    const out: Pt33[] = [];
    for (let i = 0; i < 33; i++) {
      const p = lm[i];
      // filter in units of frame height so x and y behave alike
      const x = this.fx[i].filter((p.x * w) / h, tSec) * h;
      const y = this.fy[i].filter(p.y, tSec) * h;
      const vis = p.visibility ?? 1;
      this.fv[i] = this.fv[i] < 0 ? vis : this.fv[i] + (vis - this.fv[i]) * 0.5;
      out.push({ x, y, v: this.fv[i] });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Body model
// ---------------------------------------------------------------------------

/**
 * Sides are named by where they appear in the picture: `L` is the left of the image
 * (the wearer's right when facing the camera), `R` the right of the image.
 */
export interface Body {
  sL: V2;
  sR: V2;
  eL: V2;
  eR: V2;
  wL: V2;
  wR: V2;
  hL: V2;
  hR: V2;
  kL: V2;
  kR: V2;
  aL: V2;
  aR: V2;
  head: Head | null;
  shoulderW: number;
  torsoLen: number;
  hipsTracked: boolean;
  legsTracked: boolean;
}

export interface Head {
  c: V2;
  /** unit axes of the ellipse and its radii (px) */
  ax: V2;
  ay: V2;
  rx: number;
  ry: number;
}

// Typical proportions, in units of shoulder-joint distance (used when a joint is out of frame or noisy)
const TORSO = 1.6;
const HIP_RATIO = 0.5; // hip-joint distance / shoulder-joint distance
const UPPER_ARM = 0.83;
const FOREARM = 0.75;
const THIGH_PER_TORSO = 0.72;
const SHIN_PER_TORSO = 0.68;

const VIS_SHOULDER = 0.4;
const VIS_JOINT = 0.4;

export function buildBody(pts: Pt33[], h: number): Body | null {
  const p = (i: number): V2 => v2(pts[i].x, pts[i].y);
  const vis = (i: number) => pts[i].v;

  // Pair joints by picture side, not by MediaPipe's anatomical left/right: that stays
  // correct for mirrored photos too.
  const firstIsLeft = pts[11].x < pts[12].x;
  const L = firstIsLeft ? { s: 11, e: 13, w: 15, h: 23, k: 25, a: 27 } : { s: 12, e: 14, w: 16, h: 24, k: 26, a: 28 };
  const R = firstIsLeft ? { s: 12, e: 14, w: 16, h: 24, k: 26, a: 28 } : { s: 11, e: 13, w: 15, h: 23, k: 25, a: 27 };

  if (vis(L.s) < VIS_SHOULDER || vis(R.s) < VIS_SHOULDER) return null;
  const sL = p(L.s);
  const sR = p(R.s);
  const shoulderW = dist(sL, sR);
  if (shoulderW < 0.02 * h) return null;

  const across = norm(sub(sR, sL));
  let down = perp(across);
  if (down.y < 0) down = mul(down, -1);
  const midS = lerp(sL, sR, 0.5);

  // hips
  const hipsTracked = vis(L.h) >= 0.45 && vis(R.h) >= 0.45;
  let hL = p(L.h);
  let hR = p(R.h);
  if (!hipsTracked) {
    const c = add(midS, mul(down, TORSO * shoulderW));
    hL = sub(c, mul(across, 0.5 * HIP_RATIO * shoulderW));
    hR = add(c, mul(across, 0.5 * HIP_RATIO * shoulderW));
  } else {
    // hip landmarks are the noisiest (they sit under clothes): keep their centre and height, but pull
    // their spacing halfway towards what the shoulders suggest
    const c = lerp(hL, hR, 0.5);
    const live = dist(hL, hR);
    const half = 0.5 * (0.5 * live + 0.5 * HIP_RATIO * shoulderW);
    const dir = live > 1e-3 ? norm(sub(hR, hL)) : across;
    hL = sub(c, mul(dir, half));
    hR = add(c, mul(dir, half));
  }
  const midH = lerp(hL, hR, 0.5);
  const torsoLen = dist(midS, midH);
  const spine = norm(sub(midH, midS));

  // arms
  const arm = (s: V2, ei: number, wi: number, side: -1 | 1) => {
    // hang slightly outward when a joint is not visible
    const dir = norm(add(spine, mul(across, 0.14 * side)));
    let e = p(ei);
    let wr = p(wi);
    if (vis(ei) < VIS_JOINT) e = add(s, mul(dir, UPPER_ARM * shoulderW));
    if (vis(wi) < VIS_JOINT) wr = add(e, mul(dir, FOREARM * shoulderW));
    return { e, w: wr };
  };
  const aL_ = arm(sL, L.e, L.w, -1);
  const aR_ = arm(sR, R.e, R.w, 1);

  // legs
  const legsTracked = hipsTracked && vis(L.k) >= VIS_JOINT && vis(R.k) >= VIS_JOINT && vis(L.a) >= 0.3 && vis(R.a) >= 0.3;
  const leg = (hip: V2, ki: number, ai: number, side: -1 | 1) => {
    const dir = norm(add(spine, mul(across, 0.03 * side)));
    let k = p(ki);
    let a = p(ai);
    if (vis(ki) < VIS_JOINT || !hipsTracked) k = add(hip, mul(dir, THIGH_PER_TORSO * torsoLen));
    if (vis(ai) < 0.3 || !hipsTracked) a = add(k, mul(dir, SHIN_PER_TORSO * torsoLen));
    return { k, a };
  };
  const lL = leg(hL, L.k, L.a, -1);
  const lR = leg(hR, R.k, R.a, 1);

  return {
    sL,
    sR,
    eL: aL_.e,
    eR: aR_.e,
    wL: aL_.w,
    wR: aR_.w,
    hL,
    hR,
    kL: lL.k,
    kR: lR.k,
    aL: lL.a,
    aR: lR.a,
    head: buildHead(pts, shoulderW),
    shoulderW,
    torsoLen,
    hipsTracked,
    legsTracked,
  };
}

function buildHead(pts: Pt33[], shoulderW: number): Head | null {
  if (pts[0].v < 0.5 || pts[2].v < 0.4 || pts[5].v < 0.4 || pts[9].v < 0.3 || pts[10].v < 0.3) return null;
  const q = (i: number) => v2(pts[i].x, pts[i].y);
  const eyeMid = lerp(q(2), q(5), 0.5);
  const mouthMid = lerp(q(9), q(10), 0.5);
  const upRaw = sub(eyeMid, mouthMid);
  if (Math.hypot(upRaw.x, upRaw.y) < 1) return null;
  const ay = norm(upRaw);
  const ax = perp(ay);
  const headW = 0.46 * shoulderW;
  const c = sub(eyeMid, mul(ay, 0.07 * headW));
  return { c, ax, ay, rx: 0.58 * headW, ry: 0.78 * headW };
}

/** Scale the body about its torso centre and shift it down: the "fit" sliders. */
export function fitBody(b: Body, size: number, dy: number): Body {
  if (size === 1 && dy === 0) return b;
  const centre = lerp(lerp(b.sL, b.sR, 0.5), lerp(b.hL, b.hR, 0.5), 0.5);
  const shift = v2(0, dy * b.torsoLen);
  const f = (p: V2): V2 => add(add(centre, mul(sub(p, centre), size)), shift);
  return {
    ...b,
    sL: f(b.sL),
    sR: f(b.sR),
    eL: f(b.eL),
    eR: f(b.eR),
    wL: f(b.wL),
    wR: f(b.wR),
    hL: f(b.hL),
    hR: f(b.hR),
    kL: f(b.kL),
    kR: f(b.kR),
    aL: f(b.aL),
    aR: f(b.aR),
    shoulderW: b.shoulderW * size,
    torsoLen: b.torsoLen * size,
  };
}
