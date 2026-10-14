import type { Kind, Pt, RigDef } from './rig';

/**
 * Guesses where the shoulders, hips and sleeve / leg lines are from a garment's silhouette, using
 * typical body proportions (a 175 cm adult). It is a starting point: the editor lets people nudge it.
 */
export type Length = 'none' | 'short' | 'long';

export interface AutoOptions {
  /** tops: sleeves; bottoms: 'none' means a skirt (no legs). Default: detect. */
  sleeves?: Length | 'auto';
  legs?: Length | 'auto';
}

export interface AutoResult {
  rig: RigDef;
  sleeves: Length;
  legs: Length;
}

interface Run {
  x0: number;
  x1: number;
}

export function autoRig(alpha: Uint8ClampedArray, w: number, h: number, kind: Kind, opts: AutoOptions = {}): AutoResult {
  const gapMin = Math.max(3, Math.round(0.012 * w));
  const rows: Run[][] = [];
  for (let y = 0; y < h; y++) {
    const runs: Run[] = [];
    let start = -1;
    let last = -1;
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > 100) {
        if (start < 0) start = x;
        else if (x - last > gapMin) {
          runs.push({ x0: start, x1: last });
          start = x;
        }
        last = x;
      }
    }
    if (start >= 0) runs.push({ x0: start, x1: last });
    rows.push(runs);
  }
  let top = 0;
  while (top < h && !rows[top].length) top++;
  let bottom = h - 1;
  while (bottom > top && !rows[bottom].length) bottom--;
  const span = (y: number) => (rows[y].length ? { x0: rows[y][0].x0, x1: rows[y][rows[y].length - 1].x1 } : null);
  const cx = (() => {
    const cs: number[] = [];
    for (let y = top; y <= bottom; y += 4) {
      const s = span(y);
      if (s) cs.push((s.x0 + s.x1) / 2);
    }
    cs.sort((a, b) => a - b);
    return cs.length ? cs[cs.length >> 1] : w / 2;
  })();
  const centralRun = (y: number): Run | null => {
    const r = rows[y].find((q) => q.x0 <= cx && q.x1 >= cx);
    return r ?? null;
  };
  const rowWidths = (a: number, b: number, central: boolean) => {
    const out: number[] = [];
    for (let y = Math.round(a); y <= Math.round(b) && y <= bottom; y++) {
      const r = central ? centralRun(y) : span(y);
      if (r) out.push(r.x1 - r.x0 + 1);
    }
    return out;
  };
  const px = (x: number, y: number): Pt => [+(x / w).toFixed(4), +(y / h).toFixed(4)];
  const H = bottom - top + 1;

  if (kind === 'bottom') return bottomRig(rows, w, h, top, bottom, cx, opts, px);

  // ---- tops and dresses
  const isDress = kind === 'dress';
  const band = isDress ? rowWidths(top + 0.12 * H, top + 0.3 * H, true) : rowWidths(top + 0.5 * H, top + 0.9 * H, true);
  const Wb = band.length ? (isDress ? Math.max(...band) : Math.min(...band)) : 0.7 * w;
  const pxPerM = Wb / (isDress ? 0.34 : 0.5);
  // A hood (one narrow run at the very top) sits above the shoulders: the shoulder line is where the
  // outline first becomes about as wide as the body.
  let shoulderY = top + 0.075 * pxPerM;
  if (!isDress) {
    const probe = rows[Math.min(bottom, top + Math.round(0.03 * H))];
    const s0 = probe.length ? probe[probe.length - 1].x1 - probe[0].x0 + 1 : 0;
    if (probe.length === 1 && s0 < 0.75 * Wb) {
      for (let y = top; y <= bottom; y++) {
        const s = span(y);
        if (s && s.x1 - s.x0 + 1 >= 0.82 * Wb) {
          shoulderY = y + 0.03 * pxPerM;
          break;
        }
      }
    }
  }
  const ys = Math.min(shoulderY, top + 0.4 * H);
  const half = (isDress ? 0.95 : 0.79) * (Wb / 2);
  const hipY = ys + (isDress ? 0.55 : 0.62) * pxPerM;
  const hipHalf = 0.095 * pxPerM;
  const sL: Pt = px(cx - half, ys);
  const sR: Pt = px(cx + half, ys);
  const rig: RigDef = { s: [sL, sR], h: [px(cx - hipHalf, hipY), px(cx + hipHalf, hipY)] };

  let sleeves: Length = 'none';
  const want = opts.sleeves ?? 'auto';
  if (!isDress && want !== 'none') {
    const arms = [0, 1].map((side) => sleeveChain(rows, w, top, bottom, cx, Wb, side === 0 ? sL : sR, side === 0 ? -1 : 1, pxPerM, w, h));
    const found = arms.every((a) => a);
    if (found && (want === 'auto' || want === 'short' || want === 'long')) {
      const lens = arms.map((a) => a!.lengthM);
      const autoLen: Length = Math.min(...lens) < 0.34 ? 'short' : 'long';
      sleeves = want === 'auto' ? autoLen : want;
      rig.arm = [0, 1].map((i) => {
        const a = arms[i]!;
        return sleeves === 'long' ? [a.mid, a.tip] : [a.tip];
      }) as [Pt[], Pt[]];
      rig.armR = Math.min(0.12, Math.max(0.03, Math.max(...arms.map((a) => a!.halfWidth)) / h));
    }
  }
  return { rig, sleeves, legs: 'none' };
}

/** Finds the sleeve on one side: its far end (cuff) and thickness. */
function sleeveChain(
  rows: Run[][],
  w: number,
  top: number,
  bottom: number,
  cx: number,
  Wb: number,
  shoulder: Pt,
  side: -1 | 1,
  pxPerM: number,
  W: number,
  H: number,
) {
  const sx = shoulder[0] * W;
  const sy = shoulder[1] * H;
  const edge = Wb / 2 + 0.012 * w;
  const pts: [number, number][] = [];
  for (let y = top; y <= bottom * 0.95 + top * 0.05; y++) {
    for (const r of rows[y]) {
      for (let x = r.x0; x <= r.x1; x += 2) {
        if (side * (x - cx) > edge) pts.push([x, y]);
      }
    }
  }
  const area = pts.length * 2;
  if (area < 0.006 * w * (bottom - top + 1)) return null;
  let dmax = 0;
  const ds = pts.map(([x, y]) => {
    const d = Math.hypot(x - sx, y - sy);
    if (d > dmax) dmax = d;
    return d;
  });
  let tx = 0;
  let ty = 0;
  let n = 0;
  pts.forEach(([x, y], i) => {
    if (ds[i] >= 0.82 * dmax) {
      tx += x;
      ty += y;
      n++;
    }
  });
  tx /= n;
  ty /= n;
  const L = Math.hypot(tx - sx, ty - sy);
  const px = (x: number, y: number): Pt => [+(x / W).toFixed(4), +(y / H).toFixed(4)];
  return {
    tip: px(tx, ty),
    mid: px(sx + (tx - sx) * 0.5, sy + (ty - sy) * 0.5),
    lengthM: L / pxPerM,
    halfWidth: area / Math.max(L, 1) / 2,
  };
}

function bottomRig(
  rows: Run[][],
  w: number,
  h: number,
  top: number,
  bottom: number,
  cx: number,
  opts: AutoOptions,
  px: (x: number, y: number) => Pt,
): AutoResult {
  const H = bottom - top + 1;
  const waist: number[] = [];
  for (let y = top; y <= top + Math.max(2, 0.04 * H) && y <= bottom; y++) {
    const r = rows[y];
    if (r.length) waist.push(r[r.length - 1].x1 - r[0].x0 + 1);
  }
  waist.sort((a, b) => a - b);
  const Ww = waist.length ? waist[waist.length >> 1] : 0.6 * w;
  const pxPerM = Ww / 0.4;
  const hipY = top + 0.215 * pxPerM;
  const hipHalf = 0.1 * pxPerM;
  const rig: RigDef = { h: [px(cx - hipHalf, hipY), px(cx + hipHalf, hipY)] };

  // legs: rows near the bottom that split into two separate runs
  let crotch = -1;
  let twoRuns = 0;
  for (let y = bottom; y >= top; y--) {
    if (rows[y].length >= 2) {
      twoRuns++;
      crotch = y;
    } else if (twoRuns) break;
  }
  const want = opts.legs ?? 'auto';
  if (want === 'none' || twoRuns < 0.12 * H) return { rig, sleeves: 'none', legs: 'none' };

  const centre = (y: number, side: 0 | 1): number => {
    const yy = Math.round(Math.min(bottom, Math.max(crotch + 3, y)));
    const r = rows[yy];
    const run = r.length >= 2 ? (side === 0 ? r[0] : r[r.length - 1]) : r[0];
    return (run.x0 + run.x1) / 2;
  };
  const halfW = (y: number): number => {
    const yy = Math.round(Math.min(bottom, Math.max(crotch + 3, y)));
    const r = rows[yy];
    const run = r.length >= 2 ? r[0] : r[0];
    return (run.x1 - run.x0 + 1) / 2;
  };
  const Lh = bottom - hipY;
  const long = Lh > 0.6 * pxPerM;
  const legs: Length = long ? 'long' : 'short';
  if (long) {
    const kneeY = hipY + 0.5 * Lh;
    const ankleY = bottom - 0.03 * pxPerM;
    rig.leg = [
      [px(centre(kneeY, 0), kneeY), px(centre(ankleY, 0), ankleY)],
      [px(centre(kneeY, 1), kneeY), px(centre(ankleY, 1), ankleY)],
    ];
  } else {
    const tipY = bottom - 0.02 * pxPerM;
    rig.leg = [[px(centre(tipY, 0), tipY)], [px(centre(tipY, 1), tipY)]];
  }
  rig.legR = Math.min(0.2, Math.max(0.03, halfW(hipY + 0.2 * Lh) / h));
  rig.crotch = +(crotch / h).toFixed(4);
  return { rig, sleeves: 'none', legs };
}
