// Copies the MediaPipe WASM runtime into public/ and downloads the face model
// once, so the app runs fully self-hosted (no third-party requests at runtime).
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'mediapipe');
mkdirSync(out, { recursive: true });

const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
if (existsSync(wasmSrc)) cpSync(wasmSrc, join(out, 'wasm'), { recursive: true });

const model = join(out, 'face_landmarker.task');
if (!existsSync(model)) {
  const url =
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(model, Buffer.from(await res.arrayBuffer()));
    console.log('Downloaded face_landmarker.task');
  } catch (e) {
    console.warn(`Could not download face model (${e.message}). Download it manually to public/mediapipe/face_landmarker.task`);
  }
}
