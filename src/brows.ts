import { EYE_L, EYE_R, GLABELLA, add, clamp, dist, dot, lerp, mean, sub, unit, type FacePts } from './face';
import { bboxOf, traceClosed, type Painter } from './paint';
import { LIN, enc, hexToLin, lum, mix, patchMean, smooth, vnoise, type Smoother } from './pixels';

export interface BrowStyle {
  hex: string;
  /** 0..1 */
  intensity: number;
}

/**
 * Brow tint that behaves like powder/gel on hair: dark hairs take the colour strongly (keeping their
 * own light and shade), and the skin between the hairs gets a soft, streaky, hair-like fill instead
 * of a solid band. The ends taper.
 */
export function renderBrows(
  painter: Painter,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: FacePts,
  style: BrowStyle,
  smoother: Smoother,
) {
  const I = clamp(style.intensity, 0, 1);
  if (I <= 0) return;
  const P = (i: number) => pts.get(i)!;
  const [pr, pg, pb] = hexToLin(style.hex);

  for (const [si, e] of [EYE_R, EYE_L].entries()) {
    const up = e.browUpper.map(P);
    const lo = e.browLower.map(P);
    const outerPt = up[0];
    const innerPt = up[up.length - 1];
    const len = dist(outerPt, innerPt);
    if (len < 16) continue;
    const ax = unit(sub(innerPt, outerPt)); // outer -> inner
    const nrm = unit(sub(mean(up), mean(lo))); // towards the forehead
    const mid = mean([...up, ...lo]);

    // The mesh brackets only the upper part of a thick brow, so search a little further down.
    const upper = up.map((p, k) => lerp(lo[k], p, 0.8));
    const lower = lo.map((p, k) => lerp(p, up[k], -0.4));
    const ring = [...upper, ...[...lower].reverse()];
    const blur = Math.max(1, len * 0.012);
    const grow = Math.max(0.8, len * 0.012);
    const bb = bboxOf([ring], Math.ceil(blur * 2 + grow + 6), w, h);
    if (!bb) continue;

    painter.begin(w, h, bb);
    painter.feather(0, blur, (c, dx) => {
      traceClosed(c, ring, dx);
      c.fill();
      c.lineWidth = grow * 2;
      c.lineJoin = 'round';
      c.stroke();
    });
    const mask = painter.read(0, bb);

    const skin = patchMean(ctx, add(lerp(P(GLABELLA), mid, 0.15), { x: 0, y: 0 }), Math.max(2, len * 0.07));
    if (!skin) continue;
    const ySkin = Math.max(0.02, smoother.blend(`browSkin${si}`, [lum(...skin)], 0.2)[0]);

    const img = ctx.getImageData(bb.x, bb.y, bb.w, bb.h);
    const px = img.data;
    const n = mask.length;

    // Hair luminance = the darker pixels inside the brow.
    let sh = 0, ch = 0;
    for (let i = 0; i < n; i++) {
      if (mask[i] > 0.6) {
        const Y = lum(LIN[px[i * 4]], LIN[px[i * 4 + 1]], LIN[px[i * 4 + 2]]);
        if (Y < 0.85 * ySkin) {
          sh += Y;
          ch++;
        }
      }
    }
    const yHair = Math.max(0.01, smoother.blend(`browHair${si}`, [ch > 8 ? sh / ch : ySkin * 0.35], 0.2)[0]);

    const bw = bb.w;
    for (let y = 0; y < bb.h; y++) {
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        const m = mask[i];
        if (m < 0.004) continue;
        const o = i * 4;
        const r = LIN[px[o]], g = LIN[px[o + 1]], b = LIN[px[o + 2]];
        const Y = lum(r, g, b);

        const X = x + bb.x;
        const Yp = y + bb.y;
        const p = { x: X, y: Yp };
        const s = dot(sub(p, outerPt), ax) / len; // 0 at the tail, 1 at the inner start
        const t = dot(sub(p, mid), nrm);
        const along = s * len;

        const hair = smooth(0.95, 0.55, Y / ySkin); // darker than skin = hair
        const streak =
          0.6 * vnoise(along / (len * 0.09), t / (len * 0.01) + si * 7.3) + 0.4 * vnoise(along / (len * 0.04) + 11.1, t / (len * 0.005));
        const taper = (0.25 + 0.75 * smooth(0, 0.3, s)) * (1 - 0.5 * smooth(0.94, 1.0, s));
        const alpha = clamp(m * taper * (hair * 0.9 + (1 - hair) * (0.1 + 0.4 * streak)) * I, 0, 1);
        if (alpha < 0.004) continue;

        const shade = mix(clamp(Y / ySkin, 0.7, 1.2), Math.pow(clamp(Y / yHair, 0.5, 1.6), 0.8), hair);
        px[o] = enc(r + (pr * shade - r) * alpha);
        px[o + 1] = enc(g + (pg * shade - g) * alpha);
        px[o + 2] = enc(b + (pb * shade - b) * alpha);
      }
    }
    ctx.putImageData(img, bb.x, bb.y);
  }
}
