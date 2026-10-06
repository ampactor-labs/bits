// Ink: textures you grow rather than paint. An ink is a genome, a short
// list of operations with every parameter in 0..1, and the same genome at
// the same moment always gives the same pixels. It is computed here, on
// the CPU, at a small fixed size and drawn smoothly scaled: one
// implementation that preview, film, Canvas2D and WebGL all share, so an
// ink can never look different in the film than it did on the stage. The
// soft upscale is part of the look: printed, not rendered.
//
// The genome is stored whole in the recipe (never "parent seed + child
// index"), so a bit keeps its inks when breeding changes.

import { boilNoise } from './puppet';

export const INK_OPS = [
  'noise',
  'stripes',
  'cells',
  'warp',
  'kaleido',
  'posterize',
  'halftone',
  'palette',
  'feedback',
] as const;
export type InkOp = (typeof INK_OPS)[number];

export interface InkStep {
  op: InkOp;
  /** Every parameter normalised to 0..1. */
  p: number[];
}

export interface Genome {
  seed: number;
  ops: InkStep[];
}

/** How many parameters each op reads. */
export const PARAMS: Record<InkOp, number> = {
  noise: 4, // scale, speed, octaves, mix
  stripes: 4, // frequency, angle, speed, mix
  cells: 4, // count, jitter, speed, mix
  warp: 3, // amount, scale, speed
  kaleido: 2, // segments, spin
  posterize: 1, // levels
  halftone: 2, // cell, angle
  palette: 6, // hue, spread, cycle, contrast, warmth, speed
  feedback: 3, // amount, zoom, turn
};

/** Coordinate ops run first, colour last; the order within each kind is
 *  what the genome says. */
const KIND: Record<InkOp, 0 | 1 | 2 | 3> = {
  warp: 0,
  kaleido: 0,
  noise: 1,
  stripes: 1,
  cells: 1,
  posterize: 2,
  halftone: 2,
  palette: 3,
  feedback: 3,
};

/** The side of an ink's pixel grid. */
export const INK_SIZE = 96;
/** Feedback steps on a fixed 30 Hz grid, like trails, so it cannot depend
 *  on the frame rate; a seek warms it up from this far back. */
export const INK_TICK = 1 / 30;
export const INK_WARMUP_S = 2;

// --- seeded randomness ----------------------------------------------------

/** A small seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed for child `i` of generation `gen` of a family. */
export const childSeed = (seed: number, gen: number, i: number): number =>
  (Math.imul(seed ^ 0x9e3779b9, 31) ^ Math.imul(gen + 1, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35)) >>> 0;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const gauss = (r: () => number) => {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};

// --- making genomes -------------------------------------------------------

const step = (op: InkOp, r: () => number): InkStep => ({
  op,
  p: Array.from({ length: PARAMS[op] }, () => Math.round(r() * 1000) / 1000),
});

/** Weighted templates: what a roll can come out as. Every one ends in a
 *  palette, so a roll is never grey. */
const TEMPLATES: { weight: number; ops: (InkOp | InkOp[])[] }[] = [
  { weight: 3, ops: ['noise', 'palette'] },
  { weight: 3, ops: ['warp', 'noise', 'palette'] },
  { weight: 2, ops: ['stripes', ['warp', 'kaleido'], 'palette'] },
  { weight: 2, ops: ['kaleido', 'cells', 'posterize', 'palette'] },
  { weight: 2, ops: ['warp', 'cells', 'noise', 'palette'] },
  { weight: 1, ops: ['noise', 'halftone', 'palette'] },
  { weight: 2, ops: ['warp', 'stripes', 'palette', 'feedback'] },
  { weight: 1, ops: ['kaleido', 'noise', 'stripes', 'posterize', 'palette', 'feedback'] },
];

/** A fresh ink from nothing but a seed. */
export function dice(seed: number): Genome {
  const r = rng(seed);
  const total = TEMPLATES.reduce((n, t) => n + t.weight, 0);
  let pick = r() * total;
  let tpl = TEMPLATES[0]!;
  for (const t of TEMPLATES) {
    pick -= t.weight;
    if (pick <= 0) {
      tpl = t;
      break;
    }
  }
  const ops = tpl.ops.map((o) => step(Array.isArray(o) ? o[Math.floor(r() * o.length)]! : o, r));
  return { seed, ops: normalise(ops) };
}

/** Keep 2..6 steps, in kind order, with exactly one palette. */
function normalise(ops: InkStep[]): InkStep[] {
  let out = ops.filter((s) => s.op !== 'palette');
  const palette = ops.find((s) => s.op === 'palette');
  out = out.slice(0, 5);
  out.push(palette ?? { op: 'palette', p: [0.5, 0.5, 0.5, 0.5, 0.5, 0.2] });
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => KIND[a.s.op] - KIND[b.s.op] || a.i - b.i)
    .map(({ s }) => s);
}

/** A child: every parameter nudged, sometimes a step swapped for another
 *  of its kind, sometimes one added or taken away. */
export function mutate(parent: Genome, seed: number): Genome {
  const r = rng(seed);
  let ops = parent.ops.map((s) => ({
    op: s.op,
    p: s.p.map((v) => Math.round(clamp01(v + gauss(r) * 0.12) * 1000) / 1000),
  }));
  ops = ops.map((s) => {
    if (s.op === 'palette' || r() >= 0.15) return s;
    const kin = INK_OPS.filter((o) => KIND[o] === KIND[s.op] && o !== s.op && o !== 'palette');
    if (kin.length === 0) return s;
    return step(kin[Math.floor(r() * kin.length)]!, r);
  });
  if (r() < 0.1 && ops.length < 6) {
    const choices = INK_OPS.filter((o) => o !== 'palette');
    ops.push(step(choices[Math.floor(r() * choices.length)]!, r));
  } else if (r() < 0.1 && ops.length > 2) {
    const removable = ops.map((s, i) => (s.op === 'palette' ? -1 : i)).filter((i) => i >= 0);
    ops.splice(removable[Math.floor(r() * removable.length)]!, 1);
  }
  return { seed: (parent.seed ^ seed) >>> 0, ops: normalise(ops) };
}

/** Two parents, slot by slot. */
export function cross(a: Genome, b: Genome, seed: number): Genome {
  const r = rng(seed);
  const n = Math.max(a.ops.length, b.ops.length);
  const ops: InkStep[] = [];
  for (let i = 0; i < n; i++) {
    const pick = r() < 0.5 ? a.ops[i] ?? b.ops[i] : b.ops[i] ?? a.ops[i];
    if (pick) ops.push({ op: pick.op, p: [...pick.p] });
  }
  return { seed: (a.seed ^ b.seed ^ seed) >>> 0, ops: normalise(ops) };
}

/** Null when it is a genome; the reason when it is not. */
export function genomeProblem(g: unknown): string | null {
  if (typeof g !== 'object' || g === null) return 'not an object';
  const { seed, ops } = g as Genome;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0) return 'seed';
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > 6) return 'ops';
  for (const s of ops) {
    if (!s || !INK_OPS.includes(s.op)) return 'op';
    if (!Array.isArray(s.p) || s.p.length !== PARAMS[s.op]) return 'params';
    if (!s.p.every((v) => typeof v === 'number' && v >= 0 && v <= 1)) return 'param range';
  }
  return null;
}

// --- drawing --------------------------------------------------------------

/** Smooth value noise in 0..1 from the seed. */
function vnoise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (i: number, j: number) => 0.5 + 0.5 * boilNoise(seed, i & 1023, (j & 1023) * 1031 + 7);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** The colour one genome gives one pixel at time t, before feedback. */
function shade(g: Genome, u0: number, v0: number, t: number): [number, number, number] {
  let x = u0 - 0.5;
  let y = v0 - 0.5;
  let f = 0.5;
  let first = true;
  let pal: number[] | null = null;
  for (const s of g.ops) {
    const p = s.p;
    switch (s.op) {
      case 'warp': {
        const sc = 1 + p[1]! * 6;
        const amt = p[0]! * 0.35;
        const tt = t * p[2]! * 0.6;
        const wx = vnoise(g.seed + 11, x * sc + tt, y * sc) - 0.5;
        const wy = vnoise(g.seed + 23, x * sc, y * sc - tt) - 0.5;
        x += wx * amt * 2;
        y += wy * amt * 2;
        break;
      }
      case 'kaleido': {
        const n = 2 + Math.floor(p[0]! * 8);
        const r = Math.hypot(x, y);
        let a = Math.atan2(y, x) + t * (p[1]! - 0.5) * 0.8;
        const wedge = (Math.PI * 2) / n;
        a = Math.abs(((a % wedge) + wedge) % wedge - wedge / 2);
        x = r * Math.cos(a);
        y = r * Math.sin(a);
        break;
      }
      case 'noise':
      case 'stripes':
      case 'cells': {
        let v: number;
        if (s.op === 'noise') {
          const sc = 1.5 + p[0]! * 10;
          const oct = 1 + Math.floor(p[2]! * 3.99);
          const tt = t * p[1]! * 0.5;
          let amp = 1;
          let sum = 0;
          let norm = 0;
          let fq = 1;
          for (let o = 0; o < oct; o++) {
            sum += amp * vnoise(g.seed + o * 101, x * sc * fq + tt, y * sc * fq + tt * 0.7);
            norm += amp;
            amp *= 0.5;
            fq *= 2;
          }
          v = sum / norm;
        } else if (s.op === 'stripes') {
          const fq = 2 + p[0]! * 30;
          const ang = p[1]! * Math.PI;
          const d = x * Math.cos(ang) + y * Math.sin(ang);
          v = 0.5 + 0.5 * Math.sin(2 * Math.PI * (d * fq - t * p[2]! * 1.5));
        } else {
          const n = 2 + p[0]! * 10;
          const jit = p[1]!;
          const tt = t * p[2]! * 0.4;
          const cx = (x + 0.5) * n;
          const cy = (y + 0.5) * n;
          const ix = Math.floor(cx);
          const iy = Math.floor(cy);
          let best = 9;
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              const kx = ix + i;
              const ky = iy + j;
              // One hash per cell: where its point sits and which way it
              // circles.
              const ph = 3.1416 * boilNoise(g.seed + 37, kx & 1023, (ky & 1023) * 1031);
              const ox = 0.5 + jit * 0.45 * Math.sin(tt + ph * 2);
              const oy = 0.5 + jit * 0.45 * Math.cos(tt * 1.3 + ph * 3);
              best = Math.min(best, Math.hypot(kx + ox - cx, ky + oy - cy));
            }
          }
          v = Math.min(1, best);
        }
        const mix = first ? 1 : p[3]!;
        f = f * (1 - mix) + v * mix;
        first = false;
        break;
      }
      case 'posterize': {
        const levels = 2 + Math.floor(p[0]! * 6);
        f = Math.floor(f * levels) / (levels - 1);
        break;
      }
      case 'halftone': {
        const cell = 0.02 + p[0]! * 0.08;
        const ang = p[1]! * Math.PI;
        const rx = x * Math.cos(ang) - y * Math.sin(ang);
        const ry = x * Math.sin(ang) + y * Math.cos(ang);
        const gx = (((rx / cell) % 1) + 1) % 1 - 0.5;
        const gy = (((ry / cell) % 1) + 1) % 1 - 0.5;
        f = Math.hypot(gx, gy) < Math.sqrt(f) * 0.5 ? 1 : 0;
        break;
      }
      case 'palette':
        pal = p;
        break;
      case 'feedback':
        break;
    }
  }
  f = Math.min(1, Math.max(0, f));
  const q = pal ?? [0.5, 0.5, 0.5, 0.5, 0.5, 0.2];
  // A cosine palette (a + b·cos 2π(c·f + d)), with the hue walking slowly
  // when the palette asks to.
  const contrast = 0.25 + q[3]! * 0.3;
  const cyc = 0.5 + q[2]! * 1.5;
  const hue = q[0]! + t * (q[5]! - 0.5) * 0.1;
  const spread = 0.15 + q[1]! * 0.5;
  const warm = q[4]! - 0.5;
  const ch = (k: number) =>
    Math.min(1, Math.max(0, 0.5 + warm * (0.2 - k * 0.2) + contrast * Math.cos(2 * Math.PI * (cyc * f + hue + k * spread))));
  return [ch(0), ch(1), ch(2)];
}

/** Shading is the costly part, so it happens on a slower grid than the
 *  frames: a slice every quarter second, with the frames between cross-
 *  faded. Fields drift slowly; nobody sees the difference, and an ink
 *  costs a few percent of a phone instead of most of it. */
export const INK_SLICE_S = 0.25;

/** The genome shaded at one moment, RGB in 0..1, no feedback. */
export function inkSlice(g: Genome, t: number): Float32Array {
  const N = INK_SIZE;
  const out = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const [r, gg, b] = shade(g, (i + 0.5) / N, (j + 0.5) / N, t);
      const k = (j * N + i) * 3;
      out[k] = r;
      out[k + 1] = gg;
      out[k + 2] = b;
    }
  }
  return out;
}

/** One frame: two slices cross-faded at `u`, then the previous frame
 *  folded back in, a little zoomed and turned, when the genome feeds back. */
export function inkFrame(
  g: Genome,
  a: Float32Array,
  b: Float32Array,
  u: number,
  prev: Uint8ClampedArray | null,
): Uint8ClampedArray {
  const N = INK_SIZE;
  const out = new Uint8ClampedArray(N * N * 4);
  const fb = g.ops.find((s) => s.op === 'feedback');
  const amount = fb && prev ? 0.5 + fb.p[0]! * 0.42 : 0;
  const zoom = fb ? 1 - (fb.p[1]! - 0.5) * 0.06 : 1;
  const turn = fb ? (fb.p[2]! - 0.5) * 0.1 : 0;
  const cz = Math.cos(turn) * zoom;
  const sz = Math.sin(turn) * zoom;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const q = (j * N + i) * 3;
      let r = a[q]! + (b[q]! - a[q]!) * u;
      let gg = a[q + 1]! + (b[q + 1]! - a[q + 1]!) * u;
      let bb = a[q + 2]! + (b[q + 2]! - a[q + 2]!) * u;
      if (amount > 0 && prev) {
        const dx = (i + 0.5) / N - 0.5;
        const dy = (j + 0.5) / N - 0.5;
        const pi = Math.min(N - 1, Math.max(0, Math.floor((0.5 + dx * cz - dy * sz) * N)));
        const pj = Math.min(N - 1, Math.max(0, Math.floor((0.5 + dx * sz + dy * cz) * N)));
        const k = (pj * N + pi) * 4;
        r = r * (1 - amount) + (prev[k]! / 255) * amount;
        gg = gg * (1 - amount) + (prev[k + 1]! / 255) * amount;
        bb = bb * (1 - amount) + (prev[k + 2]! / 255) * amount;
      }
      const k = (j * N + i) * 4;
      out[k] = r * 255;
      out[k + 1] = gg * 255;
      out[k + 2] = bb * 255;
      out[k + 3] = 255;
    }
  }
  return out;
}

const hasFeedback = (g: Genome) => g.ops.some((s) => s.op === 'feedback');

/** An ink as it looks at t, stepped on the 30 Hz grid. Without feedback it
 *  is a pure function of the tick. With feedback it carries the previous
 *  tick forward; a jump back, or forward by more than the warm-up, starts
 *  again INK_WARMUP_S earlier, and by then it has forgotten the
 *  difference. */
export interface InkPlayer {
  at(t: number): Uint8ClampedArray;
}

export function inkPlayer(g: Genome): InkPlayer {
  let tick = -1;
  let frame: Uint8ClampedArray | null = null;
  const fb = hasFeedback(g);
  const slices = new Map<number, Float32Array>();
  const slice = (k: number) => {
    let hit = slices.get(k);
    if (!hit) {
      hit = inkSlice(g, k * INK_SLICE_S);
      slices.set(k, hit);
      // Only neighbours are ever asked for again.
      for (const old of slices.keys()) if (old < k - 1 || old > k + 1) slices.delete(old);
    }
    return hit;
  };
  const frameAt = (n: number, prev: Uint8ClampedArray | null) => {
    const t = n * INK_TICK;
    const k = Math.floor(t / INK_SLICE_S + 1e-9);
    const u = t / INK_SLICE_S - k;
    return inkFrame(g, slice(k), slice(k + 1), Math.min(1, Math.max(0, u)), prev);
  };
  return {
    at(t) {
      const want = Math.max(0, Math.floor(t / INK_TICK + 1e-9));
      if (frame && want === tick) return frame;
      if (!fb) {
        tick = want;
        frame = frameAt(want, null);
        return frame;
      }
      const warm = Math.round(INK_WARMUP_S / INK_TICK);
      let k = frame && want > tick && want - tick <= warm ? tick + 1 : Math.max(0, want - warm);
      let prev = frame && k === tick + 1 ? frame : null;
      for (; k <= want; k++) prev = frameAt(k, prev);
      tick = want;
      frame = prev;
      return frame!;
    },
  };
}

/** A stable key for a genome, for caches. */
export const genomeKey = (g: Genome): string => JSON.stringify(g);
