import { EYE_L, EYE_R, clamp, dist, lerp, type FacePts } from './face';
import { bboxOf, traceClosed, type Painter } from './paint';

export interface BrowStyle {
  hex: string;
  /** 0..1 */
  intensity: number;
}

/** Brow tint: fills and darkens (or recolours) the brow shape with a slightly expanded, soft edge. */
export function renderBrows(
  painter: Painter,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: FacePts,
  style: BrowStyle,
) {
  if (style.intensity <= 0) return;
  const I = clamp(style.intensity, 0, 1);

  for (const e of [EYE_R, EYE_L]) {
    // The mesh's brow landmarks bracket only the upper half of a thick brow (the lower line runs
    // through the middle of the hair), so push the lower edge further down to cover all of it.
    const upper = e.browUpper.map((i, k) => lerp(pts.get(e.browLower[k])!, pts.get(i)!, 0.75));
    const lower = e.browLower.map((i, k) => lerp(pts.get(i)!, pts.get(e.browUpper[k])!, -0.35));
    const ring = [...upper, ...[...lower].reverse()];
    const len = dist(pts.get(e.browUpper[0])!, pts.get(e.browUpper[e.browUpper.length - 1])!);
    if (len < 12) continue;
    const blur = Math.max(1.5, len * 0.035);
    const grow = Math.max(0.8, len * 0.015);
    const bb = bboxOf([ring], Math.ceil(blur * 2 + grow + 6), w, h);
    if (!bb) continue;

    painter.begin(w, h);
    painter.feather(blur, (c, dx) => {
      traceClosed(c, ring, dx);
      c.fill();
      c.lineWidth = grow * 2;
      c.lineJoin = 'round';
      c.stroke();
    });
    painter.paint(ctx, bb, style.hex, [
      // multiply keeps hair texture, the opaque pass keeps the colour warm ("color" turns dark browns grey)
      { op: 'multiply', alpha: clamp(0.45 * I, 0, 1) },
      { op: 'source-over', alpha: clamp(0.42 * I, 0, 1) },
    ]);
  }
}
