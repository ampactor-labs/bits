// Reading a video once: motion and drift from small frame differences,
// person masks from the selfie segmenter, head and hands from the pose
// landmarker, all sampled at 15 per second of clip, and kept as one asset.
// Models answer differently on different phones, so the answers are stored
// and the recipe points at them: a bit plays the same everywhere after.
//
// MediaPipe stays lazy: nothing here loads until someone asks for a read.

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { JOINTS, type Joint, type VideoSpec, type VideoTracks } from '../engine/video';

export const ANALYSIS_RATE = 15;
const SMALL_W = 64;
const SMALL_H = 36;
/** How far the drift search looks, in small-frame pixels. */
const SEARCH = 4;
const MODEL_W = 256;
/** Which landmarks the joints are. */
const LANDMARK: Record<Joint, number> = { head: 0, leftHand: 15, rightHand: 16 };

/** A segmenter or landmarker stand-in, for tests that cannot ship a
 *  person: given a frame, a confidence mask or landmarks. */
export interface Models {
  segment?: (frame: OffscreenCanvas, ms: number) => Float32Array | null;
  landmarks?: (frame: OffscreenCanvas, ms: number) => { x: number; y: number; visibility?: number }[] | null;
  close?: () => void;
}

/** MediaPipe's, from the files the app ships. */
export async function mediapipeModels(want: { masks: boolean; pose: boolean }): Promise<Models> {
  const base = `${import.meta.env.BASE_URL}mediapipe`;
  const vision = await import('@mediapipe/tasks-vision');
  const fileset = await vision.FilesetResolver.forVisionTasks(base);
  const segmenter = want.masks
    ? await vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}/selfie_segmenter.tflite` },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
      })
    : null;
  const landmarker = want.pose
    ? await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}/pose_landmarker_lite.task` },
        runningMode: 'VIDEO',
        numPoses: 1,
      })
    : null;
  return {
    ...(segmenter
      ? {
          segment: (frame: OffscreenCanvas, ms: number) => {
            let out: Float32Array | null = null;
            segmenter.segmentForVideo(frame, ms, (r) => {
              const m = r.confidenceMasks?.[0];
              out = m ? m.getAsFloat32Array().slice() : null;
            });
            return out;
          },
        }
      : {}),
    ...(landmarker
      ? {
          landmarks: (frame: OffscreenCanvas, ms: number) =>
            landmarker.detectForVideo(frame, ms).landmarks?.[0] ?? null,
        }
      : {}),
    close: () => {
      segmenter?.close();
      landmarker?.close();
    },
  };
}

const normalise = (track: Float32Array) => {
  const sorted = Float32Array.from(track).sort();
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  for (let i = 0; i < track.length; i++) track[i] = p95 > 1e-6 ? Math.min(1, track[i]! / p95) : 0;
};

/** One read of a clip. `onProgress` gets 0..1 as frames go by. */
export async function analyzeVideo(
  blob: Blob,
  durationS: number,
  models: Models,
  onProgress: (fraction: number) => void = () => {},
): Promise<VideoTracks> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no video track');
  const mh = Math.max(2, Math.round((MODEL_W * track.displayHeight) / track.displayWidth));
  const sink = new CanvasSink(track, { width: MODEL_W, height: mh, fit: 'fill' });
  const n = Math.max(1, Math.floor(durationS * ANALYSIS_RATE));
  const times = Array.from({ length: n }, (_, i) => i / ANALYSIS_RATE);
  const small = new OffscreenCanvas(SMALL_W, SMALL_H).getContext('2d', { willReadFrequently: true })!;
  const model = new OffscreenCanvas(MODEL_W, mh).getContext('2d', { willReadFrequently: true })!;
  const motion = new Float32Array(n);
  const flowx = new Float32Array(n);
  const flowy = new Float32Array(n);
  const pose = models.landmarks
    ? (Object.fromEntries(JOINTS.map((j) => [j, new Float32Array(n * 3)])) as Record<Joint, Float32Array>)
    : null;
  const masks = models.segment ? { w: MODEL_W, h: mh, frames: [] as Uint8Array[] } : null;
  let prev: Float32Array | null = null;
  let i = 0;
  for await (const wrapped of sink.canvasesAtTimestamps(times)) {
    if (i >= n) break;
    if (wrapped) {
      small.drawImage(wrapped.canvas, 0, 0, SMALL_W, SMALL_H);
      const px = small.getImageData(0, 0, SMALL_W, SMALL_H).data;
      const grey = new Float32Array(SMALL_W * SMALL_H);
      for (let k = 0; k < grey.length; k++) {
        grey[k] = (0.299 * px[k * 4]! + 0.587 * px[k * 4 + 1]! + 0.114 * px[k * 4 + 2]!) / 255;
      }
      if (prev) {
        // How much changed, and the one shift that best explains it: the
        // picture's drift, found by trying every shift up to four pixels
        // (at this size, a sixteenth of the frame) and keeping the one
        // whose difference is least. A gradient method cannot see
        // anything that moves further than its own width between samples.
        let diff = 0;
        for (let k = 0; k < grey.length; k++) diff += Math.abs(grey[k]! - prev[k]!);
        motion[i] = diff / grey.length;
        let best = Infinity;
        let bx = 0;
        let by = 0;
        for (let dy = -SEARCH; dy <= SEARCH; dy++) {
          for (let dx = -SEARCH; dx <= SEARCH; dx++) {
            let sad = 0;
            for (let y = SEARCH; y < SMALL_H - SEARCH; y++) {
              const row = y * SMALL_W;
              const prow = (y - dy) * SMALL_W;
              for (let x = SEARCH; x < SMALL_W - SEARCH; x++) {
                sad += Math.abs(grey[row + x]! - prev[prow + x - dx]!);
              }
            }
            // Ties go to the smaller shift: a still picture does not drift.
            if (sad < best - 1e-9 || (Math.abs(sad - best) <= 1e-9 && Math.abs(dx) + Math.abs(dy) < Math.abs(bx) + Math.abs(by))) {
              best = sad;
              bx = dx;
              by = dy;
            }
          }
        }
        flowx[i] = bx / SEARCH;
        flowy[i] = by / SEARCH;
      }
      prev = grey;
      if (models.segment || models.landmarks) {
        model.drawImage(wrapped.canvas, 0, 0, MODEL_W, mh);
        const ms = Math.round((i * 1000) / ANALYSIS_RATE);
        if (masks && models.segment) {
          const conf = models.segment(model.canvas, ms);
          const alpha = new Uint8Array(MODEL_W * mh);
          if (conf) {
            for (let k = 0; k < alpha.length; k++) {
              alpha[k] = Math.round(255 * Math.min(1, Math.max(0, (conf[k]! - 0.35) / 0.4)));
            }
          }
          masks.frames.push(alpha);
        }
        if (pose && models.landmarks) {
          const lm = models.landmarks(model.canvas, ms);
          for (const j of JOINTS) {
            const l = lm?.[LANDMARK[j]];
            pose[j][i * 3] = l?.x ?? 0;
            pose[j][i * 3 + 1] = l?.y ?? 0;
            pose[j][i * 3 + 2] = l ? (l.visibility ?? 1) : 0;
          }
        }
      }
    } else if (masks) {
      masks.frames.push(new Uint8Array(MODEL_W * mh));
    }
    i++;
    onProgress(i / n);
  }
  input.dispose();
  // The first sample has nothing before it; it moves as the second does.
  if (n > 1) {
    motion[0] = motion[1]!;
    flowx[0] = flowx[1]!;
    flowy[0] = flowy[1]!;
  }
  normalise(motion);
  models.close?.();
  return { rate: ANALYSIS_RATE, motion, flowx, flowy, pose, masks };
}

// --- storage ---------------------------------------------------------------

const MAGIC = 0x31415642; // 'BVA1'

/** One flat binary: a small JSON header, then the arrays. */
export function serializeTracks(t: VideoTracks): Blob {
  const n = t.motion.length;
  const header = new TextEncoder().encode(
    JSON.stringify({ rate: t.rate, n, pose: !!t.pose, masks: t.masks ? { w: t.masks.w, h: t.masks.h } : null }),
  );
  const pad = (4 - ((8 + header.length) % 4)) % 4;
  // Copies, so every part is a plain ArrayBuffer view whatever the arrays
  // were made on.
  const bytes = (a: Float32Array | Uint8Array) => new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer);
  const parts: BlobPart[] = [
    new Uint32Array([MAGIC, header.length]),
    header,
    new Uint8Array(pad),
    bytes(t.motion),
    bytes(t.flowx),
    bytes(t.flowy),
  ];
  if (t.pose) for (const j of JOINTS) parts.push(bytes(t.pose[j]));
  if (t.masks) for (const f of t.masks.frames) parts.push(bytes(f));
  return new Blob(parts, { type: 'application/octet-stream' });
}

export async function deserializeTracks(blob: Blob): Promise<VideoTracks> {
  const buf = await blob.arrayBuffer();
  const head = new Uint32Array(buf, 0, 2);
  if (head[0] !== MAGIC) throw new Error('not a video analysis');
  const len = head[1]!;
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, len))) as {
    rate: number;
    n: number;
    pose: boolean;
    masks: { w: number; h: number } | null;
  };
  let off = 8 + len + ((4 - ((8 + len) % 4)) % 4);
  const f32 = (count: number) => {
    const a = new Float32Array(buf.slice(off, off + count * 4));
    off += count * 4;
    return a;
  };
  const motion = f32(meta.n);
  const flowx = f32(meta.n);
  const flowy = f32(meta.n);
  const pose = meta.pose
    ? (Object.fromEntries(JOINTS.map((j) => [j, f32(meta.n * 3)])) as Record<Joint, Float32Array>)
    : null;
  let masks: VideoTracks['masks'] = null;
  if (meta.masks) {
    const size = meta.masks.w * meta.masks.h;
    const frames: Uint8Array[] = [];
    for (let i = 0; i < meta.n; i++) {
      frames.push(new Uint8Array(buf.slice(off, off + size)));
      off += size;
    }
    masks = { w: meta.masks.w, h: meta.masks.h, frames };
  }
  return { rate: meta.rate, motion, flowx, flowy, pose, masks };
}

// --- the loaded analyses -----------------------------------------------------

const loaded = new Map<string, VideoTracks>();
/** Bumped whenever an analysis arrives, so memos built before it rebuild. */
let generation = 0;

export async function loadVideoAnalyses(
  specs: { type: string }[],
  getAssetBlob: (assetId: string) => Promise<Blob>,
): Promise<void> {
  for (const s of specs) {
    const spec = s as VideoSpec;
    if (spec.type !== 'video' || !spec.analysisId || loaded.has(spec.analysisId)) continue;
    try {
      loaded.set(spec.analysisId, await deserializeTracks(await getAssetBlob(spec.analysisId)));
      generation++;
    } catch {
      // An analysis that will not read leaves the clip as it was.
    }
  }
}

/** For tests and for a read that has just finished. */
export function rememberTracks(analysisId: string, tracks: VideoTracks): void {
  loaded.set(analysisId, tracks);
  generation++;
}

const sourcesMemo = new WeakMap<object, { generation: number; map: Map<string, { spec: VideoSpec; tracks: VideoTracks }> }>();

/** Every read video sheet in a cast, by sheet id: what video signals read.
 *  The same map object for the same cast until a new read arrives, so
 *  shaped wires keep their baked tracks. */
export function videoSourcesOf(
  cast: readonly { id: string; spec: { type: string } }[],
): Map<string, { spec: VideoSpec; tracks: VideoTracks }> {
  const hit = sourcesMemo.get(cast);
  if (hit && hit.generation === generation) return hit.map;
  const map = new Map<string, { spec: VideoSpec; tracks: VideoTracks }>();
  for (const p of cast) {
    if (p.spec.type !== 'video') continue;
    const spec = p.spec as VideoSpec;
    const tracks = tracksOf(spec);
    if (tracks) map.set(p.id, { spec, tracks });
  }
  sourcesMemo.set(cast, { generation, map });
  return map;
}

export function tracksOf(spec: VideoSpec): VideoTracks | null {
  return spec.analysisId ? (loaded.get(spec.analysisId) ?? null) : null;
}

/** Mask frames as canvases, made on first use and kept a little while. */
const maskCanvases = new Map<string, OffscreenCanvas>();

export function maskCanvas(analysisId: string, tracks: VideoTracks, index: number): OffscreenCanvas | null {
  const m = tracks.masks;
  if (!m || index < 0 || index >= m.frames.length) return null;
  const key = `${analysisId}#${index}`;
  let c = maskCanvases.get(key);
  if (!c) {
    c = new OffscreenCanvas(m.w, m.h);
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(m.w, m.h);
    const a = m.frames[index]!;
    for (let k = 0; k < a.length; k++) {
      img.data[k * 4 + 3] = a[k]!;
    }
    ctx.putImageData(img, 0, 0);
    maskCanvases.set(key, c);
    if (maskCanvases.size > 48) maskCanvases.delete(maskCanvases.keys().next().value!);
  }
  return c;
}
