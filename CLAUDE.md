# Makeup Try-On

Web app (PWA, iOS-first) where people see makeup (lips, eyeshadow, liner, blush, brows) on their face live through the camera.

## Decisions
- Vanilla TypeScript + Vite, no UI framework. Mobile-first, installable on iPhone via Add to Home Screen.
- Face tracking: `@mediapipe/tasks-vision` Face Landmarker, self-hosted in `public/mediapipe/`
  (git-ignored; `npm install` runs `scripts/setup-assets.mjs` to fetch it). No runtime third-party requests.
- Each product type has its own renderer (`lips.ts`, `eyes.ts`, `cheeks.ts`, `brows.ts`) on top of the shared
  `Painter` in `paint.ts`; `makeup.ts` layers them. Do not use `ctx.filter` (unsupported on Safari);
  edges are feathered with the offscreen `shadowBlur` trick instead.
- All shades/finishes/looks are data in `src/catalog.ts` (lips come from `src/shades.ts`).
- MediaPipe brow landmarks only bracket the upper half of a thick brow, so `brows.ts` pushes the lower edge down.
  Use "multiply" + opaque tint for brows: the "color" blend turns dark browns cold grey on pale skin.
- Camera needs HTTPS (or localhost). `getUserMedia` must be started from a user gesture on iOS.
- Native iOS app (App Store) is a possible later step via Capacitor; not built yet.

## Commands
- `npm run dev` / `npm run build` (typechecks first) / `npm run preview`

## Testing notes
- Verified with Playwright + Chromium using a fake camera (`--use-file-for-fake-video-capture`) and face photos
  (a smiling/squinting face and a neutral face; check both when changing eye or brow geometry).
- Not yet verified on a real iPhone/Safari (shadow-blur feathering, GPU delegate, share sheet).
- Production deploy: Vercel project `lipstick-tryon` (auto-deploys on push); public URL https://lipstick-tryon-kappa.vercel.app
