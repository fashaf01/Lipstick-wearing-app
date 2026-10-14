import type { GarmentDef } from './catalog';
import type { GarmentGpu, Renderer } from './gl';
import { buildMesh, type Mesh } from './rig';

export interface LoadedGarment {
  def: GarmentDef;
  mesh: Mesh;
  gpu: GarmentGpu;
  positions: Float32Array;
}

const MAX_SIDE = 1024;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load that garment image'));
    img.src = src;
  });
}

/** Alpha bounding box in 0..1 (with a little padding), from a small copy of the image. */
export function alphaBounds(canvas: HTMLCanvasElement): [number, number, number, number] {
  const s = 160 / Math.max(canvas.width, canvas.height);
  const w = Math.max(1, Math.round(canvas.width * s));
  const h = Math.max(1, Math.round(canvas.height * s));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const g = small.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(canvas, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return [0, 0, 1, 1];
  const pad = 0.015;
  return [
    Math.max(0, x0 / w - pad),
    Math.max(0, y0 / h - pad),
    Math.min(1, (x1 + 1) / w + pad),
    Math.min(1, (y1 + 1) / h + pad),
  ];
}

/** Rasterises the garment image (any size, SVG included) into a canvas the mesh and texture use. */
export function rasterise(img: HTMLImageElement): HTMLCanvasElement {
  const nw = img.naturalWidth || 640;
  const nh = img.naturalHeight || 640;
  // vector images are drawn a little larger than their nominal size so they stay crisp
  const isVector = /\.svg(\?|$)/i.test(img.currentSrc || img.src) || img.src.startsWith('data:image/svg');
  const target = isVector ? Math.max(nw, nh) * 1.25 : Math.max(nw, nh);
  const scale = Math.min(1, MAX_SIDE / target) * (target / Math.max(nw, nh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(nw * scale));
  canvas.height = Math.max(2, Math.round(nh * scale));
  const g = canvas.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function loadGarment(renderer: Renderer, def: GarmentDef, resolveSrc: (src: string) => string): Promise<LoadedGarment> {
  const img = await loadImage(resolveSrc(def.src));
  const canvas = rasterise(img);
  const mesh = buildMesh(def.rig, def.kind, canvas.width, canvas.height, alphaBounds(canvas));
  const gpu = renderer.upload(mesh, canvas);
  return { def, mesh, gpu, positions: new Float32Array(mesh.count * 2) };
}
