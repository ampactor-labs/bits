// What a wire can drive. One registry, so the recipe parser, the engine
// and the Wires room agree on every name. A sheet's targets move how it is
// drawn after the sim has placed it (wires never feed physics: a wired
// shake must not change where a pass lands); the stage's move the camera,
// the trails, the fog and the foley.

export type SheetTarget =
  | 'bounce'
  | 'shake'
  | 'lean'
  | 'x'
  | 'y'
  | 'scale'
  | 'rot'
  | 'opacity'
  | 'hue'
  | 'depth'
  | 'fold';

export type StageTarget =
  | 'trails'
  | 'foley'
  | 'fog'
  | 'cam.x'
  | 'cam.y'
  | 'cam.z'
  | 'cam.rot'
  | 'cam.scale';

export type Target = SheetTarget | StageTarget;

export interface TargetInfo {
  id: Target;
  /** What the Wires room calls it. */
  label: string;
  /** Kept to the exact arithmetic it had before the matrix. */
  legacy?: true;
}

export const SHEET_TARGETS: readonly TargetInfo[] = [
  { id: 'bounce', label: 'bounce', legacy: true },
  { id: 'shake', label: 'shake', legacy: true },
  { id: 'lean', label: 'lean', legacy: true },
  { id: 'x', label: 'sideways' },
  { id: 'y', label: 'up and down' },
  { id: 'scale', label: 'size' },
  { id: 'rot', label: 'turn' },
  { id: 'opacity', label: 'fade' },
  { id: 'hue', label: 'colour' },
  { id: 'depth', label: 'depth' },
  { id: 'fold', label: 'folds' },
];

export const STAGE_TARGETS: readonly TargetInfo[] = [
  { id: 'trails', label: 'trails', legacy: true },
  { id: 'foley', label: 'foley', legacy: true },
  { id: 'fog', label: 'fog' },
  { id: 'cam.x', label: 'camera sideways' },
  { id: 'cam.y', label: 'camera up and down' },
  { id: 'cam.z', label: 'camera push' },
  { id: 'cam.rot', label: 'camera roll' },
  { id: 'cam.scale', label: 'camera zoom' },
];

const SHEET_IDS = new Set<string>(SHEET_TARGETS.map((t) => t.id));
const STAGE_IDS = new Set<string>(STAGE_TARGETS.map((t) => t.id));

/** Whether a target belongs where the wire is: puppetId '' is the stage. */
export function isTargetFor(puppetId: string, to: string): to is Target {
  return puppetId === '' ? STAGE_IDS.has(to) : SHEET_IDS.has(to);
}

/** How far each new target goes at amount 1 and a full signal. */
export const REACH = {
  x: 0.15,
  y: 0.15,
  scale: 0.6,
  rot: Math.PI / 2,
  hue: 180,
  depth: 4,
  fold: Math.PI / 2,
  fog: 1,
  'cam.x': 0.25,
  'cam.y': 0.25,
  'cam.z': 1.2,
  'cam.rot': 0.5,
  'cam.scale': 0.5,
} as const;
