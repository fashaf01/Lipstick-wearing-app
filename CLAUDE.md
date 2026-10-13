# Lipstick Try-On

Web app (PWA, iOS-first) where people see lipstick on their face live through the camera.

## Decisions
- Vanilla TypeScript + Vite, no UI framework. Mobile-first, installable on iPhone via Add to Home Screen.
- Face tracking: `@mediapipe/tasks-vision` Face Landmarker, self-hosted in `public/mediapipe/`
  (git-ignored; `npm install` runs `scripts/setup-assets.mjs` to fetch it). No runtime third-party requests.
- Lipstick rendering lives in `src/lips.ts`. Do not use `ctx.filter` (unsupported on Safari);
  edges are feathered with the offscreen `shadowBlur` trick instead.
- Camera needs HTTPS (or localhost). `getUserMedia` must be started from a user gesture on iOS.
- Native iOS app (App Store) is a possible later step via Capacitor; not built yet.

## Commands
- `npm run dev` / `npm run build` (typechecks first) / `npm run preview`

## Testing notes
- Verified with Playwright + Chromium using a fake camera (`--use-file-for-fake-video-capture`) and a face photo.
- Not yet verified on a real iPhone/Safari (shadow-blur feathering, GPU delegate, share sheet).
