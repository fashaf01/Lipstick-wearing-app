import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Landmark } from './face';

export interface Tracker {
  /** Synchronous detection on the current video frame. */
  detectVideo(video: HTMLVideoElement): Landmark[] | null;
  /** One-off detection on a still image. */
  detectImage(image: HTMLCanvasElement): Promise<Landmark[] | null>;
}

export async function createTracker(): Promise<Tracker> {
  const base = import.meta.env.BASE_URL;
  const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);

  const make = (delegate: 'GPU' | 'CPU') =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}mediapipe/face_landmarker.task`, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });

  let landmarker: FaceLandmarker;
  try {
    landmarker = await make('GPU');
  } catch {
    landmarker = await make('CPU');
  }

  let lastTs = 0;
  return {
    detectVideo(video) {
      lastTs = Math.max(lastTs + 1, Math.round(performance.now()));
      const res = landmarker.detectForVideo(video, lastTs);
      return res.faceLandmarks[0] ?? null;
    },
    async detectImage(image) {
      await landmarker.setOptions({ runningMode: 'IMAGE' });
      const res = landmarker.detect(image);
      await landmarker.setOptions({ runningMode: 'VIDEO' });
      return res.faceLandmarks[0] ?? null;
    },
  };
}
