// Puppet physics: the inbetweener. The performer supplies intent (a target
// the finger dragged); the spring supplies polish (lag, lean, squash, settle).
// Fixed-timestep and pure, so preview and render simulate identically.

export interface PuppetState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Lean angle in radians, driven by horizontal velocity. */
  angle: number;
  /** Squash amount, 0 = none; drawn as y-compress/x-stretch. */
  squash: number;
}

export interface PuppetTarget {
  x: number;
  y: number;
}

export const PUPPET_DT = 1 / 120;

const SPRING_K = 180;
const SPRING_DAMP = 22;
const FREE_DRAG = 3.2;
const LEAN_PER_VX = 0.55;
const LEAN_MAX = 0.5;
const LEAN_FOLLOW = 14;
const SQUASH_PER_ACCEL = 0.00022;
const SQUASH_MAX = 0.35;
const SQUASH_RELAX = 10;

export function restingPuppet(x: number, y: number): PuppetState {
  return { x, y, vx: 0, vy: 0, angle: 0, squash: 0 };
}

/** One fixed step. Grabbed: spring toward the target. Free: coast and settle.
 *  Coordinates are normalized stage units (0..1-ish); velocities are units/s. */
export function stepPuppet(s: PuppetState, target: PuppetTarget | null, dt = PUPPET_DT): PuppetState {
  let ax: number;
  let ay: number;
  if (target) {
    ax = SPRING_K * (target.x - s.x) - SPRING_DAMP * s.vx;
    ay = SPRING_K * (target.y - s.y) - SPRING_DAMP * s.vy;
  } else {
    ax = -FREE_DRAG * s.vx;
    ay = -FREE_DRAG * s.vy;
  }

  const vx = s.vx + ax * dt;
  const vy = s.vy + ay * dt;
  const x = s.x + vx * dt;
  const y = s.y + vy * dt;

  const leanTarget = clamp(vx * LEAN_PER_VX, -LEAN_MAX, LEAN_MAX);
  const angle = s.angle + (leanTarget - s.angle) * Math.min(1, LEAN_FOLLOW * dt);

  const accelMag = Math.hypot(ax, ay);
  const squashTarget = clamp(accelMag * SQUASH_PER_ACCEL, 0, SQUASH_MAX);
  const squash =
    squashTarget > s.squash
      ? squashTarget
      : s.squash + (squashTarget - s.squash) * Math.min(1, SQUASH_RELAX * dt);

  return { x, y, vx, vy, angle, squash };
}

/** Advance across whole steps of the global grid: step k integrates the span
 *  [k*DT, (k+1)*DT) with the target sampled at k*DT. Whole steps only; any
 *  advance schedule (per-frame preview, per-render-frame, split calls) runs
 *  the identical sequence, which is what keeps replay bit-exact. */
export function simulatePuppetSteps(
  initial: PuppetState,
  stepStart: number,
  stepEnd: number,
  targetAt: (t: number) => PuppetTarget | null,
): PuppetState {
  let s = initial;
  for (let k = stepStart; k < stepEnd; k++) {
    s = stepPuppet(s, targetAt(k * PUPPET_DT));
  }
  return s;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Deterministic boil: cheap hash noise for doodle-line jitter, keyed by seed,
 *  boil variant, and point index. Returns in [-1, 1]. */
export function boilNoise(seed: number, variant: number, index: number): number {
  let h = (seed ^ (variant * 0x9e3779b9) ^ (index * 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 0xffffffff) * 2 - 1;
}
