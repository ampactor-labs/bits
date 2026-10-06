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

import { inFront, isRestCamera, type CameraPose } from './camera';
import type { Bands } from './signals';
import { SHAPE_CLOSED, voiceAt, EMPTY_VOICE, type VoiceMoment, type VoiceTrack } from './envelope';
import { splitPieces, type PuppetPieces } from './pieces';
import { PUPPET_DT } from './puppet';
import { IMPACT_SQUASH } from './sfx';
import type { CutEvent, EyesEvent, MouthEvent, PinEvent, Project } from './recipe';
import {
  castOf,
  createShowSim,
  cutBefore,
  cutsOf,
  lookOf,
  eyesOf,
  mouthOf,
  pinsOf,
  snipsOf,
  talkOpenFor,
  type Look,
  type PuppetPose,
  type ShowPuppet,
  type StepObserver,
  type TargetProvider,
} from './show';
import {
  effectiveWires,
  stageMods,
  trailStrength,
  wireAmount,
  wireModsFor,
  type WireMap,
  type WireContext,
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
  /** Band loudness and brightness, once decoded; absent reads as silence. */
  bands?: Bands | null;
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
  /** Behind the stage plane; the renderer projects the sheet through the
   *  camera at this depth. */
  depth: number;
}

export interface Frame {
  t: number;
  seed: number;
  /** How much of the previous frame survives (0 wipes clean). */
  trail: number;
  /** Null when the camera is at rest: an explicit identity, so a renderer
   *  draws exactly what it drew before there was a camera. */
  camera: CameraPose | null;
  /** Shadows and fog; null draws as every bit before looks did. */
  look: Look | null;
  /** The latest camera cut at or before t: a renderer that last drew
   *  before it starts clean. */
  cutAt: number | null;
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
  camera?: CameraPose | null;
  /** Precomputed by callers that build many frames; read from the project
   *  otherwise. */
  look?: Look | null;
  cuts?: CutEvent[];
}

/** Paint order: the back layer stays behind, and within each layer a
 *  further sheet paints first. Stable, so sheets at the same depth keep
 *  the cast's order and a show with no depth paints as it always did. */
export function paintOrder(cast: ShowPuppet[]): ShowPuppet[] {
  if (cast.every((p) => p.depth === 0)) return cast;
  const rank = new Map(cast.map((p, i) => [p.id, i]));
  return [...cast].sort(
    (a, b) =>
      Number(a.back === false) - Number(b.back === false) ||
      b.depth - a.depth ||
      rank.get(a.id)! - rank.get(b.id)!,
  );
}

/** The pure half: given poses, everything else about the frame. */
export function composeFrame(input: ComposeInput): Frame {
  const { project, cast, visuals, wires, analysis, poses, t } = input;
  const ctx: WireContext = {
    voice: analysis.voice,
    onsets: analysis.onsets,
    voices: analysis.voices,
    bands: analysis.bands ?? null,
    seed: project.seed,
    poses,
  };
  // The stage's wires move the camera and the fog after the sim: wires
  // never feed physics.
  const staged = stageMods(
    wires,
    ctx,
    t,
    input.camera ?? null,
    input.look === undefined ? lookOf(project) : input.look,
  );
  const camera = staged.camera && !isRestCamera(staged.camera) ? staged.camera : null;
  const voices = voiceMap(project, visuals, analysis.voice, t, analysis.voices);
  const layers: LayerFrame[] = [];
  for (const puppet of paintOrder(cast)) {
    // Behind the lens is not drawn at all.
    const mods = wireModsFor(wires, puppet.id, ctx, t);
    const depth = puppet.depth + (mods.dDepth ?? 0);
    if (camera && !inFront(camera, depth)) continue;
    layers.push({
      puppet,
      pose: poses.get(puppet.id),
      visual: visuals.get(puppet.id),
      voice: voices.get(puppet.id) ?? SHUT,
      mods,
      depth,
    });
  }
  return {
    t,
    seed: project.seed,
    trail: input.trails === false ? 0 : trailStrength(wires, ctx, t),
    camera,
    look: staged.look,
    cutAt: cutBefore(input.cuts ?? cutsOf(project), t),
    layers,
  };
}

/** A landing: a puppet's squash crossing the impact line on the way up. */
export interface Impact {
  /** Show seconds, at the sim step where it crossed. */
  at: number;
  puppetId: string;
}

/** Listens to every sim step for landings. Detection used to look at
 *  whatever frames happened to be drawn, so a 60 fps preview and a 30 fps
 *  film heard different landings; at the sim's own resolution they hear
 *  the same ones at the same moments. */
export function impactListener(): { onStep: StepObserver; drain(): Impact[] } {
  const squash = new Map<string, number>();
  let heard: Impact[] = [];
  return {
    onStep(puppetId, k, root) {
      const before = squash.get(puppetId) ?? 0;
      if (root.squash >= IMPACT_SQUASH && before < IMPACT_SQUASH) {
        heard.push({ at: (k + 1) * PUPPET_DT, puppetId });
      }
      squash.set(puppetId, root.squash);
    },
    drain() {
      const out = heard.sort((a, b) => a.at - b.at || (a.puppetId < b.puppetId ? -1 : 1));
      heard = [];
      return out;
    },
  };
}

/** Impact foley is a stage wire. */
export const foleyOn = (wires: WireMap): boolean => wireAmount(wires, '', 'const', 'foley') > 0;

export interface Framer {
  /** Forward only, like the sim it drives: seeking back means a new one. */
  frameAt(t: number): Frame;
  /** Landings up to the latest frameAt not handed out before, in time
   *  order, when impact foley is wired. */
  impacts(): Impact[];
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
  const look = lookOf(project);
  const cuts = cutsOf(project);
  const listener = foleyOn(wires) ? impactListener() : null;
  const sim = createShowSim(project, options.fromT ?? 0, options.targets, listener?.onStep);
  return {
    cast,
    frameAt(t) {
      const poses = sim.advanceTo(t);
      return composeFrame({
        project,
        cast,
        visuals,
        wires,
        analysis,
        poses,
        t,
        camera: sim.camera(),
        look,
        cuts,
        ...(options.trails === undefined ? {} : { trails: options.trails }),
      });
    },
    impacts: () => listener?.drain() ?? [],
  };
}
