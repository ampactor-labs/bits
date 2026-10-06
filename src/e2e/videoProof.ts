// Video sheets in a real browser: a clip encoded here, a white bar moving
// one step per frame, played as a sheet. The film path must draw exactly
// the frame the rule names (the latest at or before the clip's own time),
// whatever order or spacing the times are asked in.

import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH } from 'mediabunny';
import { createFramer } from '../engine/frame';
import { RECIPE_VERSION, type Project } from '../engine/recipe';
import { createRenderer2d } from '../media/stageDraw';
import { loadVideos, probeVideo, videoLocalTime, videosReadyAt } from '../media/video';

export interface VideoResult {
  durationS: number;
  /** For each asked time: the frame the rule names, and the one drawn. */
  frames: { t: number; want: number; got: number }[];
}

const FPS = 30;
const N = 45;
const CW = 320;
const CH = 180;

/** Frame i: black, with a white bar at column i·6. */
async function barClip(): Promise<Blob> {
  const canvas = new OffscreenCanvas(CW, CH);
  const ctx = canvas.getContext('2d')!;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH });
  output.addVideoTrack(source, { frameRate: FPS });
  await output.start();
  for (let i = 0; i < N; i++) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = '#fff';
    ctx.fillRect(i * 6 + 10, 0, 4, CH);
    await source.add(i / FPS, 1 / FPS);
  }
  await output.finalize();
  return new Blob([target.buffer!], { type: 'video/mp4' });
}

export async function runVideo(): Promise<VideoResult> {
  const clip = await barClip();
  const info = await probeVideo(clip);
  if (!info) throw new Error('the encoded clip would not probe');
  const spec = { type: 'video' as const, assetId: 'e2e-bars.mp4', durationS: info.durationS, at: 0.5, w: 1, h: 1 };
  const project: Project = {
    version: RECIPE_VERSION,
    id: 'video',
    title: 'video',
    createdAt: '2026-10-01T00:00:00.000Z',
    seed: 1,
    events: [
      { kind: 'CAST', id: 'c', at: 0, puppetId: 'v', puppet: spec, x: 0.5, y: 0.5, scale: 1, rot: 0 },
    ],
  };
  await loadVideos([spec], async () => clip);
  const W = 320;
  const H = 180;
  const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
  const renderer = createRenderer2d();
  const framer = createFramer(project, undefined, { trails: false });
  const frames: VideoResult['frames'] = [];
  // Forward, unevenly, past a loop: the way a film and a scrub both ask.
  for (const t of [0.2, 0.55, 0.61, 0.9, 1.33, 1.34, 1.8, 2.07, 2.3]) {
    await videosReadyAt([spec], t);
    renderer.draw(ctx, W, H, framer.frameAt(t), new Map());
    const row = ctx.getImageData(0, H / 2, W, 1).data;
    let x = -1;
    for (let i = 0; i < W; i++) if (row[i * 4]! > 200) {
      x = i;
      break;
    }
    const local = videoLocalTime(spec, t);
    frames.push({ t, want: Math.min(N - 1, Math.floor(local * FPS + 1e-6)), got: Math.round((x - 10) / 6) });
  }
  return { durationS: info.durationS, frames };
}

/** For the walkthrough: encodes the bar clip and hands it to the stage's
 *  video picker as if chosen from the camera roll. */
export async function pickVideo(): Promise<boolean> {
  const input = document.querySelector<HTMLInputElement>('input[data-pick="video"]');
  if (!input) return false;
  const file = new File([await barClip()], 'bars.mp4', { type: 'video/mp4' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

export interface ReadResult {
  meanFlowX: number;
  meanMotion: number;
  maskShare: number;
  realModels: { masks: number; maskSize: string; pose: boolean } | string;
  maskedBar: number;
  maskedElsewhere: number;
  unmaskedElsewhere: number;
  leadMoves: [number, number];
}

/** The read: a fake person (the bar) for exact checks, then the real
 *  models once to prove they load and answer at the right sizes. */
export async function runVideoRead(): Promise<ReadResult> {
  const { analyzeVideo, mediapipeModels, rememberTracks } = await import('../media/videoAnalysis');
  const { poseToSamples } = await import('../engine/video');
  const { createShowSim } = await import('../engine/show');
  const clip = await barClip();
  const info = (await probeVideo(clip))!;
  const brightest = (frame: OffscreenCanvas) => {
    const d = frame.getContext('2d')!.getImageData(0, frame.height / 2, frame.width, 1).data;
    for (let i = 0; i < frame.width; i++) if (d[i * 4]! > 200) return i / frame.width;
    return -1;
  };
  const fake = {
    segment: (frame: OffscreenCanvas) => {
      const d = frame.getContext('2d')!.getImageData(0, 0, frame.width, frame.height).data;
      const out = new Float32Array(frame.width * frame.height);
      for (let k = 0; k < out.length; k++) out[k] = d[k * 4]! > 128 ? 1 : 0;
      return out;
    },
    landmarks: (frame: OffscreenCanvas) => {
      const x = brightest(frame);
      const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
      if (x >= 0) lm[16] = { x, y: 0.5, visibility: 1 };
      return lm;
    },
  };
  const tracks = await analyzeVideo(clip, info.durationS, fake);
  const avg = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  let lit = 0;
  let all = 0;
  for (const f of tracks.masks!.frames) {
    for (const v of f) {
      all++;
      if (v > 128) lit++;
    }
  }

  let realModels: ReadResult['realModels'];
  try {
    const real = await analyzeVideo(clip, info.durationS, await mediapipeModels({ masks: true, pose: true }));
    realModels = {
      masks: real.masks?.frames.length ?? 0,
      maskSize: real.masks ? `${real.masks.w}x${real.masks.h}` : 'none',
      pose: !!real.pose && real.pose.rightHand.length === real.motion.length * 3,
    };
  } catch (err) {
    realModels = String(err).slice(0, 80);
  }

  // Masked: the clip shows only where the read found its "person".
  rememberTracks('e2e-read', tracks);
  const sheet = { type: 'video' as const, assetId: 'e2e-bars.mp4', durationS: info.durationS, at: 0, w: 1, h: 1, analysisId: 'e2e-read' };
  await loadVideos([sheet], async () => clip);
  const W = 320;
  const H = 180;
  const drawAt = (masked: boolean, t: number) => {
    const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
    const project: Project = {
      version: RECIPE_VERSION,
      id: 'masked',
      title: 'masked',
      createdAt: '2026-10-01T00:00:00.000Z',
      seed: 1,
      events: [{ kind: 'CAST', id: 'c', at: 0, puppetId: 'v', puppet: { ...sheet, masked }, x: 0.5, y: 0.5, scale: 1, rot: 0 }],
    };
    createRenderer2d().draw(ctx, W, H, createFramer(project, undefined, { trails: false }).frameAt(t), new Map());
    return ctx.getImageData(0, 0, W, H).data;
  };
  const t = 0.4;
  await videosReadyAt([sheet], t);
  const masked = drawAt(true, t);
  const unmasked = drawAt(false, t);
  const row = Math.floor(H / 2) * W * 4;
  let barX = 0;
  for (let i = 0; i < W; i++) if (unmasked[row + i * 4]! > 200) {
    barX = i;
    break;
  }
  const px = (d: Uint8ClampedArray, x: number) => d[row + x * 4]!;

  // Lead: the hand's track as a pass on a card; the card travels right.
  const samples = poseToSamples(sheet, tracks, 'rightHand', { x: 0.5, y: 0.5, w: 1, h: 1, rot: 0 });
  const led: Project = {
    version: RECIPE_VERSION,
    id: 'led',
    title: 'led',
    createdAt: '2026-10-01T00:00:00.000Z',
    seed: 1,
    events: [
      { kind: 'CAST', id: 'k', at: 0, puppetId: 'card', puppet: { type: 'rect', color: '#fff', w: 0.1, h: 0.1 }, x: 0.2, y: 0.5, scale: 1, rot: 0 },
      { kind: 'PASS', id: 'p', at: samples[0]!, puppetId: 'card', samples, via: 'video' },
    ],
  };
  const sim = createShowSim(led);
  const x1 = sim.advanceTo(0.4).get('card')!.root.x;
  const x2 = sim.advanceTo(1.3).get('card')!.root.x;

  return {
    meanFlowX: avg(tracks.flowx),
    meanMotion: avg(tracks.motion),
    maskShare: lit / Math.max(1, all),
    realModels,
    maskedBar: px(masked, barX + 1),
    maskedElsewhere: px(masked, barX + 60 < W ? barX + 60 : barX - 60),
    unmaskedElsewhere: px(unmasked, barX + 60 < W ? barX + 60 : barX - 60),
    leadMoves: [x1, x2],
  };
}
