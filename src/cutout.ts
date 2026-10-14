/**
 * Prepares a garment photo for try-on: removes a plain background (white or any solid colour) when the
 * image has no transparency yet, then crops to the garment. Runs entirely in the browser.
 */
export interface Cutout {
  canvas: HTMLCanvasElement;
  /** alpha channel of `canvas` (0..255), same size */
  alpha: Uint8ClampedArray;
  /** the background was removed by this function (false: the image already had transparency) */
  removed: boolean;
  /** something the user should know (could not find a plain background, ...) */
  warning?: string;
}

const MAX_SIDE = 1024;

export function cutout(img: HTMLImageElement): Cutout {
  const nw = img.naturalWidth || 1;
  const nh = img.naturalHeight || 1;
  const scale = Math.min(1, MAX_SIDE / Math.max(nw, nh));
  const w = Math.max(2, Math.round(nw * scale));
  const h = Math.max(2, Math.round(nh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  const image = g.getImageData(0, 0, w, h);
  const px = image.data;
  const n = w * h;

  let translucent = 0;
  for (let i = 0; i < n; i++) if (px[i * 4 + 3] < 250) translucent++;
  let removed = false;
  let warning: string | undefined;

  if (translucent / n < 0.02) {
    const alpha = removeBackground(px, w, h);
    if (alpha) {
      for (let i = 0; i < n; i++) px[i * 4 + 3] = alpha[i];
      removed = true;
    } else {
      warning = "Couldn't find a plain background to remove. For the best result use a photo on a plain white or solid-colour background, or a transparent PNG.";
    }
  }

  g.putImageData(image, 0, 0);
  return { ...crop(canvas, image), removed, warning };
}

/** Median colour of the image border and a tolerance from how much the border varies. */
function borderColour(px: Uint8ClampedArray, w: number, h: number): { c: [number, number, number]; tol: number; dev: number } {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    rs.push(px[i]);
    gs.push(px[i + 1]);
    bs.push(px[i + 2]);
  };
  for (let x = 0; x < w; x += 3) {
    take(x, 0);
    take(x, 1);
    take(x, h - 1);
    take(x, h - 2);
  }
  for (let y = 0; y < h; y += 3) {
    take(0, y);
    take(1, y);
    take(w - 1, y);
    take(w - 2, y);
  }
  const med = (a: number[]) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  const c: [number, number, number] = [med(rs), med(gs), med(bs)];
  let dev = 0;
  for (let i = 0; i < rs.length; i++) dev += Math.max(Math.abs(rs[i] - c[0]), Math.abs(gs[i] - c[1]), Math.abs(bs[i] - c[2]));
  dev /= rs.length;
  return { c, tol: Math.min(64, 34 + dev * 1.6), dev };
}

function removeBackground(px: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray | null {
  const n = w * h;
  const { c, tol, dev } = borderColour(px, w, h);
  const like = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.max(Math.abs(px[i * 4] - c[0]), Math.abs(px[i * 4 + 1] - c[1]), Math.abs(px[i * 4 + 2] - c[2]));
    like[i] = d <= tol ? 1 : 0;
  }

  // Flood fill from the border through background-like pixels. A pale garment on a pale background has
  // faint outline gaps, so the fill may only pass where there is no foreground within 2 px.
  const near = new Uint8Array(n);
  {
    const tmp = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!like[y * w + x]) for (let d = -2; d <= 2; d++) if (x + d >= 0 && x + d < w) tmp[y * w + x + d] = 1;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (tmp[y * w + x]) for (let d = -2; d <= 2; d++) if (y + d >= 0 && y + d < h) near[(y + d) * w + x] = 1;
      }
    }
  }
  const outside = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (i: number) => {
    if (like[i] && !near[i] && !outside[i]) {
      outside[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (sp) {
    const i = stack[--sp];
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < n - w) push(i + w);
  }
  // give back the 2 px halo next to the background that the seal kept out
  for (let pass = 0; pass < 2; pass++) {
    const grow: number[] = [];
    for (let i = 0; i < n; i++) {
      if (outside[i] || !like[i]) continue;
      const x = i % w;
      if ((x > 0 && outside[i - 1]) || (x < w - 1 && outside[i + 1]) || (i >= w && outside[i - w]) || (i < n - w && outside[i + w])) grow.push(i);
    }
    for (const i of grow) outside[i] = 1;
  }
  let out = 0;
  for (let i = 0; i < n; i++) out += outside[i];
  if (out / n < 0.08 || out / n > 0.97) return null;

  // keep only the largest foreground blob (drops specks, labels, stray shadows)
  const label = new Int32Array(n);
  let best = 0;
  let bestSize = 0;
  let next = 1;
  const sizes: number[] = [0];
  for (let s = 0; s < n; s++) {
    if (outside[s] || label[s]) continue;
    let size = 0;
    sp = 0;
    stack[sp++] = s;
    label[s] = next;
    while (sp) {
      const i = stack[--sp];
      size++;
      const x = i % w;
      const tryPush = (j: number) => {
        if (!outside[j] && !label[j]) {
          label[j] = next;
          stack[sp++] = j;
        }
      };
      if (x > 0) tryPush(i - 1);
      if (x < w - 1) tryPush(i + 1);
      if (i >= w) tryPush(i - w);
      if (i < n - w) tryPush(i + w);
    }
    sizes.push(size);
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
    next++;
  }
  if (!best) return null;

  const alpha = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) alpha[i] = label[i] === best ? 255 : 0;

  // enclosed background-coloured regions that are small compared with the garment (the neck opening,
  // the gap between arm and body) become holes; a big one is just a pale garment, so it stays
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (!alpha[s] || !like[s] || seen[s]) continue;
    const members: number[] = [];
    sp = 0;
    stack[sp++] = s;
    seen[s] = 1;
    while (sp) {
      const i = stack[--sp];
      members.push(i);
      const x = i % w;
      const tryPush = (j: number) => {
        if (alpha[j] && like[j] && !seen[j]) {
          seen[j] = 1;
          stack[sp++] = j;
        }
      };
      if (x > 0) tryPush(i - 1);
      if (x < w - 1) tryPush(i + 1);
      if (i >= w) tryPush(i - w);
      if (i < n - w) tryPush(i + w);
    }
    if (members.length < 0.08 * bestSize && members.length > 0.003 * bestSize) {
      // a real hole shows the background colour almost exactly; shaded pale fabric does not
      let diff = 0;
      for (const i of members) diff += Math.max(Math.abs(px[i * 4] - c[0]), Math.abs(px[i * 4 + 1] - c[1]), Math.abs(px[i * 4 + 2] - c[2]));
      if (diff / members.length <= Math.max(3, 1.5 * dev + 2)) for (const i of members) alpha[i] = 0;
    }
  }

  // soften: erode two pixels (kills the pale fringe of the old background), then blur the edge a little
  const eroded = new Uint8ClampedArray(alpha);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? alpha : eroded.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (src[i] && (!src[i - 1] || !src[i + 1] || !src[i - w] || !src[i + w])) eroded[i] = 0;
      }
    }
  }
  const soft = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += eroded[yy * w + xx];
          cnt++;
        }
      }
      soft[y * w + x] = sum / cnt;
    }
  }
  return soft;
}

/** Crops the canvas to the garment's bounding box (with a small margin). */
function crop(canvas: HTMLCanvasElement, image: ImageData): { canvas: HTMLCanvasElement; alpha: Uint8ClampedArray } {
  const { width: w, height: h, data } = image;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) {
    const alpha = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];
    return { canvas, alpha };
  }
  const pad = Math.round(0.015 * Math.max(x1 - x0, y1 - y0));
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d')!.drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
  const alpha = new Uint8ClampedArray(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) alpha[y * cw + x] = data[((y + y0) * w + (x + x0)) * 4 + 3];
  return { canvas: out, alpha };
}
