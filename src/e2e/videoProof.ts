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
