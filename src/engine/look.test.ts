import { describe, expect, it } from 'vitest';
import { fixtureProject } from '../e2e/fixtures';
import { CAMERA_ID, REST_CAMERA } from './camera';
import { createFramer } from './frame';
import { fogAmount, shadowGap, shadowOffset } from './look';
import { parseProject, RECIPE_VERSION, type Project, type RecipeEvent } from './recipe';
import { createShowSim, cutBefore, cutsOf, lookOf } from './show';

let n = 0;
const ev = (e: Record<string, unknown>) => ({ id: `l${n++}`, at: 0, ...e }) as RecipeEvent;
const withEvents = (...events: RecipeEvent[]): Project => {
  const base = fixtureProject();
  return { ...base, events: [...base.events, ...events] };
};

describe('the look', () => {
  it('is absent until a LOOK turns something on', () => {
    expect(lookOf(fixtureProject())).toBeNull();
    expect(lookOf(withEvents(ev({ kind: 'LOOK', puppetId: '', shadow: 0 })))).toBeNull();
  });

  it('takes the latest value per field', () => {
    const look = lookOf(
      withEvents(
        ev({ kind: 'LOOK', puppetId: '', shadow: 0.5, fog: 0.2 }),
        ev({ kind: 'LOOK', puppetId: '', fog: 0.8, fogColor: '#334455' }),
      ),
    );
    expect(look).toEqual({ shadow: 0.5, fog: 0.8, fogColor: '#334455' });
  });

  it('fogs far sheets more than near ones, and nothing with fog off', () => {
    expect(fogAmount(0, 5)).toBe(0);
    expect(fogAmount(1, 0)).toBeLessThan(fogAmount(1, 3));
    expect(fogAmount(1, 3)).toBeLessThan(fogAmount(1, 10));
    expect(fogAmount(1, 10)).toBeLessThan(1);
  });

  it('throws a shadow further across a bigger gap', () => {
    const near = shadowOffset(1, 0.5, 400);
    const far = shadowOffset(1, 3, 400);
    expect(far.dx).toBeGreaterThan(near.dx);
    expect(far.blur).toBeGreaterThan(near.blur);
    expect(shadowOffset(0, 3, 400).dx).toBe(0);
  });

  it('measures the gap to the nearest overlapping sheet behind', () => {
    const p = withEvents();
    const depths: Record<string, number> = { sky: 3, bg: 2 };
    const frame = createFramer(
      {
        ...p,
        events: p.events.map((e) =>
          e.kind === 'CAST' && depths[e.puppetId] !== undefined
            ? { ...e, depth: depths[e.puppetId]! }
            : e,
        ),
      },
      undefined,
      { trails: false },
    ).frameAt(0.01);
    const ids = frame.layers.map((l) => l.puppet.id);
    // The word sits alone at the top: its shadow falls on the far sky.
    expect(shadowGap(frame.layers, ids.indexOf('word'), null, 360, 640)).toBe(3);
    // The floor strip is nearer the sky than the word is.
    expect(shadowGap(frame.layers, ids.indexOf('bg'), null, 360, 640)).toBe(1);
    // With nothing at all behind it, the floor: one unit.
    expect(shadowGap(frame.layers, 0, null, 360, 640)).toBe(1);
  });
});

describe('cuts', () => {
  const cut = (at: number, x = 0.3) =>
    ev({ kind: 'CUT', at, puppetId: CAMERA_ID, x, y: 0.5, z: 0.4, rot: 0, scale: 1 });

  it('snap the camera still at their moment', () => {
    const p = withEvents(cut(1));
    const sim = createShowSim(p);
    sim.advanceTo(0.99);
    expect(sim.camera()).toEqual(REST_CAMERA);
    sim.advanceTo(1);
    expect(sim.camera()).toEqual({ x: 0.3, y: 0.5, z: 0.4, rot: 0, scale: 1 });
    // Still: with no pass driving it, nothing moves after the cut.
    sim.advanceTo(2);
    expect(sim.camera()).toEqual({ x: 0.3, y: 0.5, z: 0.4, rot: 0, scale: 1 });
  });

  it('kill the motion a pass left behind', () => {
    const samples: number[] = [];
    for (let i = 0; i <= 10; i++) samples.push(0.1 + i * 0.05, 0.5 + 0.03 * i, 0.5);
    const p = withEvents(ev({ kind: 'PASS', at: 0.1, puppetId: CAMERA_ID, samples }), cut(0.7, 0.2));
    const sim = createShowSim(p);
    sim.advanceTo(0.7);
    expect(sim.camera()!.x).toBe(0.2);
    sim.advanceTo(1.5);
    expect(sim.camera()!.x).toBe(0.2);
  });

  it('seek from a checkpoint across a cut like a fresh sim', () => {
    const p = withEvents(cut(0.5), cut(1.7, 0.6));
    createShowSim(p).advanceTo(3);
    for (const t of [1.2, 1.7, 2.5]) {
      const fresh = createShowSim(p);
      fresh.advanceTo(t);
      const resumed = createShowSim(p, 0, undefined, undefined, { resumeAt: t });
      resumed.advanceTo(t);
      expect(resumed.camera()).toEqual(fresh.camera());
    }
  });

  it('can be taken out, and the frame knows the latest one', () => {
    const c = cut(1);
    const p = withEvents(c, cut(2));
    expect(cutBefore(cutsOf(p), 1.5)).toBe(1);
    expect(cutBefore(cutsOf(p), 0.5)).toBeNull();
    const without = withEvents(
      c,
      ev({ kind: 'REMOVE', puppetId: CAMERA_ID, target: { cut: c.id } }),
    );
    expect(cutsOf(without)).toEqual([]);
    expect(createFramer(p).frameAt(2.2).cutAt).toBe(2);
  });
});

describe('recipe v4', () => {
  const header = { id: 'x', title: 'x', createdAt: '', seed: 1 };
  const parse = (version: number, events: Record<string, unknown>[]) =>
    parseProject(JSON.stringify({ ...header, version, events }));

  it('moves a v3 file up untouched', () => {
    expect(parse(3, []).version).toBe(RECIPE_VERSION);
  });

  it('checks looks and cuts', () => {
    expect(parse(4, [{ kind: 'LOOK', id: 'a', at: 0, puppetId: '', fog: 0.5 }]).events).toHaveLength(1);
    expect(() => parse(4, [{ kind: 'LOOK', id: 'a', at: 0, puppetId: '', fog: 2 }])).toThrow(/LOOK/);
    expect(() =>
      parse(4, [{ kind: 'LOOK', id: 'a', at: 0, puppetId: '', fogColor: 'grey' }]),
    ).toThrow(/fogColor/);
    const c = { kind: 'CUT', id: 'c', at: 1, puppetId: CAMERA_ID, x: 0.5, y: 0.5, z: 0, rot: 0, scale: 1 };
    expect(parse(4, [c, { kind: 'REMOVE', id: 'r', at: 0, puppetId: CAMERA_ID, target: { cut: 'c' } }]).events).toHaveLength(2);
    expect(() => parse(4, [{ ...c, scale: 0 }])).toThrow(/CUT/);
    expect(() => parse(4, [{ ...c, puppetId: 'a' }])).toThrow(/CUT/);
  });

  it('accepts a tilted pass', () => {
    const pass = { kind: 'PASS', id: 'p', at: 0, puppetId: CAMERA_ID, samples: [0, 0.5, 0.5, 1, 0.6, 0.5] };
    expect(parse(4, [{ ...pass, via: 'gyro' }]).events).toHaveLength(1);
    expect(() => parse(4, [{ ...pass, via: 'mind' }])).toThrow(/via/);
  });
});
