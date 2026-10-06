// The camera: one more body on the stage, performed like any sheet, and a
// projection that gives every sheet's depth something to do.
//
// Depth is free at rest. Stored positions are what you see through the
// resting camera, so pushing a sheet back never moves it and every bit
// made before depth existed looks the same. Depth only shows when the
// camera pans (far sheets slide less) or dollies (near sheets grow faster).
//
// The maths is in pixels, not stage units: the stage is not square, and a
// roll in normalised coordinates would shear. Each sheet's projection is a
// similarity (uniform scale, rotation, shift), so a canvas renderer applies
// it with one transform and everything inside the sheet (pieces, warp,
// mouth, eyes) follows for free.

/** The camera's puppet id. Reserved: no CAST may use it. */
export const CAMERA_ID = '@camera';

/** The scalar things a camera pass can record besides pan. */
export type CameraProp = 'z' | 'rot' | 'scale';
export const CAMERA_PROPS: readonly CameraProp[] = ['z', 'rot', 'scale'];

/** Focal distance, in the same units as depth. A sheet at depth f slides
 *  half as far as one at 0 when the camera pans. */
export const FOCAL = 2;
/** Nearer than this to the lens and a sheet is behind the camera. */
export const NEAR = 0.05;

/** Where the camera is. Pan in stage units (0.5, 0.5 is the middle), dolly
 *  `z` in depth units (positive pushes in), roll in radians, zoom as a
 *  factor. */
export interface CameraPose {
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
}

export const REST_CAMERA: Readonly<CameraPose> = { x: 0.5, y: 0.5, z: 0, rot: 0, scale: 1 };

/** Exactly at rest. Compared exactly, not within a tolerance: the rest
 *  camera is an identity that draws nothing differently, and a matrix that
 *  comes out as 0.9999999999999999 would change every pixel of every old
 *  bit. */
export function isRestCamera(c: CameraPose): boolean {
  return c.x === 0.5 && c.y === 0.5 && c.z === 0 && c.rot === 0 && c.scale === 1;
}

/** A canvas-style 2D similarity: x' = a·x + c·y + e, y' = b·x + d·y + f,
 *  in pixels. */
export interface View {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** False when the sheet is at or behind the lens and must not be drawn. */
export function inFront(cam: CameraPose, depth: number): boolean {
  return FOCAL + depth - cam.z >= NEAR;
}

/** How one sheet at `depth` lands on a W×H screen. Null means identity:
 *  the camera is at rest, so nothing needs transforming.
 *
 *  With P the sheet point and O the stage centre (both in pixels), c the
 *  camera's pan point, k = f / (f + depth − z) and m = k·(f + depth)/f:
 *  screen = O + zoom·R(roll)·[m·(P − O) + k·(O − c)]. At rest m = 1 and
 *  c = O, so screen = P whatever the depth. */
export function viewOf(cam: CameraPose | null, depth: number, W: number, H: number): View | null {
  if (!cam || isRestCamera(cam)) return null;
  const k = FOCAL / (FOCAL + depth - cam.z);
  const m = (k * (FOCAL + depth)) / FOCAL;
  const ox = W / 2;
  const oy = H / 2;
  const cos = Math.cos(cam.rot);
  const sin = Math.sin(cam.rot);
  const s = cam.scale;
  // b = O + s·R·[k(O − c) − m·O]
  const vx = k * (ox - cam.x * W) - m * ox;
  const vy = k * (oy - cam.y * H) - m * oy;
  return {
    a: s * m * cos,
    b: s * m * sin,
    c: -s * m * sin,
    d: s * m * cos,
    e: ox + s * (cos * vx - sin * vy),
    f: oy + s * (sin * vx + cos * vy),
  };
}

/** Stage point (normalised) to screen point (normalised). */
export function toScreen(
  cam: CameraPose | null,
  depth: number,
  x: number,
  y: number,
  W: number,
  H: number,
): { x: number; y: number } {
  const v = viewOf(cam, depth, W, H);
  if (!v) return { x, y };
  const px = x * W;
  const py = y * H;
  return { x: (v.a * px + v.c * py + v.e) / W, y: (v.b * px + v.d * py + v.f) / H };
}

/** Screen point (normalised) back to the stage point at `depth` that lands
 *  there: where a finger is on a sheet that the camera has moved. */
export function toStage(
  cam: CameraPose | null,
  depth: number,
  x: number,
  y: number,
  W: number,
  H: number,
): { x: number; y: number } {
  const v = viewOf(cam, depth, W, H);
  if (!v) return { x, y };
  const det = v.a * v.d - v.b * v.c;
  const dx = x * W - v.e;
  const dy = y * H - v.f;
  return {
    x: (v.d * dx - v.c * dy) / det / W,
    y: (-v.b * dx + v.a * dy) / det / H,
  };
}

/** How much a sheet at `depth` is magnified on screen. */
export function magnification(cam: CameraPose | null, depth: number): number {
  if (!cam || isRestCamera(cam)) return 1;
  return (cam.scale * (FOCAL + depth)) / (FOCAL + depth - cam.z);
}
