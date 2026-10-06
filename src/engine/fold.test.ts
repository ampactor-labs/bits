import { describe, expect, it } from 'vitest';
import { foldsOf } from './show';
import { visualsOf } from './frame';
import { effectiveWires, wireModsFor } from './wires';
import { EMPTY_VOICE } from './envelope';
import {
  migrateProject,
  parseProject,
  RECIPE_VERSION,
  type Project,
  type RecipeEvent,
} from './recipe';

const cast = {
  kind: 'CAST',
  id: 'c',
  at: 0,
  puppetId: 'p',
  puppet: { type: 'rect', color: '#fff', w: 0.3, h: 0.3 },
  x: 0.5,
  y: 0.5,
  scale: 1,
  rot: 0,
} as RecipeEvent;
const snip = (id: string, x: number) =>
  ({ kind: 'SNIP', id, at: 0, puppetId: 'p', x0: x, y0: 0, x1: x, y1: 1 }) as RecipeEvent;
const fold = (id: string, s: number, angle: number | null) =>
  ({ kind: 'FOLD', id, at: 0, puppetId: 'p', snip: s, angle }) as RecipeEvent;

const show = (events: RecipeEvent[]): Project =>
  parseProject(
    JSON.stringify({
      version: RECIPE_VERSION,
      id: 'f',
      title: 'f',
      createdAt: '',
      seed: 1,
      events,
    }),
  );

describe('folds', () => {
  it('latest per snip slot wins, and null makes it a cut again', () => {
    const p = show([
      cast,
      snip('a', 0.8),
      snip('b', 0.2),
      fold('f1', 0, 1),
      fold('f2', 1, Math.PI),
      fold('f3', 0, null),
    ]);
    expect(foldsOf(p, 'p')).toEqual([null, Math.PI]);
    const v = visualsOf(p).get('p')!;
    expect(v.folds).toEqual([null, Math.PI]);
    // The piece knows the line it folds about.
    expect(v.pieces.children.find((c) => c.snipIndex === 1)?.line).toEqual({
      x0: 0.2,
      y0: 0,
      x1: 0.2,
      y1: 1,
    });
  });

  it('a fold must name a snip that exists, at an angle within a half turn', () => {
    expect(() => show([cast, fold('f', 0, 1)])).toThrow(/existing snip/);
    expect(() => show([cast, snip('a', 0.8), fold('f', 0, 4)])).toThrow(/radians/);
    expect(() => show([cast, snip('a', 0.8), fold('f', 0, -Math.PI)])).not.toThrow();
  });

  it('a v10 bit opens unchanged as v11', () => {
    const raw = {
      version: 10,
      id: 'x',
      title: 'x',
      createdAt: '',
      seed: 1,
      events: [cast, snip('a', 0.8)],
    };
    const out = migrateProject(raw);
    expect(out.version).toBe(11);
    expect(out.events).toEqual(raw.events);
  });

  it('a wire on folds turns every fold, by up to a right angle', () => {
    const p = show([
      cast,
      {
        kind: 'WIRE',
        id: 'w',
        at: 0,
        puppetId: 'p',
        from: 'const',
        to: 'fold',
        amount: 0.5,
      } as RecipeEvent,
    ]);
    const ctx = {
      voice: EMPTY_VOICE,
      onsets: [],
      voices: new Map(),
      bands: null,
      seed: 1,
      poses: new Map(),
    };
    expect(wireModsFor(effectiveWires(p), 'p', ctx, 0).dFold).toBeCloseTo(Math.PI / 4, 9);
  });
});
