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
import type {
  EyesEvent,
  MouthEvent,
  PassEvent,
  PinEvent,
  Project,
  PuppetSpec,
  SnipEvent,
  SpringPreset,
} from './recipe';

export interface ShowPuppet {
  id: string;
  spec: PuppetSpec;
  home: { x: number; y: number; scale: number; rot: number };
  back: boolean;
  /** Mirrors the local frame; see localToWorld. */
  flip: boolean;
  spring: SpringPreset;
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
export function castOf(project: Project): ShowPuppet[] {
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
    effectivePasses(project, puppetId).filter((p) => p.event.piece === undefined),
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
}

/** Which part of a puppet a target drives. */
export type Channel = null | { piece: number } | { pin: number };

export const sameChannel = (a: Channel, b: Channel): boolean => {
  if (a === null || b === null) return a === b;
  if ('piece' in a) return 'piece' in b && a.piece === b.piece;
  return 'pin' in b && a.pin === b.pin;
};

/** Live-override targets: null channel is the body. */
export type TargetProvider = (puppetId: string, channel: Channel, t: number) => PuppetTarget | null;

interface PieceGeom {
  restAngle: number;
  joint: { x: number; y: number };
}

/** Incremental simulator on the global fixed-step grid: whole steps only, so
 *  every advance schedule runs the identical sequence and replay stays
 *  bit-exact. Seek backward by rebuilding and fast-forwarding. */
export function createShowSim(project: Project, fromT = 0, targets?: TargetProvider): ShowSim {
  const cast = castOf(project);
  const poses = new Map<string, PuppetPose>();

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

  const rootTarget = (p: ShowPuppet, t: number): PuppetTarget | null => {
    if (targets) {
      const live = targets(p.id, null, t);
      if (live) return live;
    }
    return newestCovering(rootPasses.get(p.id) ?? [], t);
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
      const targetStep = Math.floor(t / PUPPET_DT);
      if (targetStep > stepIndex) {
        for (const p of cast) {
          if (p.back) continue;
          const pose = poses.get(p.id)!;
          let root = pose.root;
          const dangles = pose.dangles.map((d) => ({ ...d }));
          let pins = pose.pins;
          const geoms = pieceGeoms.get(p.id)!;
          const locals = pinLocals.get(p.id)!;
          for (let k = stepIndex; k < targetStep; k++) {
            const tt = k * PUPPET_DT;
            const next = stepPuppet(root, rootTarget(p, tt), PUPPET_DT, p.spring);
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
          }
          poses.set(p.id, { root, dangles, pins });
        }
        stepIndex = targetStep;
      }
      return poses;
    },
    states() {
      return poses;
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
