// One frame, as data. Everything that decides what a moment of a show looks
// like is assembled here and nowhere else: draw order, the sim's poses, what
// each mouth is saying, what the wires are doing, how much the stage ghosts.
//
// Preview, export, poster and the test harness all used to assemble this by
// hand around drawStage, three copies that had to stay in step. Now they
// build a Frame and hand it to a renderer, so a feature lands in one place
// and every way of looking at a show sees it.
//
// A "sheet" in docs/VISION.md is a puppet here: the recipe's names stay what
// files on phones already say.

import { SHAPE_CLOSED, voiceAt, EMPTY_VOICE, type VoiceMoment, type VoiceTrack } from './envelope';
import { splitPieces, type PuppetPieces } from './pieces';
import { IMPACT_SQUASH } from './sfx';
import type { EyesEvent, MouthEvent, PinEvent, Project } from './recipe';
import {
  castOf,
  createShowSim,
  eyesOf,
  mouthOf,
  pinsOf,
  snipsOf,
  talkOpenFor,
  type PuppetPose,
  type ShowPuppet,
  type TargetProvider,
} from './show';
import {
  effectiveWires,
  trailStrength,
  wireAmount,
  wireModsFor,
  type WireMap,
  type WireMods,
} from './wires';

/** What a puppet carries besides its spec: cut pieces, features, pins. */
export interface PuppetVisual {
  pieces: PuppetPieces;
  mouth: MouthEvent | null;
  eyes: EyesEvent | null;
  /** Pin slots; a null slot was removed and keeps its index so the passes
   *  that name later pins still find them. */
  pins: (PinEvent | null)[];
}

export function visualsOf(project: Project): Map<string, PuppetVisual> {
  const visuals = new Map<string, PuppetVisual>();
  for (const p of castOf(project)) {
    visuals.set(p.id, {
      pieces: splitPieces(snipsOf(project, p.id)),
      mouth: mouthOf(project, p.id),
      eyes: eyesOf(project, p.id),
      pins: pinsOf(project, p.id),
    });
  }
  return visuals;
}

/** A puppet's own take, decoded: its envelope and where in show time it
 *  starts. */
export interface OwnVoice {
  track: VoiceTrack;
  at: number;
  durationS: number;
}

/** What the show's sound says, worked out once from the audio. */
export interface Analysis {
  /** The bit's loudness and viseme track. */
  voice: VoiceTrack;
  /** Beat onsets in show seconds. */
  onsets: number[];
  /** Per-puppet takes. */
  voices: Map<string, OwnVoice>;
}

export const EMPTY_ANALYSIS: Analysis = { voice: EMPTY_VOICE, onsets: [], voices: new Map() };

/** Per-puppet voice moment at t.
 *
 *  A puppet with a take of its own flaps to that take, gated by the take's
 *  own span: the voice is the talker rule for it, so it does not also need
 *  a pass to be covering the moment. Everyone else flaps to the bit, gated
 *  by their passes as before. */
export function voiceMap(
  project: Project,
  visuals: Map<string, PuppetVisual>,
  track: VoiceTrack,
  t: number,
  voices?: Map<string, OwnVoice>,
): Map<string, VoiceMoment> {
  const out = new Map<string, VoiceMoment>();
  const base = voiceAt(track, t);
  for (const [id, v] of visuals) {
    if (!v.mouth) continue;
    const own = voices?.get(id);
    if (own) {
      const local = t - own.at;
      if (local < 0 || local > own.durationS) {
        out.set(id, { open: 0, shape: SHAPE_CLOSED });
      } else {
        const m = voiceAt(own.track, local);
        out.set(id, { open: m.open, shape: m.open === 0 ? SHAPE_CLOSED : m.shape });
      }
      continue;
    }
    const open = talkOpenFor(project, id, base.open, t);
    out.set(id, { open, shape: open === 0 ? SHAPE_CLOSED : base.shape });
  }
  return out;
}

/** One sheet in one frame. */
export interface LayerFrame {
  puppet: ShowPuppet;
  /** Absent for backdrops, which the sim does not move. */
  pose: PuppetPose | undefined;
  visual: PuppetVisual | undefined;
  voice: VoiceMoment;
  mods: WireMods;
}

export interface Frame {
  t: number;
  seed: number;
  /** How much of the previous frame survives (0 wipes clean). */
  trail: number;
  /** Back to front. */
  layers: LayerFrame[];
}

const SHUT: VoiceMoment = { open: 0, shape: SHAPE_CLOSED };

export interface ComposeInput {
  project: Project;
  cast: ShowPuppet[];
  visuals: Map<string, PuppetVisual>;
  wires: WireMap;
  analysis: Analysis;
  poses: Map<string, PuppetPose>;
  t: number;
  /** Idle stills are drawn clean; playing and rendering ghost. Default on. */
  trails?: boolean;
}

/** The pure half: given poses, everything else about the frame. */
export function composeFrame(input: ComposeInput): Frame {
  const { project, cast, visuals, wires, analysis, poses, t } = input;
  const voices = voiceMap(project, visuals, analysis.voice, t, analysis.voices);
  const layers: LayerFrame[] = cast.map((puppet) => ({
    puppet,
    pose: poses.get(puppet.id),
    visual: visuals.get(puppet.id),
    voice: voices.get(puppet.id) ?? SHUT,
    mods: wireModsFor(wires, puppet.id, analysis.voice, analysis.onsets, t, project.seed),
  }));
  return {
    t,
    seed: project.seed,
    trail: input.trails === false ? 0 : trailStrength(wires, analysis.voice, analysis.onsets, t),
    layers,
  };
}

/** Puppets whose squash just crossed the impact line: a landing. `prev`
 *  carries the last squash seen per puppet and is updated in place. */
export function impactsOf(prev: Map<string, number>, poses: Map<string, PuppetPose>): string[] {
  const out: string[] = [];
  for (const [pid, pose] of poses) {
    const before = prev.get(pid) ?? 0;
    if (pose.root.squash >= IMPACT_SQUASH && before < IMPACT_SQUASH) out.push(pid);
    prev.set(pid, pose.root.squash);
  }
  return out;
}

/** Impact foley is a stage wire. */
export const foleyOn = (wires: WireMap): boolean => wireAmount(wires, '', 'on', 'foley') > 0;

export interface Framer {
  /** Forward only, like the sim it drives: seeking back means a new one. */
  frameAt(t: number): Frame;
  /** Landings since the previous frameAt, when impact foley is wired. */
  impacts(): string[];
  readonly cast: ShowPuppet[];
}

export interface FramerOptions {
  fromT?: number;
  targets?: TargetProvider;
  trails?: boolean;
}

/** The whole path from recipe to frames, for anything that plays a show
 *  straight through: the export, the poster, the harness. */
export function createFramer(
  project: Project,
  analysis: Analysis = EMPTY_ANALYSIS,
  options: FramerOptions = {},
): Framer {
  const cast = castOf(project);
  const visuals = visualsOf(project);
  const wires = effectiveWires(project);
  const sim = createShowSim(project, options.fromT ?? 0, options.targets);
  const foley = foleyOn(wires);
  const squash = new Map<string, number>();
  let landed: string[] = [];
  return {
    cast,
    frameAt(t) {
      const poses = sim.advanceTo(t);
      landed = foley ? impactsOf(squash, poses) : [];
      return composeFrame({
        project,
        cast,
        visuals,
        wires,
        analysis,
        poses,
        t,
        ...(options.trails === undefined ? {} : { trails: options.trails }),
      });
    },
    impacts: () => landed,
  };
}
