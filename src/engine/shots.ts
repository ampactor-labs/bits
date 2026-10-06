// Shots: the stretches between camera cuts. A shot is not stored anywhere.
// The recipe has cuts, and the shots are what lies between them, so moving
// or taking out a cut can never leave a shot list that disagrees with the
// film.
//
// Framing a shot means choosing where its cut puts the camera. The helpers
// here work that out from where the sheets are when the shot opens: wide is
// the rest camera, a close shot centres one sheet and fills about half the
// frame with it, and "everyone" fits every sheet in.

import { FOCAL, REST_CAMERA, type CameraPose } from './camera';
import { PUPPET_DT } from './puppet';
import type { CutEvent } from './recipe';
import type { ShowPuppet } from './show';

export interface Shot {
  from: number;
  to: number;
  /** The cut that opens it; null for a first shot that opens at rest. */
  cut: CutEvent | null;
}

/** The show's shots, in order. `cuts` is sorted (cutsOf); a cut at or
 *  past the end opens nothing anyone will see, so it is left off. */
export function shotsOf(cuts: CutEvent[], durationS: number): Shot[] {
  const live = cuts.filter((c) => c.at < durationS || durationS <= 0);
  const out: Shot[] = [];
  const opening = live[0] && live[0].at <= PUPPET_DT ? live[0] : null;
  const rest = opening ? live.slice(1) : live;
  let from = 0;
  let cut = opening;
  for (const c of rest) {
    out.push({ from, to: c.at, cut });
    from = c.at;
    cut = c;
  }
  out.push({ from, to: Math.max(from, durationS), cut });
  return out;
}

/** Where a sheet stands, for framing. */
export interface Standing {
  x: number;
  y: number;
  puppet: ShowPuppet;
}

/** The pan point that puts stage point (x, y) at `depth` in the middle of
 *  the frame. With the camera at z = 0 a sheet lands at
 *  O + zoom·k·(Q − c), where Q = O + (P − O)(f + depth)/f, so c = Q. */
const panOnto = (x: number, y: number, depth: number) => {
  const g = (FOCAL + depth) / FOCAL;
  return { x: 0.5 + (x - 0.5) * g, y: 0.5 + (y - 0.5) * g };
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A sheet's box as a share of the stage, before the camera. */
const extent = (p: ShowPuppet) => ({ w: p.spec.w * p.home.scale, h: p.spec.h * p.home.scale });

export const WIDE: Readonly<CameraPose> = REST_CAMERA;

/** Close on one sheet: centred, about half the frame tall. */
export function closeOn(s: Standing): CameraPose {
  const { w, h } = extent(s.puppet);
  const zoom = clamp(Math.min(0.55 / Math.max(h, 1e-3), 0.8 / Math.max(w, 1e-3)), 1.2, 4);
  return { ...panOnto(s.x, s.y, s.puppet.depth), z: 0, rot: 0, scale: zoom };
}

/** Everyone in: the smallest move that fits every sheet with a margin.
 *  Wide when they already need the whole stage. */
export function fitAll(all: Standing[]): CameraPose {
  if (all.length === 0) return { ...WIDE };
  if (all.length === 1) return closeOn(all[0]!);
  const pts = all.map((s) => ({
    ...panOnto(s.x, s.y, s.puppet.depth),
    k: FOCAL / (FOCAL + s.puppet.depth),
    ...extent(s.puppet),
  }));
  const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
  const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
  // How far each sheet's edge sits from the middle, before the zoom.
  const ex = Math.max(...pts.map((p) => Math.abs(p.k * (p.x - cx)) + p.w / 2));
  const ey = Math.max(...pts.map((p) => Math.abs(p.k * (p.y - cy)) + p.h / 2));
  const zoom = Math.min(0.45 / Math.max(ex, 1e-3), 0.45 / Math.max(ey, 1e-3));
  if (zoom <= 1.05) return { ...WIDE };
  return { x: cx, y: cy, z: 0, rot: 0, scale: Math.min(zoom, 3) };
}

/** The beat to move a cut to: the nearest onset past `t` in direction
 *  `dir`, staying strictly inside (lo, hi). Without beats, half a second. */
export function nudge(
  onsets: number[],
  t: number,
  dir: -1 | 1,
  lo: number,
  hi: number,
): number | null {
  const gap = PUPPET_DT * 2;
  let next: number | null;
  if (onsets.length > 0) {
    const ahead =
      dir > 0 ? onsets.filter((o) => o > t + gap) : onsets.filter((o) => o < t - gap).reverse();
    next = ahead[0] ?? null;
  } else {
    next = t + dir * 0.5;
  }
  if (next === null || next <= lo + gap || next >= hi - gap) return null;
  return next;
}

/** Same framing, to within what anyone could see. */
export function sameFraming(a: CameraPose, b: CameraPose): boolean {
  return (
    Math.abs(a.x - b.x) < 1e-3 &&
    Math.abs(a.y - b.y) < 1e-3 &&
    Math.abs(a.z - b.z) < 1e-3 &&
    Math.abs(a.rot - b.rot) < 1e-3 &&
    Math.abs(a.scale - b.scale) < 1e-3
  );
}
