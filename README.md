# Lipstick Try-On

Open the page, allow the camera, and see lipstick on your lips **live**. Works in the browser on
iPhone, Android and desktop, and can be added to the iPhone Home Screen so it opens like an app.

- Live camera try-on with face tracking (MediaPipe Face Landmarker, runs fully on-device)
- 18 shades (nude, pink, coral, red, berry) and 4 finishes: matte, satin, gloss, sheer
- Intensity slider, hold-to-compare (bare lips), front/back camera switch
- Photo mode: try shades on an uploaded photo if the camera is unavailable
- Take a photo and share or save it (native share sheet on iOS)
- Installable (PWA) and works offline after the first visit
- Privacy: video never leaves the device, nothing is uploaded

## Run it

```bash
npm install     # also downloads the face model (~4 MB) and copies the WASM runtime into public/mediapipe
npm run dev     # http://localhost:5173
```

Browsers only allow camera access on **HTTPS** or `localhost`. To try it on your phone, deploy the
`dist/` folder to any static HTTPS host (Vercel, Netlify, Cloudflare Pages, GitHub Pages):

```bash
npm run build   # outputs dist/
npm run preview # serve the production build locally
```

### Add to iPhone Home Screen

Open the deployed site in **Safari** → Share → **Add to Home Screen**. It then launches full-screen
with its own icon.

## How it works

| File | Role |
| --- | --- |
| `src/tracker.ts` | Loads the MediaPipe face model (GPU, falls back to CPU) and returns 478 face landmarks per frame |
| `src/lips.ts` | Smooths the lip landmarks and paints lipstick: feathered lip mask, then hue / pigment / depth blend passes, then gloss highlights |
| `src/shades.ts` | Shade list and finish recipes (edit these to add shades or tune finishes) |
| `src/main.ts` | Camera, photo mode, UI, capture and share |
| `public/sw.js` | Service worker that caches the app, model and WASM for offline use |

The open mouth is excluded with an even-odd lip mask, so teeth stay natural. Rendering avoids
`ctx.filter` so it also works on Safari.

## Native iOS app

This is a web app that installs like an app. A native App Store build would wrap the same code with
[Capacitor](https://capacitorjs.com/) (needs a Mac with Xcode and an Apple Developer account).
