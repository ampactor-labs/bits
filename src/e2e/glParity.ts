// The WebGL2 renderer against the canvas renderer: the same frames of the
// same fixtures, drawn both ways in order (trails accumulate the same way),
// compared pixel by pixel. They cannot be byte-identical (the GL path
// resamples each sheet's sprite once more), so the proof bounds how many
// pixels differ visibly and by how much on average.

import { CAMERA_ID } from '../engine/camera';
import { createFramer } from '../engine/frame';
import type { Project, RecipeEvent } from '../engine/recipe';
import { createRenderer2d } from '../media/stageDraw';
import { createGlRenderer } from '../render/gl/glRenderer';
import { fixtureAnalysis, fixtureImages, fixtureProject } from './fixtures';
import { dice } from '../engine/ink';
import { harmony, PAPER_PRESETS } from '../engine/grade';

export interface GlParityResult {
  available: boolean;
  renderer: string;
  /** Mean channel difference a palette and paper make to a frame: the
   *  grade is really on, not skipped by both renderers alike. */
  gradeEffect: number;
  scenes: { name: string; frames: number; worstVisible: number; worstMean: number }[];
}

const W = 360;
const H = 640;

/** The fixture with the camera moving, the sky pushed back, and a look. */
function lookedFixture(): Project {
  const base = fixtureProject();
  const samples: number[] = [];
  for (let i = 0; i <= 20; i++) samples.push(0.3 + i * 0.15, 0.5 + 0.08 * Math.sin(i / 3), 0.5);
  const dolly: number[] = [];
  for (let i = 0; i <= 20; i++) dolly.push(0.3 + i * 0.15, 0.4 * (i / 20), 0);
  return {
    ...base,
    events: [
      ...base.events.map((e) =>
        e.kind === 'CAST' && e.puppetId === 'sky' ? { ...e, depth: 3 } : e,
      ),
      { kind: 'PASS', id: 'cam-pan', at: 0.3, puppetId: CAMERA_ID, samples } as RecipeEvent,
      { kind: 'PASS', id: 'cam-z', at: 0.3, puppetId: CAMERA_ID, samples: dolly, prop: 'z' } as RecipeEvent,
      { kind: 'LOOK', id: 'look', at: 0, puppetId: '', shadow: 0.5, fog: 0.4 } as RecipeEvent,
    ],
  };
}

/** The fixture printed: a palette and newsprint paper. */
function gradedFixture(): Project {
  const base = fixtureProject();
  return {
    ...base,
    events: [
      ...base.events,
      {
        kind: 'LOOK',
        id: 'graded',
        at: 0,
        puppetId: '',
        palette: { colors: harmony('complement', 200), mix: 0.85 },
        paper: PAPER_PRESETS.newsprint,
      } as RecipeEvent,
    ],
  };
}

/** The fixture with an ink sheet and the floor strip dressed in ink. */
function inkedFixture(): Project {
  const base = fixtureProject();
  return {
    ...base,
    events: [
      ...base.events,
      {
        kind: 'CAST',
        id: 'ink-sheet',
        at: 0,
        puppetId: 'swatch',
        puppet: { type: 'ink', genome: dice(17), w: 0.4, h: 0.22 },
        x: 0.3,
        y: 0.3,
        scale: 1,
        rot: 0.2,
      } as RecipeEvent,
      { kind: 'INK', id: 'dress', at: 0, puppetId: 'bg', genome: dice(23) } as RecipeEvent,
    ],
  };
}

export async function runGlParity(): Promise<GlParityResult> {
  const images = await fixtureImages();
  const probe = new OffscreenCanvas(W, H);
  const first = createGlRenderer(probe);
  if (!first) return { available: false, renderer: 'none', gradeEffect: 0, scenes: [] };
  const glCtx = probe.getContext('webgl2')!;
  const info = glCtx.getExtension('WEBGL_debug_renderer_info');
  const renderer = info ? String(glCtx.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  first.dispose();

  const scene = (name: string, project: Project) => {
    const analysis = fixtureAnalysis();
    const flat = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
    const r2d = createRenderer2d();
    const glCanvas = new OffscreenCanvas(W, H);
    const gl = createGlRenderer(glCanvas)!;
    const a = createFramer(project, analysis);
    const b = createFramer(project, analysis);
    let worstVisible = 0;
    let worstMean = 0;
    let frames = 0;
    for (let i = 0; i < 120; i++) {
      const t = (i + 0.5) / 30;
      r2d.draw(flat, W, H, a.frameAt(t), images);
      gl.draw(W, H, b.frameAt(t), images);
      if (i % 10 !== 9) continue;
      frames++;
      const want = flat.getImageData(0, 0, W, H).data;
      const got = gl.readPixels(W, H);
      let visible = 0;
      let sum = 0;
      for (let p = 0; p < want.length; p += 4) {
        const d = Math.max(
          Math.abs(want[p]! - got[p]!),
          Math.abs(want[p + 1]! - got[p + 1]!),
          Math.abs(want[p + 2]! - got[p + 2]!),
        );
        sum += d;
        if (d > 40) visible++;
      }
      worstVisible = Math.max(worstVisible, visible / (W * H));
      worstMean = Math.max(worstMean, sum / (W * H));
    }
    gl.dispose();
    return { name, frames, worstVisible, worstMean };
  };

  const still = (project: Project) => {
    const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
    createRenderer2d().draw(ctx, W, H, createFramer(project, fixtureAnalysis(), { trails: false }).frameAt(2), images);
    return ctx.getImageData(0, 0, W, H).data;
  };
  const plain = still(fixtureProject());
  const graded = still(gradedFixture());
  let gradeSum = 0;
  for (let p = 0; p < plain.length; p += 4) gradeSum += Math.abs(plain[p]! - graded[p]!);
  const gradeEffect = gradeSum / (W * H);

  return {
    available: true,
    renderer,
    gradeEffect,
    scenes: [
      scene('fixture', fixtureProject()),
      scene('camera and look', lookedFixture()),
      scene('inks', inkedFixture()),
      scene('palette and paper', gradedFixture()),
    ],
  };
}

export interface SurfaceResult {
  /** What `?renderer=gl` gives an on-page canvas, and what auto picks here. */
  forced: string;
  auto: string;
  /** Distinct colours in the drawn frame: a blank canvas has one. */
  colours: number;
}

/** The stage's own path onto a real canvas element: asked for GL it draws
 *  with GL, and left to choose on a software GPU it picks the canvas. */
export async function runSurface(): Promise<SurfaceResult> {
  const { createSurface } = await import('../render/surface');
  const images = await fixtureImages();
  const make = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    document.body.appendChild(c);
    return c;
  };
  const forcedCanvas = make();
  const forced = createSurface(forcedCanvas, 'gl');
  const framer = createFramer(fixtureProject(), fixtureAnalysis());
  for (let i = 0; i < 30; i++) forced.draw(W, H, framer.frameAt((i + 0.5) / 30), images);
  const copy = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
  copy.drawImage(forcedCanvas, 0, 0);
  const data = copy.getImageData(0, 0, W, H).data;
  const seen = new Set<number>();
  for (let p = 0; p < data.length; p += 4 * 7) seen.add((data[p]! << 16) | (data[p + 1]! << 8) | data[p + 2]!);
  const autoCanvas = make();
  const auto = createSurface(autoCanvas, 'auto');
  const result = { forced: forced.kind, auto: auto.kind, colours: seen.size };
  forced.dispose();
  auto.dispose();
  forcedCanvas.remove();
  autoCanvas.remove();
  return result;
}
