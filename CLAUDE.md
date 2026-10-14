# Try-On Clothes

Web app (PWA, iOS-first) where people see clothes on their body live through the camera. It replaced the earlier
makeup try-on (still in git history at commit `eb790fd`).

## Decisions
- Vanilla TypeScript + Vite, no UI framework. Mobile-first, installable on iPhone via Add to Home Screen.
- Body tracking: `@mediapipe/tasks-vision` Pose Landmarker (33 landmarks), self-hosted in `public/mediapipe/`
  (git-ignored; `npm install` runs `scripts/setup-assets.mjs` to fetch the models). No runtime third-party requests.
  `full` model by default, `?model=lite` for the small one.
- Clothes are **2D skeletal mesh warps**, not 3D: each garment image gets a rig (shoulders, hips, sleeve / leg chains,
  normalised to the image, see `RigDef` in `src/rig.ts`), a grid mesh and per-vertex bone weights. Every frame
  `poseMesh` bends the mesh to the tracked joints (torso = bilinear quad; pelvis; limbs = chains that point where
  the limb points but keep the garment's length, scaled by torso length so turning does not shrink sleeves).
- Rendering is WebGL 2 (`src/gl.ts`): camera frame as a texture, garments drawn over it with premultiplied alpha.
  The fragment shader multiplies by scene brightness and colour cast, borrows broad shading from the camera image
  (mip level 4.5 relative to the torso mean), adds sensor grain, and masks an ellipse around the head. The canvas has
  the video's pixel size and is shown with CSS `object-fit: cover` (mirrored with CSS for the front camera); capture
  re-renders and copies in the same task, so no `preserveDrawingBuffer`.
- Landmarks are paired by **picture side** (left of the image = `L`), not by MediaPipe's anatomical left/right, so mirrored
  photos work. Garment rigs use the same convention (image-left first).
- MediaPipe's hip landmarks sit lower than anatomical hip joints (shoulder to hip is ~0.6 m, not 0.52 m) and are the
  noisiest, so hip spacing is pulled halfway towards `0.5 x shoulder width`. The built-in garments are drawn with
  these proportions (see the header of `scripts/make-clothes.mjs`).
- User garments: `src/cutout.ts` removes a plain background (flood fill from the border, sealed against outline gaps,
  holes only if they match the background colour almost exactly), `src/autorig.ts` guesses the rig from the silhouette
  with typical body proportions, `src/editor.ts` lets the user drag the points, `src/store.ts` keeps them in IndexedDB.
- Built-in garments are generated: `node scripts/make-clothes.mjs` writes `public/clothes/*.svg`, `index.json` (for the
  service worker) and `src/clothes.json` (catalogue + rigs). Edit the script, not the generated files.
- **Never give a DOM element an id that is also a global MediaPipe's WASM uses** (`dbg` broke tracking: elements with ids
  become `window` properties and shadow its emscripten globals).
- Camera needs HTTPS (or localhost). `getUserMedia` must be started from a user gesture on iOS.
- Native iOS app (App Store) is a possible later step via Capacitor; not built yet.

## Commands
- `npm run dev` / `npm run build` (typechecks first) / `npm run preview`
- `node scripts/make-clothes.mjs` regenerates the sample garments

## Testing notes
- Verified with Playwright + Chromium (software WebGL): photo mode with `setInputFiles` on `#file`, camera mode with
  `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=clip.y4m`, the add-your-own flow with
  `#file-garment`. The dev server exposes `window.__tryon` (also with `?debug=1`); `?debug=1` draws the joints.
- Pose detection takes ~2 s per frame on the headless software CPU, so frame rate cannot be measured there.
  Rendering is ~7 ms on software GL.
- Test photos need one clearly visible person (the model picks one); crop group photos first.
- Not yet verified on a real iPhone/Safari (WebGL 2 video textures, GPU delegate for pose, frame rate, IndexedDB blobs,
  share sheet).
- Production deploy: Vercel project `lipstick-tryon` (auto-deploys on push); public URL https://lipstick-tryon-kappa.vercel.app
