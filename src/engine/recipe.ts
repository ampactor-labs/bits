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

export interface CutEvent extends EventBase {
  kind: 'CUT';
}

export interface SpeedEvent extends EventBase {
  kind: 'SPEED';
  rate: number;
  attackS: number;
}

export interface ZoomEvent extends EventBase {
  kind: 'ZOOM';
  cx: number;
  cy: number;
  scale: number;
}

export type RecipeEvent = CutEvent | SpeedEvent | ZoomEvent;

export interface Project {
  version: typeof RECIPE_VERSION;
  id: string;
  title: string;
  createdAt: string;
  /** Seed for every stochastic effect; lives here so replay stays deterministic. */
  seed: number;
  sources: SourceRef[];
  events: RecipeEvent[];
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
  }
  return raw as Project;
}
