// Show evaluation: CAST and PASS events become puppet motion over the audio
// spine. Passes are looper tracks: the newest pass covering a moment supplies
// the finger target; the spring supplies the life. Snipped pieces dangle on
// damped angular springs driven by the root's acceleration.

import {
  PUPPET_DT,
  restingPuppet,
  stepPuppet,
  type PuppetState,
  type PuppetTarget,
} from './puppet';
import type { MouthEvent, PassEvent, Project, PuppetSpec, SnipEvent } from './recipe';

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

/** The newest pass covering t owns the puppet; older passes fill the gaps. */
export function targetForPuppet(project: Project, puppetId: string, t: number): PuppetTarget | null {
  const passes = passesFor(project, puppetId);
  for (let i = passes.length - 1; i >= 0; i--) {
    const target = passTarget(passes[i]!, t);
    if (target) return target;
  }
  return null;
}

export interface ShowSim {
  advanceTo(t: number): Map<string, PuppetPose>;
  states(): Map<string, PuppetPose>;
}

export type TargetProvider = (puppetId: string, t: number) => PuppetTarget | null;

/** Incremental simulator on the global fixed-step grid: whole steps only, so
 *  every advance schedule runs the identical sequence and replay stays
 *  bit-exact. Seek by rebuilding. */
export function createShowSim(project: Project, fromT = 0, targets?: TargetProvider): ShowSim {
  const cast = castOf(project);
  const poses = new Map<string, PuppetPose>();
  for (const p of cast) {
    poses.set(p.id, {
      root: restingPuppet(p.home.x, p.home.y),
      dangles: snipsOf(project, p.id).map(() => ({ angle: 0, angVel: 0 })),
    });
  }
  let stepIndex = Math.floor(fromT / PUPPET_DT);

  return {
    advanceTo(t: number) {
      const targetStep = Math.floor(t / PUPPET_DT);
      if (targetStep > stepIndex) {
        const provider: TargetProvider = targets ?? ((id, tt) => targetForPuppet(project, id, tt));
        for (const p of cast) {
          if (p.back) continue;
          const pose = poses.get(p.id)!;
          let root = pose.root;
          const dangles = pose.dangles.map((d) => ({ ...d }));
          for (let k = stepIndex; k < targetStep; k++) {
            const next = stepPuppet(root, provider(p.id, k * PUPPET_DT));
            const ax = (next.vx - root.vx) / PUPPET_DT;
            for (const d of dangles) {
              const acc = -DANGLE_K * d.angle - DANGLE_D * d.angVel - DANGLE_COUPLE * ax;
              d.angVel += acc * PUPPET_DT;
              d.angle += d.angVel * PUPPET_DT;
              if (d.angle > DANGLE_MAX) {
                d.angle = DANGLE_MAX;
                d.angVel = Math.min(0, d.angVel);
              } else if (d.angle < -DANGLE_MAX) {
                d.angle = -DANGLE_MAX;
                d.angVel = Math.max(0, d.angVel);
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
