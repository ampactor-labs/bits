// A busy little show with a fixed seed: every kind of sheet, a cut, a pin
// warp, a mouth and eyes, wires and trails. Built without any assets, so it
// renders the same in every browser session, which is what pixel checks
// need. The cutout's bitmap is painted here and handed over directly.

import { computeVoiceTrack } from '../engine/envelope';
import type { Analysis } from '../engine/frame';
import { RECIPE_VERSION, type Project, type RecipeEvent } from '../engine/recipe';

export const FIXTURE_SEED = 424242;
export const FIXTURE_DURATION_S = 4;

let n = 0;
const id = () => `fx${(n++).toString(16).padStart(6, '0')}`;

/** A pass that walks from one point to another over [t0, t1]. */
function walk(puppetId: string, t0: number, t1: number, from: [number, number], to: [number, number], extra: Partial<RecipeEvent> = {}): RecipeEvent {
  const samples: number[] = [];
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    const wob = Math.sin(u * Math.PI * 4) * 0.03;
    samples.push(t0 + (t1 - t0) * u, from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u + wob);
  }
  return { kind: 'PASS', id: id(), at: t0, puppetId, samples, ...extra } as RecipeEvent;
}

export function fixtureProject(): Project {
  n = 0;
  const events: RecipeEvent[] = [
    { kind: 'CAST', id: id(), at: 0, puppetId: 'sky', puppet: { type: 'cutout', assetId: 'fixture-sky.png', w: 1, h: 1 }, x: 0.5, y: 0.5, scale: 1, rot: 0, back: true },
    { kind: 'CAST', id: id(), at: 0, puppetId: 'bg', puppet: { type: 'rect', color: '#2b3a55', w: 0.9, h: 0.25 }, x: 0.5, y: 0.88, scale: 1, rot: 0 },
    { kind: 'CAST', id: id(), at: 0, puppetId: 'guy', puppet: { type: 'doodle', strokes: [[0.2, 0.1, 0.8, 0.1, 0.8, 0.9, 0.2, 0.9, 0.2, 0.1], [0.3, 0.6, 0.5, 0.75, 0.7, 0.6]], strokeStyle: [{ color: '#f0883e', width: 1.4 }, { color: '#ece5db', width: 1 }], w: 0.32, h: 0.22 }, x: 0.3, y: 0.6, scale: 1, rot: 0.1 },
    { kind: 'CAST', id: id(), at: 0, puppetId: 'cat', puppet: { type: 'cutout', assetId: 'fixture-cat.png', w: 0.3, h: 0.18 }, x: 0.65, y: 0.35, scale: 1.1, rot: -0.15, flip: true },
    { kind: 'CAST', id: id(), at: 0, puppetId: 'word', puppet: { type: 'text', text: 'bits!', w: 0.4, h: 0.08 }, x: 0.5, y: 0.15, scale: 1, rot: 0 },
    { kind: 'SNIP', id: id(), at: 0, puppetId: 'guy', x0: 0.0, y0: 0.35, x1: 1.0, y1: 0.3 },
    { kind: 'MOUTH', id: id(), at: 0, puppetId: 'guy', mx: 0.5, my: 0.7, size: 0.35 },
    { kind: 'EYES', id: id(), at: 0, puppetId: 'guy', ex: 0.5, ey: 0.45, size: 0.4 },
    { kind: 'PIN', id: id(), at: 0, puppetId: 'cat', px: 0.2, py: 0.3 },
    { kind: 'PIN', id: id(), at: 0, puppetId: 'cat', px: 0.8, py: 0.7 },
    { kind: 'MOUTH', id: id(), at: 0, puppetId: 'cat', mx: 0.6, my: 0.6, size: 0.3 },
    { kind: 'WIRE', id: id(), at: 0, puppetId: 'guy', source: 'voice', target: 'bounce', amount: 0.5 },
    { kind: 'WIRE', id: id(), at: 0, puppetId: 'cat', source: 'beat', target: 'shake', amount: 1 },
    { kind: 'WIRE', id: id(), at: 0, puppetId: 'word', source: 'on', target: 'lean', amount: 0.5 },
    { kind: 'WIRE', id: id(), at: 0, puppetId: '', source: 'on', target: 'trails', amount: 0.5 },
    walk('guy', 0.2, 2.2, [0.2, 0.7], [0.6, 0.55]),
    walk('guy', 1.0, 3.0, [0.4, 0.3], [0.6, 0.4], { piece: 0 } as Partial<RecipeEvent>),
    walk('cat', 0.5, 3.5, [0.65, 0.35], [0.4, 0.3]),
    walk('cat', 1.5, 3.2, [0.55, 0.32], [0.6, 0.22], { pin: 1 } as Partial<RecipeEvent>),
  ];
  return {
    version: RECIPE_VERSION,
    id: 'fixture',
    title: 'fixture',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    seed: FIXTURE_SEED,
    events,
  };
}

/** A talky, beaty analysis to go with it. */
export function fixtureAnalysis(): Analysis {
  const rate = 16000;
  const samples = new Float32Array(rate * FIXTURE_DURATION_S);
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    const syllable = Math.max(0, Math.sin(t * Math.PI * 3.1));
    samples[i] = syllable * 0.5 * Math.sin(2 * Math.PI * (180 + 60 * Math.sin(t * 5)) * t);
  }
  return {
    voice: computeVoiceTrack(samples, rate),
    onsets: [0.5, 1.1, 1.7, 2.3, 2.9, 3.5],
    voices: new Map(),
  };
}

/** The cat, painted: an orange blob with ears, enough shape to see a warp. */
export async function fixtureImages(): Promise<Map<string, ImageBitmap>> {
  const c = new OffscreenCanvas(120, 72);
  const x = c.getContext('2d')!;
  x.fillStyle = '#e39b4f';
  x.beginPath();
  x.ellipse(60, 42, 50, 26, 0, 0, Math.PI * 2);
  x.fill();
  x.beginPath();
  x.moveTo(22, 30);
  x.lineTo(30, 4);
  x.lineTo(44, 24);
  x.moveTo(76, 24);
  x.lineTo(90, 4);
  x.lineTo(98, 30);
  x.fill();
  x.fillStyle = '#3b2412';
  for (let i = 0; i < 5; i++) x.fillRect(30 + i * 14, 30, 5, 30);
  const sky = new OffscreenCanvas(64, 100);
  const g = sky.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 100);
  grad.addColorStop(0, '#6d8fb3');
  grad.addColorStop(1, '#e8d2a6');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 100);
  g.fillStyle = '#41506a';
  g.fillRect(8, 60, 12, 40);
  g.fillRect(40, 50, 16, 50);
  return new Map([
    ['cat', await createImageBitmap(c)],
    ['sky', await createImageBitmap(sky)],
  ]);
}
