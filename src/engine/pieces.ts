// Scissor geometry: each SNIP line splits the puppet's unit box with a
// half-plane. The side holding the box center stays root; the far side
// becomes a child hinged at the drawn line's midpoint. Successive snips
// carve the remaining root, Gilliam-style.

export interface SnipLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type Poly = [number, number][];

export interface PieceDef {
  poly: Poly;
  /** Hinge point in puppet-local box coords; null for the root. */
  joint: { x: number; y: number } | null;
  /** Index into the snip list that created this child; -1 for the root. */
  snipIndex: number;
}

export interface PuppetPieces {
  root: PieceDef;
  children: PieceDef[];
}

const UNIT_BOX: Poly = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const MIN_AREA = 0.005;

function side(line: SnipLine, x: number, y: number): number {
  return (line.x1 - line.x0) * (y - line.y0) - (line.y1 - line.y0) * (x - line.x0);
}

/** Sutherland-Hodgman clip of a polygon against one half-plane. */
function clipHalfPlane(poly: Poly, line: SnipLine, keepSign: number): Poly {
  const out: Poly = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]!;
    const [bx, by] = poly[(i + 1) % poly.length]!;
    const aIn = side(line, ax, ay) * keepSign >= 0;
    const bIn = side(line, bx, by) * keepSign >= 0;
    if (aIn) out.push([ax, ay]);
    if (aIn !== bIn) {
      const da = side(line, ax, ay);
      const db = side(line, bx, by);
      const f = da / (da - db);
      out.push([ax + (bx - ax) * f, ay + (by - ay) * f]);
    }
  }
  return out;
}

export function polyArea(poly: Poly): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]!;
    const [x1, y1] = poly[(i + 1) % poly.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

export function polyCentroid(poly: Poly): { x: number; y: number } {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of poly) {
    cx += x;
    cy += y;
  }
  const n = Math.max(1, poly.length);
  return { x: cx / n, y: cy / n };
}

/** Ray-cast point-in-polygon in puppet-local box coords. */
export function pointInPoly(poly: Poly, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function splitPieces(snips: SnipLine[]): PuppetPieces {
  let rootPoly = UNIT_BOX;
  const children: PieceDef[] = [];
  for (let i = 0; i < snips.length; i++) {
    const line = snips[i]!;
    const centerSide = side(line, 0.5, 0.5);
    // A line through the exact center cannot pick a root side; skip it.
    if (Math.abs(centerSide) < 1e-9) continue;
    const keep = Math.sign(centerSide);
    const childPoly = clipHalfPlane(rootPoly, line, -keep);
    const keptPoly = clipHalfPlane(rootPoly, line, keep);
    if (polyArea(childPoly) < MIN_AREA || polyArea(keptPoly) < MIN_AREA) continue;
    children.push({
      poly: childPoly,
      joint: {
        x: Math.min(1, Math.max(0, (line.x0 + line.x1) / 2)),
        y: Math.min(1, Math.max(0, (line.y0 + line.y1) / 2)),
      },
      snipIndex: i,
    });
    rootPoly = keptPoly;
  }
  return { root: { poly: rootPoly, joint: null, snipIndex: -1 }, children };
}
