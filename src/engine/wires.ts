// Wires: signals patched into properties, matrix-style (research said cables
// are spaghetti even for pros; the ARP 2500 knew it in 1970). Sources are
// deterministic — a constant, the voice track, or beat impulses from the
// onset grid — so wired motion replays and renders bit-true.

import { voiceAt, type VoiceTrack } from './envelope';
import { boilNoise } from './puppet';
import type { Project, WireSource, WireTarget } from './recipe';

export interface WireMods {
  scaleMul: number;
  dx: number;
  dy: number;
  dAngle: number;
}

const IDENTITY_MODS: WireMods = { scaleMul: 1, dx: 0, dy: 0, dAngle: 0 };

const BOUNCE_MAX = 0.38;
const SHAKE_MAX = 0.03;
const LEAN_MAX = 0.45;
const BEAT_DECAY = 7;
const SHAKE_HZ = 30;

export type WireMap = Map<string, { source: WireSource; target: WireTarget; amount: number }>;

const key = (pid: string, source: WireSource, target: WireTarget) => `${pid}|${source}|${target}`;

/** Latest wire per (puppet, source, target) wins; amount 0 unplugs. */
export function effectiveWires(project: Project): WireMap {
  const map: WireMap = new Map();
  for (const e of project.events) {
    if (e.kind !== 'WIRE') continue;
    const k = key(e.puppetId, e.source, e.target);
    if (e.amount <= 0) map.delete(k);
    else map.set(k, { source: e.source, target: e.target, amount: e.amount });
  }
  return map;
}

export function wireAmount(
  wires: WireMap,
  pid: string,
  source: WireSource,
  target: WireTarget,
): number {
  return wires.get(key(pid, source, target))?.amount ?? 0;
}

/** Impulse train from the onset grid: 1 at each beat, exponential decay. */
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

function signalAt(source: WireSource, voice: VoiceTrack, onsets: number[], t: number): number {
  switch (source) {
    case 'on':
      return 1;
    case 'voice':
      return voiceAt(voice, t).open;
    case 'beat':
      return beatPulse(onsets, t);
  }
}

/** Draw-time modulation for one puppet: bounded, seeded, pure. */
export function wireModsFor(
  wires: WireMap,
  pid: string,
  voice: VoiceTrack,
  onsets: number[],
  t: number,
  seed: number,
): WireMods {
  let scaleMul = 1;
  let dx = 0;
  let dy = 0;
  let dAngle = 0;
  let any = false;
  const frame = Math.floor(t * SHAKE_HZ);
  for (const source of ['on', 'voice', 'beat'] as const) {
    const bounce = wireAmount(wires, pid, source, 'bounce');
    const shake = wireAmount(wires, pid, source, 'shake');
    const lean = wireAmount(wires, pid, source, 'lean');
    if (bounce === 0 && shake === 0 && lean === 0) continue;
    const s = signalAt(source, voice, onsets, t);
    if (bounce > 0) {
      scaleMul += bounce * BOUNCE_MAX * s;
      any = true;
    }
    if (shake > 0) {
      dx += shake * SHAKE_MAX * s * boilNoise(seed, frame, 11);
      dy += shake * SHAKE_MAX * s * boilNoise(seed, frame, 23);
      any = true;
    }
    if (lean > 0) {
      dAngle += lean * LEAN_MAX * s * boilNoise(seed, frame, 37);
      any = true;
    }
  }
  return any ? { scaleMul, dx, dy, dAngle } : IDENTITY_MODS;
}

/** Stage trail strength in 0..1 from wires on the stage itself (pid ''). */
export function trailStrength(
  wires: WireMap,
  voice: VoiceTrack,
  onsets: number[],
  t: number,
): number {
  let out = 0;
  for (const source of ['on', 'voice', 'beat'] as const) {
    const amount = wireAmount(wires, '', source, 'trails');
    if (amount > 0) out = Math.max(out, amount * signalAt(source, voice, onsets, t));
  }
  return Math.min(1, out);
}
