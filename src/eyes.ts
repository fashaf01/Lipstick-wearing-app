import { EYE_L, EYE_R, add, clamp, dist, dot, mean, mul, sub, unit, type EyeIdx, type FacePts, type Pt } from './face';
import { bboxOf, traceOpen, type Painter } from './paint';
import { LIN, chroma, enc, hash, hexToLin, lum, patchMean, smooth, vnoise, type Smoother } from './pixels';

export interface EyeStyle {
  hex: string;
  finish: string;
  /** 0..1 */
  intensity: number;
}

// Each eye gets its own coordinate frame: `a` runs 0..1 from the outer to the inner corner and
// `hu` is the height above the eye along the direction of the brow.
const LUT_N = 64;
const A0 = -0.3;
const A1 = 1.3;

interface Geo {
  o: Pt;
  ax: Pt;
  up: Pt;
  w: number;
  U: Pt[]; // upper lid
  L: Pt[]; // lower lid
  lid: Float32Array; // height of the upper lid line for each `a`
  low: Float32Array; // height of the lower lid line
  lidToBrow: number;
}

function curveLut(o: Pt, ax: Pt, up: Pt, w: number, pts: Pt[]): Float32Array {
  const as = pts.map((p) => dot(sub(p, o), ax) / w);
  const hs = pts.map((p) => dot(sub(p, o), up));
  const lut = new Float32Array(LUT_N);
  for (let j = 0; j < LUT_N; j++) {
    const a = A0 + ((A1 - A0) * j) / (LUT_N - 1);
    let v = a <= as[0] ? hs[0] : hs[hs.length - 1];
    for (let k = 0; k < as.length - 1; k++) {
      const a0 = as[k];
      const a1 = as[k + 1];
      if ((a >= a0 && a <= a1) || (a >= a1 && a <= a0)) {
        v = hs[k] + (hs[k + 1] - hs[k]) * ((a - a0) / (a1 - a0 || 1));
        break;
      }
    }
    lut[j] = v;
  }
  return lut;
}
const lutAt = (lut: Float32Array, a: number) => {
  const f = clamp((a - A0) / (A1 - A0), 0, 1) * (LUT_N - 1);
  const i = Math.floor(f);
  const j = Math.min(LUT_N - 1, i + 1);
  return lut[i] + (lut[j] - lut[i]) * (f - i);
};

function eyeGeo(pts: FacePts, e: EyeIdx): Geo {
  const U = e.upper.map((i) => pts.get(i)!);
  const L = e.lower.map((i) => pts.get(i)!);
  const o = U[0];
  const inner = U[U.length - 1];
  const w = dist(o, inner);
  const ax = unit(sub(inner, o));
  const c = mean([...U, ...L]);
  const browMid = mean(e.browLower.map((i) => pts.get(i)!));
  let up: Pt = { x: -ax.y, y: ax.x };
  if (dot(up, sub(browMid, c)) < 0) up = mul(up, -1);
  const lid = curveLut(o, ax, up, w, U);
  const low = curveLut(o, ax, up, w, L);
  const lidToBrow = Math.max(w * 0.25, dot(sub(browMid, U[Math.floor(U.length / 2)]), up));
  return { o, ax, up, w, U, L, lid, low, lidToBrow };
}

const point = (g: Geo, a: number, hu: number): Pt => add(add(g.o, mul(g.ax, a * g.w)), mul(g.up, hu));

/**
 * Eyeshadow as pigment on the eyelid skin.
 *  - hard cut at the lash line (lashes and eyeball stay untouched), soft fade towards the crease,
 *  - deeper at the outer corner, with a defined crease,
 *  - skin texture, pores and shading show through, and pigment never lands on lashes or sclera.
 * Finishes: matte, shimmer (sheen + glitter that twinkles), smoky (taller, deeper, smudged lower lash line).
 */
export function renderEyeshadow(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: FacePts,
  style: EyeStyle,
  now: number,
  smoother: Smoother,
) {
  const I = clamp(style.intensity, 0, 1);
  if (I <= 0) return;
  const smoky = style.finish === 'smoky';
  const shimmer = style.finish === 'shimmer';
  const [pr, pg, pb] = hexToLin(style.hex);
  const K = smoky ? 0.98 : shimmer ? 0.88 : 0.95;

  for (const [side, e] of [EYE_R, EYE_L].entries()) {
    const g = eyeGeo(pts, e);
    if (g.w < 14) continue;
    const hBase = clamp(g.w * (smoky ? 0.6 : 0.46), g.w * 0.24, g.lidToBrow * 1.0);
    const box: Pt[] = [];
    for (const a of [-0.22, 0.5, 1.12]) for (const hh of [-0.28 * g.w, hBase * 1.45]) box.push(point(g, a, hh));
    const bb = bboxOf([box], 6, w, h);
    if (!bb) continue;

    const img = ctx.getImageData(bb.x, bb.y, bb.w, bb.h);
    const px = img.data;
    const bw = bb.w;
    const n = bw * bb.h;
    const cov = new Float32Array(n);
    const VN = new Float32Array(n);
    const AA = new Float32Array(n);
    const ABOVE = new Float32Array(n);

    for (let y = 0; y < bb.h; y++) {
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        const dxp = x + bb.x - g.o.x;
        const dyp = y + bb.y - g.o.y;
        const a = (dxp * g.ax.x + dyp * g.ax.y) / g.w;
        const hu = dxp * g.up.x + dyp * g.up.y;
        const aC = clamp(a, 0, 1);
        const cH = Math.min(hBase * (0.6 + 0.6 * Math.pow(1 - aC, 0.8)), g.lidToBrow * 1.0);
        const hup = hu - lutAt(g.lid, a);
        const vn = hup / cH;
        const above = smooth(-1.4, 1.2, hup); // crisp cut along the lash line
        const side_ = smooth(-0.16, 0.03, a) * (1 - smooth(0.93, 1.05, a));
        let dens = 1 - smooth(0.4, 1.05, vn); // full pigment across the lid, fading only near the crease
        dens *= 0.78 + 0.42 * Math.pow(1 - aC, 1.2); // heavier towards the outer corner
        let c = above * dens * side_;
        if (smoky) {
          const hd = lutAt(g.low, a) - hu; // distance below the lower lash line
          const low = smooth(-1.4, 1.2, hd) * (1 - smooth(0, g.w * 0.1, hd)) * side_ * 0.7;
          if (low > c) c = low;
        }
        cov[i] = c;
        VN[i] = vn;
        AA[i] = a;
        ABOVE[i] = above * side_;
      }
    }

    // Reference: this lid's own skin tone (dark lashes excluded) for lighting and a skin/non-skin test.
    let s1 = 0, c1 = 0;
    for (let i = 0; i < n; i++) {
      if (cov[i] > 0.3 && AA[i] > 0.1 && AA[i] < 0.9 && VN[i] > 0.05 && VN[i] < 0.8) {
        s1 += lum(LIN[px[i * 4]], LIN[px[i * 4 + 1]], LIN[px[i * 4 + 2]]);
        c1++;
      }
    }
    if (c1 < 12) continue;
    const m1 = s1 / c1;
    let sr = 0, sg = 0, sb = 0, c2 = 0;
    for (let i = 0; i < n; i++) {
      if (cov[i] > 0.3 && AA[i] > 0.1 && AA[i] < 0.9 && VN[i] > 0.05 && VN[i] < 0.8) {
        const r = LIN[px[i * 4]], gg = LIN[px[i * 4 + 1]], b = LIN[px[i * 4 + 2]];
        if (lum(r, gg, b) > 0.6 * m1) {
          sr += r;
          sg += gg;
          sb += b;
          c2++;
        }
      }
    }
    if (c2 < 8) continue;
    const yRef = Math.max(0.01, smoother.blend(`eyeY${side}`, [lum(sr / c2, sg / c2, sb / c2)], 0.2)[0]);
    const [skx, sky] = chroma(sr / c2, sg / c2, sb / c2);

    const light: [number, number, number] = [(pr + 1) / 2, (pg + 1) / 2, (pb + 1) / 2];
    for (let y = 0; y < bb.h; y++) {
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        const c = cov[i];
        const bumpBase = ABOVE[i];
        if (c < 0.004 && bumpBase < 0.004) continue;
        const o = i * 4;
        const r = LIN[px[o]], gg = LIN[px[o + 1]], b = LIN[px[o + 2]];
        const Y = lum(r, gg, b);

        // Not skin (lashes, eyeball, hair)? leave it alone.
        let gate = 0.55;
        if (Y > 0.005) {
          const s = r + gg + b;
          gate = 1 - 0.9 * smooth(0.06, 0.14, Math.hypot(r / s - skx, gg / s - sky));
        }

        const vn = VN[i];
        const a = AA[i];
        const aC = clamp(a, 0, 1);
        const crease = Math.exp(-Math.pow((vn - 0.72) / 0.2, 2)) * bumpBase * (smoky ? 0.9 : shimmer ? 0.35 : 0.55);
        const grain = 0.88 + 0.24 * vnoise((x + bb.x) * 0.09, (y + bb.y) * 0.09);
        const alpha = clamp((c * K * grain + crease * 0.5) * I * gate, 0, 1);
        if (alpha < 0.004) continue;

        const s = Math.pow(clamp(Y / yRef, 0.35, 1.8), 0.9);
        const deep = 1 - 0.45 * crease;
        let qr = pr * deep * s, qg = pg * deep * s, qb = pb * deep * s;

        if (shimmer) {
          const glow = Math.exp(-Math.pow((aC - 0.5) / 0.3, 2)) * Math.exp(-Math.pow((vn - 0.3) / 0.35, 2)) * bumpBase;
          qr += light[0] * 0.35 * glow;
          qg += light[1] * 0.35 * glow;
          qb += light[2] * 0.35 * glow;
          const cx = Math.floor((a * g.w) / 2.6);
          const hy = Math.floor(((x + bb.x - g.o.x) * g.up.x + (y + bb.y - g.o.y) * g.up.y) / 2.6);
          const hv = hash(cx * 7 + side * 101, hy * 13);
          if (hv > 0.972 && c > 0.15) {
            const tw = Math.max(0, Math.sin(now * 0.005 + hv * 80));
            const sp = 0.6 * tw * c;
            qr += sp;
            qg += sp;
            qb += sp;
          }
        }

        px[o] = enc(r + (qr - r) * alpha);
        px[o + 1] = enc(gg + (qg - gg) * alpha);
        px[o + 2] = enc(b + (qb - b) * alpha);
      }
    }
    ctx.putImageData(img, bb.x, bb.y);
  }
}

/** Eyeliner in the lash line. Finishes: thin, classic, winged (adds a flick at the outer corner). */
export function renderLiner(
  painter: Painter,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: FacePts,
  style: EyeStyle,
) {
  const I = clamp(style.intensity, 0, 1);
  if (I <= 0) return;
  const winged = style.finish === 'winged';
  const [pr, pg, pb] = hexToLin(style.hex);

  for (const e of [EYE_R, EYE_L]) {
    const g = eyeGeo(pts, e);
    if (g.w < 14) continue;
    const lw = g.w * (style.finish === 'thin' ? 0.035 : 0.055);
    const line = g.U.map((p) => add(p, mul(g.up, lw * 0.35)));
    const o = g.U[0];
    const tip = add(add(o, mul(g.ax, -g.w * 0.27)), mul(g.up, g.w * 0.16));
    const wingTop = add(line[1], mul(g.up, lw * 0.5));
    const wingBottom = add(add(o, mul(g.up, -lw * 0.1)), mul(g.ax, -lw * 0.2));

    const blur = Math.max(0.9, g.w * 0.008);
    const bb = bboxOf([line, winged ? [tip] : []], Math.ceil(lw * 2 + blur * 2 + 6), w, h);
    if (!bb) continue;

    painter.begin(w, h, bb);
    painter.feather(0, blur, (c, dx) => {
      c.lineWidth = lw;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      traceOpen(c, line, dx);
      c.stroke();
      if (winged) {
        c.beginPath();
        c.moveTo(wingTop.x + dx, wingTop.y);
        c.lineTo(tip.x + dx, tip.y);
        c.lineTo(wingBottom.x + dx, wingBottom.y);
        c.closePath();
        c.fill();
      }
    });
    const mask = painter.read(0, bb);

    const ref = patchMean(ctx, point(g, 0.5, g.lidToBrow * 0.35), Math.max(2, g.w * 0.05));
    const yRef = Math.max(0.02, ref ? lum(...ref) : 0.3);
    const img = ctx.getImageData(bb.x, bb.y, bb.w, bb.h);
    const px = img.data;
    for (let i = 0; i < mask.length; i++) {
      const a = mask[i] * I * 0.95;
      if (a < 0.004) continue;
      const o = i * 4;
      const r = LIN[px[o]], gg = LIN[px[o + 1]], b = LIN[px[o + 2]];
      // a hint of the underlying light/shade keeps the line looking like it is on the skin
      const s = 0.55 + 0.45 * clamp(lum(r, gg, b) / yRef, 0, 1.6);
      px[o] = enc(r + (pr * s - r) * a);
      px[o + 1] = enc(gg + (pg * s - gg) * a);
      px[o + 2] = enc(b + (pb * s - b) * a);
    }
    ctx.putImageData(img, bb.x, bb.y);
  }
}
