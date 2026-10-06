import { describe, expect, it } from 'vitest';
import {
  INK_SIZE,
  INK_TICK,
  childSeed,
  cross,
  dice,
  genomeProblem,
  inkPlayer,
  mutate,
  PARAMS,
  type Genome,
} from './ink';
import { parseProject, RECIPE_VERSION } from './recipe';

const valid = (g: Genome) => {
  expect(genomeProblem(g)).toBeNull();
  expect(g.ops.length).toBeGreaterThanOrEqual(2);
  expect(g.ops.length).toBeLessThanOrEqual(6);
  expect(g.ops.filter((s) => s.op === 'palette')).toHaveLength(1);
};

describe('genomes', () => {
  it('roll the same from the same seed, and differently from another', () => {
    expect(dice(42)).toEqual(dice(42));
    expect(dice(42)).not.toEqual(dice(43));
    for (let s = 0; s < 50; s++) valid(dice(s));
  });

  it('breed children that stay valid and stay near their parent', () => {
    const parent = dice(7);
    for (let i = 0; i < 40; i++) {
      const child = mutate(parent, childSeed(7, 0, i));
      valid(child);
      expect(mutate(parent, childSeed(7, 0, i))).toEqual(child);
    }
    // Mostly nudges: a child of a child is still a genome, generations on.
    let g = parent;
    for (let gen = 0; gen < 30; gen++) {
      g = mutate(g, childSeed(7, gen, 1));
      valid(g);
    }
  });

  it('cross two parents slot by slot', () => {
    const a = dice(1);
    const b = dice(2);
    const c = cross(a, b, 99);
    valid(c);
    for (const s of c.ops) {
      expect(s.p).toHaveLength(PARAMS[s.op]);
    }
  });

  it('refuse what is not a genome', () => {
    expect(genomeProblem(null)).not.toBeNull();
    expect(genomeProblem({ seed: 1, ops: [{ op: 'glitter', p: [] }] })).toBe('op');
    expect(genomeProblem({ seed: 1, ops: [{ op: 'posterize', p: [2] }] })).toBe('param range');
    expect(genomeProblem({ seed: -1, ops: [] })).toBe('seed');
  });
});

describe('drawing an ink', () => {
  it('gives the same pixels for the same moment, every time', () => {
    const g = dice(5);
    const a = inkPlayer(g).at(1.234);
    const b = inkPlayer(g).at(1.234);
    expect(a.length).toBe(INK_SIZE * INK_SIZE * 4);
    expect(a.every((v, i) => v === b[i])).toBe(true);
  });

  it('is never flat, and a smooth field is smooth', () => {
    const colours = (g: Genome) => {
      const px = inkPlayer(g).at(0.5);
      const seen = new Set<number>();
      for (let i = 0; i < px.length; i += 4 * 13) seen.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
      return seen.size;
    };
    // Posterised and halftone rolls have few colours by design; none has one.
    for (let seed = 0; seed < 20; seed++) expect(colours(dice(seed)), `seed ${seed}`).toBeGreaterThan(1);
    const smooth: Genome = {
      seed: 3,
      ops: [
        { op: 'noise', p: [0.4, 0.2, 0.6, 1] },
        { op: 'palette', p: [0.3, 0.6, 0.5, 0.7, 0.5, 0.5] },
      ],
    };
    expect(colours(smooth)).toBeGreaterThan(100);
  });

  it('feeds back the same whether played through or sought to', () => {
    const g: Genome = {
      seed: 9,
      ops: [
        { op: 'stripes', p: [0.4, 0.3, 0.6, 1] },
        { op: 'palette', p: [0.2, 0.5, 0.5, 0.5, 0.5, 0.6] },
        { op: 'feedback', p: [0.7, 0.6, 0.6] },
      ],
    };
    const played = inkPlayer(g);
    for (let t = 0; t < 3; t += INK_TICK) played.at(t);
    const end = played.at(3);
    const sought = inkPlayer(g).at(3);
    // Playing through remembers further back than a seek's warm-up, but
    // feedback forgets: the two agree to within rounding.
    let worst = 0;
    for (let i = 0; i < end.length; i++) worst = Math.max(worst, Math.abs(end[i]! - sought[i]!));
    expect(worst).toBeLessThanOrEqual(3);
  });
});

describe('recipe v6', () => {
  const header = { id: 'x', title: 'x', createdAt: '', seed: 1 };
  const parse = (version: number, events: Record<string, unknown>[]) =>
    parseProject(JSON.stringify({ ...header, version, events }));

  it('moves a v5 file up untouched', () => {
    expect(parse(5, []).version).toBe(RECIPE_VERSION);
  });

  it('takes ink sheets and INK, and checks their genomes', () => {
    const genome = dice(4);
    const cast = {
      kind: 'CAST',
      id: 'c',
      at: 0,
      puppetId: 'a',
      puppet: { type: 'ink', genome, w: 0.4, h: 0.4 },
      x: 0.5,
      y: 0.5,
      scale: 1,
      rot: 0,
    };
    const p = parse(6, [cast, { kind: 'INK', id: 'i', at: 0, puppetId: 'a', genome }, { kind: 'INK', id: 'j', at: 0, puppetId: 'a', genome: null }]);
    expect(p.events).toHaveLength(3);
    expect(() => parse(6, [{ ...cast, puppet: { type: 'ink', genome: { seed: 1, ops: [] }, w: 1, h: 1 } }])).toThrow(/genome/);
    expect(() => parse(6, [{ kind: 'INK', id: 'i', at: 0, puppetId: 'a', genome: { seed: 1 } }])).toThrow(/genome/);
  });
});
