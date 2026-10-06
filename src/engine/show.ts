// Show evaluation: CAST and PASS events become puppet motion over the audio
// spine. Passes are looper tracks: the newest pass covering a moment supplies
// the target; the spring supplies the life. Root passes drag the body;
// piece passes swing a snipped-off piece toward the performed point. A
// mouthed puppet talks while one of its passes covers the moment.

import {
  PUPPET_DT,
  restingPuppet,
  stepPuppet,
  type PuppetState,
  type PuppetTarget,
} from './puppet';
import { polyCentroid, splitPieces, type PuppetPieces } from './pieces';
import { CAMERA_ID, CAMERA_PROPS, REST_CAMERA, type CameraPose, type CameraProp } from './camera';
import type { Genome } from './ink';
import type { Palette, Paper } from './grade';
import type {
  CutEvent,
  EyesEvent,
  LookEvent,
  MouthEvent,
  PassEvent,
  PinEvent,
  Project,
  PuppetSpec,
  RecipeEvent,
  SnipEvent,
  SpringPreset,
  VoiceEvent,
} from './recipe';

export interface ShowPuppet {
  id: string;
  spec: PuppetSpec;
  home: { x: number; y: number; scale: number; rot: number };
  back: boolean;
  /** Mirrors the local frame; see localToWorld. */
  flip: boolean;
  spring: SpringPreset;
  /** Behind the stage plane, in focal units; see engine/camera. */
  depth: number;
  /** The sheet it rides, and where on that sheet; null when free. */
  attach: { to: string; x: number; y: number } | null;
}

export interface DangleState {
  angle: number;
  angVel: number;
}

export interface PuppetPose {
  root: PuppetState;
  dangles: DangleState[];
  /** Warp pin positions in stage coords, spring-driven; empty when unpinned. */
  pins: PuppetState[];
}

const DANGLE_K = 42;
const DANGLE_D = 6.5;
const DANGLE_COUPLE = 1.1;
const DANGLE_MAX = 1.1;
const PIECE_K = 140;
const PIECE_D = 15;
const PIECE_MAX = 2.2;

/** Cast in draw order: backdrops first, then puppets, newest CAST in front.
 *  A DROP removes; a later CAST revives (and fronts). */
/** Read-only by contract: callers map or filter it, never change it in
 *  place, so one cast per event list can be shared by every caller. */
const castMemo = new WeakMap<RecipeEvent[], ShowPuppet[]>();

export function castOf(project: Project): ShowPuppet[] {
  let hit = castMemo.get(project.events);
  if (!hit) {
    hit = computeCast(project);
    castMemo.set(project.events, hit);
  }
  return hit;
}

function computeCast(project: Project): ShowPuppet[] {
  const map = new Map<string, ShowPuppet>();
  let order: string[] | null = null;
  for (const e of project.events) {
    if (e.kind === 'CAST') {
      // delete-then-set keeps the old rule: the latest CAST fronts its
      // puppet among the ones no REORDER names.
      map.delete(e.puppetId);
      map.set(e.puppetId, {
        id: e.puppetId,
        spec: e.puppet,
        home: { x: e.x, y: e.y, scale: e.scale, rot: e.rot },
        back: e.back === true,
        flip: e.flip === true,
        spring: e.puppet.spring ?? 'felt',
        depth: e.depth ?? 0,
        attach: e.attach ?? null,
      });
    } else if (e.kind === 'DROP') {
      map.delete(e.puppetId);
    } else if (e.kind === 'REORDER') {
      order = e.order;
    }
  }
  const all = [...map.values()];
  const backs = all.filter((p) => p.back);
  const fronts = all.filter((p) => !p.back);
  // With no REORDER the order is exactly what it always was, so every v0
  // recipe draws identically.
  if (!order) return [...backs, ...fronts];
  // A CAST for a puppet the latest REORDER names must not change its
  // layer, or the next drag would silently undo the reorder.
  const unlisted = new Map(fronts.map((p) => [p.id, p]));
  const listed: ShowPuppet[] = [];
  for (const id of order) {
    const p = unlisted.get(id);
    if (p) {
      listed.push(p);
      unlisted.delete(id);
    }
  }
  return [...backs, ...listed, ...unlisted.values()];
}

/** Snip slots, in the order they were cut. A removed snip leaves its slot
 *  as null rather than compacting the list: `snipIndex` is what every PASS
 *  with a `piece` target names, so renumbering would re-target them. */
export function snipsOf(project: Project, puppetId: string): (SnipEvent | null)[] {
  const slots: (SnipEvent | null)[] = [];
  for (const e of project.events) {
    if (e.kind === 'SNIP' && e.puppetId === puppetId) {
      slots.push(e);
    } else if (e.kind === 'REMOVE' && e.puppetId === puppetId && 'snip' in e.target) {
      if (e.target.snip < slots.length) slots[e.target.snip] = null;
    }
  }
  return slots;
}

/** Each snip slot's fold angle, or null where the snip is a swinging cut.
 *  Latest FOLD per slot wins. */
export function foldsOf(project: Project, puppetId: string): (number | null)[] {
  const folds: (number | null)[] = snipsOf(project, puppetId).map(() => null);
  for (const e of project.events) {
    if (e.kind === 'FOLD' && e.puppetId === puppetId && e.snip < folds.length) folds[e.snip] = e.angle;
  }
  return folds;
}

/** Pins apply only to uncut puppets: cut paper or bend it, not both. The
 *  exclusivity counts LIVE snips, so removing the last one makes a puppet
 *  pinnable again and brings back the pins it had before the cut.
 *
 *  Slots work like snips: a fresh PIN always opens slot `length`, a PIN
 *  with an index re-places that slot, and a removal nulls it. A freed slot
 *  is never reused. */
export function pinsOf(project: Project, puppetId: string): (PinEvent | null)[] {
  if (snipsOf(project, puppetId).some((snip) => snip !== null)) return [];
  const slots: (PinEvent | null)[] = [];
  for (const e of project.events) {
    if (e.kind === 'PIN' && e.puppetId === puppetId) {
      if (e.index === undefined) slots.push(e);
      else if (e.index < slots.length) slots[e.index] = e;
    } else if (e.kind === 'REMOVE' && e.puppetId === puppetId && 'pin' in e.target) {
      if (e.target.pin < slots.length) slots[e.target.pin] = null;
    }
  }
  return slots;
}

/** A puppet's own take, if it has one. Latest VOICE wins; a REMOVE with a
 *  voice target hands the puppet back to the bit. */
export function voiceOf(project: Project, puppetId: string): VoiceEvent | null {
  let out: VoiceEvent | null = null;
  for (const e of project.events) {
    if (e.kind === 'VOICE' && e.puppetId === puppetId) out = e;
    else if (e.kind === 'REMOVE' && e.puppetId === puppetId && 'voice' in e.target) out = null;
  }
  return out;
}

/** The ink a sheet is dressed in: latest INK wins, null takes it off. */
export function inkOf(project: Project, puppetId: string): Genome | null {
  let out: Genome | null = null;
  for (const e of project.events) {
    if (e.kind === 'INK' && e.puppetId === puppetId) out = e.genome;
  }
  return out;
}

/** The stage's look: latest wins per field, absent is off. */
export interface Look {
  shadow: number;
  fog: number;
  fogColor: string;
  palette: Palette | null;
  paper: Paper | null;
}

export const DEFAULT_FOG = '#8a93a6';

/** Per event list: a project is immutable, so its look and cuts are too,
 *  and the stage asks for them every frame. */
const lookMemo = new WeakMap<RecipeEvent[], Look | null>();
const cutsMemo = new WeakMap<RecipeEvent[], CutEvent[]>();

export function lookOf(project: Project): Look | null {
  if (lookMemo.has(project.events)) return lookMemo.get(project.events)!;
  const out = computeLook(project);
  lookMemo.set(project.events, out);
  return out;
}

function computeLook(project: Project): Look | null {
  let found = false;
  const look: Look = { shadow: 0, fog: 0, fogColor: DEFAULT_FOG, palette: null, paper: null };
  for (const e of project.events) {
    if (e.kind !== 'LOOK') continue;
    found = true;
    const l: LookEvent = e;
    if (l.shadow !== undefined) look.shadow = l.shadow;
    if (l.fog !== undefined) look.fog = l.fog;
    if (l.fogColor !== undefined) look.fogColor = l.fogColor;
    if (l.palette !== undefined) look.palette = l.palette;
    if (l.paper !== undefined) look.paper = l.paper;
  }
  // A look that is all off is no look: the plain drawing path.
  return found && (look.shadow > 0 || look.fog > 0 || look.palette !== null || look.paper !== null)
    ? look
    : null;
}

/** The camera's cuts in time order, without the ones taken out. */
export function cutsOf(project: Project): CutEvent[] {
  let hit = cutsMemo.get(project.events);
  if (!hit) {
    hit = computeCuts(project);
    cutsMemo.set(project.events, hit);
  }
  return hit;
}

function computeCuts(project: Project): CutEvent[] {
  const removed = new Set<string>();
  for (const e of project.events) {
    if (e.kind === 'REMOVE' && 'cut' in e.target) removed.add(e.target.cut);
  }
  return project.events
    .filter((e): e is CutEvent => e.kind === 'CUT' && !removed.has(e.id))
    .sort((a, b) => a.at - b.at);
}

/** The latest cut at or before t, in show seconds; null before the first. */
export function cutBefore(cuts: CutEvent[], t: number): number | null {
  let out: number | null = null;
  for (const c of cuts) {
    if (c.at <= t) out = c.at;
    else break;
  }
  return out;
}

/** Latest mouth wins; null when the puppet has none or it was removed. */
export function mouthOf(project: Project, puppetId: string): MouthEvent | null {
  let out: MouthEvent | null = null;
  for (const e of project.events) {
    if (e.kind === 'MOUTH' && e.puppetId === puppetId) out = e;
    else if (e.kind === 'REMOVE' && e.puppetId === puppetId && 'mouth' in e.target) out = null;
  }
  return out;
}

/** Latest eyes win; null when the puppet has none or they were removed. */
export function eyesOf(project: Project, puppetId: string): EyesEvent | null {
  let out: EyesEvent | null = null;
  for (const e of project.events) {
    if (e.kind === 'EYES' && e.puppetId === puppetId) out = e;
    else if (e.kind === 'REMOVE' && e.puppetId === puppetId && 'eyes' in e.target) out = null;
  }
  return out;
}

/** A pass as it actually plays: the event plus the window it covers after
 *  any trim. Removed and muted passes never appear. */
export interface EffectivePass {
  event: PassEvent;
  from: number;
  to: number;
}

/** A pass with everything the lanes need to draw it, including the ones
 *  the sim ignores: a muted pass you cannot see is a muted pass you cannot
 *  bring back. */
export interface LanePass extends EffectivePass {
  /** What was recorded, before any trim. */
  rawFrom: number;
  rawTo: number;
  muted: boolean;
  trimmed: boolean;
}

/** A MUTE, TRIM or REMOVE whose target is absent from the project we were
 *  handed is ignored rather than an error: corpse recording simulates a
 *  project with the passes stripped out but everything else intact. */
export function lanePasses(project: Project, puppetId: string): LanePass[] {
  const removed = new Set<string>();
  const muted = new Map<string, boolean>();
  const trims = new Map<string, { from: number; to: number }>();
  for (const e of project.events) {
    if (e.kind === 'REMOVE' && 'pass' in e.target) removed.add(e.target.pass);
    else if (e.kind === 'MUTE') muted.set(e.passId, e.muted);
    else if (e.kind === 'TRIM') trims.set(e.passId, { from: e.from, to: e.to });
  }
  const out: LanePass[] = [];
  for (const e of project.events) {
    if (e.kind !== 'PASS' || e.puppetId !== puppetId) continue;
    // A removed pass is gone from the lanes too: undo brings it back, and
    // a tombstone you can un-tick would make REMOVE mean two things.
    if (removed.has(e.id)) continue;
    const rawFrom = e.samples[0]!;
    const rawTo = e.samples[e.samples.length - 3]!;
    const trim = trims.get(e.id);
    const from = trim ? Math.max(rawFrom, trim.from) : rawFrom;
    const to = trim ? Math.min(rawTo, trim.to) : rawTo;
    if (to < from) continue;
    out.push({
      event: e,
      from,
      to,
      rawFrom,
      rawTo,
      muted: muted.get(e.id) === true,
      trimmed: !!trim && (from > rawFrom + 1e-6 || to < rawTo - 1e-6),
    });
  }
  return out;
}

/** The passes the sim honours: live, unmuted, within their trim. */
export function effectivePasses(project: Project, puppetId: string): EffectivePass[] {
  return lanePasses(project, puppetId)
    .filter((p) => !p.muted)
    .map(({ event, from, to }) => ({ event, from, to }));
}

/** Live passes for a puppet, ignoring their windows. */
export function passesFor(project: Project, puppetId: string): PassEvent[] {
  return effectivePasses(project, puppetId).map((p) => p.event);
}

function passCovers(pass: PassEvent, t: number, window?: { from: number; to: number }): boolean {
  const first = window ? window.from : pass.samples[0]!;
  const last = window ? window.to : pass.samples[pass.samples.length - 3]!;
  return t >= first && t <= last;
}

/** Linear interpolation between neighboring samples of a pass. */
export function passTarget(
  pass: PassEvent,
  t: number,
  window?: { from: number; to: number },
): PuppetTarget | null {
  if (!passCovers(pass, t, window)) return null;
  const s = pass.samples;
  for (let i = 0; i + 5 < s.length; i += 3) {
    const t0 = s[i]!;
    const t1 = s[i + 3]!;
    if (t >= t0 && t <= t1) {
      const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return {
        x: s[i + 1]! + (s[i + 4]! - s[i + 1]!) * f,
        y: s[i + 2]! + (s[i + 5]! - s[i + 2]!) * f,
      };
    }
  }
  return { x: s[s.length - 2]!, y: s[s.length - 1]! };
}

function newestCovering(passes: EffectivePass[], t: number): PuppetTarget | null {
  for (let i = passes.length - 1; i >= 0; i--) {
    const p = passes[i]!;
    const target = passTarget(p.event, t, p);
    if (target) return target;
  }
  return null;
}

/** The newest ROOT pass covering t owns the body; older passes fill gaps. */
export function targetForPuppet(project: Project, puppetId: string, t: number): PuppetTarget | null {
  return newestCovering(
    effectivePasses(project, puppetId).filter(
      (p) => p.event.piece === undefined && p.event.prop === undefined,
    ),
    t,
  );
}

/** A mouthed puppet talks while any of its passes covers t. A puppet with no
 *  passes at all talks freely, so a fresh cast flaps the moment it's mouthed. */
export function talkOpenFor(project: Project, puppetId: string, envOpen: number, t: number): number {
  const passes = effectivePasses(project, puppetId);
  if (passes.length === 0) return envOpen;
  return passes.some((p) => t >= p.from && t <= p.to) ? envOpen : 0;
}

export interface ShowSim {
  advanceTo(t: number): Map<string, PuppetPose>;
  states(): Map<string, PuppetPose>;
  /** Where the camera is after the last advance; null when this show has
   *  no camera to move (nothing to record it and no passes for it). */
  camera(): CameraPose | null;
}

/** Which part of a puppet a target drives. A prop is one number, carried
 *  in the target's x. */
export type Channel = null | { piece: number } | { pin: number } | { prop: CameraProp };

export const sameChannel = (a: Channel, b: Channel): boolean => {
  if (a === null || b === null) return a === b;
  if ('piece' in a) return 'piece' in b && a.piece === b.piece;
  if ('pin' in a) return 'pin' in b && a.pin === b.pin;
  return 'prop' in b && a.prop === b.prop;
};

/** Live-override targets: null channel is the body. */
export type TargetProvider = (puppetId: string, channel: Channel, t: number) => PuppetTarget | null;

interface PieceGeom {
  restAngle: number;
  joint: { x: number; y: number };
}

/** Watches every step of the sim: `k` is the step index, so the step ends
 *  at (k + 1) · PUPPET_DT. Called puppet by puppet, each in time order. */
export type StepObserver = (puppetId: string, k: number, root: PuppetState) => void;

/** The camera as the sim carries it: a body for pan, and one spring per
 *  prop, each riding in a PuppetState's x so it moves with the same weight
 *  as everything else on the stage (handheld for free). */
interface CameraBody {
  pan: PuppetState;
  props: Record<CameraProp, PuppetState>;
}

const restingCamera = (): CameraBody => ({
  pan: restingPuppet(REST_CAMERA.x, REST_CAMERA.y),
  props: {
    z: restingPuppet(REST_CAMERA.z, 0),
    rot: restingPuppet(REST_CAMERA.rot, 0),
    scale: restingPuppet(REST_CAMERA.scale, 0),
  },
});

/** Every second of sim time, everyone's state, so a seek steps at most a
 *  second instead of the whole show. Keyed by the event list itself: a
 *  project is immutable, so the same array always simulates the same way,
 *  and an edit makes a new array whose checkpoints start empty. */
const CHECKPOINT_STEPS = 120;
interface Checkpoint {
  poses: Map<string, PuppetPose>;
  /** What was on show: differs from the physics only for sheets on twos. */
  shown: Map<string, PuppetPose>;
  camera: CameraBody | null;
}

/** On twos: a sheet animated on twos shows a new pose every twelfth of a
 *  second (every ten sim steps) and holds it in between, the way cutout
 *  animation shot on film moves. The spring underneath runs as felt. */
const TWOS_STEPS = 10;
const checkpoints = new WeakMap<RecipeEvent[], Map<number, Checkpoint>>();

const copyPose = (pose: PuppetPose): PuppetPose => ({
  root: pose.root,
  dangles: pose.dangles.map((d) => ({ ...d })),
  pins: pose.pins.slice(),
});

const copyCamera = (c: CameraBody | null): CameraBody | null =>
  c && { pan: c.pan, props: { ...c.props } };

export interface ShowSimOptions {
  /** Start from the latest checkpoint at or before this time instead of
   *  from rest at `fromT`. Only for callers whose live targets cannot have
   *  acted before it; the caller still advances to the time it wants. */
  resumeAt?: number;
}

/** Incremental simulator on the global fixed-step grid: whole steps only, so
 *  every advance schedule runs the identical sequence and replay stays
 *  bit-exact. Seek backward by rebuilding and fast-forwarding. */
export function createShowSim(
  project: Project,
  fromT = 0,
  targets?: TargetProvider,
  onStep?: StepObserver,
  options: ShowSimOptions = {},
): ShowSim {
  const cast = castOf(project);
  let poses = new Map<string, PuppetPose>();

  // Precomputed per puppet: pass tables (root and per-piece) and piece
  // geometry, so the hot loop never rescans the event log.
  const rootPasses = new Map<string, EffectivePass[]>();
  const piecePasses = new Map<string, Map<number, EffectivePass[]>>();
  const pinPasses = new Map<string, Map<number, EffectivePass[]>>();
  const pieceGeoms = new Map<string, Map<number, PieceGeom>>();
  /** Parallel to the pin slots; a null slot has no local point. */
  const pinLocals = new Map<string, ({ x: number; y: number } | null)[]>();

  for (const p of cast) {
    const snips = snipsOf(project, p.id);
    const pins = pinsOf(project, p.id);
    pinLocals.set(
      p.id,
      pins.map((e) => (e ? { x: e.px, y: e.py } : null)),
    );
    poses.set(p.id, {
      root: restingPuppet(p.home.x, p.home.y),
      // One dangle per snip SLOT, so indices line up even where a snip was
      // removed.
      dangles: snips.map(() => ({ angle: 0, angVel: 0 })),
      pins: pins.map((e) => {
        if (!e) return restingPuppet(p.home.x, p.home.y);
        const world = localToWorld(restingPuppet(p.home.x, p.home.y), p, e.px, e.py);
        return restingPuppet(world.x, world.y);
      }),
    });

    const live = new Set<number>();
    snips.forEach((snip, i) => {
      if (snip) live.add(i);
    });
    const livePins = new Set<number>();
    pins.forEach((pin, i) => {
      if (pin) livePins.add(i);
    });

    const all = effectivePasses(project, p.id);
    rootPasses.set(
      p.id,
      all.filter((e) => e.event.piece === undefined && e.event.pin === undefined),
    );
    const byPiece = new Map<number, EffectivePass[]>();
    const byPin = new Map<number, EffectivePass[]>();
    for (const e of all) {
      // A pass whose target slot was removed drives nothing.
      if (e.event.piece !== undefined) {
        if (!live.has(e.event.piece)) continue;
        const list = byPiece.get(e.event.piece) ?? [];
        list.push(e);
        byPiece.set(e.event.piece, list);
      } else if (e.event.pin !== undefined) {
        if (!livePins.has(e.event.pin)) continue;
        const list = byPin.get(e.event.pin) ?? [];
        list.push(e);
        byPin.set(e.event.pin, list);
      }
    }
    piecePasses.set(p.id, byPiece);
    pinPasses.set(p.id, byPin);

    const pieces: PuppetPieces = splitPieces(snips);
    const geoms = new Map<number, PieceGeom>();
    for (const child of pieces.children) {
      const centroid = polyCentroid(child.poly);
      const joint = child.joint!;
      // A flipped puppet's local x runs the other way, so the world-space
      // direction from joint to centroid mirrors with it.
      const vx = (centroid.x - joint.x) * p.spec.w * p.home.scale * (p.flip ? -1 : 1);
      const vy = (centroid.y - joint.y) * p.spec.h * p.home.scale;
      geoms.set(child.snipIndex, { restAngle: Math.atan2(vy, vx), joint });
    }
    pieceGeoms.set(p.id, geoms);
  }

  let stepIndex = Math.floor(fromT / PUPPET_DT);

  // The camera only exists when something can move it: passes recorded for
  // it, or a live stage that might record one. Otherwise there is nothing
  // to step and the frame says "no camera", which draws as it always did.
  const cameraPasses = effectivePasses(project, CAMERA_ID);
  const panPasses = cameraPasses.filter((e) => e.event.prop === undefined);
  const propPasses = new Map<CameraProp, EffectivePass[]>(
    CAMERA_PROPS.map((prop) => [prop, cameraPasses.filter((e) => e.event.prop === prop)]),
  );
  const cuts = cutsOf(project);
  let cam: CameraBody | null =
    cameraPasses.length > 0 || cuts.length > 0 || targets !== undefined ? restingCamera() : null;
  /** Cuts by the step boundary they land on: the first boundary at or
   *  after the cut's time, so a frame drawn at the cut already sees it.
   *  Several on one boundary: the last wins. */
  const cutAtBoundary = new Map<number, CutEvent>();
  for (const c of cuts) cutAtBoundary.set(Math.ceil(c.at / PUPPET_DT - 1e-9), c);
  const snapTo = (body: CameraBody, cut: CutEvent): CameraBody => ({
    // Somewhere else, still: the pose snaps and every spring stops.
    pan: restingPuppet(cut.x, cut.y),
    props: {
      z: restingPuppet(cut.z, 0),
      rot: restingPuppet(cut.rot, 0),
      scale: restingPuppet(cut.scale, 0),
    },
  });
  const opening = cutAtBoundary.get(stepIndex);
  if (cam && opening && options.resumeAt === undefined) cam = snapTo(cam, opening);

  // Checkpoints are written only by sims nobody is steering live, from the
  // start of the show, so every one of them is the recipe's own truth.
  const book = (() => {
    let b = checkpoints.get(project.events);
    if (!b) {
      b = new Map();
      checkpoints.set(project.events, b);
    }
    return b;
  })();
  const writes = targets === undefined && stepIndex === 0;
  let shownCp: Map<string, PuppetPose> | null = null;
  if (options.resumeAt !== undefined && stepIndex === 0) {
    const want = Math.floor(options.resumeAt / PUPPET_DT);
    let best = 0;
    for (const k of book.keys()) if (k <= want && k > best) best = k;
    const cp = book.get(best);
    if (cp) {
      poses = new Map([...cp.poses].map(([id, pose]) => [id, copyPose(pose)]));
      shownCp = new Map([...cp.shown].map(([id, pose]) => [id, copyPose(pose)]));
      // A checkpoint written without a camera (no passes for it) is still
      // valid for a live stage: its camera just has not moved yet.
      cam = copyCamera(cp.camera) ?? (cam && restingCamera());
      stepIndex = best;
    }
  }
  /** What the frame shows; the physics in `poses` runs underneath. */
  const shown: Map<string, PuppetPose> = shownCp ?? new Map(poses);

  const camTarget = (channel: Channel, passes: EffectivePass[], t: number) => {
    if (targets) {
      const live = targets(CAMERA_ID, channel, t);
      if (live) return live;
    }
    return newestCovering(passes, t);
  };

  const stepCamera = (from: number, to: number) => {
    if (!cam) return;
    let { pan } = cam;
    const props = { ...cam.props };
    for (let k = from; k < to; k++) {
      const tt = k * PUPPET_DT;
      pan = stepPuppet(pan, camTarget(null, panPasses, tt), PUPPET_DT);
      for (const prop of CAMERA_PROPS) {
        const want = camTarget({ prop }, propPasses.get(prop)!, tt);
        props[prop] = stepPuppet(props[prop], want && { x: want.x, y: 0 }, PUPPET_DT);
      }
      const cut = cutAtBoundary.get(k + 1);
      if (cut) {
        const snapped = snapTo({ pan, props }, cut);
        pan = snapped.pan;
        Object.assign(props, snapped.props);
      }
    }
    cam = { pan, props };
  };

  const rootTarget = (p: ShowPuppet, t: number): PuppetTarget | null => {
    if (targets) {
      const live = targets(p.id, null, t);
      if (live) return live;
    }
    return newestCovering(rootPasses.get(p.id) ?? [], t);
  };

  // Kits: a riding sheet steps after the sheet it rides, and springs toward
  // its anchor on that sheet as it was at the same step. Parents first,
  // otherwise the cast's own order, so a show without kits steps as it
  // always did.
  const byId = new Map(cast.map((p) => [p.id, p]));
  const simOrder: ShowPuppet[] = [];
  {
    const placed = new Set<string>();
    const place = (p: ShowPuppet, depth: number) => {
      if (placed.has(p.id) || depth > cast.length) return;
      const parent = p.attach ? byId.get(p.attach.to) : undefined;
      if (parent) place(parent, depth + 1);
      if (!placed.has(p.id)) {
        placed.add(p.id);
        simOrder.push(p);
      }
    };
    for (const p of cast) place(p, 0);
  }
  /** Sheets something rides: only their roots are kept per step. */
  const ridden = new Set(cast.flatMap((p) => (p.attach && byId.has(p.attach.to) ? [p.attach.to] : [])));
  /** Each ridden sheet's root after every step of the chunk being stepped. */
  const chunkRoots = new Map<string, PuppetState[]>();
  const anchorTarget = (p: ShowPuppet, step: number, chunkStart: number): PuppetTarget | null => {
    if (!p.attach) return null;
    const parent = byId.get(p.attach.to);
    const roots = parent && chunkRoots.get(parent.id);
    const root = roots?.[step - chunkStart];
    return parent && root ? localToWorld(root, parent, p.attach.x, p.attach.y) : null;
  };

  const pieceTarget = (p: ShowPuppet, piece: number, t: number): PuppetTarget | null => {
    if (targets) {
      const live = targets(p.id, { piece }, t);
      if (live) return live;
    }
    return newestCovering(piecePasses.get(p.id)?.get(piece) ?? [], t);
  };

  const pinTarget = (p: ShowPuppet, pin: number, t: number): PuppetTarget | null => {
    if (targets) {
      const live = targets(p.id, { pin }, t);
      if (live) return live;
    }
    return newestCovering(pinPasses.get(p.id)?.get(pin) ?? [], t);
  };

  return {
    advanceTo(t: number) {
      const finalStep = Math.floor(t / PUPPET_DT);
      // In chunks that end on checkpoint boundaries. Each sheet steps on
      // its own, so where the chunks fall changes nothing it computes.
      while (finalStep > stepIndex) {
        const targetStep = Math.min(
          finalStep,
          (Math.floor(stepIndex / CHECKPOINT_STEPS) + 1) * CHECKPOINT_STEPS,
        );
        for (const p of simOrder) {
          const pose = poses.get(p.id)!;
          const rootsHere: PuppetState[] | null = ridden.has(p.id) ? [] : null;
          if (rootsHere) chunkRoots.set(p.id, rootsHere);
          let root = pose.root;
          const dangles = pose.dangles.map((d) => ({ ...d }));
          let pins = pose.pins;
          const geoms = pieceGeoms.get(p.id)!;
          const locals = pinLocals.get(p.id)!;
          const onTwos = p.spring === 'twos';
          let held: PuppetPose | null = null;
          for (let k = stepIndex; k < targetStep; k++) {
            const tt = k * PUPPET_DT;
            const next = stepPuppet(
              root,
              rootTarget(p, tt) ?? (p.attach ? anchorTarget(p, k, stepIndex) : null),
              PUPPET_DT,
              p.spring,
            );
            rootsHere?.push(next);
            // A mirrored puppet's local rotation runs the other way, so the
            // sideways acceleration that makes a piece swing flips with it.
            const ax = ((next.vx - root.vx) / PUPPET_DT) * (p.flip ? -1 : 1);
            // Pins chase their performed target, or ride home on the body.
            if (pins.length > 0) {
              pins = pins.map((pinState, pi) => {
                const local = locals[pi];
                // A removed slot has no pin to step; it just rests.
                if (!local) return pinState;
                const performed = pinTarget(p, pi, tt);
                const rest = localToWorld(next, p, local.x, local.y);
                return stepPuppet(pinState, performed ?? rest, PUPPET_DT, p.spring);
              });
            }
            for (let di = 0; di < dangles.length; di++) {
              const d = dangles[di]!;
              const geom = geoms.get(di);
              const performed = geom ? pieceTarget(p, di, tt) : null;
              if (performed && geom) {
                // Chase the performed point: desired angle from the joint's
                // world position, minus the piece's rest direction.
                const jw = jointWorld(next, p, geom.joint);
                // The drawer rotates the piece inside the puppet's local
                // frame, which the mirror reverses, so the angle that
                // reaches the finger is the negated one.
                const world = normalizeAngle(
                  Math.atan2(performed.y - jw.y, performed.x - jw.x) -
                    (geom.restAngle + next.angle + p.home.rot),
                );
                const desired = p.flip ? -world : world;
                const acc = PIECE_K * (desired - d.angle) - PIECE_D * d.angVel;
                d.angVel += acc * PUPPET_DT;
                d.angle += d.angVel * PUPPET_DT;
                d.angle = clampSwing(d, PIECE_MAX);
              } else {
                const acc = -DANGLE_K * d.angle - DANGLE_D * d.angVel - DANGLE_COUPLE * ax;
                d.angVel += acc * PUPPET_DT;
                d.angle += d.angVel * PUPPET_DT;
                d.angle = clampSwing(d, DANGLE_MAX);
              }
            }
            root = next;
            onStep?.(p.id, k, root);
            if (onTwos && (k + 1) % TWOS_STEPS === 0) {
              held = { root, dangles: dangles.map((d) => ({ ...d })), pins };
            }
          }
          const live = { root, dangles, pins };
          poses.set(p.id, live);
          shown.set(p.id, onTwos ? (held ?? shown.get(p.id) ?? live) : live);
        }
        stepCamera(stepIndex, targetStep);
        stepIndex = targetStep;
        if (writes && stepIndex % CHECKPOINT_STEPS === 0 && !book.has(stepIndex)) {
          book.set(stepIndex, {
            poses: new Map([...poses].map(([id, pose]) => [id, copyPose(pose)])),
            shown: new Map([...shown].map(([id, pose]) => [id, copyPose(pose)])),
            camera: copyCamera(cam),
          });
        }
      }
      return shown;
    },
    states() {
      return shown;
    },
    camera() {
      if (!cam) return null;
      return {
        x: cam.pan.x,
        y: cam.pan.y,
        z: cam.props.z.x,
        rot: cam.props.rot.x,
        scale: cam.props.scale.x,
      };
    },
  };
}

function jointWorld(
  root: PuppetState,
  p: ShowPuppet,
  joint: { x: number; y: number },
): { x: number; y: number } {
  return localToWorld(root, p, joint.x, joint.y);
}

/** Puppet-local box coords to stage coords under the current root frame. */
export function localToWorld(
  root: PuppetState,
  p: ShowPuppet,
  lx0: number,
  ly0: number,
): { x: number; y: number } {
  // Flip lives here, not at draw time. Pass samples are stage coords and
  // do not mirror with the puppet, so a draw-only mirror would put a
  // dragged pin at the mirror image of the finger.
  const lx = ((p.flip ? 1 - lx0 : lx0) - 0.5) * p.spec.w * p.home.scale;
  const ly = (ly0 - 0.5) * p.spec.h * p.home.scale;
  const a = root.angle + p.home.rot;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: root.x + lx * c - ly * s, y: root.y + lx * s + ly * c };
}

/** Where on `parent` a sheet at stage point (x, y) rides: the point in
 *  the parent's own box, as the parent sits at home. */
export function anchorOn(parent: ShowPuppet, x: number, y: number): { x: number; y: number } {
  return worldToLocal(restingPuppet(parent.home.x, parent.home.y), parent, x, y);
}

/** Stage coords back to puppet-local box coords under the current root frame. */
export function worldToLocal(
  root: PuppetState,
  p: ShowPuppet,
  wx: number,
  wy: number,
): { x: number; y: number } {
  const a = -(root.angle + p.home.rot);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = wx - root.x;
  const dy = wy - root.y;
  const x = (dx * c - dy * s) / (p.spec.w * p.home.scale) + 0.5;
  return {
    x: p.flip ? 1 - x : x,
    y: (dx * s + dy * c) / (p.spec.h * p.home.scale) + 0.5,
  };
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function clampSwing(d: DangleState, max: number): number {
  if (d.angle > max) {
    d.angVel = Math.min(0, d.angVel);
    return max;
  }
  if (d.angle < -max) {
    d.angVel = Math.max(0, d.angVel);
    return -max;
  }
  return d.angle;
}
