// Moving-least-squares similarity deformation (Schaefer et al. 2006): the
// closed-form member of the ARAP family. Pins are control points in puppet-
// local box coords; drag some and every grid vertex follows with locally
// rigid-ish motion. Pure math, no solver, bit-deterministic.

export interface Pt {
  x: number;
  y: number;
}

const ALPHA = 2;
const EPS = 1e-9;

/** Deform one point v given rest controls p and deformed controls q.
 *  Interpolates: f(p_i) = q_i. With one control, pure translation. */
export function mlsSimilarity(v: Pt, p: Pt[], q: Pt[]): Pt {
  const n = p.length;
  if (n === 0) return v;
  if (n === 1) return { x: v.x + q[0]!.x - p[0]!.x, y: v.y + q[0]!.y - p[0]!.y };

  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const dx = v.x - p[i]!.x;
    const dy = v.y - p[i]!.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < EPS) return { ...q[i]! };
    w[i] = 1 / Math.pow(d2, ALPHA / 2);
  }

  let wSum = 0;
  let pcx = 0;
  let pcy = 0;
  let qcx = 0;
  let qcy = 0;
  for (let i = 0; i < n; i++) {
    wSum += w[i]!;
    pcx += w[i]! * p[i]!.x;
    pcy += w[i]! * p[i]!.y;
    qcx += w[i]! * q[i]!.x;
    qcy += w[i]! * q[i]!.y;
  }
  pcx /= wSum;
  pcy /= wSum;
  qcx /= wSum;
  qcy /= wSum;

  // Similarity: mu = sum w_i |p̂_i|²; A = sum w_i q̂_i [p̂_i; -p̂_i⊥]ᵀ.
  let mu = 0;
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const px = p[i]!.x - pcx;
    const py = p[i]!.y - pcy;
    const qx = q[i]!.x - qcx;
    const qy = q[i]!.y - qcy;
    mu += w[i]! * (px * px + py * py);
    a += w[i]! * (qx * px + qy * py);
    b += w[i]! * (qx * py - qy * px);
  }
  if (mu < EPS) return { x: v.x - pcx + qcx, y: v.y - pcy + qcy };

  const vx = v.x - pcx;
  const vy = v.y - pcy;
  return {
    x: (a * vx + b * vy) / mu + qcx,
    y: (-b * vx + a * vy) / mu + qcy,
  };
}

export interface WarpGrid {
  cols: number;
  rows: number;
  /** Rest vertices in puppet-local box coords, row-major, length (cols+1)*(rows+1)*2. */
  rest: Float32Array;
}

export function makeWarpGrid(cols = 10, rows = 14): WarpGrid {
  const rest = new Float32Array((cols + 1) * (rows + 1) * 2);
  let k = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      rest[k++] = c / cols;
      rest[k++] = r / rows;
    }
  }
  return { cols, rows, rest };
}

/** Deform every grid vertex; returns a new array, rest coords in, deformed out. */
export function deformGrid(grid: WarpGrid, p: Pt[], q: Pt[]): Float32Array {
  const out = new Float32Array(grid.rest.length);
  const v: Pt = { x: 0, y: 0 };
  for (let i = 0; i < grid.rest.length; i += 2) {
    v.x = grid.rest[i]!;
    v.y = grid.rest[i + 1]!;
    const d = mlsSimilarity(v, p, q);
    out[i] = d.x;
    out[i + 1] = d.y;
  }
  return out;
}
