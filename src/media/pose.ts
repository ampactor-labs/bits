// Body passes: MediaPipe pose landmarks from the front camera drive virtual
// grabs. Wrists are the handles; coordinates come out mirrored so moving
// your right hand right moves the puppet right on screen.

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

export interface BodyHands {
  right: { x: number; y: number } | null;
  left: { x: number; y: number } | null;
}

const RIGHT_WRIST = 16;
const LEFT_WRIST = 15;
const MIN_VISIBILITY = 0.5;

export class PoseDriver {
  private landmarker: PoseLandmarker;
  private video: HTMLVideoElement;
  private stream: MediaStream;
  private raf = 0;
  private lastVideoTime = -1;
  private hands: BodyHands = { right: null, left: null };

  private constructor(landmarker: PoseLandmarker, video: HTMLVideoElement, stream: MediaStream) {
    this.landmarker = landmarker;
    this.video = video;
    this.stream = stream;
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      if (this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return;
      this.lastVideoTime = this.video.currentTime;
      try {
        const result = this.landmarker.detectForVideo(this.video, performance.now());
        const lm = result.landmarks?.[0];
        const read = (idx: number) => {
          const l = lm?.[idx];
          if (!l || (l.visibility !== undefined && l.visibility < MIN_VISIBILITY)) return null;
          // Mirror x: selfie view.
          return { x: Math.min(1, Math.max(0, 1 - l.x)), y: Math.min(1, Math.max(0, l.y)) };
        };
        this.hands = { right: read(RIGHT_WRIST), left: read(LEFT_WRIST) };
      } catch {
        // A dropped frame is fine; keep the last hands.
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  static async create(video: HTMLVideoElement): Promise<PoseDriver> {
    const base = `${import.meta.env.BASE_URL}mediapipe`;
    const fileset = await FilesetResolver.forVisionTasks(base);
    const landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}/pose_landmarker_lite.task` },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    return new PoseDriver(landmarker, video, stream);
  }

  latest(): BodyHands {
    return this.hands;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.stream.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.landmarker.close();
  }
}
