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
import type { EyesEvent, MouthEvent, PassEvent, Project, PuppetSpec, SnipEvent } from './recipe';

export interface ShowPuppet {
  id: string;
  spec: PuppetSpec;
  home: { x: number; y: number; scale: number; rot: number };
  back: boolean;
}

export interface DangleState {
  angle: number;
  angVel: number;
}

export interface PuppetPose {
  root: PuppetState;
  dangles: DangleState[];
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
  for (const e of project.events) {
    if (e.kind === 'CAST') {
      map.delete(e.puppetId);
      map.set(e.puppetId, {
        id: e.puppetId,
        spec: e.puppet,
        home: { x: e.x, y: e.y, scale: e.scale, rot: e.rot },
        back: e.back === true,
      });
    } else if (e.kind === 'DROP') {
      map.delete(e.puppetId);
    }
  }
  const all = [...map.values()];
  return [...all.filter((p) => p.back), ...all.filter((p) => !p.back)];
}

export function snipsOf(project: Project, puppetId: string): SnipEvent[] {
  return project.events.filter(
    (e): e is SnipEvent => e.kind === 'SNIP' && e.puppetId === puppetId,
  );
}

/** Latest mouth wins; null when the puppet has none. */
export function mouthOf(project: Project, puppetId: string): MouthEvent | null {
  let out: MouthEvent | null = null;
  for (const e of project.events) {
    if (e.kind === 'MOUTH' && e.puppetId === puppetId) out = e;
  }
  return out;
}

/** Latest eyes win; null when the puppet has none. */
export function eyesOf(project: Project, puppetId: string): EyesEvent | null {
  let out: EyesEvent | null = null;
  for (const e of project.events) {
    if (e.kind === 'EYES' && e.puppetId === puppetId) out = e;
  }
  return out;
}

export function passesFor(project: Project, puppetId: string): PassEvent[] {
  return project.events.filter(
    (e): e is PassEvent => e.kind === 'PASS' && e.puppetId === puppetId,
  );
}

function passCovers(pass: PassEvent, t: number): boolean {
  const first = pass.samples[0]!;
  const last = pass.samples[pass.samples.length - 3]!;
  return t >= first && t <= last;
}

/** Linear interpolation between neighboring samples of a pass. */
export function passTarget(pass: PassEvent, t: number): PuppetTarget | null {
  if (!passCovers(pass, t)) return null;
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

function newestCovering(passes: PassEvent[], t: number): PuppetTarget | null {
  for (let i = passes.length - 1; i >= 0; i--) {
    const target = passTarget(passes[i]!, t);
    if (target) return target;
  }
  return null;
}

/** The newest ROOT pass covering t owns the body; older passes fill gaps. */
export function targetForPuppet(project: Project, puppetId: string, t: number): PuppetTarget | null {
  return newestCovering(
    passesFor(project, puppetId).filter((p) => p.piece === undefined),
    t,
  );
}

/** A mouthed puppet talks while any of its passes covers t. A puppet with no
 *  passes at all talks freely, so a fresh cast flaps the moment it's mouthed. */
export function talkOpenFor(project: Project, puppetId: string, envOpen: number, t: number): number {
  const passes = passesFor(project, puppetId);
  if (passes.length === 0) return envOpen;
  return passes.some((p) => passCovers(p, t)) ? envOpen : 0;
}

export interface ShowSim {
  advanceTo(t: number): Map<string, PuppetPose>;
  states(): Map<string, PuppetPose>;
}

/** Live-override targets: `piece` is null for the body, a snip index for a
 *  dangling piece. */
export type TargetProvider = (
  puppetId: string,
  piece: number | null,
  t: number,
) => PuppetTarget | null;

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
  const rootPasses = new Map<string, PassEvent[]>();
  const piecePasses = new Map<string, Map<number, PassEvent[]>>();
  const pieceGeoms = new Map<string, Map<number, PieceGeom>>();
  const pieceCount = new Map<string, number>();

  for (const p of cast) {
    const snips = snipsOf(project, p.id);
    pieceCount.set(p.id, snips.length);
    poses.set(p.id, {
      root: restingPuppet(p.home.x, p.home.y),
      dangles: snips.map(() => ({ angle: 0, angVel: 0 })),
    });
    const all = passesFor(project, p.id);
    rootPasses.set(
      p.id,
      all.filter((e) => e.piece === undefined),
    );
    const byPiece = new Map<number, PassEvent[]>();
    for (const e of all) {
      if (e.piece === undefined) continue;
      const list = byPiece.get(e.piece) ?? [];
      list.push(e);
      byPiece.set(e.piece, list);
    }
    piecePasses.set(p.id, byPiece);

    const pieces: PuppetPieces = splitPieces(snips);
    const geoms = new Map<number, PieceGeom>();
    for (const child of pieces.children) {
      const centroid = polyCentroid(child.poly);
      const joint = child.joint!;
      const vx = (centroid.x - joint.x) * p.spec.w * p.home.scale;
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
      const live = targets(p.id, piece, t);
      if (live) return live;
    }
    return newestCovering(piecePasses.get(p.id)?.get(piece) ?? [], t);
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
          const geoms = pieceGeoms.get(p.id)!;
          for (let k = stepIndex; k < targetStep; k++) {
            const tt = k * PUPPET_DT;
            const next = stepPuppet(root, rootTarget(p, tt));
            const ax = (next.vx - root.vx) / PUPPET_DT;
            for (let di = 0; di < dangles.length; di++) {
              const d = dangles[di]!;
              const geom = geoms.get(di);
              const performed = geom ? pieceTarget(p, di, tt) : null;
              if (performed && geom) {
                // Chase the performed point: desired angle from the joint's
                // world position, minus the piece's rest direction.
                const jw = jointWorld(next, p, geom.joint);
                const desired = normalizeAngle(
                  Math.atan2(performed.y - jw.y, performed.x - jw.x) -
                    (geom.restAngle + next.angle + p.home.rot),
                );
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
          poses.set(p.id, { root, dangles });
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
  const lx = (joint.x - 0.5) * p.spec.w * p.home.scale;
  const ly = (joint.y - 0.5) * p.spec.h * p.home.scale;
  const a = root.angle + p.home.rot;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: root.x + lx * c - ly * s, y: root.y + lx * s + ly * c };
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
