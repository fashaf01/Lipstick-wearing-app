import './style.css';
import {
  CATEGORIES,
  CATEGORY_ORDER,
  PRESETS,
  applyPreset,
  defaultLook,
  presetColors,
  productOf,
  sanitizeLook,
  clearedLook,
  type CategoryId,
  type Look,
} from './catalog';
import { FaceSmoother, toPoints, type FacePts } from './face';
import { renderLook, resetMakeup } from './makeup';
import { createTracker, type Tracker } from './tracker';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const view = $<HTMLCanvasElement>('view');
// willReadFrequently: the makeup renderers edit pixels directly, so keep the frame CPU-readable
const ctx = view.getContext('2d', { alpha: false, willReadFrequently: true })!;
const video = $<HTMLVideoElement>('cam');
const statusEl = $('status');
const intro = $('intro');
const introError = $('intro-error');
const fileInput = $<HTMLInputElement>('file');

// ---------- look & settings ----------
type Tab = CategoryId | 'looks';
const TABS: { id: Tab; label: string }[] = [
  { id: 'looks', label: 'Looks' },
  ...CATEGORY_ORDER.map((id) => ({ id: id as Tab, label: CATEGORIES[id].label })),
];
const STORE_KEY = 'makeup-tryon:v2';
const OLD_STORE_KEY = 'lipstick-tryon:v1';

let look: Look = defaultLook();
let tab: Tab = 'lips';
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { look?: unknown; tab?: string } | null;
  if (saved) {
    look = sanitizeLook(saved.look);
    if (TABS.some((t) => t.id === saved.tab)) tab = saved.tab as Tab;
  } else {
    // carry over the lipstick choice from the first version of the app
    const old = JSON.parse(localStorage.getItem(OLD_STORE_KEY) ?? 'null') as { shadeId?: string; finish?: string; intensity?: number } | null;
    if (old) look = sanitizeLook({ lips: { productId: old.shadeId, finish: old.finish, intensity: old.intensity } });
  }
} catch {
  /* storage unavailable (private mode) – defaults are fine */
}
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ look, tab }));
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
let tracker: Tracker | null = null;
let trackerFailed = false;
const trackerReady = createTracker()
  .then((t) => {
    tracker = t;
    return t;
  })
  .catch((err) => {
    console.error('Face tracking failed to load', err);
    trackerFailed = true;
    return null;
  });

const smoother = new FaceSmoother();
let livePts: FacePts | null = null;
let lastFaceAt = 0;
let lastVideoTime = -1;
let comparing = false;
let photo: { canvas: HTMLCanvasElement; pts: FacePts | null } | null = null;
let photoDirty = true;

// ---------- UI ----------
const tabsEl = $('tabs');
const swatchesEl = $('swatches');
const finishesEl = $('finishes');
const controlsEl = $('controls');
const intensityEl = $<HTMLInputElement>('intensity');
const NONE = '__none';

function buildTabs() {
  for (const t of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.dataset.id = t.id;
    b.setAttribute('role', 'tab');
    b.innerHTML = `<i class="dot"></i><span></span>`;
    b.querySelector('span')!.textContent = t.label;
    b.addEventListener('click', () => {
      tab = t.id;
      persist();
      renderPanel();
    });
    tabsEl.appendChild(b);
  }
}

const noneSvg =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/></svg>';

function renderPanel() {
  swatchesEl.textContent = '';
  finishesEl.textContent = '';
  swatchesEl.scrollLeft = 0;

  if (tab === 'looks') {
    swatchesEl.className = 'swatches presets';
    swatchesEl.setAttribute('role', 'group');
    swatchesEl.setAttribute('aria-label', 'Ready-made looks');
    controlsEl.hidden = true;

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'preset';
    clear.dataset.id = NONE;
    clear.innerHTML = `<span class="chip none">${noneSvg}</span><span class="name">Clear all</span>`;
    clear.addEventListener('click', () => setLook(clearedLook()));
    swatchesEl.appendChild(clear);

    for (const preset of PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.dataset.id = preset.id;
      const dots = presetColors(preset)
        .map((hex) => `<i style="background:${hex}"></i>`)
        .join('');
      b.innerHTML = `<span class="chip">${dots}</span><span class="name"></span>`;
      b.querySelector('.name')!.textContent = preset.name;
      b.addEventListener('click', () => setLook(applyPreset(preset)));
      swatchesEl.appendChild(b);
    }
  } else {
    const cat = CATEGORIES[tab];
    swatchesEl.className = 'swatches';
    swatchesEl.setAttribute('role', 'radiogroup');
    swatchesEl.setAttribute('aria-label', `${cat.label} shade`);
    controlsEl.hidden = false;

    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'swatch none';
    none.dataset.id = NONE;
    none.setAttribute('role', 'radio');
    none.setAttribute('aria-label', `No ${cat.label.toLowerCase()}`);
    none.innerHTML = noneSvg;
    none.addEventListener('click', () => selectProduct(null));
    swatchesEl.appendChild(none);

    for (const product of cat.products) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.id = product.id;
      b.style.background = product.hex;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `${product.name}, ${product.family}`);
      b.addEventListener('click', () => selectProduct(product.id));
      swatchesEl.appendChild(b);
    }

    finishesEl.hidden = cat.finishes.length < 2;
    finishesEl.style.setProperty('--n', String(cat.finishes.length));
    for (const f of cat.finishes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = f.id;
      b.textContent = f.label;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        look[tab as CategoryId].finish = f.id;
        persist();
        syncUI();
      });
      finishesEl.appendChild(b);
    }
  }
  syncUI(true);
}

function syncUI(scroll = false) {
  for (const el of tabsEl.children as Iterable<HTMLElement>) {
    const id = el.dataset.id as Tab;
    el.setAttribute('aria-selected', String(id === tab));
    const dot = el.querySelector<HTMLElement>('.dot')!;
    const product = id === 'looks' ? undefined : productOf(id, look[id]);
    dot.style.background = product?.hex ?? '';
    dot.classList.toggle('on', !!product);
  }

  let accent = productOf('lips', look.lips)?.hex ?? '#c8102e';
  if (tab === 'looks') {
    $('shade-name').textContent = 'Looks';
    $('shade-family').textContent = 'Full-face looks in one tap';
  } else {
    const cat = CATEGORIES[tab];
    const layer = look[tab];
    const product = productOf(tab, layer);
    if (product) accent = product.hex;
    $('shade-name').textContent = product ? product.name : `No ${cat.label.toLowerCase()}`;
    $('shade-family').textContent = product ? product.family : 'Tap a shade to try it on';
    for (const el of swatchesEl.children as Iterable<HTMLElement>) {
      const on = el.dataset.id === (product ? product.id : NONE);
      el.setAttribute('aria-checked', String(on));
      if (on && scroll) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
    for (const el of finishesEl.children as Iterable<HTMLElement>) {
      el.setAttribute('aria-checked', String(el.dataset.id === layer.finish));
    }
    intensityEl.value = String(layer.intensity);
    intensityEl.disabled = !product;
    controlsEl.classList.toggle('disabled', !product);
  }
  document.documentElement.style.setProperty('--accent', accent);
  photoDirty = true;
}

function selectProduct(id: string | null) {
  const layer = look[tab as CategoryId];
  layer.productId = id;
  if (id && layer.intensity === 0) layer.intensity = 60;
  persist();
  syncUI(true);
}

function setLook(next: Look) {
  look = next;
  persist();
  syncUI();
}

intensityEl.addEventListener('input', () => {
  if (tab === 'looks') return;
  look[tab].intensity = Number(intensityEl.value);
  persist();
  photoDirty = true;
});

buildTabs();
renderPanel();

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
  livePts = null;
  smoother.reset();
  resetMakeup();
  syncMode();
  return null;
}

function syncMode() {
  view.classList.toggle('mirror', mode === 'camera' && mirrored);
  $('mode-label').textContent = mode === 'photo' ? 'Camera' : 'Photo';
  $('btn-flip').hidden = mode === 'photo';
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

function loadImage(file: File): Promise<HTMLImageElement> {
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

async function openPhoto(file: File) {
  setStatus('Finding your face…');
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);

    const t = await trackerReady;
    if (!t) throw new Error('Face tracking is not available');
    const lm = await t.detectImage(canvas);
    resetMakeup();
    photo = { canvas, pts: lm ? toPoints(lm, canvas.width, canvas.height) : null };

    stopStream();
    mode = 'photo';
    photoDirty = true;
    intro.hidden = true;
    syncMode();
    setStatus(photo.pts ? '' : 'No face found in that photo. Try a clearer, front-facing one.');
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

// ---------- compare (hold to see your bare face) ----------
const compareBtn = $('btn-compare');
const setCompare = (on: boolean) => {
  comparing = on;
  compareBtn.classList.toggle('active', on);
  photoDirty = true;
};
compareBtn.addEventListener('pointerdown', (e) => {
  compareBtn.setPointerCapture(e.pointerId);
  setCompare(true);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  compareBtn.addEventListener(type, () => setCompare(false));
}
compareBtn.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- render loop ----------
function fitCanvas(w: number, h: number) {
  if (view.width !== w || view.height !== h) {
    view.width = w;
    view.height = h;
  }
}

function drawMakeup(w: number, h: number, pts: FacePts | null, now: number) {
  if (!pts || comparing) return;
  renderLook(ctx, w, h, pts, look, now);
}

const sparkling = () => !!look.eyes.productId && look.eyes.finish === 'shimmer';

function frame(now: number) {
  requestAnimationFrame(frame);

  if (mode === 'camera') {
    if (video.readyState < 2 || !video.videoWidth) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    fitCanvas(w, h);
    ctx.drawImage(video, 0, 0, w, h);

    if (tracker && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const lm = tracker.detectVideo(video);
      if (lm) {
        livePts = smoother.update(lm, w, h);
        lastFaceAt = now;
      } else if (now - lastFaceAt > 250) {
        livePts = null;
        smoother.reset();
        resetMakeup();
      }
    }
    drawMakeup(w, h, livePts, now);

    if (trackerFailed) setStatus('Face tracking could not load. Check your connection and reload.');
    else if (!tracker) setStatus('Loading face tracking…');
    else if (!livePts && now - lastFaceAt > 700) setStatus('Move your face into the frame');
    else setStatus('');
  } else if (mode === 'photo' && photo && (photoDirty || sparkling())) {
    photoDirty = false;
    const { canvas, pts } = photo;
    fitCanvas(canvas.width, canvas.height);
    ctx.drawImage(canvas, 0, 0);
    drawMakeup(canvas.width, canvas.height, pts, now);
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
  if (mode === 'idle' || !view.width) return;
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
  const name = 'makeup-look.jpg';
  const file = new File([resultBlob], name, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My makeup look' });
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
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
