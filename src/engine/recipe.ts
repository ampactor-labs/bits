// The recipe is the heart of BITS: an append-only log of performance events
// over source media. Same recipe + same sources = same frames, always.
// Undo is truncation; jam and arrange views are projections of this log.

export const RECIPE_VERSION = 0 as const;

export interface SourceRef {
  id: string;
  name: string;
  bytes: number;
  /** Duration in seconds, filled in after the source is first probed. */
  durationS?: number;
  addedAt: string;
}

interface EventBase {
  id: string;
  /** Raw performed time on the project timeline, in seconds. */
  at: number;
  /** Quantized time, present when an onset grid was active at capture.
   *  Raw is never discarded: quantize is a view decision, reversible forever. */
  atQ?: number;
}

/** A cut marker: a beat on the scrub bar now, a segment boundary for arrange later. */
export interface CutEvent extends EventBase {
  kind: 'CUT';
}

/** Edge event: this playback rate applies from `at` until the next SPEED edge.
 *  rate 1 is realtime; 0.3 is slow motion; the default before any edge is 1. */
export interface SpeedEvent extends EventBase {
  kind: 'SPEED';
  rate: number;
}

/** The source span [at, endAt) is removed from the output. */
export interface SkipEvent extends EventBase {
  kind: 'SKIP';
  endAt: number;
}

/** Automation sample: punch-in center (normalized source coords) and scale.
 *  Values hold before the first and after the last sample, lerp between. */
export interface ZoomEvent extends EventBase {
  kind: 'ZOOM';
  cx: number;
  cy: number;
  scale: number;
}

/** What a puppet is made of. rect exists for tests and fixtures. */
export type PuppetSpec =
  | { type: 'cutout'; assetId: string; w: number; h: number }
  | { type: 'doodle'; strokes: number[][]; w: number; h: number }
  | { type: 'rect'; color: string; w: number; h: number };

/** A puppet joins the cast with a home pose (normalized stage coords). */
export interface CastEvent extends EventBase {
  kind: 'CAST';
  puppetId: string;
  puppet: PuppetSpec;
  x: number;
  y: number;
  scale: number;
}

/** One recorded performance pass: flat [t, x, y, ...] samples in show seconds
 *  and normalized stage coords, sorted by t. The pass covers [first t, last t];
 *  the newest pass covering a moment owns the puppet at that moment. */
export interface PassEvent extends EventBase {
  kind: 'PASS';
  puppetId: string;
  samples: number[];
}

export type RecipeEvent = CutEvent | SpeedEvent | SkipEvent | ZoomEvent | CastEvent | PassEvent;

export interface Project {
  version: typeof RECIPE_VERSION;
  id: string;
  title: string;
  createdAt: string;
  /** Seed for every stochastic effect; lives here so replay stays deterministic. */
  seed: number;
  sources: SourceRef[];
  events: RecipeEvent[];
  /** The show's audio spine: the bit, recorded first. */
  audio?: { assetId: string; durationS: number };
}

export function createProject(title: string, now = new Date()): Project {
  return {
    version: RECIPE_VERSION,
    id: crypto.randomUUID(),
    title,
    createdAt: now.toISOString(),
    seed: Math.floor(Math.random() * 2 ** 31),
    sources: [],
    events: [],
  };
}

/** Append-only: returns a new project, never mutates. */
export function appendEvent(project: Project, event: RecipeEvent): Project {
  return { ...project, events: [...project.events, event] };
}

/** Events sorted by effective time (quantized when present), stable for ties. */
export function eventsInOrder(project: Project): RecipeEvent[] {
  return project.events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => effectiveTime(a.e) - effectiveTime(b.e) || a.i - b.i)
    .map(({ e }) => e);
}

export function effectiveTime(event: RecipeEvent): number {
  return event.atQ ?? event.at;
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project);
}

export function parseProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('recipe: not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('recipe: not an object');
  const p = raw as Record<string, unknown>;
  if (p.version !== RECIPE_VERSION) {
    throw new Error(`recipe: unsupported version ${String(p.version)}`);
  }
  if (typeof p.id !== 'string' || typeof p.title !== 'string') {
    throw new Error('recipe: missing id or title');
  }
  if (typeof p.seed !== 'number' || !Array.isArray(p.sources) || !Array.isArray(p.events)) {
    throw new Error('recipe: malformed body');
  }
  for (const e of p.events) {
    const ev = e as Record<string, unknown>;
    if (typeof ev.kind !== 'string' || typeof ev.at !== 'number' || typeof ev.id !== 'string') {
      throw new Error('recipe: malformed event');
    }
    if (ev.kind === 'SPEED' && !(typeof ev.rate === 'number' && ev.rate > 0)) {
      throw new Error('recipe: SPEED event needs a positive rate');
    }
    if (ev.kind === 'SKIP' && !(typeof ev.endAt === 'number' && ev.endAt > (ev.at as number))) {
      throw new Error('recipe: SKIP event needs endAt after at');
    }
    if (
      ev.kind === 'ZOOM' &&
      !(typeof ev.cx === 'number' && typeof ev.cy === 'number' && typeof ev.scale === 'number')
    ) {
      throw new Error('recipe: ZOOM event needs cx, cy, scale');
    }
    if (
      ev.kind === 'CAST' &&
      !(
        typeof ev.puppetId === 'string' &&
        typeof ev.puppet === 'object' &&
        ev.puppet !== null &&
        typeof ev.x === 'number' &&
        typeof ev.y === 'number' &&
        typeof ev.scale === 'number'
      )
    ) {
      throw new Error('recipe: CAST event needs puppetId, puppet, x, y, scale');
    }
    if (ev.kind === 'PASS') {
      const ok =
        typeof ev.puppetId === 'string' &&
        Array.isArray(ev.samples) &&
        ev.samples.length >= 3 &&
        ev.samples.length % 3 === 0 &&
        ev.samples.every((n: unknown) => typeof n === 'number');
      if (!ok) throw new Error('recipe: PASS event needs puppetId and t,x,y sample triples');
    }
  }
  return raw as Project;
}
