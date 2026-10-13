import './style.css';
import { FINISHES, FINISH_ORDER, SHADES, type FinishId, type Shade } from './shades';
import { createTracker, type Tracker } from './tracker';
import { LipRenderer, LipSmoother, toPoints, type LipPts } from './lips';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const view = $<HTMLCanvasElement>('view');
const ctx = view.getContext('2d', { alpha: false })!;
const video = $<HTMLVideoElement>('cam');
const statusEl = $('status');
const intro = $('intro');
const introError = $('intro-error');
const fileInput = $<HTMLInputElement>('file');

// ---------- settings ----------
interface Settings {
  shadeId: string;
  finish: FinishId;
  intensity: number; // 0..100
}
const STORE_KEY = 'lipstick-tryon:v1';
const settings: Settings = { shadeId: 'classic-red', finish: 'satin', intensity: 80 };
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Settings> | null;
  if (saved) {
    if (SHADES.some((s) => s.id === saved.shadeId)) settings.shadeId = saved.shadeId!;
    if (saved.finish && saved.finish in FINISHES) settings.finish = saved.finish;
    if (typeof saved.intensity === 'number') settings.intensity = Math.min(100, Math.max(0, saved.intensity));
  }
} catch {
  /* storage unavailable (private mode) – defaults are fine */
}
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

const currentShade = (): Shade => SHADES.find((s) => s.id === settings.shadeId) ?? SHADES[0];

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

const renderer = new LipRenderer();
const smoother = new LipSmoother();
let livePts: LipPts | null = null;
let lastFaceAt = 0;
let lastVideoTime = -1;
let comparing = false;
let photo: { canvas: HTMLCanvasElement; pts: LipPts | null } | null = null;
let photoDirty = true;

// ---------- UI: shades / finishes / intensity ----------
const swatchesEl = $('swatches');
const finishesEl = $('finishes');
const intensityEl = $<HTMLInputElement>('intensity');

function buildSwatches() {
  for (const shade of SHADES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.id = shade.id;
    b.style.background = shade.hex;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `${shade.name}, ${shade.family}`);
    b.addEventListener('click', () => selectShade(shade.id));
    swatchesEl.appendChild(b);
  }
}

function buildFinishes() {
  for (const id of FINISH_ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = id;
    b.textContent = FINISHES[id].label;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => selectFinish(id));
    finishesEl.appendChild(b);
  }
}

function syncUI(scroll = false) {
  const shade = currentShade();
  $('shade-name').textContent = shade.name;
  $('shade-family').textContent = shade.family;
  document.documentElement.style.setProperty('--accent', shade.hex);
  for (const el of swatchesEl.children) {
    const on = (el as HTMLElement).dataset.id === shade.id;
    el.setAttribute('aria-checked', String(on));
    if (on && scroll) (el as HTMLElement).scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }
  for (const el of finishesEl.children) {
    el.setAttribute('aria-checked', String((el as HTMLElement).dataset.id === settings.finish));
  }
  intensityEl.value = String(settings.intensity);
  photoDirty = true;
}

function selectShade(id: string) {
  settings.shadeId = id;
  persist();
  syncUI(true);
}
function selectFinish(id: FinishId) {
  settings.finish = id;
  persist();
  syncUI();
}
intensityEl.addEventListener('input', () => {
  settings.intensity = Number(intensityEl.value);
  persist();
  photoDirty = true;
});

buildSwatches();
buildFinishes();
syncUI(true);

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

// ---------- compare (hold to see bare lips) ----------
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

function drawLips(w: number, h: number, pts: LipPts | null) {
  if (!pts || comparing) return;
  const shade = currentShade();
  renderer.render(ctx, w, h, pts, { hex: shade.hex, finish: settings.finish, intensity: settings.intensity / 100 });
}

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
      }
    }
    drawLips(w, h, livePts);

    if (trackerFailed) setStatus('Face tracking could not load. Check your connection and reload.');
    else if (!tracker) setStatus('Loading face tracking…');
    else if (!livePts && now - lastFaceAt > 700) setStatus('Move your face into the frame');
    else setStatus('');
  } else if (mode === 'photo' && photo && photoDirty) {
    photoDirty = false;
    const { canvas, pts } = photo;
    fitCanvas(canvas.width, canvas.height);
    ctx.drawImage(canvas, 0, 0);
    drawLips(canvas.width, canvas.height, pts);
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
  const name = `${currentShade().id}-lipstick.jpg`;
  const file = new File([resultBlob], name, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${currentShade().name} lipstick` });
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
