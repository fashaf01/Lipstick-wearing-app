import './style.css';
import {
  BUILT_IN,
  KIND_LABEL,
  KIND_ORDER,
  KIND_SINGULAR,
  defaultFit,
  emptyOutfit,
  wear,
  type Fit,
  type GarmentDef,
  type Outfit,
} from './catalog';
import { buildBody, fitBody, PoseSmoother, type Body, type Pt33 } from './body';
import { cutout } from './cutout';
import { openEditor } from './editor';
import { loadGarment, loadImage, type LoadedGarment } from './garments';
import { Renderer } from './gl';
import { createPoseTracker, type Landmark, type PoseTracker } from './pose';
import { poseMesh, type Kind } from './rig';
import { deleteStored, listStored, saveStored, type StoredGarment } from './store';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const view = $<HTMLCanvasElement>('view');
const video = $<HTMLVideoElement>('cam');
const statusEl = $('status');
const intro = $('intro');
const introError = $('intro-error');
const fileInput = $<HTMLInputElement>('file');

let renderer: Renderer | null = null;
let glError = '';
try {
  renderer = new Renderer(view);
} catch (err) {
  glError = err instanceof Error ? err.message : 'WebGL is not available';
}

// ---------- catalogue, outfit and settings ----------
const garments: GarmentDef[] = [...BUILT_IN];
const byId = (id: string | null) => (id ? garments.find((g) => g.id === id) : undefined);

type Tab = Kind;
const STORE_KEY = 'clothes-tryon:v1';

let outfit: Outfit = emptyOutfit();
let fit: Record<Kind, Fit> = defaultFit();
let tab: Tab = 'top';
let collapsed = false;
let savedOutfit: Partial<Outfit> = {};
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as {
    outfit?: Outfit;
    fit?: Record<Kind, Fit>;
    tab?: string;
    collapsed?: boolean;
  } | null;
  if (saved) {
    savedOutfit = saved.outfit ?? {};
    for (const k of KIND_ORDER) {
      const f = saved.fit?.[k];
      if (f && Number.isFinite(f.size) && Number.isFinite(f.dy)) fit[k] = { size: Math.min(1.3, Math.max(0.8, f.size)), dy: Math.min(0.3, Math.max(-0.3, f.dy)) };
    }
    if (KIND_ORDER.includes(saved.tab as Kind)) tab = saved.tab as Kind;
    collapsed = !!saved.collapsed;
  } else {
    outfit = wear(wear(outfit, 'top', 'tee-red'), 'bottom', 'jeans-blue');
  }
} catch {
  /* storage unavailable (private mode) – defaults are fine */
}
/** Re-applies the remembered outfit for garments that exist now (user garments load a moment later). */
function restoreOutfit() {
  for (const k of KIND_ORDER) {
    const id = savedOutfit[k];
    if (!outfit[k] && typeof id === 'string' && byId(id)?.kind === k) outfit[k] = id;
  }
}
restoreOutfit();
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ outfit, fit, tab, collapsed }));
  } catch {
    /* ignore */
  }
}

// ---------- app state ----------
type Mode = 'idle' | 'camera' | 'photo';
let mode: Mode = 'idle';
let stream: MediaStream | null = null;
let facing: 'user' | 'environment' = 'user';
let mirrored = true;
let tracker: PoseTracker | null = null;
let trackerFailed = false;
const trackerReady = createPoseTracker()
  .then((t) => {
    tracker = t;
    return t;
  })
  .catch((err) => {
    console.error('Body tracking failed to load', err);
    trackerFailed = true;
    return null;
  });

const smoother = new PoseSmoother();
let liveBody: Body | null = null;
let lastPoseAt = 0;
let lastVideoTime = -1;
let comparing = false;
let photo: { canvas: HTMLCanvasElement; body: Body | null } | null = null;
let dirty = true;

// ---------- garment loading ----------
const base = import.meta.env.BASE_URL;
const resolveSrc = (src: string) => (/^(blob:|data:|https?:)/.test(src) ? src : `${base}${src}`);
const loaded = new Map<string, LoadedGarment>();
const loading = new Set<string>();

function garmentFor(id: string): LoadedGarment | undefined {
  const hit = loaded.get(id);
  if (hit) return hit;
  const def = byId(id);
  if (!def || !renderer || loading.has(id)) return undefined;
  loading.add(id);
  loadGarment(renderer, def, resolveSrc)
    .then((g) => {
      loaded.set(id, g);
      dirty = true;
    })
    .catch((err) => {
      console.error(err);
      setStatus('Could not load that garment');
      setTimeout(() => setStatus(''), 3000);
    })
    .finally(() => {
      loading.delete(id);
      renderCards();
    });
  renderCards();
  return undefined;
}

// ---------- UI ----------
const tabsEl = $('tabs');
const cardsEl = $('cards');
const controlsEl = $('controls');
const sizeEl = $<HTMLInputElement>('fit-size');
const dyEl = $<HTMLInputElement>('fit-dy');
const NONE = '__none';
const ADD = '__add';
const garmentInput = $<HTMLInputElement>('file-garment');

const noneSvg =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/></svg>';

function buildTabs() {
  for (const k of KIND_ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.dataset.id = k;
    b.setAttribute('role', 'tab');
    b.innerHTML = `<i class="dot"></i><span></span>`;
    b.querySelector('span')!.textContent = KIND_LABEL[k];
    b.addEventListener('click', () => {
      tab = k;
      persist();
      renderCards();
      syncUI(true);
    });
    tabsEl.appendChild(b);
  }
}

const plusSvg =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

function renderCards() {
  cardsEl.textContent = '';
  const none = document.createElement('button');
  none.type = 'button';
  none.className = 'card none';
  none.dataset.id = NONE;
  none.setAttribute('role', 'radio');
  none.setAttribute('aria-label', `No ${KIND_LABEL[tab].toLowerCase()}`);
  none.innerHTML = `${noneSvg}<span>None</span>`;
  none.addEventListener('click', () => choose(null));
  cardsEl.appendChild(none);

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'card add';
  add.dataset.id = ADD;
  add.setAttribute('aria-label', 'Add your own clothes from a photo');
  add.innerHTML = `${plusSvg}<span>Add yours</span>`;
  add.addEventListener('click', () => garmentInput.click());
  cardsEl.appendChild(add);

  for (const def of garments.filter((g) => g.kind === tab)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card';
    b.dataset.id = def.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', def.name);
    const img = document.createElement('img');
    img.src = resolveSrc(def.src);
    img.alt = '';
    img.loading = 'lazy';
    b.appendChild(img);
    if (loading.has(def.id)) b.insertAdjacentHTML('beforeend', '<span class="busy">…</span>');
    if (def.custom) {
      const edit = document.createElement('span');
      edit.className = 'edit';
      edit.setAttribute('role', 'button');
      edit.setAttribute('aria-label', `Edit ${def.name}`);
      edit.textContent = '✎';
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        void editGarment(def.id);
      });
      b.appendChild(edit);
    }
    b.addEventListener('click', () => choose(def.id));
    cardsEl.appendChild(b);
  }
  syncUI(false);
}

function choose(id: string | null) {
  outfit = wear(outfit, tab, id);
  if (id) garmentFor(id);
  persist();
  syncUI(true);
}

function syncUI(scroll: boolean) {
  for (const el of tabsEl.children as Iterable<HTMLElement>) {
    const k = el.dataset.id as Kind;
    el.setAttribute('aria-selected', String(k === tab));
    el.querySelector('.dot')!.classList.toggle('on', !!outfit[k]);
    (el.querySelector('.dot') as HTMLElement).style.background = outfit[k] ? (byId(outfit[k])?.color ?? '#fff') : '';
  }
  const def = byId(outfit[tab]);
  $('item-name').textContent = def ? def.name : `No ${KIND_SINGULAR[tab].toLowerCase()}`;
  $('item-sub').textContent = def ? (def.custom ? 'Yours' : '') : 'Tap one to try it on';
  for (const el of cardsEl.children as Iterable<HTMLElement>) {
    const on = el.dataset.id === (def ? def.id : NONE);
    el.setAttribute('aria-checked', String(on));
    if (on && scroll) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }
  const f = fit[tab];
  sizeEl.value = String(Math.round(f.size * 100));
  dyEl.value = String(Math.round(f.dy * 100));
  controlsEl.classList.toggle('disabled', !def);
  sizeEl.disabled = dyEl.disabled = !def;
  dirty = true;
}

sizeEl.addEventListener('input', () => {
  fit[tab].size = Number(sizeEl.value) / 100;
  persist();
  dirty = true;
});
dyEl.addEventListener('input', () => {
  fit[tab].dy = Number(dyEl.value) / 100;
  persist();
  dirty = true;
});

buildTabs();
renderCards();
for (const k of KIND_ORDER) if (outfit[k]) garmentFor(outfit[k]!);

// ---------- status pill ----------
let statusText = '';
function setStatus(text: string) {
  if (text === statusText) return;
  statusText = text;
  statusEl.textContent = text;
  statusEl.hidden = !text;
}

// ---------- camera ----------
function stopStream() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (!window.isSecureContext) return 'The camera needs a secure (https) connection. Open this page over https.';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera access is blocked. Allow the camera for this site in your browser settings, or try on a photo.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device. You can try on a photo instead.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.';
  return 'Could not start the camera. You can try on a photo instead.';
}

async function startCamera(): Promise<string | null> {
  if (glError) return `Your browser can't show the try-on (${glError}).`;
  if (!navigator.mediaDevices?.getUserMedia) {
    return window.isSecureContext ? 'This browser does not support camera access.' : cameraErrorMessage(null);
  }
  stopStream();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    return cameraErrorMessage(err);
  }
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    /* autoplay is allowed after a user gesture; ignore otherwise */
  }
  mirrored = stream.getVideoTracks()[0]?.getSettings().facingMode !== 'environment';
  mode = 'camera';
  photo = null;
  lastVideoTime = -1;
  liveBody = null;
  smoother.reset();
  syncMode();
  return null;
}

function syncMode() {
  view.classList.toggle('mirror', mode === 'camera' && mirrored);
  view.classList.toggle('photo', mode === 'photo');
  overlay.classList.toggle('photo', mode === 'photo');
  $('mode-label').textContent = mode === 'photo' ? 'Camera' : 'Photo';
  $('btn-flip').hidden = mode === 'photo';
  dirty = true;
}

async function enterCamera(fromIntro: boolean) {
  const err = await startCamera();
  if (err) {
    if (fromIntro) {
      introError.textContent = err;
      introError.hidden = false;
    } else {
      setStatus(err);
      setTimeout(() => setStatus(''), 5000);
    }
    return;
  }
  intro.hidden = true;
}

$('btn-start').addEventListener('click', () => {
  introError.hidden = true;
  void enterCamera(true);
});
$('btn-flip').addEventListener('click', () => {
  facing = facing === 'user' ? 'environment' : 'user';
  void enterCamera(false);
});

// ---------- photo mode ----------
const MAX_PHOTO_SIDE = 1280;

function loadFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    img.src = url;
  });
}

const rawPts = (lm: Landmark[], w: number, h: number): Pt33[] => lm.map((p) => ({ x: p.x * w, y: p.y * h, v: p.visibility ?? 1 }));

async function openPhoto(file: File) {
  if (glError) {
    setStatus(`Your browser can't show the try-on (${glError}).`);
    return;
  }
  setStatus('Finding your body…');
  try {
    const img = await loadFile(file);
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);

    const t = await trackerReady;
    if (!t) throw new Error('Body tracking is not available');
    const lm = await t.detectImage(canvas);
    const body = lm ? buildBody(rawPts(lm, canvas.width, canvas.height), canvas.height) : null;
    photo = { canvas, body };

    stopStream();
    mode = 'photo';
    dirty = true;
    intro.hidden = true;
    syncMode();
    setStatus(body ? '' : 'No body found in that photo. Try one where your shoulders are visible.');
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Could not open that photo');
    setTimeout(() => setStatus(''), 5000);
  }
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (f) void openPhoto(f);
});
$('btn-intro-photo').addEventListener('click', () => fileInput.click());
$('btn-mode').addEventListener('click', () => {
  if (mode === 'photo') void enterCamera(false);
  else fileInput.click();
});

// ---------- your own garments ----------
const prettyName = (file: string) => {
  const base = file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return (base ? base[0].toUpperCase() + base.slice(1) : 'My garment').slice(0, 28);
};

function averageColour(canvas: HTMLCanvasElement): string {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(canvas, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data;
  let r = 0;
  let gg = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    r += d[i];
    gg += d[i + 1];
    b += d[i + 2];
    n++;
  }
  if (!n) return '#ffffff';
  return `rgb(${Math.round(r / n)}, ${Math.round(gg / n)}, ${Math.round(b / n)})`;
}

const toPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the image'))), 'image/png'));

function addCustomDef(s: StoredGarment) {
  garments.push({ id: s.id, name: s.name, kind: s.kind, color: s.color, src: URL.createObjectURL(s.blob), rig: s.rig, custom: true });
}

function unload(id: string) {
  const g = loaded.get(id);
  if (g && renderer) renderer.release(g.gpu);
  loaded.delete(id);
}

function toast(text: string, ms = 5000) {
  setStatus(text);
  setTimeout(() => {
    if (statusText === text) setStatus('');
  }, ms);
}

void listStored().then((all) => {
  for (const s of all) addCustomDef(s);
  if (!all.length) return;
  restoreOutfit();
  for (const k of KIND_ORDER) if (outfit[k]) garmentFor(outfit[k]!);
  renderCards();
});

async function addGarmentFromFile(file: File) {
  setStatus('Preparing your garment…');
  try {
    const img = await loadFile(file);
    const cut = cutout(img);
    setStatus('');
    const res = await openEditor({ canvas: cut.canvas, alpha: cut.alpha, kind: tab, name: prettyName(file.name), warning: cut.warning });
    if (res.action !== 'save') return;
    const stored: StoredGarment = {
      id: `my-${Date.now().toString(36)}`,
      name: res.name,
      kind: res.kind,
      blob: await toPng(cut.canvas),
      rig: res.rig,
      color: averageColour(cut.canvas),
      created: Date.now(),
    };
    const saved = await saveStored(stored);
    addCustomDef(stored);
    tab = res.kind;
    outfit = wear(outfit, res.kind, stored.id);
    garmentFor(stored.id);
    persist();
    renderCards();
    syncUI(true);
    if (!saved) toast("Couldn't save it on this device (private browsing?). It will be here until you close the app.");
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not read that image');
  }
}

async function editGarment(id: string) {
  const def = byId(id);
  if (!def?.custom) return;
  try {
    const img = await loadImage(def.src);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
    const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];

    const res = await openEditor({ canvas, alpha, kind: def.kind, name: def.name, rig: def.rig, canDelete: true });
    if (res.action === 'cancel') return;

    for (const k of KIND_ORDER) if (outfit[k] === id) outfit[k] = null;
    unload(id);
    if (res.action === 'delete') {
      await deleteStored(id);
      URL.revokeObjectURL(def.src);
      garments.splice(garments.indexOf(def), 1);
    } else {
      def.name = res.name;
      def.kind = res.kind;
      def.rig = res.rig;
      const blob = await (await fetch(def.src)).blob();
      await saveStored({ id, name: def.name, kind: def.kind, blob, rig: def.rig, color: def.color, created: Date.now() });
      tab = def.kind;
      outfit = wear(outfit, def.kind, id);
      garmentFor(id);
    }
    persist();
    renderCards();
    syncUI(true);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not open that garment');
  }
}

garmentInput.addEventListener('change', () => {
  const f = garmentInput.files?.[0];
  garmentInput.value = '';
  if (f) void addGarmentFromFile(f);
});

// ---------- collapsible controls ----------
const sheet = $('sheet');
const sheetToggle = $('sheet-toggle');
function applyCollapsed() {
  sheet.classList.toggle('collapsed', collapsed);
  sheetToggle.setAttribute('aria-expanded', String(!collapsed));
  sheetToggle.setAttribute('aria-label', collapsed ? 'Show controls' : 'Hide controls');
}
sheetToggle.addEventListener('click', () => {
  collapsed = !collapsed;
  applyCollapsed();
  persist();
});
applyCollapsed();

// ---------- compare (hold to see yourself without the clothes) ----------
const compareBtn = $('btn-compare');
const setCompare = (on: boolean) => {
  comparing = on;
  compareBtn.classList.toggle('active', on);
  dirty = true;
};
compareBtn.addEventListener('pointerdown', (e) => {
  compareBtn.setPointerCapture(e.pointerId);
  setCompare(true);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  compareBtn.addEventListener(type, () => setCompare(false));
}
compareBtn.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- lighting match ----------
// The scene's overall brightness and colour cast, and the average brightness under the torso (the
// shader compares the camera image to it to borrow broad shading).
const sceneCanvas = document.createElement('canvas');
sceneCanvas.width = sceneCanvas.height = 16;
const sceneCtx = sceneCanvas.getContext('2d', { willReadFrequently: true })!;
const torsoCanvas = document.createElement('canvas');
torsoCanvas.width = torsoCanvas.height = 12;
const torsoCtx = torsoCanvas.getContext('2d', { willReadFrequently: true })!;
let light = 1;
let tint: [number, number, number] = [1, 1, 1];
let shadeRef = 0.4;
let lightTick = 0;
function updateLight(source: CanvasImageSource, w: number, h: number, body: Body | null, immediate = false) {
  const tick = lightTick++;
  if (immediate || tick % 10 === 0) {
    sceneCtx.drawImage(source, 0, 0, 16, 16);
    const d = sceneCtx.getImageData(0, 0, 16, 16).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    const n = 256 * 255;
    r /= n;
    g /= n;
    b /= n;
    const mean = 0.299 * r + 0.587 * g + 0.114 * b;
    const target = Math.min(1.08, Math.max(0.68, 0.55 + mean * 0.8));
    // white balance: half-strength, so a warm room warms the garment without turning it orange
    const k = (c: number) => Math.min(1.12, Math.max(0.88, 1 + 0.5 * (c / Math.max(mean, 0.02) - 1)));
    const t: [number, number, number] = [k(r), k(g), k(b)];
    const a = immediate ? 1 : 0.25;
    light += (target - light) * a;
    tint = [tint[0] + (t[0] - tint[0]) * a, tint[1] + (t[1] - tint[1]) * a, tint[2] + (t[2] - tint[2]) * a];
  }
  if (body && (immediate || tick % 3 === 0)) {
    const xs = [body.sL.x, body.sR.x, body.hL.x, body.hR.x];
    const ys = [body.sL.y, body.sR.y, body.hL.y, body.hR.y];
    const x0 = Math.max(0, Math.min(...xs));
    const x1 = Math.min(w, Math.max(...xs));
    const y0 = Math.max(0, Math.min(...ys));
    const y1 = Math.min(h, Math.max(...ys));
    if (x1 - x0 > 8 && y1 - y0 > 8) {
      torsoCtx.drawImage(source, x0, y0, x1 - x0, y1 - y0, 0, 0, 12, 12);
      const d = torsoCtx.getImageData(0, 0, 12, 12).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const l = sum / (144 * 255);
      shadeRef = immediate ? l : shadeRef + (l - shadeRef) * 0.3;
    }
  }
}

// ---------- render ----------
const NOISE = 0.03;
const SHADE = 0.55;
const stats = { frames: 0, detectMs: 0, renderMs: 0, detects: 0 };

/** Garments to draw, back to front. */
function layers(body: Body): { g: LoadedGarment; fit: Fit }[] {
  const out: { g: LoadedGarment; fit: Fit }[] = [];
  const order: Kind[] = outfit.dress ? ['dress'] : ['bottom', 'top'];
  for (const k of order) {
    const id = outfit[k];
    if (!id) continue;
    const g = garmentFor(id);
    if (!g) continue;
    // legs need the hips in view; otherwise the garment would float where there is no body
    if (k === 'bottom' && !body.hipsTracked) continue;
    out.push({ g, fit: fit[k] });
  }
  return out;
}

function renderScene(source: TexImageSource, w: number, h: number, body: Body | null) {
  const r = renderer!;
  r.resize(w, h);
  r.drawSource(source);
  if (!body || comparing) return;
  const items = layers(body);
  if (!items.length) return;
  r.beginGarments({ light, tint, shade: SHADE, shadeRef, noise: NOISE, head: body.head });
  for (const { g, fit: f } of items) {
    poseMesh(g.mesh, fitBody(body, f.size, f.dy), g.positions);
    r.drawGarment(g.gpu, g.positions);
  }
}

// ?debug=1 draws the tracked joints over the picture (for tuning garments)
const debug = new URLSearchParams(location.search).has('debug');
const overlay = $<HTMLCanvasElement>('joints-overlay');
overlay.hidden = !debug;
function drawDebug(w: number, h: number, body: Body | null) {
  if (!debug) return;
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }
  overlay.classList.toggle('mirror', mode === 'camera' && mirrored);
  const g = overlay.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  if (!body) return;
  const dot = (p: { x: number; y: number }, c: string) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(p.x, p.y, Math.max(3, h / 200), 0, 7);
    g.fill();
  };
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, c: string) => {
    g.strokeStyle = c;
    g.lineWidth = Math.max(2, h / 400);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  };
  line(body.sL, body.sR, '#0f0');
  line(body.hL, body.hR, '#0ff');
  line(body.sL, body.hL, '#ff0');
  line(body.sR, body.hR, '#ff0');
  line(body.sL, body.eL, '#f0f');
  line(body.eL, body.wL, '#f0f');
  line(body.sR, body.eR, '#f0f');
  line(body.eR, body.wR, '#f0f');
  line(body.hL, body.kL, '#fa0');
  line(body.kL, body.aL, '#fa0');
  line(body.hR, body.kR, '#fa0');
  line(body.kR, body.aR, '#fa0');
  for (const p of [body.sL, body.sR, body.eL, body.eR, body.wL, body.wR, body.hL, body.hR, body.kL, body.kR, body.aL, body.aR]) dot(p, '#fff');
  if (body.head) {
    g.strokeStyle = '#f66';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(body.head.c.x, body.head.c.y, body.head.rx, body.head.ry, Math.atan2(body.head.ax.y, body.head.ax.x), 0, 7);
    g.stroke();
  }
}

function renderCurrent(): boolean {
  if (!renderer) return false;
  if (mode === 'camera') {
    if (video.readyState < 2 || !video.videoWidth) return false;
    updateLight(video, video.videoWidth, video.videoHeight, liveBody);
    renderScene(video, video.videoWidth, video.videoHeight, liveBody);
    drawDebug(video.videoWidth, video.videoHeight, liveBody);
    return true;
  }
  if (mode === 'photo' && photo) {
    updateLight(photo.canvas, photo.canvas.width, photo.canvas.height, photo.body, true);
    renderScene(photo.canvas, photo.canvas.width, photo.canvas.height, photo.body);
    drawDebug(photo.canvas.width, photo.canvas.height, photo.body);
    return true;
  }
  return false;
}

function frame(now: number) {
  requestAnimationFrame(frame);
  if (!renderer) return;

  if (mode === 'camera') {
    if (video.readyState < 2 || !video.videoWidth) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const fresh = video.currentTime !== lastVideoTime;
    if (fresh && tracker) {
      lastVideoTime = video.currentTime;
      const t0 = performance.now();
      const lm = tracker.detectVideo(video);
      stats.detectMs += performance.now() - t0;
      stats.detects++;
      if (lm) {
        liveBody = buildBody(smoother.update(lm, w, h, now / 1000), h);
        if (liveBody) lastPoseAt = now;
      }
      if (!lm || !liveBody) {
        if (now - lastPoseAt > 350) {
          liveBody = null;
          smoother.reset();
        }
      }
    } else if (fresh) {
      lastVideoTime = video.currentTime;
    }
    if (fresh || dirty) {
      dirty = false;
      const t0 = performance.now();
      renderCurrent();
      stats.renderMs += performance.now() - t0;
      stats.frames++;
    }

    if (trackerFailed) setStatus('Body tracking could not load. Check your connection and reload.');
    else if (!tracker) setStatus('Loading body tracking…');
    else if (!liveBody && now - lastPoseAt > 700) setStatus('Step back so your shoulders are in view');
    else if (liveBody && outfit.bottom && !outfit.dress && !liveBody.hipsTracked) setStatus('Step back to see your hips and legs');
    else setStatus('');
  } else if (mode === 'photo' && photo && dirty) {
    dirty = false;
    renderCurrent();
  }
}
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && mode === 'camera' && video.paused) void video.play().catch(() => {});
});

// ---------- capture / share ----------
const resultEl = $('result');
const resultImg = $<HTMLImageElement>('result-img');
let resultBlob: Blob | null = null;

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

async function capture() {
  if (mode === 'idle' || !renderer) return;
  // draw and copy in the same task so the WebGL buffer is still valid
  if (!renderCurrent() || !view.width) return;
  const out = document.createElement('canvas');
  out.width = view.width;
  out.height = view.height;
  const o = out.getContext('2d')!;
  if (mode === 'camera' && mirrored) {
    o.translate(out.width, 0);
    o.scale(-1, 1);
  }
  o.drawImage(view, 0, 0);

  const flash = document.createElement('div');
  flash.className = 'flash';
  $('app').appendChild(flash);
  setTimeout(() => flash.remove(), 400);

  const blob = await canvasToBlob(out);
  if (!blob) return;
  resultBlob = blob;
  if (resultImg.src) URL.revokeObjectURL(resultImg.src);
  resultImg.src = URL.createObjectURL(blob);
  resultEl.hidden = false;
}

async function shareResult() {
  if (!resultBlob) return;
  const name = 'my-outfit.jpg';
  const file = new File([resultBlob], name, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My outfit' });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = resultImg.src;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

$('btn-shutter').addEventListener('click', () => void capture());
$('btn-share').addEventListener('click', () => void shareResult());
$('btn-close').addEventListener('click', () => {
  resultEl.hidden = true;
});

// Offline-capable service worker (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => {});
  });
}

// Test hook for the browser-based checks (Playwright): lets a script pick garments and read state.
// Only in dev builds or with ?debug=1.
if (import.meta.env.DEV || debug) {
  (window as unknown as { __tryon: unknown }).__tryon = {
    wear: (kind: Kind, id: string | null) => {
      outfit = wear(outfit, kind, id);
      if (id) garmentFor(id);
      syncUI(false);
    },
    setFit: (kind: Kind, size: number, dy: number) => {
      fit[kind] = { size, dy };
      dirty = true;
    },
    get body() {
      return mode === 'photo' ? photo?.body : liveBody;
    },
    get ready() {
      return !!tracker;
    },
    stats,
  };
}
