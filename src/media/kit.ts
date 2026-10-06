// A selfie kit, in one flow: the photo is cut out as usual, the pose model
// finds the neck, and the cutout is split there into a head and a body.
// The stage casts the body and sets the head riding it, so the head nods
// and lags on its own spring: a puppet with a neck, from one tap.

import { makeCutout, type CutoutProgress } from './cutout';

export interface KitPart {
  blob: Blob;
  width: number;
  height: number;
}

export interface Kit {
  head: KitPart;
  body: KitPart;
  /** Where the neck is across the body's top edge, 0..1. */
  neckX: number;
}

type Landmark = { x: number; y: number; visibility?: number };
type Landmarks = (canvas: OffscreenCanvas) => Promise<Landmark[] | null>;

/** The pose model in IMAGE mode, from the files the app ships. */
const mediapipeLandmarks: Landmarks = async (canvas) => {
  const base = `${import.meta.env.BASE_URL}mediapipe`;
  const vision = await import('@mediapipe/tasks-vision');
  const fileset = await vision.FilesetResolver.forVisionTasks(base);
  const landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${base}/pose_landmarker_lite.task` },
    runningMode: 'IMAGE',
    numPoses: 1,
  });
  try {
    return landmarker.detect(canvas).landmarks?.[0] ?? null;
  } finally {
    landmarker.close();
  }
};

/** Where to split: below the chin, above the shoulders. Null when the
 *  model cannot see a head and shoulders. */
export function neckOf(lm: Landmark[] | null): { x: number; y: number } | null {
  const nose = lm?.[0];
  const ls = lm?.[11];
  const rs = lm?.[12];
  const seen = (l?: Landmark) => !!l && (l.visibility ?? 1) > 0.4;
  if (!seen(nose) || !seen(ls) || !seen(rs)) return null;
  const sy = (ls!.y + rs!.y) / 2;
  if (sy <= nose!.y) return null;
  return { x: (ls!.x + rs!.x) / 2, y: nose!.y + (sy - nose!.y) * 0.62 };
}

/** A kit from a photo, or null when it cannot be split (no person, no
 *  model, no shoulders): the caller casts a plain cutout instead. */
export async function makeKit(
  photo: Blob,
  onProgress: CutoutProgress = () => {},
  landmarks: Landmarks = mediapipeLandmarks,
): Promise<Kit | null> {
  const cut = await makeCutout(photo, onProgress);
  if (cut.fallback) return null;
  const bitmap = await createImageBitmap(cut.blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const neck = neckOf(await landmarks(canvas).catch(() => null));
  if (!neck) return null;
  const splitY = Math.round(neck.y * canvas.height);
  if (splitY < 8 || splitY > canvas.height - 8) return null;
  const part = async (y: number, h: number): Promise<KitPart> => {
    const c = new OffscreenCanvas(canvas.width, h);
    c.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    return { blob: await c.convertToBlob({ type: 'image/png' }), width: canvas.width, height: h };
  };
  // A little overlap, so the seam hides behind the head as it nods.
  const overlap = Math.round(canvas.height * 0.02);
  return {
    head: await part(0, Math.min(canvas.height, splitY + overlap)),
    body: await part(splitY, canvas.height - splitY),
    neckX: neck.x,
  };
}
