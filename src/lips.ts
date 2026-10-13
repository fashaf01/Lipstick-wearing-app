import { FINISHES, hexToRgb, type FinishId } from './shades';
import {
  INNER_LIP,
  MOUTH_CORNER_L,
  MOUTH_CORNER_R,
  OUTER_LIP,
  clamp,
  dist,
  lerp,
  type FacePts,
  type Pt,
} from './face';
import { bboxOf, traceClosed, type Painter } from './paint';

export interface LipStyle {
  hex: string;
  finish: FinishId;
  /** 0..1 */
  intensity: number;
}

function glint(c: CanvasRenderingContext2D, at: Pt, angle: number, rx: number, ry: number, alpha: number) {
  if (rx < 1 || ry < 0.5) return;
  c.save();
  c.translate(at.x, at.y);
  c.rotate(angle);
  c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.4})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, rx, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/**
 * Lipstick: feathered lip mask -> blend passes (hue, pigment, depth) -> specular glints.
 * The even-odd fill keeps the open mouth (teeth) clear.
 */
export function renderLips(painter: Painter, ctx: CanvasRenderingContext2D, w: number, h: number, pts: FacePts, style: LipStyle) {
  if (style.intensity <= 0) return;
  const outer = OUTER_LIP.map((i) => pts.get(i)!);
  const inner = INNER_LIP.map((i) => pts.get(i)!);
  const P = (i: number) => pts.get(i)!;

  const mouthW = dist(P(MOUTH_CORNER_L), P(MOUTH_CORNER_R));
  if (mouthW < 8) return;
  const blur = Math.max(2, mouthW * 0.04);
  const bb = bboxOf([outer], Math.ceil(blur * 2 + 6), w, h);
  if (!bb) return;

  const finish = FINISHES[style.finish];
  const I = clamp(style.intensity, 0, 1);
  const [r, g, b] = hexToRgb(style.hex);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  painter.begin(w, h);
  painter.feather(blur, (c, dx) => {
    traceClosed(c, outer, dx);
    traceClosed(c, inner, dx);
    c.fill('evenodd');
  });

  painter.paint(ctx, bb, style.hex, [
    { op: 'color', alpha: finish.tint * I },
    { op: 'source-over', alpha: finish.cover * I },
    { op: 'multiply', alpha: finish.depth > 0 ? clamp(finish.depth * I * (1.15 - lum), 0, 1) : 0 },
  ]);

  if (finish.shine > 0) {
    const angle = Math.atan2(P(MOUTH_CORNER_R).y - P(MOUTH_CORNER_L).y, P(MOUTH_CORNER_R).x - P(MOUTH_CORNER_L).x);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const lowerT = dist(P(14), P(17));
    const upperT = dist(P(0), P(13));
    const lowerC = lerp(P(14), P(17), 0.45);
    const upperC = lerp(P(0), P(13), 0.55);
    painter.paintCustom(
      ctx,
      bb,
      (l) => {
        glint(l, lowerC, angle, mouthW * 0.2, lowerT * 0.3, 0.95);
        glint(l, { x: lowerC.x - ux * mouthW * 0.2, y: lowerC.y - uy * mouthW * 0.2 }, angle, mouthW * 0.08, lowerT * 0.2, 0.5);
        glint(l, { x: lowerC.x + ux * mouthW * 0.2, y: lowerC.y + uy * mouthW * 0.2 }, angle, mouthW * 0.08, lowerT * 0.2, 0.5);
        glint(l, upperC, angle, mouthW * 0.14, upperT * 0.28, 0.6);
      },
      [{ op: 'source-over', alpha: clamp(finish.shine * (0.5 + 0.5 * I), 0, 1) }],
    );
  }
}
