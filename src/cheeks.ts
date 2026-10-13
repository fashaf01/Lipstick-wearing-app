import {
  EYE_L,
  EYE_R,
  FACE_EDGE_L,
  FACE_EDGE_R,
  MOUTH_CORNER_L,
  MOUTH_CORNER_R,
  add,
  clamp,
  dist,
  dot,
  lerp,
  mul,
  sub,
  unit,
  type FacePts,
} from './face';
import { LIN, chroma, enc, hexToLin, lum, patchMean, smooth, vnoise, type Smoother } from './pixels';

export interface BlushStyle {
  hex: string;
  finish: string; // 'matte' | 'glow'
  /** 0..1 */
  intensity: number;
}

/**
 * Blush as colour *in* the skin: an uneven, powder-like flush on the cheekbone, angled up to the
 * temple. Skin texture, pores and the cheek's own light stay visible; hair and glasses are skipped.
 * The finish "glow" adds a soft highlight on top of the cheekbone.
 */
export function renderBlush(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: FacePts,
  style: BlushStyle,
  smoother: Smoother,
) {
  const I = clamp(style.intensity, 0, 1);
  if (I <= 0) return;
  const P = (i: number) => pts.get(i)!;
  const faceW = dist(P(FACE_EDGE_R), P(FACE_EDGE_L));
  if (faceW < 60) return;
  const u = unit(sub(P(FACE_EDGE_L), P(FACE_EDGE_R))); // across the face
  const v = { x: -u.y, y: u.x }; // down the face
  const [pr, pg, pb] = hexToLin(style.hex);
  const yPigment = lum(pr, pg, pb);

  // image-left cheek belongs to the subject's right eye / mouth corner 61
  const sides = [
    { iris: EYE_R.iris, mouth: MOUTH_CORNER_L, out: mul(u, -1), tilt: 1 },
    { iris: EYE_L.iris, mouth: MOUTH_CORNER_R, out: u, tilt: -1 },
  ];

  for (const [si, s] of sides.entries()) {
    const apple = add(lerp(P(s.iris), P(s.mouth), 0.46), mul(s.out, faceW * 0.01));
    const ax = unit(add(u, mul(v, 0.28 * s.tilt)));
    const outSign = dot(s.out, ax) >= 0 ? 1 : -1;
    const rx = faceW * 0.15;
    const ry = faceW * 0.095;
    const pad = rx * 1.4;
    const x0 = Math.max(0, Math.floor(apple.x - pad));
    const y0 = Math.max(0, Math.floor(apple.y - pad));
    const bw = Math.min(w, Math.ceil(apple.x + pad)) - x0;
    const bh = Math.min(h, Math.ceil(apple.y + pad)) - y0;
    if (bw <= 0 || bh <= 0) continue;

    const ref = patchMean(ctx, apple, Math.max(2, rx * 0.3));
    if (!ref) continue;
    const yRef = Math.max(0.01, smoother.blend(`blushY${si}`, [lum(...ref)], 0.2)[0]);
    const [skx, sky] = chroma(...ref);
    const tone = Math.pow(yRef / Math.max(0.02, yPigment), 0.6); // keep the flush close to the skin's own brightness
    const crest = add(add(apple, mul(v, -ry * 0.8)), mul(s.out, rx * 0.3));

    const img = ctx.getImageData(x0, y0, bw, bh);
    const px = img.data;
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const X = x + x0;
        const Yp = y + y0;
        const dx = X - apple.x;
        const dy = Yp - apple.y;
        const qu = (dx * ax.x + dy * ax.y) * outSign; // + towards the temple
        const qv = -dx * ax.y + dy * ax.x;
        const e = (qu / (qu > 0 ? rx * 1.15 : rx * 0.8)) ** 2 + (qv / ry) ** 2;
        if (e > 2.2) continue;

        const o = (y * bw + x) * 4;
        const r = LIN[px[o]], g = LIN[px[o + 1]], b = LIN[px[o + 2]];
        const Y = lum(r, g, b);
        const sum = r + g + b;
        const gate = 1 - smooth(0.03, 0.09, Math.hypot(r / sum - skx, g / sum - sky));
        if (gate < 0.01) continue;

        const dens = Math.exp(-e * 1.9) * (0.7 + 0.6 * vnoise(X * 0.04, Yp * 0.04));
        const alpha = dens * I * 0.5 * gate;
        const shade = Math.pow(clamp(Y / yRef, 0.5, 1.5), 0.9) * tone;
        let qr = pr * shade, qg = pg * shade, qb = pb * shade;

        if (style.finish === 'glow') {
          const e2 = ((X - crest.x) ** 2 + (Yp - crest.y) ** 2) / (rx * 0.5) ** 2;
          const hi = 0.05 * Math.exp(-e2 * 2) * I * gate;
          qr += hi;
          qg += hi;
          qb += hi;
        }
        px[o] = enc(r + (qr - r) * alpha);
        px[o + 1] = enc(g + (qg - g) * alpha);
        px[o + 2] = enc(b + (qb - b) * alpha);
      }
    }
    ctx.putImageData(img, x0, y0);
  }
}
