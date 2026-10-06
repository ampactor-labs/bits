// The recipe: an append-only log of everything that makes a show. Casting,
// performed passes, scissor cuts, mouths, drops. Same recipe simulates to the
// same frames, always. Undo is popping the last event.

import { CAMERA_ID, CAMERA_PROPS, type CameraProp } from './camera';
import { isTargetFor } from './props';
import { parseSignal } from './signals';
import { genomeProblem, type Genome } from './ink';
import type { Palette, Paper } from './grade';

export const RECIPE_VERSION = 8 as const;
/** Every version this app can open. Older files migrate on load. */
export const READABLE_VERSIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

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
export type SpringPreset = 'paper' | 'felt' | 'rubber' | 'jelly' | 'stiff' | 'twos';

export const SPRING_PRESETS = ['paper', 'felt', 'rubber', 'jelly', 'stiff', 'twos'] as const;

interface SpecCommon {
  w: number;
  h: number;
  /** Shown on chips, lanes and in toasts. Metadata: never changes pixels. */
  name?: string;
  spring?: SpringPreset;
}

/** What a puppet is made of. rect exists for tests and fixtures. */
export type PuppetSpec =
  | ({
      type: 'cutout';
      assetId: string;
      /** 'cover' fills the box the way a backdrop fills the stage, cropping
       *  rather than stretching. Absent stretches the image to the box. */
      fit?: 'cover';
    } & SpecCommon)
  | ({
      type: 'doodle';
      strokes: number[][];
      /** Parallel to strokes; absent means the original bone at the default
       *  width, so v0 doodles draw exactly as they always did. */
      strokeStyle?: { color: string; width: number }[];
    } & SpecCommon)
  | ({ type: 'text'; text: string } & SpecCommon)
  | ({ type: 'rect'; color: string } & SpecCommon)
  /** A sheet grown rather than drawn: an ink genome, stored whole. */
  | ({ type: 'ink'; genome: Genome } & SpecCommon)
  /** A clip playing in show time. `at` is when its first frame shows,
   *  `clipFrom` how far into the file it starts, and it loops unless
   *  told not to. Its duration is stored, so where it is at any moment
   *  is a rule of the recipe, not of whichever decoder opens it. */
  | ({
      type: 'video';
      assetId: string;
      durationS: number;
      at?: number;
      clipFrom?: number;
      loop?: boolean;
    } & SpecCommon);

/** A puppet joins (or re-poses in) the cast. The latest CAST for a puppet
 *  wins and moves it to the front; `back` puts it in the back layer, behind
 *  everyone. Since v2 a backdrop is an ordinary sheet there: it moves, cuts,
 *  bends, talks and takes wires like any other. */
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
  /** How far behind the stage plane the sheet sits, in focal units (the
   *  focal distance is 2). Absent is 0. Free at rest: it changes nothing
   *  until the camera moves, except that a further sheet paints behind a
   *  nearer one in its layer. */
  depth?: number;
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
  /** Records one number instead of a point: samples are [t, v, 0]
   *  triples, so everything that reads passes by threes still works. Only
   *  the camera (puppetId '@camera') has props so far: dolly, roll, zoom. */
  prop?: CameraProp;
  /** What performed it: a finger (absent) or the phone's tilt. Metadata
   *  only; the pass plays the same either way. */
  via?: 'finger' | 'gyro';
}

/** How the whole stage looks. Latest wins per field; an absent field is
 *  off, which is how every bit before looks existed is drawn. */
export interface LookEvent extends EventBase {
  kind: 'LOOK';
  puppetId: '';
  /** Paper shadows, 0..1: how dark, and how far they fall per unit of
   *  depth between a sheet and the one behind it. */
  shadow?: number;
  /** Depth haze, 0..1: far sheets fade toward the fog colour. */
  fog?: number;
  fogColor?: string;
  /** Five colours the whole picture is mapped onto by brightness; null
   *  takes the palette off. */
  palette?: Palette | null;
  /** What it is printed on; null takes the paper away. */
  paper?: Paper | null;
}

/** A cut: at `at` the camera is simply somewhere else, still. It snaps the
 *  camera's pose and stops its motion, and the trails start clean. */
export interface CutEvent extends EventBase {
  kind: 'CUT';
  puppetId: typeof CAMERA_ID;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
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

export type SfxKind = 'boing' | 'slap' | 'honk' | 'scratch' | 'drop';

/** A performed sound: a foley-board tap at `at`, mixed into the show's audio.
 *  puppetId is '' (sounds belong to the stage). */
export interface SoundEvent extends EventBase {
  kind: 'SOUND';
  puppetId: string;
  sfx: SfxKind;
}

/** A modulation wire: a signal patched into a property, matrix-style.
 *  `from` names a signal (engine/signals.ts), `to` a target
 *  (engine/props.ts); puppetId '' is the stage. Latest wire per (sheet,
 *  from, to) wins; amount 0 unplugs. Every signal is deterministic, so
 *  wired shows replay and render bit-true. Since v5; v4's {source,
 *  target} migrate to it. */
export interface WireEvent extends EventBase {
  kind: 'WIRE';
  puppetId: string;
  from: string;
  to: string;
  /** -1..1: negative drives the target the other way. */
  amount: number;
  /** 0..1: lag, from 20 ms to 5 s. */
  smooth?: number;
  /** 0..1: ignore the signal below this. */
  threshold?: number;
  /** 0..2 seconds late. */
  delay?: number;
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
  | { sound: string }
  | { cut: string };

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

/** Dresses a sheet in an ink: its own content keeps its shape, the ink
 *  colours it. Latest wins; a null genome takes the ink off. The genome is
 *  stored whole, so a bit keeps its inks whatever breeding becomes. */
export interface InkEvent extends EventBase {
  kind: 'INK';
  puppetId: string;
  genome: Genome | null;
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
  | DropEvent
  | LookEvent
  | CutEvent
  | InkEvent;

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
  /** The shape of the stage, and of the film. Absent means the tall one
   *  every bit has had so far, so nothing already made changes shape. */
  aspect?: '9:16' | '16:9';
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

type Raw = Record<string, unknown>;

/** Each step takes a file of version v to v + 1. Old files are rewritten
 *  into today's shapes on load, so the engine only ever knows the latest
 *  meaning of every event. */
const MIGRATIONS: Record<number, (raw: Raw) => Raw> = {
  /** v0's grammar is a subset of v1's, so the events are already valid;
   *  only the header moves. */
  0: (raw) => ({
    ...raw,
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : raw.createdAt,
  }),
  /** v1 drew a backdrop cover-fit to the whole stage and ignored its
   *  transform and everything attached to it. v2 makes it an ordinary sheet,
   *  so a v1 backdrop becomes one that looks the same: a cover-fit image the
   *  size of the stage, at rest in the middle. Whatever v1 ignored is
   *  dropped rather than suddenly obeyed. */
  1: (raw) => {
    const events = Array.isArray(raw.events) ? (raw.events as Raw[]) : [];
    const latestBack = new Map<string, boolean>();
    for (const e of events) {
      if (e.kind === 'CAST' && typeof e.puppetId === 'string') {
        latestBack.set(e.puppetId, e.back === true);
      }
    }
    const backdrops = new Set([...latestBack].filter(([, back]) => back).map(([id]) => id));
    const IGNORED = new Set(['WIRE', 'MOUTH', 'EYES', 'PIN', 'SNIP', 'PASS']);
    const dropped = new Set<string>();
    const kept: Raw[] = [];
    for (const e of events) {
      if (IGNORED.has(e.kind as string) && backdrops.has(e.puppetId as string)) {
        dropped.add(e.id as string);
        continue;
      }
      const target = e.target as Raw | undefined;
      const names =
        e.kind === 'MUTE' || e.kind === 'TRIM'
          ? e.passId
          : e.kind === 'REMOVE' && target && 'pass' in target
            ? target.pass
            : e.kind === 'REMOVE' && backdrops.has(e.puppetId as string)
              ? '*'
              : undefined;
      if (names === '*' || (typeof names === 'string' && dropped.has(names))) continue;
      if (e.kind === 'CAST' && e.back === true) {
        const { flip: _flip, ...rest } = e;
        void _flip;
        kept.push({
          ...rest,
          puppet: { ...(e.puppet as Raw), fit: 'cover' },
          x: 0.5,
          y: 0.5,
          scale: 1,
          rot: 0,
        });
        continue;
      }
      kept.push(e);
    }
    return { ...raw, version: 2, events: kept };
  },
  /** v3 adds depth, the camera and scalar passes. Nothing in v2 means
   *  anything new, so only the header moves. */
  2: (raw) => ({ ...raw, version: 3 }),
  /** v4 adds looks, cuts and tilt-performed passes; nothing older changes. */
  3: (raw) => ({ ...raw, version: 4 }),
  /** v5 opens the wires into a matrix: {source, target} becomes {from,
   *  to}, and the old 'on' source is the signal 'const'. */
  4: (raw) => {
    const events = Array.isArray(raw.events) ? (raw.events as Raw[]) : [];
    return {
      ...raw,
      version: 5,
      events: events.map((e) => {
        if (e.kind !== 'WIRE') return e;
        const { source, target, ...rest } = e;
        return { ...rest, from: source === 'on' ? 'const' : source, to: target };
      }),
    };
  },
  /** v6 adds inks (an ink sheet, and INK to dress any sheet); nothing
   *  older changes. */
  5: (raw) => ({ ...raw, version: 6 }),
  /** v7 adds palettes, paper and three springs; nothing older changes. */
  6: (raw) => ({ ...raw, version: 7 }),
  /** v8 adds video sheets; nothing older changes. */
  7: (raw) => ({ ...raw, version: 8 }),
};

/** Bring a stored recipe up to today's version, one step at a time. Kept
 *  separate from parseProject so each migration can be tested directly on
 *  a stored fixture. */
export function migrateProject(raw: Raw): Raw {
  let out = raw;
  while (typeof out.version === 'number' && out.version < RECIPE_VERSION) {
    const step = MIGRATIONS[out.version];
    if (!step) break;
    out = step(out);
  }
  return out;
}

/** Append-only: returns a new project, never mutates. */
export function appendEvent(project: Project, event: RecipeEvent): Project {
  return { ...project, events: [...project.events, event] };
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** How near and how far a sheet can sit. Nearer than -1.5 and a modest
 *  dolly would put it behind the lens; past 20 it barely moves at all. */
export const MIN_DEPTH = -1.5;
export const MAX_DEPTH = 20;

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
  if (typeof version === 'number' && version > RECIPE_VERSION) {
    throw new Error('recipe: made with a newer bits, reload to update');
  }
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
  if (p.aspect !== undefined && p.aspect !== '9:16' && p.aspect !== '16:9') {
    throw new Error('recipe: aspect must be 9:16 or 16:9');
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
        if (ev.puppetId === CAMERA_ID) {
          throw new Error('recipe: the camera is not a puppet');
        }
        if (ev.depth !== undefined && !(isNum(ev.depth) && ev.depth >= MIN_DEPTH && ev.depth <= MAX_DEPTH)) {
          throw new Error(`recipe: CAST depth must be in ${MIN_DEPTH}..${MAX_DEPTH}`);
        }
        const spec = ev.puppet as Record<string, unknown>;
        if (spec.spring !== undefined && !SPRING_PRESETS.includes(spec.spring as SpringPreset)) {
          throw new Error('recipe: unknown spring preset');
        }
        if (spec.fit !== undefined && !(spec.type === 'cutout' && spec.fit === 'cover')) {
          throw new Error('recipe: fit is cover, on photos only');
        }
        if (spec.type === 'video') {
          const ok =
            typeof spec.assetId === 'string' &&
            spec.assetId.length > 0 &&
            isNum(spec.durationS) &&
            (spec.durationS as number) > 0 &&
            (spec.at === undefined || isNum(spec.at)) &&
            (spec.clipFrom === undefined ||
              (isNum(spec.clipFrom) && spec.clipFrom >= 0 && spec.clipFrom < (spec.durationS as number))) &&
            (spec.loop === undefined || typeof spec.loop === 'boolean');
          if (!ok) throw new Error('recipe: video needs an assetId, a positive duration, and a start inside it');
        }
        if (spec.type === 'ink' && genomeProblem(spec.genome) !== null) {
          throw new Error(`recipe: ink genome is malformed (${genomeProblem(spec.genome)})`);
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
        if (ev.prop !== undefined) {
          if (!CAMERA_PROPS.includes(ev.prop as CameraProp)) {
            throw new Error('recipe: PASS prop must be z, rot or scale');
          }
          if (ev.puppetId !== CAMERA_ID) {
            throw new Error('recipe: only the camera records props');
          }
        }
        if (ev.via !== undefined && ev.via !== 'finger' && ev.via !== 'gyro') {
          throw new Error('recipe: PASS via must be finger or gyro');
        }
        if (ev.puppetId === CAMERA_ID && (ev.piece !== undefined || ev.pin !== undefined)) {
          throw new Error('recipe: the camera has no pieces or pins');
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
        } else if ('cut' in target) {
          refersBack(target.cut, 'CUT', 'REMOVE cut');
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
        const unit = (v: unknown, max = 1) => v === undefined || (isNum(v) && v >= 0 && v <= max);
        if (
          typeof ev.from !== 'string' ||
          typeof ev.to !== 'string' ||
          !parseSignal(ev.from) ||
          !isTargetFor(ev.puppetId as string, ev.to)
        ) {
          throw new Error('recipe: WIRE needs a known signal and a target for its sheet or the stage');
        }
        if (!(isNum(ev.amount) && ev.amount >= -1 && ev.amount <= 1)) {
          throw new Error('recipe: WIRE amount must be in -1..1');
        }
        if (!unit(ev.smooth) || !unit(ev.threshold) || !unit(ev.delay, 2)) {
          throw new Error('recipe: WIRE smooth and threshold are 0..1, delay 0..2');
        }
        break;
      }
      case 'DROP':
        break;
      case 'LOOK': {
        const unit = (v: unknown) => v === undefined || (isNum(v) && v >= 0 && v <= 1);
        if (ev.puppetId !== '' || !unit(ev.shadow) || !unit(ev.fog)) {
          throw new Error('recipe: LOOK shadow and fog are 0..1, on the stage');
        }
        if (ev.fogColor !== undefined && !(typeof ev.fogColor === 'string' && /^#[0-9a-f]{6}$/i.test(ev.fogColor))) {
          throw new Error('recipe: LOOK fogColor must be #rrggbb');
        }
        if (ev.palette !== undefined && ev.palette !== null) {
          const pal = ev.palette as Record<string, unknown>;
          const ok =
            Array.isArray(pal.colors) &&
            pal.colors.length === 5 &&
            pal.colors.every((c: unknown) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) &&
            unit(pal.mix);
          if (!ok) throw new Error('recipe: LOOK palette needs five #rrggbb colours and a mix in 0..1');
        }
        if (ev.paper !== undefined && ev.paper !== null) {
          const pp = ev.paper as Record<string, unknown>;
          const ok = ['edge', 'grain', 'fade', 'misreg'].every((k) => isNum(pp[k]) && unit(pp[k]));
          if (!ok) throw new Error('recipe: LOOK paper needs edge, grain, fade and misreg in 0..1');
        }
        break;
      }
      case 'INK':
        if (ev.genome !== null && genomeProblem(ev.genome) !== null) {
          throw new Error(`recipe: INK genome is malformed (${genomeProblem(ev.genome)})`);
        }
        break;
      case 'CUT':
        if (
          ev.puppetId !== CAMERA_ID ||
          !(isNum(ev.x) && isNum(ev.y) && isNum(ev.z) && isNum(ev.rot) && isNum(ev.scale)) ||
          (ev.scale as number) <= 0
        ) {
          throw new Error('recipe: CUT needs the camera and a pose (x, y, z, rot, scale > 0)');
        }
        break;
      default:
        throw new Error(`recipe: unknown event kind ${ev.kind}`);
    }
    seen.set(ev.id, ev.kind);
  }
  return p as unknown as Project;
}
