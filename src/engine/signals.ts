// Signals: every number a wire can read, named by one string grammar that
// the recipe parser and the evaluator share, so a name the file accepts is
// always a name the engine can play.
//
//   const                     1, always
//   voice | voice:<pid>       the bit's mouth track, or one sheet's own take
//   beat                      a pulse at every onset, decaying
//   band:bass|mid|air         loudness in a frequency band (0..1)
//   bright                    how bright the sound is: its spectral centroid
//   lfo:<hz>                  a slow sine, 0..1
//   rand:<hz>                 smooth seeded wander, 0..1
//   step:<hz>                 seeded sample-and-hold, 0..1
//   sheet:<pid>.x|y|speed     where a sheet is, how fast it moves
//   dist:<a>:<b>              how far apart two sheets are
//
// Recorded signals (everything but sheet and dist) are functions of time
// alone, so their filtered forms are baked on the sim's 120 Hz grid: how a
// smoothed wire looks at a moment cannot depend on which moments a preview
// happened to ask for. World signals read the frame's poses and take no
// filter; the Wires room offers smoothing only where it can be exact.

import { voiceAt, type VoiceTrack } from './envelope';
import { boilNoise } from './puppet';
import type { PuppetPose } from './show';

export type Band = 'bass' | 'mid' | 'air';

export type Signal =
  | { kind: 'const' }
  | { kind: 'voice'; pid: string | null }
  | { kind: 'beat' }
  | { kind: 'band'; band: Band }
  | { kind: 'bright' }
  | { kind: 'lfo'; hz: number }
  | { kind: 'rand'; hz: number }
  | { kind: 'step'; hz: number }
  | { kind: 'sheet'; pid: string; of: 'x' | 'y' | 'speed' }
  | { kind: 'dist'; a: string; b: string };

const HZ = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

/** Null when the name means nothing. */
export function parseSignal(id: string): Signal | null {
  if (id === 'const') return { kind: 'const' };
  if (id === 'voice') return { kind: 'voice', pid: null };
  if (id === 'beat') return { kind: 'beat' };
  if (id === 'bright') return { kind: 'bright' };
  const colon = id.indexOf(':');
  if (colon < 0) return null;
  const head = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  switch (head) {
    case 'voice':
      return rest ? { kind: 'voice', pid: rest } : null;
    case 'band':
      return rest === 'bass' || rest === 'mid' || rest === 'air' ? { kind: 'band', band: rest } : null;
    case 'lfo':
    case 'rand':
    case 'step': {
      if (!HZ.test(rest)) return null;
      const hz = Number(rest);
      return hz > 0 && hz <= 30 ? { kind: head, hz } : null;
    }
    case 'sheet': {
      const dot = rest.lastIndexOf('.');
      if (dot <= 0) return null;
      const of = rest.slice(dot + 1);
      return of === 'x' || of === 'y' || of === 'speed'
        ? { kind: 'sheet', pid: rest.slice(0, dot), of }
        : null;
    }
    case 'dist': {
      const parts = rest.split(':');
      return parts.length === 2 && parts[0] && parts[1] ? { kind: 'dist', a: parts[0], b: parts[1] } : null;
    }
    default:
      return null;
  }
}

/** World signals read the sim; everything else is a function of time. */
export const isWorldSignal = (s: Signal): boolean => s.kind === 'sheet' || s.kind === 'dist';

/** Band loudness tracks on the 120 Hz grid, from a native-rate decode. */
export interface Bands {
  rate: number;
  bass: Float32Array;
  mid: Float32Array;
  air: Float32Array;
  bright: Float32Array;
}

/** What a signal can be read from. */
export interface SignalSources {
  voice: VoiceTrack;
  onsets: number[];
  /** Per-sheet takes: track plus where it starts. */
  voices: Map<string, { track: VoiceTrack; at: number; durationS: number }>;
  bands: Bands | null;
  seed: number;
}

const BEAT_DECAY = 7;

/** Impulse train from the onset grid: 1 at each beat, exponential decay.
 *  The same arithmetic the legacy beat wire used. */
export function beatPulse(onsets: number[], t: number): number {
  let last = -Infinity;
  for (let i = onsets.length - 1; i >= 0; i--) {
    if (onsets[i]! <= t) {
      last = onsets[i]!;
      break;
    }
  }
  if (!Number.isFinite(last)) return 0;
  return Math.exp(-BEAT_DECAY * (t - last));
}

const bandAt = (track: Float32Array, rate: number, t: number): number => {
  if (track.length === 0 || t < 0) return 0;
  const f = t * rate;
  const i = Math.floor(f);
  if (i >= track.length - 1) return track[track.length - 1] ?? 0;
  const u = f - i;
  return track[i]! * (1 - u) + track[i + 1]! * u;
};

/** 0..1 from the seed, for a grid cell of a seeded signal. */
const cell = (seed: number, hz: number, k: number) =>
  0.5 + 0.5 * boilNoise(seed ^ 0x5eed, Math.round(hz * 1000), k);

/** A time signal's raw value at t. */
export function timeSignalAt(s: Signal, src: SignalSources, t: number): number {
  switch (s.kind) {
    case 'const':
      return 1;
    case 'voice': {
      if (s.pid === null) return voiceAt(src.voice, t).open;
      const own = src.voices.get(s.pid);
      if (!own) return 0;
      const local = t - own.at;
      return local < 0 || local > own.durationS ? 0 : voiceAt(own.track, local).open;
    }
    case 'beat':
      return beatPulse(src.onsets, t);
    case 'band':
      return src.bands ? bandAt(src.bands[s.band], src.bands.rate, t) : 0;
    case 'bright':
      return src.bands ? bandAt(src.bands.bright, src.bands.rate, t) : 0;
    case 'lfo':
      return 0.5 - 0.5 * Math.cos(2 * Math.PI * s.hz * t);
    case 'rand': {
      const f = t * s.hz;
      const k = Math.floor(f);
      const u = f - k;
      const e = u * u * (3 - 2 * u);
      return cell(src.seed, s.hz, k) * (1 - e) + cell(src.seed, s.hz, k + 1) * e;
    }
    case 'step':
      return cell(src.seed, s.hz, Math.floor(t * s.hz));
    default:
      return 0;
  }
}

/** A world signal's value from the frame's poses. Speed is in stage units
 *  per second, scaled so a brisk drag reads near 1. */
export function worldSignalAt(s: Signal, poses: Map<string, PuppetPose>): number {
  if (s.kind === 'sheet') {
    const root = poses.get(s.pid)?.root;
    if (!root) return 0;
    if (s.of === 'x') return root.x;
    if (s.of === 'y') return root.y;
    return Math.min(1, Math.hypot(root.vx, root.vy) / 1.5);
  }
  if (s.kind === 'dist') {
    const a = poses.get(s.a)?.root;
    const b = poses.get(s.b)?.root;
    if (!a || !b) return 0;
    return Math.min(1, Math.hypot(a.x - b.x, a.y - b.y) / 0.7);
  }
  return 0;
}

/** How a wire shapes its signal before it reaches the target. */
export interface Shaping {
  /** 0..1: from 20 ms to 5 s of lag. */
  smooth?: number;
  /** 0..1: below this the signal reads 0; above, it rescales to 0..1. */
  threshold?: number;
  /** Seconds the signal arrives late, 0..2. */
  delay?: number;
}

export const isShaped = (w: Shaping): boolean =>
  (w.smooth ?? 0) > 0 || (w.threshold ?? 0) > 0 || (w.delay ?? 0) > 0;

export const BAKE_RATE = 120;

/** A shaped time signal, baked forward on the 120 Hz grid as far as it has
 *  been asked for. Causal, so extending it never changes what is there:
 *  any order of questions gets the same answers. */
export interface Baked {
  at(t: number): number;
}

export function bakeSignal(s: Signal, shaping: Shaping, src: SignalSources): Baked {
  const delay = shaping.delay ?? 0;
  const th = Math.min(0.99, shaping.threshold ?? 0);
  const smooth = shaping.smooth ?? 0;
  const tau = smooth > 0 ? 0.02 * Math.pow(250, smooth) : 0;
  const dt = 1 / BAKE_RATE;
  const kRelease = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
  const kAttack = tau > 0 ? 1 - Math.exp(-dt / (tau / 4)) : 1;
  let data = new Float32Array(256);
  let filled = 0;
  let y = 0;
  const extendTo = (n: number) => {
    if (n <= filled) return;
    if (n > data.length) {
      const grown = new Float32Array(Math.max(n, data.length * 2));
      grown.set(data.subarray(0, filled));
      data = grown;
    }
    for (let i = filled; i < n; i++) {
      const t = i * dt - delay;
      const raw = t < 0 ? 0 : timeSignalAt(s, src, t);
      const x = th > 0 ? Math.max(0, (raw - th) / (1 - th)) : raw;
      y += (x - y) * (x > y ? kAttack : kRelease);
      data[i] = y;
    }
    filled = n;
  };
  return {
    at(t) {
      if (t <= 0) {
        extendTo(1);
        return data[0]!;
      }
      const f = t * BAKE_RATE;
      const i = Math.floor(f);
      extendTo(i + 2);
      const u = f - i;
      return data[i]! * (1 - u) + data[i + 1]! * u;
    },
  };
}
