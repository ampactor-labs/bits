// The recipe: an append-only log of everything that makes a show. Casting,
// performed passes, scissor cuts, mouths, drops. Same recipe simulates to the
// same frames, always. Undo is popping the last event.

export const RECIPE_VERSION = 1 as const;
/** Every version this app can open. v0 files migrate on load. */
export const READABLE_VERSIONS = [0, 1] as const;

interface EventBase {
  id: string;
  /** Show-time seconds (0 for stage-setup events like CAST/SNIP/MOUTH). */
  at: number;
  /** Events committed together share a group id and form a contiguous run
   *  at the tail of the log. Undo pops the whole run; redo re-appends it in
   *  order. Plain data, so determinism is untouched. */
  group?: string;
}

/** How floppy a puppet is. 'felt' reproduces the original constants, so an
 *  unset spring and 'felt' simulate identically. */
export type SpringPreset = 'paper' | 'felt' | 'rubber';

export const SPRING_PRESETS = ['paper', 'felt', 'rubber'] as const;

interface SpecCommon {
  w: number;
  h: number;
  /** Shown on chips, lanes and in toasts. Metadata: never changes pixels. */
  name?: string;
  spring?: SpringPreset;
}

/** What a puppet is made of. rect exists for tests and fixtures. */
export type PuppetSpec =
  | ({ type: 'cutout'; assetId: string } & SpecCommon)
  | ({
      type: 'doodle';
      strokes: number[][];
      /** Parallel to strokes; absent means the original bone at the default
       *  width, so v0 doodles draw exactly as they always did. */
      strokeStyle?: { color: string; width: number }[];
    } & SpecCommon)
  | ({ type: 'text'; text: string } & SpecCommon)
  | ({ type: 'rect'; color: string } & SpecCommon);

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
  /** Mirrors the puppet's LOCAL FRAME about its centre. Not a draw-time
   *  scale: pass samples are stage coords and do not mirror with it, so the
   *  flip has to live in the local/world transform or a dragged pin renders
   *  at the mirror image of the finger. */
  flip?: boolean;
}

/** Draw order for non-backdrops, back to front. Latest REORDER wins.
 *
 *  It has to coexist with CAST's own fronting rule: castOf rebuilds order
 *  from Map insertion and every CAST re-inserts, so without this the next
 *  drag (which commits a CAST on release) would silently undo a reorder.
 *  Order is: the latest REORDER filtered to live puppets, then every live
 *  puppet it does not name, in latest-CAST order. With no REORDER in the
 *  log the result is exactly the old rule. */
export interface ReorderEvent extends EventBase {
  kind: 'REORDER';
  puppetId: '';
  order: string[];
}

/** One recorded grab: flat [t, x, y, ...] samples in show seconds and
 *  normalized stage coords, sorted by t. The newest pass covering a moment
 *  owns its target. `piece` targets a snipped-off piece (by snip index):
 *  the dangle's spring chases the performed point instead of resting. */
export interface PassEvent extends EventBase {
  kind: 'PASS';
  puppetId: string;
  samples: number[];
  piece?: number;
  /** Targets a warp pin (by pin index) instead of the body or a piece. */
  pin?: number;
}

/** A warp control point in puppet-local box coords. Pins accumulate; drag
 *  one in a pass and the texture bends around it (MLS similarity). Pins and
 *  snips are exclusive per puppet: cut paper or bend it, not both. */
export interface PinEvent extends EventBase {
  kind: 'PIN';
  puppetId: string;
  px: number;
  py: number;
  /** Re-places an existing pin slot instead of opening a new one, so a pin
   *  can be moved without orphaning the passes that target it. Must name a
   *  slot that already exists. */
  index?: number;
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

/** Googly eyes pinned at a puppet-local point; pupils lag the motion.
 *  Latest EYES per puppet wins. */
export interface EyesEvent extends EventBase {
  kind: 'EYES';
  puppetId: string;
  ex: number;
  ey: number;
  /** Eye-pair width as a fraction of the puppet box width. */
  size: number;
}

export type WireSource = 'on' | 'voice' | 'beat';
export type WireTarget = 'bounce' | 'shake' | 'lean' | 'trails' | 'foley';

export type SfxKind = 'boing' | 'slap' | 'honk' | 'scratch' | 'drop';

/** A performed sound: a foley-board tap at `at`, mixed into the show's audio.
 *  puppetId is '' (sounds belong to the stage). */
export interface SoundEvent extends EventBase {
  kind: 'SOUND';
  puppetId: string;
  sfx: SfxKind;
}

/** A modulation wire: a signal patched into a property. puppetId '' targets
 *  the stage itself (trails). Latest wire per (puppet, source, target) wins;
 *  amount 0 unplugs. Sources are deterministic (the recorded voice track and
 *  its beat grid), so wired shows replay and render bit-true. */
export interface WireEvent extends EventBase {
  kind: 'WIRE';
  puppetId: string;
  source: WireSource;
  target: WireTarget;
  amount: number;
}

/** What a REMOVE tombstones. Slot indices are never renumbered: pin and
 *  snip index is a position that six call sites pair by, so compacting on
 *  removal would silently re-target every later pass. */
export type RemoveTarget =
  | { mouth: true }
  | { eyes: true }
  | { voice: true }
  | { pin: number }
  | { snip: number }
  | { pass: string }
  | { sound: string };

/** Undoes a feature without rewriting history. puppetId is '' for pass and
 *  sound targets, which are named by event id. */
export interface RemoveEvent extends EventBase {
  kind: 'REMOVE';
  puppetId: string;
  target: RemoveTarget;
}

/** A muted pass stops driving its puppet and stops counting as talking.
 *  Latest wins per pass. */
export interface MuteEvent extends EventBase {
  kind: 'MUTE';
  puppetId: '';
  passId: string;
  muted: boolean;
}

/** Clamps a pass's coverage window to [from, to]. Latest wins per pass. */
export interface TrimEvent extends EventBase {
  kind: 'TRIM';
  puppetId: '';
  passId: string;
  from: number;
  to: number;
}

/** A take of its own for one puppet, starting at `at` in show time. The
 *  bit stays the bed: a puppet without a voice still flaps to it, and a
 *  puppet with one flaps to its own, so two people can record their halves
 *  separately and the right mouth moves for each. */
export interface VoiceEvent extends EventBase {
  kind: 'VOICE';
  puppetId: string;
  assetId: string;
  durationS: number;
  /** 0..1, default 1. */
  gain?: number;
}

/** Removes a puppet from the cast; a later CAST revives it. */
export interface DropEvent extends EventBase {
  kind: 'DROP';
  puppetId: string;
}

export type RecipeEvent =
  | CastEvent
  | ReorderEvent
  | PassEvent
  | SnipEvent
  | MouthEvent
  | EyesEvent
  | PinEvent
  | RemoveEvent
  | MuteEvent
  | TrimEvent
  | WireEvent
  | SoundEvent
  | VoiceEvent
  | DropEvent;

export interface Project {
  version: typeof RECIPE_VERSION;
  id: string;
  title: string;
  createdAt: string;
  /** Seed for every stochastic effect (doodle boil); replay stays deterministic. */
  seed: number;
  events: RecipeEvent[];
  /** The show's audio spine: the bit, recorded first. `trim` bounds what
   *  plays and what renders; show time stays asset time, so no pass is ever
   *  rewritten by trimming. A render input, not an event. */
  audio?: { assetId: string; durationS: number; trim?: { from: number; to: number } };
  /** Metadata; never changes pixels, so it needs no version bump. */
  updatedAt?: string;
  sound?: { source: 'mic' | 'file'; name?: string };
  /** Where a bit came from, when it arrived as someone else's file. It is
   *  a credit, not a link: nothing is fetched and nothing merges. */
  remixOf?: { title: string; id: string };
}

export function createProject(title: string, now = new Date()): Project {
  return {
    version: RECIPE_VERSION,
    id: crypto.randomUUID(),
    title,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    seed: Math.floor(Math.random() * 2 ** 31),
    events: [],
  };
}

/** v0 to v1. v0's grammar is a subset of v1's, so the events are already
 *  valid; only the header moves. Kept separate from parseProject so the
 *  migration can be tested directly on a stored v0 fixture. */
export function migrateProject(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.version === RECIPE_VERSION) return raw;
  return {
    ...raw,
    version: RECIPE_VERSION,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : raw.createdAt,
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('recipe: not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('recipe: not an object');
  const incoming = parsed as Record<string, unknown>;
  const version = incoming.version;
  if (!READABLE_VERSIONS.includes(version as (typeof READABLE_VERSIONS)[number])) {
    throw new Error(`recipe: unsupported version ${String(version)}`);
  }
  const p = migrateProject(incoming);
  if (typeof p.id !== 'string' || typeof p.title !== 'string') {
    throw new Error('recipe: missing id or title');
  }
  if (typeof p.seed !== 'number' || !Array.isArray(p.events)) {
    throw new Error('recipe: malformed body');
  }
  // A credit line straight from a stranger's file: it reaches the screen,
  // so it has to be the shape the screen expects.
  if (p.remixOf !== undefined) {
    const r = p.remixOf as Record<string, unknown> | null;
    if (typeof r !== 'object' || r === null || typeof r.title !== 'string' || typeof r.id !== 'string') {
      throw new Error('recipe: remixOf needs a title and an id');
    }
  }

  // Ids must be unique and references must point backwards, or the same
  // recipe could resolve differently in two implementations.
  const seen = new Map<string, string>();
  /** Slots opened so far per puppet, so PIN.index can only name a real one. */
  const pinSlots = new Map<string, number>();
  const snipSlots = new Map<string, number>();
  let prevGroup: string | undefined;
  const closedGroups = new Set<string>();

  for (const e of p.events) {
    const ev = e as Record<string, unknown>;
    if (typeof ev.kind !== 'string' || typeof ev.id !== 'string' || !isNum(ev.at)) {
      throw new Error('recipe: malformed event');
    }
    if (seen.has(ev.id)) throw new Error(`recipe: duplicate event id ${ev.id}`);
    if (ev.kind !== 'CAST' && typeof ev.puppetId !== 'string') {
      throw new Error(`recipe: ${ev.kind} event needs a puppetId`);
    }

    // A group is one contiguous run; undo pops the run, so a reopened group
    // would make undo span unrelated events.
    const group = ev.group;
    if (group !== undefined) {
      if (typeof group !== 'string' || group.length === 0) {
        throw new Error('recipe: group must be a non-empty string');
      }
      if (group !== prevGroup && closedGroups.has(group)) {
        throw new Error(`recipe: group ${group} is not contiguous`);
      }
    }
    if (prevGroup !== undefined && prevGroup !== group) closedGroups.add(prevGroup);
    prevGroup = typeof group === 'string' ? group : undefined;

    const refersBack = (id: unknown, kind: string, what: string) => {
      if (typeof id !== 'string' || seen.get(id) !== kind) {
        throw new Error(`recipe: ${what} must name an earlier ${kind}`);
      }
    };

    switch (ev.kind) {
      case 'CAST': {
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
        if (ev.flip !== undefined && typeof ev.flip !== 'boolean') {
          throw new Error('recipe: CAST flip must be a boolean');
        }
        const spec = ev.puppet as Record<string, unknown>;
        if (spec.spring !== undefined && !SPRING_PRESETS.includes(spec.spring as SpringPreset)) {
          throw new Error('recipe: unknown spring preset');
        }
        if (spec.name !== undefined && typeof spec.name !== 'string') {
          throw new Error('recipe: puppet name must be a string');
        }
        if (spec.strokeStyle !== undefined) {
          const strokes = spec.strokes;
          if (
            !Array.isArray(spec.strokeStyle) ||
            !Array.isArray(strokes) ||
            spec.strokeStyle.length !== strokes.length
          ) {
            throw new Error('recipe: strokeStyle must pair with strokes');
          }
        }
        break;
      }
      case 'REORDER':
        if (!Array.isArray(ev.order) || !ev.order.every((v: unknown) => typeof v === 'string')) {
          throw new Error('recipe: REORDER needs an order of puppet ids');
        }
        break;
      case 'PASS': {
        const ok =
          Array.isArray(ev.samples) &&
          ev.samples.length >= 3 &&
          ev.samples.length % 3 === 0 &&
          ev.samples.every((n: unknown) => isNum(n));
        if (!ok) throw new Error('recipe: PASS event needs t,x,y sample triples');
        if (ev.piece !== undefined && !(isNum(ev.piece) && ev.piece >= 0)) {
          throw new Error('recipe: PASS piece must be a snip index');
        }
        if (ev.pin !== undefined && !(isNum(ev.pin) && ev.pin >= 0)) {
          throw new Error('recipe: PASS pin must be a pin index');
        }
        if (ev.piece !== undefined && ev.pin !== undefined) {
          throw new Error('recipe: PASS cannot target both a piece and a pin');
        }
        break;
      }
      case 'SNIP': {
        if (!(isNum(ev.x0) && isNum(ev.y0) && isNum(ev.x1) && isNum(ev.y1))) {
          throw new Error('recipe: SNIP event needs a line');
        }
        const pid = ev.puppetId as string;
        snipSlots.set(pid, (snipSlots.get(pid) ?? 0) + 1);
        break;
      }
      case 'MOUTH':
        if (!(isNum(ev.mx) && isNum(ev.my) && isNum(ev.size) && (ev.size as number) > 0)) {
          throw new Error('recipe: MOUTH event needs mx, my, positive size');
        }
        break;
      case 'EYES':
        if (!(isNum(ev.ex) && isNum(ev.ey) && isNum(ev.size) && (ev.size as number) > 0)) {
          throw new Error('recipe: EYES event needs ex, ey, positive size');
        }
        break;
      case 'PIN': {
        if (!(isNum(ev.px) && isNum(ev.py))) {
          throw new Error('recipe: PIN event needs px, py');
        }
        const pid = ev.puppetId as string;
        const open = pinSlots.get(pid) ?? 0;
        if (ev.index === undefined) {
          pinSlots.set(pid, open + 1);
        } else if (!(isNum(ev.index) && Number.isInteger(ev.index) && ev.index >= 0 && ev.index < open)) {
          throw new Error('recipe: PIN index must name an existing pin');
        }
        break;
      }
      case 'REMOVE': {
        const target = ev.target as Record<string, unknown> | undefined;
        if (typeof target !== 'object' || target === null || Object.keys(target).length !== 1) {
          throw new Error('recipe: REMOVE needs exactly one target');
        }
        const pid = ev.puppetId as string;
        if ('mouth' in target || 'eyes' in target || 'voice' in target) {
          if (target.mouth !== true && target.eyes !== true && target.voice !== true) {
            throw new Error('recipe: REMOVE mouth/eyes/voice must be true');
          }
        } else if ('pin' in target) {
          const n = target.pin;
          if (!(isNum(n) && Number.isInteger(n) && n >= 0 && n < (pinSlots.get(pid) ?? 0))) {
            throw new Error('recipe: REMOVE pin must name an existing pin');
          }
        } else if ('snip' in target) {
          const n = target.snip;
          if (!(isNum(n) && Number.isInteger(n) && n >= 0 && n < (snipSlots.get(pid) ?? 0))) {
            throw new Error('recipe: REMOVE snip must name an existing snip');
          }
        } else if ('pass' in target) {
          refersBack(target.pass, 'PASS', 'REMOVE pass');
        } else if ('sound' in target) {
          refersBack(target.sound, 'SOUND', 'REMOVE sound');
        } else {
          throw new Error('recipe: unknown REMOVE target');
        }
        break;
      }
      case 'MUTE':
        if (typeof ev.muted !== 'boolean') throw new Error('recipe: MUTE needs muted');
        refersBack(ev.passId, 'PASS', 'MUTE passId');
        break;
      case 'TRIM':
        if (!(isNum(ev.from) && isNum(ev.to) && (ev.from as number) < (ev.to as number))) {
          throw new Error('recipe: TRIM needs from < to');
        }
        refersBack(ev.passId, 'PASS', 'TRIM passId');
        break;
      case 'VOICE': {
        if (typeof ev.assetId !== 'string' || !ev.assetId) {
          throw new Error('recipe: VOICE needs an assetId');
        }
        if (!(isNum(ev.durationS) && (ev.durationS as number) > 0)) {
          throw new Error('recipe: VOICE needs a positive durationS');
        }
        if (
          ev.gain !== undefined &&
          !(isNum(ev.gain) && (ev.gain as number) >= 0 && (ev.gain as number) <= 1)
        ) {
          throw new Error('recipe: VOICE gain must be in 0..1');
        }
        break;
      }
      case 'SOUND': {
        const ok =
          ev.sfx === 'boing' ||
          ev.sfx === 'slap' ||
          ev.sfx === 'honk' ||
          ev.sfx === 'scratch' ||
          ev.sfx === 'drop';
        if (!ok) throw new Error('recipe: SOUND event needs a known sfx');
        break;
      }
      case 'WIRE': {
        const srcOk = ev.source === 'on' || ev.source === 'voice' || ev.source === 'beat';
        const tgtOk =
          ev.target === 'bounce' ||
          ev.target === 'shake' ||
          ev.target === 'lean' ||
          ev.target === 'trails' ||
          ev.target === 'foley';
        if (!(srcOk && tgtOk && isNum(ev.amount) && ev.amount >= 0 && ev.amount <= 1)) {
          throw new Error('recipe: WIRE event needs a source, target, and amount in 0..1');
        }
        break;
      }
      case 'DROP':
        break;
      default:
        throw new Error(`recipe: unknown event kind ${ev.kind}`);
    }
    seen.set(ev.id, ev.kind);
  }
  return p as unknown as Project;
}
