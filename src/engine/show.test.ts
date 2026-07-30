import { describe, expect, it } from 'vitest';
import { boilNoise, restingPuppet, simulatePuppetSteps, stepPuppet } from './puppet';
import { castOf, createShowSim, mouthOf, passTarget, targetForPuppet } from './show';
import { splitPieces, polyArea } from './pieces';
import { computeEnvelope, openAt } from './envelope';
import { appendEvent, createProject, type Project, type RecipeEvent } from './recipe';

const STEPS_PER_S = 120;
const simulateSeconds = (
  initial: ReturnType<typeof restingPuppet>,
  seconds: number,
  targetAt: (t: number) => { x: number; y: number } | null,
) => simulatePuppetSteps(initial, 0, Math.round(seconds * STEPS_PER_S), targetAt);

const cast = (puppetId: string, x = 0.5, y = 0.5, extra: object = {}): RecipeEvent => ({
  kind: 'CAST',
  id: `c${Math.random().toString(36).slice(2, 8)}`,
  at: 0,
  puppetId,
  puppet: { type: 'rect', color: '#f0883e', w: 0.2, h: 0.2 },
  x,
  y,
  scale: 1,
  rot: 0,
  ...extra,
});

const pass = (id: string, puppetId: string, samples: number[]): RecipeEvent => ({
  kind: 'PASS',
  id,
  at: samples[0]!,
  puppetId,
  samples,
});

const show = (events: RecipeEvent[]): Project =>
  events.reduce((p, e) => appendEvent(p, e), createProject('show'));

describe('puppet spring', () => {
  it('approaches a fixed target and settles near it', () => {
    const end = simulateSeconds(restingPuppet(0, 0), 3, () => ({ x: 0.8, y: 0.4 }));
    expect(end.x).toBeCloseTo(0.8, 2);
    expect(Math.abs(end.vx)).toBeLessThan(0.01);
  });

  it('leans and squashes under acceleration, bounded', () => {
    let s = restingPuppet(0, 0);
    for (let i = 0; i < 30; i++) s = stepPuppet(s, { x: 5, y: 0 });
    expect(s.angle).toBeGreaterThan(0.05);
    expect(s.angle).toBeLessThanOrEqual(0.5);
    expect(s.squash).toBeLessThanOrEqual(0.35);
  });
});

describe('pass targets', () => {
  const p = pass('p1', 'a', [1, 0.0, 0.0, 2, 1.0, 0.5, 3, 0.0, 1.0]);

  it('lerps between samples and null outside coverage', () => {
    expect(passTarget(p as never, 0.5)).toBeNull();
    expect(passTarget(p as never, 1.5)).toEqual({ x: 0.5, y: 0.25 });
    expect(passTarget(p as never, 3.01)).toBeNull();
  });

  it('newest covering pass wins; older passes fill gaps', () => {
    const proj = show([
      cast('a'),
      pass('old', 'a', [0, 0.1, 0.1, 4, 0.1, 0.1]),
      pass('new', 'a', [1, 0.9, 0.9, 2, 0.9, 0.9]),
    ]);
    expect(targetForPuppet(proj, 'a', 1.5)).toEqual({ x: 0.9, y: 0.9 });
    expect(targetForPuppet(proj, 'a', 3)).toEqual({ x: 0.1, y: 0.1 });
  });
});

describe('cast order and lifecycle', () => {
  it('latest cast wins pose and moves the puppet to the front', () => {
    const proj = show([cast('a', 0.2, 0.2), cast('b'), cast('a', 0.7, 0.7)]);
    const c = castOf(proj);
    expect(c.map((p) => p.id)).toEqual(['b', 'a']);
    expect(c[1]!.home.x).toBe(0.7);
  });

  it('drop removes; a later cast revives', () => {
    const dropped = show([cast('a'), { kind: 'DROP', id: 'd', at: 0, puppetId: 'a' }]);
    expect(castOf(dropped)).toHaveLength(0);
    const revived = appendEvent(dropped, cast('a', 0.3, 0.3));
    expect(castOf(revived)).toHaveLength(1);
  });

  it('backdrops pin behind everyone regardless of cast order', () => {
    const proj = show([cast('front'), cast('bg', 0.5, 0.5, { back: true })]);
    expect(castOf(proj).map((p) => p.id)).toEqual(['bg', 'front']);
  });

  it('latest mouth wins', () => {
    const proj = show([
      cast('a'),
      { kind: 'MOUTH', id: 'm1', at: 0, puppetId: 'a', mx: 0.5, my: 0.2, size: 0.2 },
      { kind: 'MOUTH', id: 'm2', at: 0, puppetId: 'a', mx: 0.4, my: 0.3, size: 0.25 },
    ]);
    expect(mouthOf(proj, 'a')?.id).toBe('m2');
  });
});

describe('scissor pieces', () => {
  it('splits the box into root plus a hinged child', () => {
    const { root, children } = splitPieces([{ x0: 0, y0: 0.3, x1: 1, y1: 0.3 }]);
    expect(children).toHaveLength(1);
    // The child is the top strip (center 0.5,0.5 is below the line).
    expect(polyArea(children[0]!.poly)).toBeCloseTo(0.3, 5);
    expect(polyArea(root.poly)).toBeCloseTo(0.7, 5);
    expect(children[0]!.joint).toEqual({ x: 0.5, y: 0.3 });
  });

  it('successive snips carve the remaining root', () => {
    const { root, children } = splitPieces([
      { x0: 0, y0: 0.25, x1: 1, y1: 0.25 },
      { x0: 0.75, y0: 0, x1: 0.75, y1: 1 },
    ]);
    expect(children).toHaveLength(2);
    // Second child is the right strip of what remained (below y=0.25).
    expect(polyArea(children[1]!.poly)).toBeCloseTo(0.25 * 0.75, 5);
    expect(polyArea(root.poly)).toBeCloseTo(0.75 * 0.75, 5);
  });

  it('ignores degenerate lines', () => {
    const through = splitPieces([{ x0: 0, y0: 0.5, x1: 1, y1: 0.5 }]);
    expect(through.children).toHaveLength(0);
    const graze = splitPieces([{ x0: 0, y0: 0.001, x1: 1, y1: 0.0 }]);
    expect(graze.children).toHaveLength(0);
  });
});

describe('show simulation with dangles', () => {
  const snipped = () =>
    show([
      cast('a', 0.2, 0.5),
      { kind: 'SNIP', id: 's', at: 0, puppetId: 'a', x0: 0, y0: 0.3, x1: 1, y1: 0.3 },
      pass('p', 'a', [0.2, 0.2, 0.5, 0.6, 0.9, 0.5]),
    ]);

  it('a yank swings the dangle, bounded, then it settles', () => {
    const sim = createShowSim(snipped());
    sim.advanceTo(0.55);
    const mid = sim.states().get('a')!;
    expect(mid.dangles).toHaveLength(1);
    expect(Math.abs(mid.dangles[0]!.angle)).toBeGreaterThan(0.02);
    expect(Math.abs(mid.dangles[0]!.angle)).toBeLessThanOrEqual(1.1);
    sim.advanceTo(5);
    expect(Math.abs(sim.states().get('a')!.dangles[0]!.angle)).toBeLessThan(0.02);
  });

  it('split advance schedules stay bit-exact', () => {
    const a = createShowSim(snipped());
    a.advanceTo(0.7);
    a.advanceTo(2.3);
    const b = createShowSim(snipped());
    b.advanceTo(2.3);
    expect(a.states().get('a')).toEqual(b.states().get('a'));
  });
});

describe('envelope', () => {
  const RATE = 48000;

  it('is silent on silence and opens on bursts, deterministically', () => {
    const silent = computeEnvelope(new Float32Array(RATE), RATE);
    expect(Math.max(...silent)).toBe(0);

    const samples = new Float32Array(RATE * 2);
    for (let i = 0; i < RATE * 0.2; i++) {
      samples[RATE + i] = 0.8 * Math.sin((2 * Math.PI * 200 * i) / RATE);
    }
    const env = computeEnvelope(samples, RATE);
    expect(openAt(env, 0.5)).toBe(0);
    expect(openAt(env, 1.1)).toBeGreaterThan(0.5);
    expect(computeEnvelope(samples, RATE)).toEqual(env);
  });
});

describe('boil noise', () => {
  it('is deterministic, bounded, and varies by variant', () => {
    expect(boilNoise(7, 1, 42)).toBe(boilNoise(7, 1, 42));
    for (let i = 0; i < 100; i++) {
      const v = boilNoise(123, i % 3, i);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    expect(boilNoise(7, 0, 42)).not.toBe(boilNoise(7, 1, 42));
  });
});
