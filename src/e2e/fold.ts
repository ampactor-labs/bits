// Folds, in pixels. A magenta card with a cut down its right quarter: laid
// flat it is the whole card; bent, the flap is shorter and darker; folded
// right over, it lies on the card showing the paper's plain back, and
// where it was is bare stage.

import { createFramer } from '../engine/frame';
import { RECIPE_VERSION, type Project, type RecipeEvent } from '../engine/recipe';
import { createRenderer2d } from '../media/stageDraw';

export interface FoldResult {
  /** RGB at a point on the card, by case and by where across it. */
  flat: number[][];
  bent: number[][];
  over: number[][];
}

const W = 360;
const H = 640;
/** Across the card, in its own 0..1: on the card, on the flap near its
 *  line, and at the flap's far edge. */
export const FOLD_PROBES = [0.62, 0.8, 0.95];

export function foldProject(angle: number | null, wired = false): Project {
  const events: RecipeEvent[] = [
    {
      kind: 'CAST',
      id: 'c-card',
      at: 0,
      puppetId: 'card',
      puppet: { type: 'rect', color: '#ff00ff', w: 0.4, h: 0.3 },
      x: 0.5,
      y: 0.5,
      scale: 1,
      rot: 0,
    },
    { kind: 'SNIP', id: 's', at: 0, puppetId: 'card', x0: 0.75, y0: 0, x1: 0.75, y1: 1 },
  ];
  if (angle !== null)
    events.push({ kind: 'FOLD', id: 'f', at: 0, puppetId: 'card', snip: 0, angle });
  if (wired) {
    events.push({
      kind: 'WIRE',
      id: 'w',
      at: 0,
      puppetId: 'card',
      from: 'lfo:0.5',
      to: 'fold',
      amount: 1,
    });
  }
  return {
    version: RECIPE_VERSION,
    id: 'fold',
    title: 'fold',
    createdAt: '2026-10-01T00:00:00.000Z',
    seed: 5,
    events,
  };
}

export async function runFold(): Promise<FoldResult> {
  const probe = (angle: number | null) => {
    const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
    createRenderer2d().draw(
      ctx,
      W,
      H,
      createFramer(foldProject(angle), undefined, { trails: false }).frameAt(0),
      new Map(),
    );
    return FOLD_PROBES.map((u) => {
      const x = Math.round((0.5 + (u - 0.5) * 0.4) * W);
      const d = ctx.getImageData(x, H / 2, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!];
    });
  };
  return { flat: probe(0), bent: probe(1), over: probe(Math.PI) };
}
