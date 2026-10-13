# Makeup Try-On

Web app (PWA, iOS-first) where people see makeup (lips, eyeshadow, liner, blush, brows) on their face live through the camera.

## Decisions
- Vanilla TypeScript + Vite, no UI framework. Mobile-first, installable on iPhone via Add to Home Screen.
- Face tracking: `@mediapipe/tasks-vision` Face Landmarker, self-hosted in `public/mediapipe/`
  (git-ignored; `npm install` runs `scripts/setup-assets.mjs` to fetch it). No runtime third-party requests.
- Makeup is rendered **per pixel in linear light** (not flat colour/blend-mode overlays, which look like a filter).
  Each product edits the frame pixels in place (`getImageData` -> modify -> `putImageData` on a small box), so the
  canvas is created with `willReadFrequently: true`. Pigment takes its light/shade from the original pixel
  luminance (`ratio = Y / yRef`), so lip lines, skin texture, lashes and hairs show through.
- Renderers: `lips.ts` (edge = landmark contour refined by lip/skin chroma at the outer lip line only; gloss lit
  from a height field of the lips), `eyes.ts` (eyeshadow in a per-eye lid coordinate frame, hard cut at the lash line,
  skin/non-skin gate, shimmer glitter; liner), `cheeks.ts` (blush), `brows.ts` (hair-aware fill with streak noise).
  `paint.ts` only builds small anti-aliased masks; `pixels.ts` has colour/noise/sampling helpers; `makeup.ts` layers
  everything (blush, brows, eyeshadow, liner, lips). Reference colours (lip, skin) are measured live and smoothed.
  Do not use `ctx.filter` (unsupported on Safari); mask edges use the offscreen `shadowBlur` trick.
- Cost: a full look is about 7 ms/frame on a desktop CPU at 720p. Keep new per-pixel work inside small boxes.
- All shades/finishes/looks are data in `src/catalog.ts` (lips come from `src/shades.ts`).
- MediaPipe brow landmarks only bracket the upper half of a thick brow, so `brows.ts` searches further down.
  Video chroma is half resolution, so chroma-based tests are blurred before use.
- Camera needs HTTPS (or localhost). `getUserMedia` must be started from a user gesture on iOS.
- Native iOS app (App Store) is a possible later step via Capacitor; not built yet.

## Commands
- `npm run dev` / `npm run build` (typechecks first) / `npm run preview`

## Testing notes
- Verified with Playwright + Chromium using a fake camera (`--use-file-for-fake-video-capture`) and face photos
  (a smiling/squinting face and a neutral face; check both when changing eye or brow geometry).
- Not yet verified on a real iPhone/Safari (shadow-blur feathering, CPU canvas speed, GPU delegate, share sheet).
- Production deploy: Vercel project `lipstick-tryon` (auto-deploys on push); public URL https://lipstick-tryon-kappa.vercel.app
