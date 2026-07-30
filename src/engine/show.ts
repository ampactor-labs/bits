// Show evaluation: turns CAST and PASS events into puppet motion over the
// audio spine. Passes are looper tracks: for each puppet, the newest pass
// covering a moment supplies the finger target; the spring does the rest.

import {
  PUPPET_DT,
  restingPuppet,
  simulatePuppetSteps,
  type PuppetState,
  type PuppetTarget,
} from './puppet';
import type { PassEvent, Project, PuppetSpec } from './recipe';

export interface ShowPuppet {
  id: string;
  spec: PuppetSpec;
  home: { x: number; y: number; scale: number };
}

export function castOf(project: Project): ShowPuppet[] {
  const out = new Map<string, ShowPuppet>();
  for (const e of project.events) {
    if (e.kind === 'CAST') {
      out.set(e.puppetId, {
        id: e.puppetId,
        spec: e.puppet,
        home: { x: e.x, y: e.y, scale: e.scale },
      });
    }
  }
  return [...out.values()];
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

/** Incremental simulator: advance monotonically, seek by rebuilding. */
export interface ShowSim {
  advanceTo(t: number): Map<string, PuppetState>;
  states(): Map<string, PuppetState>;
}

export type TargetProvider = (puppetId: string, t: number) => PuppetTarget | null;

export function createShowSim(project: Project, fromT = 0, targets?: TargetProvider): ShowSim {
  const cast = castOf(project);
  const states = new Map<string, PuppetState>();
  for (const p of cast) states.set(p.id, restingPuppet(p.home.x, p.home.y));
  // Whole steps on the global grid; see simulatePuppetSteps for why.
  let stepIndex = Math.floor(fromT / PUPPET_DT);

  return {
    advanceTo(t: number) {
      const targetStep = Math.floor(t / PUPPET_DT);
      if (targetStep > stepIndex) {
        const provider: TargetProvider = targets ?? ((id, tt) => targetForPuppet(project, id, tt));
        for (const p of cast) {
          const state = states.get(p.id)!;
          states.set(
            p.id,
            simulatePuppetSteps(state, stepIndex, targetStep, (tt) => provider(p.id, tt)),
          );
        }
        stepIndex = targetStep;
      }
      return states;
    },
    states() {
      return states;
    },
  };
}
