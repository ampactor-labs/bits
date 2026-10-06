// Wires: signals patched into properties, matrix-style (research said cables
// are spaghetti even for pros; the ARP 2500 knew it in 1970). Any signal in
// engine/signals.ts can drive any target in engine/props.ts. Every source
// is deterministic, so wired motion replays and renders bit-true.
//
// The five wires that existed before the matrix (bounce, shake and lean on
// a sheet; trails and foley on the stage, from const, voice or beat) keep
// their exact arithmetic and summation order, held byte for byte against
// the frozen copy in src/e2e/legacy/wires.ts. New sources and targets add
// after them, so an old bit's numbers never move.

import { REST_CAMERA, type CameraPose } from './camera';
import type { Look } from './show';
import { REACH, type Target } from './props';
import type { Project, WireEvent } from './recipe';
import type { PuppetPose } from './show';
import {
  bakeSignal,
  isShaped,
  isWorldSignal,
  parseSignal,
  timeSignalAt,
  worldSignalAt,
  type Baked,
  type Shaping,
  type Signal,
  type SignalSources,
} from './signals';
import { boilNoise } from './puppet';

export interface WireMods {
  scaleMul: number;
  dx: number;
  dy: number;
  dAngle: number;
  /** 0..1, absent is opaque. */
  alpha?: number;
  /** Degrees around the colour wheel, absent is none. */
  hue?: number;
  /** Added to the sheet's depth for projection. */
  dDepth?: number;
}

const IDENTITY_MODS: WireMods = { scaleMul: 1, dx: 0, dy: 0, dAngle: 0 };

const BOUNCE_MAX = 0.38;
const SHAKE_MAX = 0.03;
const LEAN_MAX = 0.45;
const SHAKE_HZ = 30;

/** One live wire. */
export interface Wire extends Shaping {
  pid: string;
  from: string;
  to: Target;
  amount: number;
  signal: Signal;
}

export type WireMap = Map<string, Wire>;

const key = (pid: string, from: string, to: string) => `${pid}|${from}|${to}`;

/** Latest wire per (sheet, signal, target) wins; amount 0 unplugs. */
export function effectiveWires(project: Project): WireMap {
  const map: WireMap = new Map();
  for (const e of project.events) {
    if (e.kind !== 'WIRE') continue;
    const k = key(e.puppetId, e.from, e.to);
    const signal = parseSignal(e.from);
    if (e.amount === 0 || !signal) map.delete(k);
    else map.set(k, wireOf(e, signal));
  }
  return map;
}

function wireOf(e: WireEvent, signal: Signal): Wire {
  return {
    pid: e.puppetId,
    from: e.from,
    to: e.to as Target,
    amount: e.amount,
    signal,
    ...(e.smooth !== undefined ? { smooth: e.smooth } : {}),
    ...(e.threshold !== undefined ? { threshold: e.threshold } : {}),
    ...(e.delay !== undefined ? { delay: e.delay } : {}),
  };
}

export function wireAmount(wires: WireMap, pid: string, from: string, to: string): number {
  return wires.get(key(pid, from, to))?.amount ?? 0;
}

export function wireAt(wires: WireMap, pid: string, from: string, to: string): Wire | undefined {
  return wires.get(key(pid, from, to));
}

/** The three sources the old wires knew, in the order they summed. */
const LEGACY_FROM = ['const', 'voice', 'beat'] as const;

/** Everything a wire's signal can be read from at one moment. */
export interface WireContext extends SignalSources {
  poses: Map<string, PuppetPose>;
}

/** Shaped wires' baked tracks, kept per wire object and per sources: the
 *  same wire map over the same analysis bakes once. */
const baked = new WeakMap<Wire, { src: SignalSources; track: Baked }>();

/** A wire's signal value at t, shaped if it asks to be. */
export function wireSignal(w: Wire, ctx: WireContext, t: number): number {
  if (isWorldSignal(w.signal)) return worldSignalAt(w.signal, ctx.poses);
  if (!isShaped(w)) return timeSignalAt(w.signal, ctx, t);
  let hit = baked.get(w);
  if (
    !hit ||
    hit.src.voice !== ctx.voice ||
    hit.src.onsets !== ctx.onsets ||
    hit.src.bands !== ctx.bands ||
    hit.src.voices !== ctx.voices ||
    hit.src.seed !== ctx.seed
  ) {
    const src: SignalSources = {
      voice: ctx.voice,
      onsets: ctx.onsets,
      voices: ctx.voices,
      bands: ctx.bands,
      seed: ctx.seed,
    };
    hit = { src, track: bakeSignal(w.signal, w, src) };
    baked.set(w, hit);
  }
  return hit.track.at(t);
}

/** Wires on one sheet, legacy ones first in the old order, then the rest
 *  in a fixed order of their own. Memoised per map. */
const bySheet = new WeakMap<WireMap, Map<string, { legacy: Wire[]; rest: Wire[] }>>();
function sheetWires(wires: WireMap, pid: string): { legacy: Wire[]; rest: Wire[] } {
  let index = bySheet.get(wires);
  if (!index) {
    index = new Map();
    bySheet.set(wires, index);
  }
  let out = index.get(pid);
  if (!out) {
    const legacy: Wire[] = [];
    const rest: Wire[] = [];
    for (const w of wires.values()) {
      if (w.pid !== pid) continue;
      const isLegacy =
        (w.to === 'bounce' || w.to === 'shake' || w.to === 'lean') &&
        (LEGACY_FROM as readonly string[]).includes(w.from) &&
        !isShaped(w) &&
        w.amount > 0;
      (isLegacy ? legacy : rest).push(w);
    }
    rest.sort((a, b) => (a.from + a.to < b.from + b.to ? -1 : a.from + a.to > b.from + b.to ? 1 : 0));
    out = { legacy, rest };
    index.set(pid, out);
  }
  return out;
}

/** Draw-time modulation for one sheet: bounded, seeded, pure. */
export function wireModsFor(wires: WireMap, pid: string, ctx: WireContext, t: number): WireMods {
  const { legacy, rest } = sheetWires(wires, pid);
  if (legacy.length === 0 && rest.length === 0) return IDENTITY_MODS;
  let scaleMul = 1;
  let dx = 0;
  let dy = 0;
  let dAngle = 0;
  let any = false;
  const seed = ctx.seed;
  const frame = Math.floor(t * SHAKE_HZ);
  // The old loop, exactly: per source in the old order, bounce then shake
  // then lean, each only when wired.
  for (const from of LEGACY_FROM) {
    const amountOf = (to: string) => legacy.find((w) => w.from === from && w.to === to)?.amount ?? 0;
    const bounce = amountOf('bounce');
    const shake = amountOf('shake');
    const lean = amountOf('lean');
    if (bounce === 0 && shake === 0 && lean === 0) continue;
    const s = timeSignalAt(parseSignal(from)!, ctx, t);
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
  let alpha: number | undefined;
  let hue: number | undefined;
  let dDepth: number | undefined;
  for (const w of rest) {
    const s = wireSignal(w, ctx, t);
    const a = w.amount;
    any = true;
    switch (w.to) {
      case 'bounce':
        scaleMul += a * BOUNCE_MAX * s;
        break;
      case 'shake':
        dx += a * SHAKE_MAX * s * boilNoise(seed, frame, 11);
        dy += a * SHAKE_MAX * s * boilNoise(seed, frame, 23);
        break;
      case 'lean':
        dAngle += a * LEAN_MAX * s * boilNoise(seed, frame, 37);
        break;
      case 'x':
        dx += a * REACH.x * s;
        break;
      case 'y':
        dy += a * REACH.y * s;
        break;
      case 'scale':
        scaleMul += a * REACH.scale * s;
        break;
      case 'rot':
        dAngle += a * REACH.rot * s;
        break;
      case 'opacity': {
        // Positive: the sheet appears with the signal. Negative: it fades
        // as the signal rises.
        const m = Math.abs(a);
        const shown = 1 - m + m * (a > 0 ? s : 1 - s);
        alpha = Math.min(1, Math.max(0, (alpha ?? 1) * shown));
        break;
      }
      case 'hue':
        hue = (hue ?? 0) + a * REACH.hue * s;
        break;
      case 'depth':
        dDepth = (dDepth ?? 0) + a * REACH.depth * s;
        break;
      default:
        break;
    }
  }
  if (!any) return IDENTITY_MODS;
  return {
    scaleMul: Math.max(0.05, scaleMul),
    dx,
    dy,
    dAngle,
    ...(alpha !== undefined ? { alpha } : {}),
    ...(hue !== undefined ? { hue } : {}),
    ...(dDepth !== undefined ? { dDepth } : {}),
  };
}

/** Stage trail strength in 0..1 from wires on the stage itself (pid ''). */
export function trailStrength(wires: WireMap, ctx: WireContext, t: number): number {
  let out = 0;
  for (const from of LEGACY_FROM) {
    const w = wireAt(wires, '', from, 'trails');
    if (w && w.amount > 0 && !isShaped(w)) {
      out = Math.max(out, w.amount * timeSignalAt(w.signal, ctx, t));
    }
  }
  for (const w of wires.values()) {
    if (w.pid !== '' || w.to !== 'trails') continue;
    if ((LEGACY_FROM as readonly string[]).includes(w.from) && !isShaped(w) && w.amount > 0) continue;
    out = Math.max(out, w.amount * wireSignal(w, ctx, t));
  }
  return Math.min(1, Math.max(0, out));
}

/** The stage's wired camera and fog, applied after the sim. Null camera
 *  in and nothing wired: null out, the explicit rest. */
export function stageMods(
  wires: WireMap,
  ctx: WireContext,
  t: number,
  camera: CameraPose | null,
  look: Look | null,
): { camera: CameraPose | null; look: Look | null } {
  let cam: CameraPose | null = null;
  let fog = 0;
  let any = false;
  for (const w of wires.values()) {
    if (w.pid !== '') continue;
    if (!w.to.startsWith('cam.') && w.to !== 'fog') continue;
    const v = w.amount * wireSignal(w, ctx, t);
    any = true;
    if (w.to === 'fog') {
      fog += v * REACH.fog;
      continue;
    }
    cam ??= { ...(camera ?? REST_CAMERA) };
    if (w.to === 'cam.x') cam.x += v * REACH['cam.x'];
    else if (w.to === 'cam.y') cam.y += v * REACH['cam.y'];
    else if (w.to === 'cam.z') cam.z += v * REACH['cam.z'];
    else if (w.to === 'cam.rot') cam.rot += v * REACH['cam.rot'];
    else if (w.to === 'cam.scale') cam.scale *= Math.max(0.1, 1 + v * REACH['cam.scale']);
  }
  if (!any) return { camera, look };
  const nextLook =
    fog !== 0
      ? {
          shadow: look?.shadow ?? 0,
          fog: Math.min(1, Math.max(0, (look?.fog ?? 0) + fog)),
          fogColor: look?.fogColor ?? '#8a93a6',
        }
      : look;
  return {
    camera: cam ?? camera,
    look: nextLook && (nextLook.shadow > 0 || nextLook.fog > 0) ? nextLook : null,
  };
}
