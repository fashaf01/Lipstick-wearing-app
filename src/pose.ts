import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PoseTracker {
  /** Synchronous detection on the current video frame. */
  detectVideo(video: HTMLVideoElement): Landmark[] | null;
  /** One-off detection on a still image. */
  detectImage(image: HTMLCanvasElement): Promise<Landmark[] | null>;
}

export async function createPoseTracker(): Promise<PoseTracker> {
  const base = import.meta.env.BASE_URL;
  const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);
  const variant = new URLSearchParams(location.search).get('model') === 'lite' ? 'lite' : 'full';

  const make = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}mediapipe/pose_landmarker_${variant}.task`, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });

  let landmarker: PoseLandmarker;
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
      return res.landmarks[0] ?? null;
    },
    async detectImage(image) {
      await landmarker.setOptions({ runningMode: 'IMAGE' });
      const res = landmarker.detect(image);
      await landmarker.setOptions({ runningMode: 'VIDEO' });
      return res.landmarks[0] ?? null;
    },
  };
}
