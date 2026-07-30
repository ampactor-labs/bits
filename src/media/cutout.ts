// Photo-to-puppet: MediaPipe selfie segmentation when available, whole-frame
// sticker when not. The fallback keeps the show castable on any device; the
// segmenter just makes it Gilliam.

import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const MAX_SIDE = 1024;
const CONFIDENCE = 0.5;
const PAD_PX = 10;

let segmenterPromise: Promise<ImageSegmenter | null> | null = null;

function getSegmenter(): Promise<ImageSegmenter | null> {
  segmenterPromise ??= (async () => {
    try {
      const base = `${import.meta.env.BASE_URL}mediapipe`;
      const fileset = await FilesetResolver.forVisionTasks(base);
      return await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}/selfie_segmenter.tflite` },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
      });
    } catch (err) {
      console.warn('segmenter unavailable; cutouts fall back to full frames', err);
      return null;
    }
  })();
  return segmenterPromise;
}

export interface Cutout {
  blob: Blob;
  width: number;
  height: number;
}

export async function makeCutout(imageBlob: Blob): Promise<Cutout> {
  const bitmap = await createImageBitmap(imageBlob);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const segmenter = await getSegmenter();
  if (!segmenter) return canvasToCutout(canvas);

  const mask = await new Promise<Float32Array | null>((resolve) => {
    try {
      segmenter.segment(canvas, (result) => {
        const m = result.confidenceMasks?.[0];
        // Copy inside the callback: masks are freed when it returns.
        resolve(m ? m.getAsFloat32Array().slice() : null);
      });
    } catch {
      resolve(null);
    }
  });
  if (!mask) return canvasToCutout(canvas);

  const img = ctx.getImageData(0, 0, w, h);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let hits = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const conf = mask[y * w + x]!;
      const on = conf >= CONFIDENCE;
      img.data[(y * w + x) * 4 + 3] = on ? Math.round(255 * Math.min(1, (conf - 0.35) / 0.4)) : 0;
      if (on) {
        hits += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  // A near-empty mask means the model saw no person: keep the whole frame.
  if (hits < w * h * 0.01) return canvasToCutout(canvas);

  ctx.putImageData(img, 0, 0);
  const bx = Math.max(0, minX - PAD_PX);
  const by = Math.max(0, minY - PAD_PX);
  const bw = Math.min(w, maxX + PAD_PX) - bx;
  const bh = Math.min(h, maxY + PAD_PX) - by;
  const trimmed = new OffscreenCanvas(bw, bh);
  trimmed.getContext('2d')!.drawImage(canvas, bx, by, bw, bh, 0, 0, bw, bh);
  return canvasToCutout(trimmed);
}

async function canvasToCutout(canvas: OffscreenCanvas): Promise<Cutout> {
  return {
    blob: await canvas.convertToBlob({ type: 'image/png' }),
    width: canvas.width,
    height: canvas.height,
  };
}
