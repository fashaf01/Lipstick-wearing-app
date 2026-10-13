# Makeup Try-On

Open the page, allow the camera, and see makeup on your face **live**. Works in the browser on
iPhone, Android and desktop, and can be added to the iPhone Home Screen so it opens like an app.

- **Live camera try-on** with on-device face tracking (MediaPipe Face Landmarker)
- **Realistic rendering**: makeup is blended per pixel in linear light, so skin texture, lip lines, lashes and brow hairs show through (it looks like product on skin, not a filter)
- **Lipstick**: 18 shades, finishes matte / satin / gloss / sheer
- **Eyeshadow**: 16 shades, finishes matte / shimmer (twinkling sparkles) / smoky
- **Eyeliner**: 7 colours, thin / classic / winged
- **Blush**: 7 shades, matte / glow
- **Brows**: 7 tints
- **Looks**: one-tap full-face looks (Natural Glow, Rosy Day, Classic Red, Smoky Night, Berry Bold, Golden Hour)
- Per-product intensity, hold-to-compare (bare face), front/back camera switch
- Photo mode: try everything on an uploaded photo if the camera is unavailable
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
npm run build   # typechecks, then outputs dist/
npm run preview # serve the production build locally
```

### Add to iPhone Home Screen

Open the deployed site in **Safari** → Share → **Add to Home Screen**. It then launches full-screen
with its own icon.

## How it works

| File | Role |
| --- | --- |
| `src/tracker.ts` | Loads the MediaPipe face model (GPU, falls back to CPU) and returns 478 face landmarks per frame |
| `src/face.ts` | Landmark index sets, geometry helpers, and temporal smoothing |
| `src/pixels.ts` | Linear-light colour conversion, noise, reference-colour sampling, blur |
| `src/paint.ts` | Small anti-aliased masks and contour helpers |
| `src/lips.ts`, `eyes.ts`, `cheeks.ts`, `brows.ts` | One per-pixel renderer per product type |
| `src/makeup.ts` | Applies a whole look in layer order: blush, brows, eyeshadow, liner, lips |
| `src/catalog.ts` | All shades, finishes and the one-tap Looks (edit here to add products) |
| `src/shades.ts` | Lipstick shades and finish recipes |
| `src/main.ts` | Camera, photo mode, tabbed UI, capture and share |
| `public/sw.js` | Service worker that caches the app, model and WASM for offline use |

Notes: lip edges follow the real lip/skin colour change near the landmark contour, the open mouth is excluded so
teeth stay natural, and gloss is lit from the lips' shape. Mask edges use an off-canvas `shadowBlur` trick instead of
`ctx.filter`, so it also works on Safari. A full look costs about 7 ms per frame on a desktop CPU.

## Native iOS app

This is a web app that installs like an app. A native App Store build would wrap the same code with
[Capacitor](https://capacitorjs.com/) (needs a Mac with Xcode and an Apple Developer account).

## Not included yet

Foundation / skin smoothing, mascara and lashes, contour, and several faces at once.
