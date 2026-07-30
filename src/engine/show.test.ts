import { describe, expect, it } from 'vitest';
import { boilNoise, restingPuppet, simulatePuppetSteps, stepPuppet } from './puppet';

const STEPS_PER_S = 120;
const simulateSeconds = (
  initial: ReturnType<typeof restingPuppet>,
  seconds: number,
  targetAt: (t: number) => { x: number; y: number } | null,
) => simulatePuppetSteps(initial, 0, Math.round(seconds * STEPS_PER_S), targetAt);
import { castOf, createShowSim, passTarget, targetForPuppet } from './show';
import { appendEvent, createProject, type CastEvent, type PassEvent, type Project } from './recipe';

const cast = (puppetId: string, x = 0.5, y = 0.5): CastEvent => ({
  kind: 'CAST',
  id: `c-${puppetId}`,
  at: 0,
  puppetId,
  puppet: { type: 'rect', color: '#f0883e', w: 0.2, h: 0.2 },
  x,
  y,
  scale: 1,
});

const pass = (id: string, puppetId: string, samples: number[]): PassEvent => ({
  kind: 'PASS',
  id,
  at: samples[0]!,
  puppetId,
  samples,
});

const show = (events: (CastEvent | PassEvent)[]): Project =>
  events.reduce((p, e) => appendEvent(p, e), createProject('show'));

describe('puppet spring', () => {
  it('approaches a fixed target and settles near it', () => {
    const end = simulateSeconds(restingPuppet(0, 0), 3, () => ({ x: 0.8, y: 0.4 }));
    expect(end.x).toBeCloseTo(0.8, 2);
    expect(end.y).toBeCloseTo(0.4, 2);
    expect(Math.abs(end.vx)).toBeLessThan(0.01);
  });

  it('coasts and decays when free', () => {
    let s = restingPuppet(0.5, 0.5);
    s = { ...s, vx: 2 };
    const end = simulateSeconds(s, 4, () => null);
    expect(end.x).toBeGreaterThan(0.5);
    expect(Math.abs(end.vx)).toBeLessThan(0.02);
  });

  it('leans with velocity and squashes under acceleration, both bounded', () => {
    let s = restingPuppet(0, 0);
    for (let i = 0; i < 30; i++) s = stepPuppet(s, { x: 5, y: 0 });
    expect(s.angle).toBeGreaterThan(0.05);
    expect(s.angle).toBeLessThanOrEqual(0.5);
    expect(s.squash).toBeGreaterThan(0);
    expect(s.squash).toBeLessThanOrEqual(0.35);
  });

  it('is deterministic', () => {
    const run = () =>
      simulatePuppetSteps(restingPuppet(0.1, 0.9), 0, 284, (t) => ({ x: Math.sin(t), y: 0.5 }));
    expect(run()).toEqual(run());
  });
});

describe('pass targets', () => {
  const p = pass('p1', 'a', [1, 0.0, 0.0, 2, 1.0, 0.5, 3, 0.0, 1.0]);

  it('lerps between samples and null outside coverage', () => {
    expect(passTarget(p, 0.5)).toBeNull();
    expect(passTarget(p, 1.5)).toEqual({ x: 0.5, y: 0.25 });
    expect(passTarget(p, 3)).toEqual({ x: 0.0, y: 1.0 });
    expect(passTarget(p, 3.01)).toBeNull();
  });

  it('newest covering pass wins; older passes fill gaps', () => {
    const proj = show([
      cast('a'),
      pass('old', 'a', [0, 0.1, 0.1, 4, 0.1, 0.1]),
      pass('new', 'a', [1, 0.9, 0.9, 2, 0.9, 0.9]),
    ]);
    expect(targetForPuppet(proj, 'a', 1.5)).toEqual({ x: 0.9, y: 0.9 });
    expect(targetForPuppet(proj, 'a', 3)).toEqual({ x: 0.1, y: 0.1 });
    expect(targetForPuppet(proj, 'a', 5)).toBeNull();
  });
});

describe('show simulation', () => {
  it('collects the cast with latest home pose winning', () => {
    const proj = show([cast('a', 0.2, 0.2), cast('a', 0.7, 0.7)]);
    const c = castOf(proj);
    expect(c).toHaveLength(1);
    expect(c[0]!.home).toEqual({ x: 0.7, y: 0.7, scale: 1 });
  });

  it('moves a puppet through its pass and matches a fresh sim (determinism)', () => {
    const proj = show([cast('a', 0.5, 0.5), pass('p', 'a', [0.5, 0.5, 0.5, 1.5, 0.9, 0.2])]);
    const sim1 = createShowSim(proj);
    sim1.advanceTo(1.0);
    const mid = { ...sim1.states().get('a')! };
    sim1.advanceTo(2.5);
    const end1 = sim1.states().get('a')!;

    const sim2 = createShowSim(proj);
    sim2.advanceTo(2.5);
    expect(sim2.states().get('a')).toEqual(end1);
    expect(mid.x).toBeGreaterThan(0.5);
    // Free release carries momentum: near the last target, overshoot allowed.
    expect(Math.abs(end1.x - 0.9)).toBeLessThan(0.15);
    expect(Math.abs(end1.y - 0.2)).toBeLessThan(0.15);
  });
});

describe('boil noise', () => {
  it('is deterministic, bounded, and varies by variant', () => {
    expect(boilNoise(7, 1, 42)).toBe(boilNoise(7, 1, 42));
    for (let i = 0; i < 200; i++) {
      const v = boilNoise(123, i % 3, i);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(boilNoise(7, 0, 42)).not.toBe(boilNoise(7, 1, 42));
  });
});
