// The frame builder against the hand-assembled path it replaced. Every
// frame of the fixture is drawn both ways onto two canvases, in order (so
// trails accumulate the same way), and must match byte for byte.

import { voiceAt } from '../engine/envelope';
import { createFramer, visualsOf, voiceMap, type Analysis } from '../engine/frame';
import type { Project } from '../engine/recipe';
import { castOf, createShowSim } from '../engine/show';
import { effectiveWires, trailStrength, wireModsFor, type WireMods } from '../engine/wires';
import { createRenderer2d, renderFrame2d, STAGE_BG } from '../media/stageDraw';
import { drawStage } from './legacy/stageDraw';
import {
  fixtureAnalysis,
  fixtureImages,
  fixtureProject,
  fixtureV1,
  FIXTURE_DURATION_S,
} from './fixtures';

export interface ParityResult {
  frames: number;
  /** Frames whose pixels differ at all. */
  mismatched: number;
  /** Largest per-channel difference seen. */
  maxDiff: number;
  /** The fixture actually moves and talks, so the check is not vacuous. */
  changedAcrossTime: number;
  mouthOpenFrames: number;
}

/** What preview and export did before the frame builder existed: the
 *  hand assembly, drawn by the frozen legacy renderer. */
function legacyDraw(
  ctx: OffscreenCanvasRenderingContext2D,
  W: number,
  H: number,
  project: Project,
  analysis: Analysis,
  sim: ReturnType<typeof createShowSim>,
  images: Map<string, ImageBitmap>,
  t: number,
): void {
  const cast = castOf(project);
  const visuals = visualsOf(project);
  const wires = effectiveWires(project);
  const poses = sim.advanceTo(t);
  const mods = new Map<string, WireMods>();
  for (const p of cast)
    mods.set(p.id, wireModsFor(wires, p.id, analysis.voice, analysis.onsets, t, project.seed));
  drawStage(
    ctx,
    W,
    H,
    cast,
    poses,
    images,
    visuals,
    voiceMap(project, visuals, analysis.voice, t, analysis.voices),
    t,
    project.seed,
    mods,
    trailStrength(wires, analysis.voice, analysis.onsets, t),
  );
}

export async function runFrameParity(): Promise<ParityResult> {
  const W = 180;
  const H = 320;
  const fps = 30;
  // The legacy side reads the file as v1 saved it; today's side reads it
  // migrated, as the app would open it.
  const legacy = fixtureV1();
  const project = fixtureProject();
  const analysis = fixtureAnalysis();
  const images = await fixtureImages();

  const a = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
  const b = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
  for (const c of [a, b]) {
    c.fillStyle = STAGE_BG;
    c.fillRect(0, 0, W, H);
  }
  const sim = createShowSim(legacy);
  const framer = createFramer(project, analysis);
  // The renderer the export uses, frame-rate-aware trails and all: at the
  // film's 30 fps it must draw exactly what the old path drew.
  const renderer = createRenderer2d();

  let mismatched = 0;
  let maxDiff = 0;
  let changedAcrossTime = 0;
  let mouthOpenFrames = 0;
  let first: Uint8ClampedArray | null = null;
  const frames = Math.round(FIXTURE_DURATION_S * fps);
  for (let i = 0; i < frames; i++) {
    const t = (i + 0.5) / fps;
    legacyDraw(a, W, H, legacy, analysis, sim, images, t);
    const frame = framer.frameAt(t);
    renderer.draw(b, W, H, frame, images);
    if (voiceAt(analysis.voice, t).open > 0 && frame.layers.some((l) => l.voice.open > 0)) {
      mouthOpenFrames += 1;
    }
    const da = a.getImageData(0, 0, W, H).data;
    const db = b.getImageData(0, 0, W, H).data;
    let worst = 0;
    for (let k = 0; k < da.length; k++) worst = Math.max(worst, Math.abs(da[k]! - db[k]!));
    if (worst > 0) mismatched += 1;
    maxDiff = Math.max(maxDiff, worst);
    if (!first) first = da.slice();
    else {
      let diff = 0;
      for (let k = 0; k < da.length; k += 4) if (da[k] !== first[k]) diff += 1;
      if (diff > (W * H) / 50) changedAcrossTime += 1;
    }
  }
  for (const img of images.values()) img.close();
  return { frames, mismatched, maxDiff, changedAcrossTime, mouthOpenFrames };
}

/** Stills of the fixture as PNG data URLs, for looking at. Frames between
 *  the requested times are drawn too, so trails look as they would. */
export async function peekFixture(times: number[], W = 360, H = 640): Promise<string[]> {
  const project = fixtureProject();
  const framer = createFramer(project, fixtureAnalysis());
  const images = await fixtureImages();
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  const out: string[] = [];
  const sorted = [...times].sort((x, y) => x - y);
  let t = 1 / 60;
  for (const want of sorted) {
    for (; t < want; t += 1 / 30) renderFrame2d(ctx, W, H, framer.frameAt(t), images);
    renderFrame2d(ctx, W, H, framer.frameAt(want), images);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    out.push(
      await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.readAsDataURL(blob);
      }),
    );
  }
  return out;
}

export interface TrailRateResult {
  /** How much of a ghost is left 0.3 s after its sheet vanished, at 30 and
   *  at 60 fps, with trails that fade by elapsed time. */
  byTime: [number, number];
  /** The same with the old per-frame fade. */
  byFrame: [number, number];
}

/** A white card sits on the stage with trails on, then vanishes; how much
 *  of its ghost is left 0.3 s later should not depend on the frame rate. */
export async function runTrailRate(): Promise<TrailRateResult> {
  const W = 64;
  const H = 64;
  const project = fixtureProject();
  const card = castOf({
    ...project,
    events: [
      {
        kind: 'CAST',
        id: 'card',
        at: 0,
        puppetId: 'card',
        puppet: { type: 'rect', color: '#ffffff', w: 0.5, h: 0.5 },
        x: 0.5,
        y: 0.5,
        scale: 1,
        rot: 0,
      },
    ],
  })[0]!;
  const visual = {
    pieces: {
      root: {
        poly: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ] as [number, number][],
        joint: null,
        snipIndex: -1,
      },
      children: [],
    },
    mouth: null,
    eyes: null,
    pins: [],
  };
  const still = {
    root: { x: 0.5, y: 0.5, vx: 0, vy: 0, angle: 0, squash: 0 },
    dangles: [],
    pins: [],
  };
  const ident = { scaleMul: 1, dx: 0, dy: 0, dAngle: 0 };
  const run = (fps: number, byTime: boolean) => {
    const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = STAGE_BG;
    ctx.fillRect(0, 0, W, H);
    const renderer = createRenderer2d();
    let t = 0.5;
    const draw = (shown: boolean) => {
      const frame = {
        t,
        seed: 1,
        trail: 0.8,
        layers: shown
          ? [{ puppet: card, pose: still, visual, voice: { open: 0, shape: 0 }, mods: ident }]
          : [],
      };
      if (byTime) renderer.draw(ctx, W, H, frame, new Map());
      else renderFrame2d(ctx, W, H, frame, new Map());
    };
    for (; t < 1; t += 1 / fps) draw(true);
    for (; t < 1.3; t += 1 / fps) draw(false);
    return ctx.getImageData(W / 2, H / 2, 1, 1).data[0]! - 16;
  };
  return {
    byTime: [run(30, true), run(60, true)],
    byFrame: [run(30, false), run(60, false)],
  };
}
