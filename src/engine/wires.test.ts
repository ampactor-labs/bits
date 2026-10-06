import { describe, expect, it } from 'vitest';
import * as legacy from '../e2e/legacy/wires';
import { computeVoiceTrack } from './envelope';
import { parseProject, type Project } from './recipe';
import { bakeSignal, parseSignal, timeSignalAt, type SignalSources } from './signals';
import { effectiveWires, stageMods, trailStrength, wireModsFor, type WireContext } from './wires';
import { REST_CAMERA } from './camera';

const RATE = 16000;
const voice = (() => {
  const s = new Float32Array(RATE * 4);
  for (let i = 0; i < s.length; i++) {
    const t = i / RATE;
    s[i] = Math.max(0, Math.sin(t * Math.PI * 2.7)) * 0.6 * Math.sin(2 * Math.PI * 220 * t);
  }
  return computeVoiceTrack(s, RATE);
})();
const onsets = [0.4, 0.9, 1.3, 2.2, 3.1];

/** A seeded little generator, so the random wire sets are the same every
 *  run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A v4 file holding a random handful of the old wires. */
function v4Show(seed: number) {
  const r = rng(seed);
  const sources = ['on', 'voice', 'beat'] as const;
  const targets = ['bounce', 'shake', 'lean'] as const;
  const events: Record<string, unknown>[] = [];
  let n = 0;
  for (const pid of ['a', 'b']) {
    events.push({
      kind: 'CAST',
      id: `c${pid}`,
      at: 0,
      puppetId: pid,
      puppet: { type: 'rect', color: '#fff', w: 0.2, h: 0.2 },
      x: 0.5,
      y: 0.5,
      scale: 1,
      rot: 0,
    });
  }
  for (let i = 0; i < 8; i++) {
    const stage = r() < 0.25;
    events.push({
      kind: 'WIRE',
      id: `w${n++}`,
      at: 0,
      puppetId: stage ? '' : r() < 0.5 ? 'a' : 'b',
      source: sources[Math.floor(r() * 3)],
      target: stage ? (r() < 0.7 ? 'trails' : 'foley') : targets[Math.floor(r() * 3)],
      amount: [0, 0.5, 1, 0.25][Math.floor(r() * 4)],
    });
  }
  return { version: 4, id: 'x', title: 'x', createdAt: '', seed: 1000 + seed, events };
}

describe('the matrix keeps the old wires exact', () => {
  it('matches the frozen wires byte for byte on every old wire set', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const raw = v4Show(seed);
      const project: Project = parseProject(JSON.stringify(raw));
      const old = legacy.effectiveWires(raw);
      const now = effectiveWires(project);
      const ctx: WireContext = {
        voice,
        onsets,
        voices: new Map(),
        bands: null,
        seed: project.seed,
        poses: new Map(),
      };
      for (let t = 0; t < 3.5; t += 0.0371) {
        for (const pid of ['a', 'b']) {
          expect(wireModsFor(now, pid, ctx, t)).toEqual(
            legacy.wireModsFor(old, pid, voice, onsets, t, project.seed),
          );
        }
        expect(trailStrength(now, ctx, t)).toBe(legacy.trailStrength(old, voice, onsets, t));
      }
    }
  });

  it('migrates v4 wires to from/to, with on as const', () => {
    const project = parseProject(JSON.stringify(v4Show(3)));
    const wires = project.events.filter((e) => e.kind === 'WIRE');
    expect(wires.length).toBeGreaterThan(0);
    for (const w of wires) {
      expect(w).not.toHaveProperty('source');
      expect(['const', 'voice', 'beat']).toContain(w.from);
    }
  });
});

describe('signals', () => {
  const src: SignalSources = { voice, onsets, voices: new Map(), bands: null, seed: 9 };

  it('parse the grammar and refuse what it is not', () => {
    for (const ok of ['const', 'voice', 'voice:a', 'beat', 'band:bass', 'bright', 'lfo:0.5', 'rand:2', 'step:4', 'sheet:a.speed', 'dist:a:b']) {
      expect(parseSignal(ok), ok).not.toBeNull();
    }
    for (const bad of ['on', 'band:treble', 'lfo:0', 'lfo:abc', 'sheet:a.z', 'dist:a', 'voice:']) {
      expect(parseSignal(bad), bad).toBeNull();
    }
  });

  it('stay in 0..1', () => {
    for (const id of ['lfo:0.5', 'rand:3', 'step:4', 'beat', 'voice']) {
      const s = parseSignal(id)!;
      for (let t = 0; t < 3; t += 0.013) {
        const v = timeSignalAt(s, src, t);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('shape the same whatever order the moments are asked in', () => {
    const shaping = { smooth: 0.5, threshold: 0.2, delay: 0.1 };
    const s = parseSignal('voice')!;
    const forward = bakeSignal(s, shaping, src);
    const jumpy = bakeSignal(s, shaping, src);
    const times = Array.from({ length: 200 }, (_, i) => (i * 0.0173) % 3.4);
    const a = times.map((t) => forward.at(t));
    // Ask the second one far ahead first, then go back over the same times.
    jumpy.at(3.4);
    const b = times.map((t) => jumpy.at(t));
    expect(b).toEqual(a);
    expect(forward.at(1.5)).toBeGreaterThan(0);
  });

  it('smooth more with more smoothing', () => {
    const s = parseSignal('beat')!;
    const sharp = bakeSignal(s, { smooth: 0.1 }, src);
    const soft = bakeSignal(s, { smooth: 0.8 }, src);
    // Right after a beat the sharp one has jumped further.
    expect(sharp.at(0.45)).toBeGreaterThan(soft.at(0.45));
  });
});

describe('stage wires', () => {
  const show = (events: Record<string, unknown>[]) =>
    parseProject(JSON.stringify({ version: 5, id: 'x', title: 'x', createdAt: '', seed: 1, events }));

  it('move the camera after the sim, and leave it at rest unwired', () => {
    const ctx: WireContext = { voice, onsets, voices: new Map(), bands: null, seed: 1, poses: new Map() };
    expect(stageMods(new Map(), ctx, 1, null, null)).toEqual({ camera: null, look: null });
    const wired = effectiveWires(
      show([{ kind: 'WIRE', id: 'w', at: 0, puppetId: '', from: 'const', to: 'cam.x', amount: 1 }]),
    );
    const { camera } = stageMods(wired, ctx, 1, null, null);
    expect(camera).toEqual({ ...REST_CAMERA, x: 0.75 });
  });

  it('turn fog on through a wire', () => {
    const ctx: WireContext = { voice, onsets, voices: new Map(), bands: null, seed: 1, poses: new Map() };
    const wired = effectiveWires(
      show([{ kind: 'WIRE', id: 'w', at: 0, puppetId: '', from: 'const', to: 'fog', amount: 0.5 }]),
    );
    expect(stageMods(wired, ctx, 1, null, null).look?.fog).toBe(0.5);
  });

  it('refuse a target the wire cannot reach', () => {
    expect(() =>
      show([{ kind: 'WIRE', id: 'w', at: 0, puppetId: '', from: 'const', to: 'scale', amount: 1 }]),
    ).toThrow(/WIRE/);
    expect(() =>
      show([{ kind: 'WIRE', id: 'w', at: 0, puppetId: '', from: 'nonsense', to: 'fog', amount: 1 }]),
    ).toThrow(/WIRE/);
    expect(() =>
      show([{ kind: 'WIRE', id: 'w', at: 0, puppetId: '', from: 'const', to: 'fog', amount: 3 }]),
    ).toThrow(/amount/);
  });
});
