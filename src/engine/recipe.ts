// The recipe: an append-only log of everything that makes a show. Casting,
// performed passes, scissor cuts, mouths, drops. Same recipe simulates to the
// same frames, always. Undo is popping the last event.

export const RECIPE_VERSION = 0 as const;

interface EventBase {
  id: string;
  /** Show-time seconds (0 for stage-setup events like CAST/SNIP/MOUTH). */
  at: number;
}

/** What a puppet is made of. rect exists for tests and fixtures. */
export type PuppetSpec =
  | { type: 'cutout'; assetId: string; w: number; h: number }
  | { type: 'doodle'; strokes: number[][]; w: number; h: number }
  | { type: 'rect'; color: string; w: number; h: number };

/** A puppet joins (or re-poses in) the cast. The latest CAST for a puppet
 *  wins and moves it to the front; `back` pins backdrops behind everyone. */
export interface CastEvent extends EventBase {
  kind: 'CAST';
  puppetId: string;
  puppet: PuppetSpec;
  x: number;
  y: number;
  scale: number;
  /** Home rotation in radians; the spring's lean adds on top. */
  rot: number;
  back?: boolean;
}

/** One recorded grab: flat [t, x, y, ...] samples in show seconds and
 *  normalized stage coords, sorted by t. The newest pass covering a moment
 *  owns the puppet at that moment. */
export interface PassEvent extends EventBase {
  kind: 'PASS';
  puppetId: string;
  samples: number[];
}

/** A scissor line across a puppet, in puppet-local box coords (0..1). The
 *  side away from the box center splits off and dangles from the line's
 *  midpoint like a paper-doll joint. */
export interface SnipEvent extends EventBase {
  kind: 'SNIP';
  puppetId: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A mouth pinned at a puppet-local point; the audio's loudness envelope
 *  drives how far it opens. Latest MOUTH per puppet wins. */
export interface MouthEvent extends EventBase {
  kind: 'MOUTH';
  puppetId: string;
  mx: number;
  my: number;
  /** Mouth width as a fraction of the puppet box width. */
  size: number;
}

/** Removes a puppet from the cast; a later CAST revives it. */
export interface DropEvent extends EventBase {
  kind: 'DROP';
  puppetId: string;
}

export type RecipeEvent = CastEvent | PassEvent | SnipEvent | MouthEvent | DropEvent;

export interface Project {
  version: typeof RECIPE_VERSION;
  id: string;
  title: string;
  createdAt: string;
  /** Seed for every stochastic effect (doodle boil); replay stays deterministic. */
  seed: number;
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
    events: [],
  };
}

/** Append-only: returns a new project, never mutates. */
export function appendEvent(project: Project, event: RecipeEvent): Project {
  return { ...project, events: [...project.events, event] };
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
  if (typeof p.seed !== 'number' || !Array.isArray(p.events)) {
    throw new Error('recipe: malformed body');
  }
  for (const e of p.events) {
    const ev = e as Record<string, unknown>;
    if (typeof ev.kind !== 'string' || typeof ev.id !== 'string' || !isNum(ev.at)) {
      throw new Error('recipe: malformed event');
    }
    if (ev.kind !== 'CAST' && typeof ev.puppetId !== 'string') {
      throw new Error(`recipe: ${ev.kind} event needs a puppetId`);
    }
    switch (ev.kind) {
      case 'CAST':
        if (
          typeof ev.puppetId !== 'string' ||
          typeof ev.puppet !== 'object' ||
          ev.puppet === null ||
          !isNum(ev.x) ||
          !isNum(ev.y) ||
          !isNum(ev.scale) ||
          !isNum(ev.rot)
        ) {
          throw new Error('recipe: CAST event needs puppetId, puppet, x, y, scale, rot');
        }
        break;
      case 'PASS': {
        const ok =
          Array.isArray(ev.samples) &&
          ev.samples.length >= 3 &&
          ev.samples.length % 3 === 0 &&
          ev.samples.every((n: unknown) => isNum(n));
        if (!ok) throw new Error('recipe: PASS event needs t,x,y sample triples');
        break;
      }
      case 'SNIP':
        if (!(isNum(ev.x0) && isNum(ev.y0) && isNum(ev.x1) && isNum(ev.y1))) {
          throw new Error('recipe: SNIP event needs a line');
        }
        break;
      case 'MOUTH':
        if (!(isNum(ev.mx) && isNum(ev.my) && isNum(ev.size) && (ev.size as number) > 0)) {
          throw new Error('recipe: MOUTH event needs mx, my, positive size');
        }
        break;
      case 'DROP':
        break;
      default:
        throw new Error(`recipe: unknown event kind ${ev.kind}`);
    }
  }
  return raw as Project;
}
