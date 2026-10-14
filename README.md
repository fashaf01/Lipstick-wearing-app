# Try-On Clothes

Open the page, allow the camera, step back so your whole body is in view, and see tops, jeans, skirts and
dresses on you **live**. Works in the browser on iPhone, Android and desktop, and can be added to the
iPhone Home Screen so it opens like an app.

- **Live camera try-on** with on-device body tracking (MediaPipe Pose Landmarker)
- **The garment follows you**: the torso stretches with your shoulders and hips, sleeves and trouser legs
  rotate with your arms and legs, and the head is masked out so collars never cover your face
- **Blends into the room**: brightness, colour cast and broad shading are borrowed from the camera image, and the garment
  gets the same sensor grain as the video
- **Mix and match**: a top plus bottoms, or a dress. Size and height sliders fine-tune the fit
- **Add your own clothes** from a photo: the app cuts out a plain background, guesses where the shoulders, hips and
  sleeves are, and lets you drag the dots to adjust. Your garments are stored on the device
- Hold-to-compare, front / back camera, photo mode (try clothes on a photo of you), take a photo and share it
- Installable (PWA), works offline after the first visit
- Privacy: video and photos never leave the device, nothing is uploaded

## Run it

```bash
npm install     # also downloads the pose models (~15 MB) and copies the WASM runtime into public/mediapipe
npm run dev     # http://localhost:5173
```

Browsers only allow camera access on **HTTPS** or `localhost`. To try it on your phone, deploy the `dist/`
folder to any static HTTPS host (Vercel, Netlify, Cloudflare Pages, GitHub Pages):

```bash
npm run build   # typechecks, then outputs dist/
npm run preview # serve the production build locally
```

### Add to iPhone Home Screen

Open the deployed site in **Safari** → Share → **Add to Home Screen**.

## Getting a good result

- Stand 2–3 m back, facing the camera, with your shoulders and hips in view (tops only need the shoulders; bottoms
  need the hips and legs). Good light helps tracking.
- Wear something **plain and close-fitting**: the garment is drawn over the video, so your own clothes show wherever
  the garment is smaller than them.
- Facing forward works best. Turning sideways narrows the garment but it cannot show the side or back view.

### Adding your own clothes

Tap **Add yours** in the garment list and choose a photo.

- Best: a **transparent PNG**, or a photo of the garment on a **plain white / solid-colour background**, flat or on a
  ghost mannequin, front view, nothing else in the picture, no hard shadows. Sleeves hanging close to the body
  (about 15° from vertical) rotate least.
- The app removes a plain background, then opens the editor. Pick the type (top / bottom / dress) and sleeve or leg
  shape, then drag the dots: green = shoulder joints, blue = hips, pink = sleeve axis, orange = leg axis. "Keep both
  sides matching" moves the other side with it.
- Tap the pencil on one of your garments to edit or delete it.

## How it works

| File | Role |
| --- | --- |
| `src/pose.ts` | Loads the MediaPipe pose model (GPU, falls back to CPU) and returns 33 body landmarks per frame |
| `src/body.ts` | One Euro smoothing, picks the joints by picture side, fills in joints that are out of frame, builds the head mask |
| `src/rig.ts` | A garment's skeleton ("rig"), its mesh and per-vertex bone weights, and the per-frame bending (linear blend skinning with 2D bones) |
| `src/gl.ts` | WebGL 2 renderer: camera image, garment meshes, lighting, grain, head mask |
| `src/garments.ts` | Loads a garment image, rasterises it, builds its mesh and uploads it |
| `src/cutout.ts` | Background removal (flood fill from the border) and cropping for garment photos |
| `src/autorig.ts` | Guesses the rig of a garment from its silhouette using typical body proportions |
| `src/editor.ts` | The editor with draggable shoulder / hip / sleeve / leg points |
| `src/store.ts` | IndexedDB storage for the user's garments |
| `src/catalog.ts`, `src/clothes.json` | The built-in garments (generated) and the outfit rules |
| `scripts/make-clothes.mjs` | Generates the built-in sample garments (`public/clothes/*.svg`) and their rigs |
| `src/main.ts` | Camera, photo mode, UI, capture and share |
| `public/sw.js` | Service worker that caches the app, models and garments for offline use |

The garment mesh has a torso patch (bilinear between your shoulders and hips), a pelvis, and chains of bones for each
sleeve and leg. Each bone points the way your limb points but keeps the garment's own length, scaled with your torso,
so sleeves do not shrink when you turn or point an arm at the camera.

### Debugging

Add `?debug=1` to the URL to draw the tracked joints over the picture, and `?model=lite` to use the smaller, faster
(less steady) pose model.

## Native iOS app

This is a web app that installs like an app. A native App Store build would wrap the same code with
[Capacitor](https://capacitorjs.com/) (needs a Mac with Xcode and an Apple Developer account).

## Not included yet

Hands or arms in front of the body hiding the garment, side / back views, shoes and accessories, several people at
once, and a smarter background remover for busy photos. The previous makeup try-on is in git history (commit `eb790fd`).
