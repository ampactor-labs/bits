// The camera, in pixels. Two sheets at different depths and a backdrop;
// a recorded pan moves the camera; the frame is drawn the way the export
// draws it. Far sheets must slide less than near ones, by f / (f + depth),
// and the backdrop must never open onto the void behind it.

import { CAMERA_ID, FOCAL } from '../engine/camera';
import { createFramer } from '../engine/frame';
import type { Project, RecipeEvent } from '../engine/recipe';
import { createRenderer2d, STAGE_BG } from '../media/stageDraw';
import { fixtureImages } from './fixtures';

export interface CameraResult {
  /** How far the camera panned, in pixels at the stage plane. */
  pan: number;
  /** How far each sheet slid on screen. */
  nearSlide: number;
  farSlide: number;
  /** What the projection says the far one should slide. */
  farExpected: number;
  /** Share of pixels showing the bare stage colour, at rest and panned. */
  voidAtRest: number;
  voidPanned: number;
  /** True when a show with no camera passes draws no camera at all. */
  restIsNull: boolean;
}

const W = 360;
const H = 640;
const FAR = 3;

function cameraProject(withPan: boolean): Project {
  const cast = (id: string, color: string, x: number, y: number, depth: number): RecipeEvent => ({
    kind: 'CAST',
    id: `c-${id}`,
    at: 0,
    puppetId: id,
    puppet: { type: 'rect', color, w: 0.12, h: 0.08 },
    x,
    y,
    scale: 1,
    rot: 0,
    ...(depth ? { depth } : {}),
  });
  const samples: number[] = [];
  for (let i = 0; i <= 10; i++) samples.push(0.1 + i * 0.05, 0.5 + 0.012 * i, 0.5);
  return {
    version: 3,
    id: 'camera',
    title: 'camera',
    createdAt: '2026-10-01T00:00:00.000Z',
    seed: 7,
    events: [
      {
        kind: 'CAST',
        id: 'c-sky',
        at: 0,
        puppetId: 'sky',
        puppet: { type: 'cutout', assetId: 'fixture-sky.png', w: 1, h: 1, fit: 'cover' },
        x: 0.5,
        y: 0.5,
        scale: 1,
        rot: 0,
        back: true,
        depth: FAR,
      },
      cast('near', '#ff00ff', 0.7, 0.4, 0),
      cast('far', '#00ff00', 0.4, 0.6, FAR),
      ...(withPan
        ? [{ kind: 'PASS', id: 'pan', at: 0.1, puppetId: CAMERA_ID, samples } as RecipeEvent]
        : []),
    ],
  };
}

/** Mean x of the pixels that are exactly this colour, or NaN. */
function centroidX(data: Uint8ClampedArray, rgb: [number, number, number]): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === rgb[0] && data[i + 1] === rgb[1] && data[i + 2] === rgb[2]) {
      sum += (i / 4) % W;
      n++;
    }
  }
  return n ? sum / n : NaN;
}

function voidShare(data: Uint8ClampedArray): number {
  const bg = parseInt(STAGE_BG.slice(1), 16);
  const [r, g, b] = [(bg >> 16) & 255, (bg >> 8) & 255, bg & 255];
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === r && data[i + 1] === g && data[i + 2] === b) n++;
  }
  return n / (data.length / 4);
}

export async function runCamera(): Promise<CameraResult> {
  const fixture = await fixtureImages();
  const images = new Map([['sky', fixture.get('sky')!]]);
  const draw = (project: Project, t: number) => {
    const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
    const framer = createFramer(project, undefined, { trails: false });
    const frame = framer.frameAt(t);
    createRenderer2d().draw(ctx, W, H, frame, images);
    return { data: ctx.getImageData(0, 0, W, H).data, camera: frame.camera };
  };
  // Long after the pass, so the camera's spring has settled on its end.
  const rest = draw(cameraProject(false), 2);
  const panned = draw(cameraProject(true), 2);
  const pan = ((panned.camera?.x ?? 0.5) - 0.5) * W;
  const near = centroidX(panned.data, [255, 0, 255]) - centroidX(rest.data, [255, 0, 255]);
  const far = centroidX(panned.data, [0, 255, 0]) - centroidX(rest.data, [0, 255, 0]);
  return {
    pan,
    nearSlide: near,
    farSlide: far,
    farExpected: -pan * (FOCAL / (FOCAL + FAR)),
    voidAtRest: voidShare(rest.data),
    voidPanned: voidShare(panned.data),
    restIsNull: rest.camera === null,
  };
}
