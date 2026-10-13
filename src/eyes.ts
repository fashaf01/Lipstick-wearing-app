import {
  EYE_L,
  EYE_R,
  add,
  clamp,
  dist,
  dot,
  mean,
  mul,
  sub,
  unit,
  type EyeIdx,
  type FacePts,
  type Pt,
} from './face';
import { bboxOf, traceClosed, traceOpen, type Painter } from './paint';
import { hexToRgb } from './shades';

export interface EyeStyle {
  hex: string;
  finish: string;
  /** 0..1 */
  intensity: number;
}

interface EyeGeo {
  U: Pt[]; // upper lid, outer corner -> inner corner
  L: Pt[]; // lower lid, outer corner -> inner corner
  w: number; // eye width
  up: Pt; // unit vector pointing from the eye towards the brow
  out: Pt; // unit vector pointing from the inner to the outer corner
  lidToBrow: number; // distance from the lid to the brow, along `up`
}

function eyeGeo(pts: FacePts, e: EyeIdx): EyeGeo {
  const U = e.upper.map((i) => pts.get(i)!);
  const L = e.lower.map((i) => pts.get(i)!);
  const o = U[0];
  const inner = U[U.length - 1];
  const w = dist(o, inner);
  const out = unit(sub(o, inner));
  const c = mean([...U, ...L]);
  const browMid = mean(e.browLower.map((i) => pts.get(i)!));
  let up: Pt = { x: -out.y, y: out.x };
  if (dot(up, sub(browMid, c)) < 0) up = mul(up, -1);
  const lidToBrow = Math.max(w * 0.25, dot(sub(browMid, U[Math.floor(U.length / 2)]), up));
  return { U, L, w, up, out, lidToBrow };
}

const mixWhite = (hex: string, t: number) => {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v + (255 - v) * t));
  return `rgb(${r},${g},${b})`;
};

/**
 * Eyeshadow: a lid shape that fades upwards towards the crease.
 * Finishes: matte, shimmer (soft sheen + twinkling sparkles), smoky (taller, deeper, smudged lower lash line).
 */
export function renderEyeshadow(
  painter: Painter,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: FacePts,
  style: EyeStyle,
  now: number,
) {
  if (style.intensity <= 0) return;
  const I = clamp(style.intensity, 0, 1);
  const smoky = style.finish === 'smoky';
  const shimmer = style.finish === 'shimmer';

  for (const [side, e] of [EYE_R, EYE_L].entries()) {
    const g = eyeGeo(pts, e);
    if (g.w < 12) continue;

    const n = g.U.length;
    const hBase = clamp(g.w * (smoky ? 0.55 : 0.42), g.w * 0.2, g.lidToBrow * 0.85);
    const crease = g.U.map((p, k) => {
      const t = k / (n - 1);
      const f = 0.55 + 0.65 * Math.pow(1 - t, 0.8); // taller towards the outer corner
      return add(p, mul(g.up, Math.min(hBase * f, g.lidToBrow * 0.85)));
    });
    const wing = add(add(g.U[0], mul(g.out, g.w * 0.1)), mul(g.up, hBase * 0.7));
    const upper = [...g.U, ...[...crease].reverse(), wing];
    const rings = [upper];
    if (smoky) {
      const down = mul(g.up, -g.w * 0.06);
      rings.push([...g.L, ...[...g.L].reverse().map((p) => add(p, down))]);
    }

    const blur = Math.max(2, g.w * 0.11);
    const bb = bboxOf(rings, Math.ceil(blur * 2 + 6), w, h);
    if (!bb) continue;

    painter.begin(w, h);
    painter.feather(blur, (c, dx) => {
      for (const r of rings) {
        c.beginPath();
        traceClosed(c, r, dx);
        c.fill();
      }
    });

    // Strongest on the lid, fading towards the crease.
    const midU = g.U[Math.floor(n / 2)];
    const top = add(midU, mul(g.up, hBase * 1.25));
    const fade = (l: CanvasRenderingContext2D) => {
      l.globalCompositeOperation = 'destination-in';
      const gr = l.createLinearGradient(midU.x, midU.y, top.x, top.y);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(0.5, 'rgba(0,0,0,0.72)');
      gr.addColorStop(1, 'rgba(0,0,0,0.1)');
      l.fillStyle = gr;
      l.fillRect(bb.x, bb.y, bb.w, bb.h);
    };
    const k = smoky ? { cover: 0.72, mult: 0.55 } : shimmer ? { cover: 0.55, mult: 0.25 } : { cover: 0.66, mult: 0.36 };
    painter.paint(
      ctx,
      bb,
      style.hex,
      [
        { op: 'source-over', alpha: k.cover * I },
        { op: 'multiply', alpha: k.mult * I },
        { op: 'color', alpha: 0.22 * I },
      ],
      fade,
    );

    if (shimmer) {
      const centre = add(midU, mul(g.up, hBase * 0.35));
      const glow = mixWhite(style.hex, 0.6);
      painter.paintCustom(
        ctx,
        bb,
        (l) => {
          const gr = l.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, g.w * 0.34);
          gr.addColorStop(0, glow);
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          l.fillStyle = gr;
          l.fillRect(bb.x, bb.y, bb.w, bb.h);
          // Fixed sparkle positions in lid space so they stay glued to the eyelid as it moves.
          for (let s = 0; s < 14; s++) {
            const u = (s * 0.618 + side * 0.31) % 1;
            const v = (s * 0.382 + 0.17) % 1;
            const idx = clamp(Math.round(u * (n - 1)), 0, n - 1);
            const p = add(g.U[idx], mul(g.up, v * hBase * 0.9));
            const tw = Math.max(0, Math.sin(now * 0.004 + s * 1.7 + side * 2));
            const r = g.w * 0.011 * (0.6 + 0.8 * ((s * 0.7) % 1));
            l.globalAlpha = 0.25 + 0.75 * tw;
            l.fillStyle = '#fff';
            l.beginPath();
            l.arc(p.x, p.y, Math.max(0.8, r), 0, Math.PI * 2);
            l.fill();
          }
          l.globalAlpha = 1;
        },
        [{ op: 'screen', alpha: 0.6 * I }],
      );
    }
  }
}

/** Eyeliner along the upper lash line. Finishes: thin, classic, winged (adds a flick at the outer corner). */
export function renderLiner(
  painter: Painter,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: FacePts,
  style: EyeStyle,
) {
  if (style.intensity <= 0) return;
  const I = clamp(style.intensity, 0, 1);
  const winged = style.finish === 'winged';

  for (const e of [EYE_R, EYE_L]) {
    const g = eyeGeo(pts, e);
    if (g.w < 12) continue;
    const lw = g.w * (style.finish === 'thin' ? 0.035 : 0.055);
    const line = g.U.map((p) => add(p, mul(g.up, lw * 0.35)));
    const o = g.U[0];
    const tip = add(add(o, mul(g.out, g.w * 0.27)), mul(g.up, g.w * 0.16));
    const wingTop = add(line[1], mul(g.up, lw * 0.5));
    const wingBottom = add(add(o, mul(g.up, -lw * 0.1)), mul(g.out, lw * 0.2));

    const blur = Math.max(1.5, g.w * 0.014);
    const bb = bboxOf([line, winged ? [tip] : []], Math.ceil(lw * 2 + blur * 2 + 6), w, h);
    if (!bb) continue;

    painter.begin(w, h);
    painter.feather(blur, (c, dx) => {
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
    painter.paint(ctx, bb, style.hex, [
      { op: 'source-over', alpha: 0.92 * I },
      { op: 'multiply', alpha: 0.3 * I },
    ]);
  }
}
