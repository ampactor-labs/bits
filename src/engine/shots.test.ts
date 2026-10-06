import { describe, expect, it } from 'vitest';
import { closeOn, fitAll, nudge, sameFraming, shotsOf, WIDE, type Standing } from './shots';
import { castOf, createShowSim, cutsOf } from './show';
import { CAMERA_ID, toScreen } from './camera';
import {
  parseProject,
  RECIPE_VERSION,
  type CutEvent,
  type Project,
  type RecipeEvent,
} from './recipe';

const cast = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  ({
    kind: 'CAST',
    id: `c-${id}`,
    at: 0,
    puppetId: id,
    puppet: { type: 'rect', color: '#fff', w: 0.2, h: 0.15 },
    x,
    y,
    scale: 1,
    rot: 0,
    ...extra,
  }) as RecipeEvent;

const cut = (id: string, at: number, pose = WIDE): CutEvent =>
  ({ kind: 'CUT', id, at, puppetId: CAMERA_ID, ...pose }) as CutEvent;

const show = (events: RecipeEvent[]): Project =>
  parseProject(
    JSON.stringify({
      version: RECIPE_VERSION,
      id: 's',
      title: 's',
      createdAt: '',
      seed: 3,
      events,
    }),
  );

const standing = (p: Project): Standing[] =>
  castOf(p).map((puppet) => ({ x: puppet.home.x, y: puppet.home.y, puppet }));

describe('shots', () => {
  it('are the stretches between cuts, the first at rest unless a cut opens it', () => {
    expect(shotsOf([], 10)).toEqual([{ from: 0, to: 10, cut: null }]);
    const a = cut('a', 3);
    const b = cut('b', 7);
    expect(shotsOf([a, b], 10).map((s) => [s.from, s.to, s.cut?.id ?? null])).toEqual([
      [0, 3, null],
      [3, 7, 'a'],
      [7, 10, 'b'],
    ]);
    const open = cut('o', 0);
    expect(shotsOf([open, a], 10).map((s) => [s.from, s.to, s.cut?.id ?? null])).toEqual([
      [0, 3, 'o'],
      [3, 10, 'a'],
    ]);
    // A cut past the end opens nothing.
    expect(shotsOf([a, cut('late', 12)], 10)).toHaveLength(2);
  });

  it('a close shot puts its sheet in the middle of the frame, near or far', () => {
    for (const depth of [0, 3]) {
      const p = show([cast('a', 0.25, 0.7, { depth })]);
      const pose = closeOn(standing(p)[0]!);
      expect(pose.scale).toBeGreaterThan(1.5);
      const at = toScreen(pose, depth, 0.25, 0.7, 1080, 1920);
      expect(at.x).toBeCloseTo(0.5, 6);
      expect(at.y).toBeCloseTo(0.5, 6);
    }
  });

  it('everyone in keeps every sheet on screen, and is wide when they fill it', () => {
    const p = show([cast('a', 0.35, 0.45), cast('b', 0.6, 0.55, { depth: 2 })]);
    const pose = fitAll(standing(p));
    expect(pose.scale).toBeGreaterThan(1);
    for (const s of standing(p)) {
      const at = toScreen(pose, s.puppet.depth, s.x, s.y, 1080, 1920);
      expect(at.x).toBeGreaterThan(0.1);
      expect(at.x).toBeLessThan(0.9);
      expect(at.y).toBeGreaterThan(0.1);
      expect(at.y).toBeLessThan(0.9);
    }
    const apart = show([cast('a', 0.1, 0.1), cast('b', 0.9, 0.9)]);
    expect(sameFraming(fitAll(standing(apart)), WIDE)).toBe(true);
  });

  it('a nudge lands on the next beat inside the shot, or nowhere', () => {
    const beats = [1, 2, 3, 4];
    expect(nudge(beats, 2, 1, 0, 10)).toBe(3);
    expect(nudge(beats, 2, -1, 0, 10)).toBe(1);
    expect(nudge(beats, 2, 1, 0, 3)).toBeNull();
    expect(nudge([], 2, 1, 0, 10)).toBe(2.5);
  });

  it('a framed cut holds the camera where the framing put it', () => {
    const base = [cast('a', 0.3, 0.6)];
    const pose = closeOn(standing(show(base))[0]!);
    const p = show([...base, cut('c', 1, pose)]);
    expect(cutsOf(p)).toHaveLength(1);
    const sim = createShowSim(p);
    sim.advanceTo(0.5);
    expect(sim.camera()?.scale ?? 1).toBe(1);
    sim.advanceTo(2);
    const cam = sim.camera()!;
    expect(cam.scale).toBeCloseTo(pose.scale, 6);
    expect(cam.x).toBeCloseTo(pose.x, 6);
  });
});
