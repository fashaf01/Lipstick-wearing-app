// Copies the MediaPipe WASM runtime into public/ and downloads the pose model
// once, so the app runs fully self-hosted (no third-party requests at runtime).
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'mediapipe');
mkdirSync(out, { recursive: true });

const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
if (existsSync(wasmSrc)) cpSync(wasmSrc, join(out, 'wasm'), { recursive: true });

// "full" is the default (steadier limbs); "lite" is faster and is used with ?model=lite
const variants = ['full', 'lite'];
for (const variant of variants) {
  const model = join(out, `pose_landmarker_${variant}.task`);
  if (existsSync(model)) continue;
  const url = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/1/pose_landmarker_${variant}.task`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(model, Buffer.from(await res.arrayBuffer()));
    console.log(`Downloaded pose_landmarker_${variant}.task`);
  } catch (e) {
    console.warn(
      `Could not download the ${variant} pose model (${e.message}). Download it manually to public/mediapipe/pose_landmarker_${variant}.task`,
    );
  }
}
