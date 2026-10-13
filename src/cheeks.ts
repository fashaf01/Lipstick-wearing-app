import { EYE_L, EYE_R, FACE_EDGE_L, FACE_EDGE_R, MOUTH_CORNER_L, MOUTH_CORNER_R, add, clamp, dist, lerp, mul, sub, unit, type FacePts } from './face';
import { hexToRgb } from './shades';
import type { Painter } from './paint';

export interface BlushStyle {
  hex: string;
  finish: string; // 'matte' | 'glow'
  /** 0..1 */
  intensity: number;
}

/**
 * Blush: a soft ellipse on the apple of each cheek, angled up towards the temple.
 * The finish "glow" adds a highlight on top of the cheekbone.
 */
export function renderBlush(
  painter: Painter,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: FacePts,
  style: BlushStyle,
) {
  if (style.intensity <= 0) return;
  const I = clamp(style.intensity, 0, 1);
  const P = (i: number) => pts.get(i)!;
  const faceW = dist(P(FACE_EDGE_R), P(FACE_EDGE_L));
  if (faceW < 60) return;
  const u = unit(sub(P(FACE_EDGE_L), P(FACE_EDGE_R))); // across the face
  const v = { x: -u.y, y: u.x }; // down the face
  const [r, g, b] = hexToRgb(style.hex);
  const rgba = (a: number) => `rgba(${r},${g},${b},${a})`;

  // image-left cheek belongs to the subject's right eye / mouth corner 61
  const sides = [
    { iris: EYE_R.iris, mouth: MOUTH_CORNER_L, out: mul(u, -1), tilt: 1 },
    { iris: EYE_L.iris, mouth: MOUTH_CORNER_R, out: u, tilt: -1 },
  ];

  for (const s of sides) {
    const apple = add(lerp(P(s.iris), P(s.mouth), 0.46), mul(s.out, faceW * 0.01));
    const axis = unit(add(u, mul(v, 0.28 * s.tilt)));
    const angle = Math.atan2(axis.y, axis.x);
    const rx = faceW * 0.15;
    const ry = faceW * 0.095;
    const pad = rx * 1.15;
    const bb = {
      x: Math.max(0, Math.floor(apple.x - pad)),
      y: Math.max(0, Math.floor(apple.y - pad)),
      w: 0,
      h: 0,
    };
    bb.w = Math.min(w, Math.ceil(apple.x + pad)) - bb.x;
    bb.h = Math.min(h, Math.ceil(apple.y + pad)) - bb.y;
    if (bb.w <= 0 || bb.h <= 0) continue;

    painter.begin(w, h);
    painter.paintFree(
      ctx,
      bb,
      (l) => {
        l.save();
        l.translate(apple.x, apple.y);
        l.rotate(angle);
        l.scale(1, ry / rx);
        const gr = l.createRadialGradient(0, 0, 0, 0, 0, rx);
        gr.addColorStop(0, rgba(0.85));
        gr.addColorStop(0.35, rgba(0.6));
        gr.addColorStop(0.7, rgba(0.22));
        gr.addColorStop(1, rgba(0));
        l.fillStyle = gr;
        l.beginPath();
        l.arc(0, 0, rx, 0, Math.PI * 2);
        l.fill();
        l.restore();
      },
      [
        { op: 'source-over', alpha: 0.38 * I },
        { op: 'multiply', alpha: 0.28 * I },
        { op: 'color', alpha: 0.22 * I },
      ],
    );

    if (style.finish === 'glow') {
      const hi = add(add(apple, mul(v, -ry * 0.9)), mul(s.out, rx * 0.25));
      painter.paintFree(
        ctx,
        bb,
        (l) => {
          l.save();
          l.translate(hi.x, hi.y);
          l.rotate(angle);
          l.scale(1, 0.6);
          const gr = l.createRadialGradient(0, 0, 0, 0, 0, rx * 0.55);
          gr.addColorStop(0, 'rgba(255,240,235,0.9)');
          gr.addColorStop(1, 'rgba(255,240,235,0)');
          l.fillStyle = gr;
          l.beginPath();
          l.arc(0, 0, rx * 0.55, 0, Math.PI * 2);
          l.fill();
          l.restore();
        },
        [{ op: 'screen', alpha: 0.4 * I }],
      );
    }
  }
}
