import type { FinishId } from './shades';
import {
  INNER_LIP,
  MOUTH_CORNER_L,
  MOUTH_CORNER_R,
  NOSE_BOTTOM,
  CHIN,
  OUTER_LIP,
  clamp,
  dist,
  lerp,
  type FacePts,
  type Pt,
} from './face';
import { bboxOf, offsetRing, traceClosed, type Painter } from './paint';
import { LIN, boxBlur, chroma, enc, hexToLin, lum, meanRgb, mix, patchMean, smooth, vnoise, type Smoother } from './pixels';

export interface LipStyle {
  hex: string;
  finish: FinishId;
  /** 0..1 */
  intensity: number;
}

interface Recipe {
  /** how much of the natural lip colour is replaced */
  cover: number;
  /** how much the lips' own highlights may lighten the colour (matte flattens them) */
  hl: number;
  /** strength / tightness of the shape-based gloss highlight */
  spec: number;
  shin: number;
  /** broad wet sheen */
  sheen: number;
}
const RECIPES: Record<FinishId, Recipe> = {
  matte: { cover: 0.97, hl: 0.1, spec: 0, shin: 1, sheen: 0 },
  satin: { cover: 0.95, hl: 0.35, spec: 0.16, shin: 20, sheen: 0.06 },
  gloss: { cover: 0.88, hl: 0.6, spec: 0.55, shin: 40, sheen: 0.26 },
  sheer: { cover: 0.55, hl: 0.5, spec: 0.22, shin: 30, sheen: 0.1 },
};

/**
 * Lipstick as a real layer on the lips:
 *  - the lip edge is found from the actual lip/skin colour change (landmarks only give a search band),
 *  - the pigment keeps the lips' own shading, so lip lines, shadows and texture show through,
 *  - gloss is lit from the 3D shape of the lips, so it follows the mouth as it moves.
 */
export function renderLips(
  painter: Painter,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: FacePts,
  style: LipStyle,
  smoother: Smoother,
) {
  const I = clamp(style.intensity, 0, 1);
  if (I <= 0) return;
  const P = (i: number) => pts.get(i)!;
  const outer = OUTER_LIP.map(P);
  const inner = INNER_LIP.map(P);
  const mouthW = dist(P(MOUTH_CORNER_L), P(MOUTH_CORNER_R));
  if (mouthW < 20) return;

  // The landmark contour is the primary edge. Only at the outer lip line do we let the actual image
  // trim or extend it by a few pixels; the mouth opening uses the contour exactly (teeth stay clean).
  const d = Math.max(2, mouthW * 0.025);
  const bb = bboxOf([offsetRing(outer, d)], Math.ceil(d * 2 + 6), w, h);
  if (!bb) return;

  const blur = Math.max(1, mouthW * 0.012);
  painter.begin(w, h, bb);
  const shape = (c: CanvasRenderingContext2D, dx: number, outerRing: Pt[]) => {
    traceClosed(c, outerRing, dx);
    traceClosed(c, inner, dx);
    c.fill('evenodd');
  };
  const coreRing = offsetRing(outer, -d);
  const wideRing = offsetRing(outer, d);
  painter.feather(0, blur, (c, dx) => shape(c, dx, coreRing));
  painter.feather(1, blur, (c, dx) => shape(c, dx, wideRing));
  painter.feather(2, blur, (c, dx) => shape(c, dx, outer));
  const core = painter.read(0, bb);
  const wide = painter.read(1, bb);
  const mid = painter.read(2, bb);

  const img = ctx.getImageData(bb.x, bb.y, bb.w, bb.h);
  const px = img.data;
  const n = bb.w * bb.h;

  // Reference colours: the lips themselves, and bare skin just above and below them.
  let sr = 0, sg = 0, sb = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    if (core[i] > 0.9) {
      sr += LIN[px[i * 4]];
      sg += LIN[px[i * 4 + 1]];
      sb += LIN[px[i * 4 + 2]];
      cnt++;
    }
  }
  if (cnt < 30) return;
  const lipRef: [number, number, number] = [sr / cnt, sg / cnt, sb / cnt];
  const pr = Math.max(2, mouthW * 0.04);
  const skinRef = meanRgb([
    patchMean(ctx, lerp(P(0), P(NOSE_BOTTOM), 0.5), pr),
    patchMean(ctx, lerp(P(17), P(CHIN), 0.5), pr),
  ]);

  // How lip-coloured is each pixel? Position along the skin -> lip direction in chromaticity space,
  // smoothed a little because video chroma is stored at half resolution.
  let conf = 0;
  const T = new Float32Array(n).fill(0.5);
  if (skinRef) {
    const lc = chroma(...lipRef);
    const kc = chroma(...skinRef);
    const dx = lc[0] - kc[0];
    const dy = lc[1] - kc[1];
    const mag = Math.hypot(dx, dy);
    conf = smooth(0.012, 0.04, mag);
    if (conf > 0) {
      const dd = mag * mag;
      for (let i = 0; i < n; i++) {
        if (wide[i] < 0.004) continue;
        const o = i * 4;
        const r = LIN[px[o]], g = LIN[px[o + 1]], b = LIN[px[o + 2]];
        T[i] = lum(r, g, b) > 0.004 ? ((r / (r + g + b) - kc[0]) * dx + (g / (r + g + b) - kc[1]) * dy) / dd : 0;
      }
    }
  }
  const Ts = conf > 0 ? boxBlur(T, bb.w, bb.h, 1) : T;

  // Final coverage = certain core + (inside the contour but near the edge) + (just beyond the contour).
  let A: Float32Array = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const wd = wide[i];
    if (wd < 0.004) continue;
    const co = core[i];
    const md = mid[i];
    const innerBand = md > co ? md - co : 0;
    const grow = wd > md ? wd - md : 0;
    let a = co;
    if (conf > 0) {
      const t = Ts[i];
      a += innerBand * mix(1, smooth(0.15, 0.55, t), conf * 0.45); // trust the contour, trim obvious skin
      a += grow * smooth(0.5, 0.85, t) * conf; // extend only where it is clearly lip-coloured
    } else {
      a += innerBand + grow * 0.5;
    }
    A[i] = a > 1 ? 1 : a;
  }
  A = boxBlur(A, bb.w, bb.h, 1); // ~1px anti-aliasing on the edge

  const rec = RECIPES[style.finish] ?? RECIPES.satin;
  const yRef = Math.max(0.01, smoother.blend('lipY', [lum(...lipRef)], 0.2)[0]);
  const [pr_, pg_, pb_] = hexToLin(style.hex);
  const centreY = (P(13).y + P(14).y) / 2;
  const opacity = 1 - Math.pow(1 - I, 1.7); // lipstick is opaque: a high setting should really cover

  // Height field of the lips (blurred coverage) -> surface normals for the gloss highlight.
  let H: Float32Array | null = null;
  let slope = 0;
  if (rec.spec > 0 || rec.sheen > 0) {
    const rb = Math.max(2, Math.round(mouthW * 0.03));
    H = boxBlur(boxBlur(A, bb.w, bb.h, rb), bb.w, bb.h, rb);
    slope = rb * 1.6;
  }

  const bw = bb.w;
  for (let y = 0; y < bb.h; y++) {
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      const a = A[i];
      if (a < 0.004) continue;
      const o = i * 4;
      const r = LIN[px[o]], g = LIN[px[o + 1]], b = LIN[px[o + 2]];
      const Y = lum(r, g, b);
      const ratio = Y / yRef;

      // Pigment with the lips' own light and shadow on it.
      let s = clamp(ratio, 0.18, 6);
      if (s > 1) s = 1 + rec.hl * (1 - Math.exp(-(s - 1) * 1.5)); // soft-knee: highlights lighten, never blow out
      let qr = pr_ * s, qg = pg_ * s, qb = pb_ * s;
      const white = smooth(1.6, 3.2, ratio) * 0.6 * rec.hl; // strong highlights stay near-white
      if (white > 0) {
        qr = mix(qr, Y, white);
        qg = mix(qg, Y, white);
        qb = mix(qb, Y, white);
      }

      if (H) {
        const xl = x > 0 ? i - 1 : i, xr = x < bw - 1 ? i + 1 : i;
        const yu = y > 0 ? i - bw : i, yd = y < bb.h - 1 ? i + bw : i;
        const nx = -(H[xr] - H[xl]) * 0.5 * slope;
        const ny = -(H[yd] - H[yu]) * 0.5 * slope;
        const dotNH = (ny * -0.15 + 0.989) / Math.hypot(nx, ny, 1);
        const body = smooth(0.3, 0.75, H[i]); // no highlight on the thin fringe of the lips
        if (dotNH > 0 && body > 0) {
          let sp = rec.spec * Math.pow(dotNH, rec.shin) + rec.sheen * Math.pow(dotNH, 8);
          sp *= (y + bb.y < centreY ? 0.45 : 1) * (0.75 + 0.5 * vnoise((x + bb.x) * 0.12, (y + bb.y) * 0.12));
          sp *= clamp(ratio, 0.7, 1.3) * body;
          qr += sp * (0.75 + 0.25 * pr_);
          qg += sp * (0.75 + 0.25 * pg_);
          qb += sp * (0.75 + 0.25 * pb_);
        }
      }

      const k = a * rec.cover * opacity;
      px[o] = enc(r + (qr - r) * k);
      px[o + 1] = enc(g + (qg - g) * k);
      px[o + 2] = enc(b + (qb - b) * k);
    }
  }
  ctx.putImageData(img, bb.x, bb.y);
}
