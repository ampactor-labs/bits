import { describe, expect, it } from 'vitest';
import { anchorOn, castOf, createShowSim, localToWorld } from './show';
import { restingPuppet } from './puppet';
import { blinkAt } from './blink';
import { parseProject, RECIPE_VERSION, type Project, type RecipeEvent } from './recipe';
import { neckOf } from '../media/kit';

const cast = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  ({
    kind: 'CAST',
    id: `c-${id}`,
    at: 0,
    puppetId: id,
    puppet: { type: 'rect', color: '#fff', w: 0.2, h: 0.2 },
    x,
    y,
    scale: 1,
    rot: 0,
    ...extra,
  }) as RecipeEvent;

const show = (events: RecipeEvent[]): Project =>
  parseProject(JSON.stringify({ version: RECIPE_VERSION, id: 'k', title: 'k', createdAt: '', seed: 3, events }));

/** A body walked right, and a hat riding its top edge. The hat is cast
 *  first, so the sim has to step the body before it anyway. */
function kit(): Project {
  const samples: number[] = [];
  for (let i = 0; i <= 20; i++) samples.push(0.2 + i * 0.05, 0.3 + i * 0.02, 0.5);
  return show([
    cast('hat', 0.3, 0.4, { attach: { to: 'body', x: 0.5, y: 0 } }),
    cast('body', 0.3, 0.5),
    { kind: 'PASS', id: 'walk', at: 0.2, puppetId: 'body', samples } as RecipeEvent,
  ]);
}

describe('kits', () => {
  it('a riding sheet follows the sheet it rides, a little behind', () => {
    const sim = createShowSim(kit());
    const early = sim.advanceTo(0.5);
    const hatEarly = early.get('hat')!.root.x;
    const bodyEarly = early.get('body')!.root.x;
    // Moving right: the hat lags the body.
    expect(hatEarly).toBeLessThan(bodyEarly);
    const late = sim.advanceTo(3);
    const body = castOf(kit()).find((p) => p.id === 'body')!;
    const anchor = localToWorld(late.get('body')!.root, body, 0.5, 0);
    // Settled: the hat sits on its anchor on the body.
    expect(late.get('hat')!.root.x).toBeCloseTo(anchor.x, 2);
    expect(late.get('hat')!.root.y).toBeCloseTo(anchor.y, 2);
  });

  it('seeks from a checkpoint to the same place as playing through', () => {
    const p = kit();
    createShowSim(p).advanceTo(3);
    for (const t of [1.1, 2.6]) {
      const fresh = createShowSim(p).advanceTo(t);
      const resumed = createShowSim(p, 0, undefined, undefined, { resumeAt: t }).advanceTo(t);
      expect(resumed.get('hat')).toEqual(fresh.get('hat'));
    }
  });

  it('anchors where a sheet is put', () => {
    const body = castOf(kit()).find((p) => p.id === 'body')!;
    const a = anchorOn(body, 0.35, 0.42);
    const back = localToWorld(restingPuppet(body.home.x, body.home.y), body, a.x, a.y);
    expect(back.x).toBeCloseTo(0.35, 9);
    expect(back.y).toBeCloseTo(0.42, 9);
  });

  it('refuses a circle, and a sheet riding itself', () => {
    expect(() =>
      show([
        cast('a', 0.5, 0.5, { attach: { to: 'b', x: 0.5, y: 0 } }),
        cast('b', 0.5, 0.5, { attach: { to: 'c', x: 0.5, y: 0 } }),
        cast('c', 0.5, 0.5, { attach: { to: 'a', x: 0.5, y: 0 } }),
      ]),
    ).toThrow(/circle/);
    expect(() => show([cast('a', 0.5, 0.5, { attach: { to: 'a', x: 0.5, y: 0 } })])).toThrow(/attach/);
    // A chain is fine, and a later CAST without attach lets go.
    expect(
      show([
        cast('a', 0.5, 0.5, { attach: { to: 'b', x: 0.5, y: 0 } }),
        cast('b', 0.5, 0.5, { attach: { to: 'c', x: 0.5, y: 0 } }),
        cast('c', 0.5, 0.5),
      ]).events,
    ).toHaveLength(3);
  });
});

describe('blinking', () => {
  it('is quick, now and then, and the same every time', () => {
    let shut = 0;
    let blinks = 0;
    let was = 0;
    for (let t = 0; t < 35; t += 1 / 120) {
      const b = blinkAt(9, 'guy', t);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      if (b > 0) shut++;
      if (b > 0.5 && was <= 0.5) blinks++;
      was = b;
      expect(blinkAt(9, 'guy', t)).toBe(b);
    }
    expect(blinks).toBe(10);
    // Shut about 4% of the time.
    expect(shut / (35 * 120)).toBeLessThan(0.06);
  });

  it('is not in step with anyone else', () => {
    const a = Array.from({ length: 400 }, (_, i) => blinkAt(9, 'guy', i / 40) > 0.5);
    const b = Array.from({ length: 400 }, (_, i) => blinkAt(9, 'cat', i / 40) > 0.5);
    expect(a).not.toEqual(b);
  });
});

describe('the neck', () => {
  const lm = (nose: number, shoulders: number) => {
    const out = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
    out[0] = { x: 0.5, y: nose, visibility: 1 };
    out[11] = { x: 0.6, y: shoulders, visibility: 1 };
    out[12] = { x: 0.4, y: shoulders, visibility: 1 };
    return out;
  };

  it('sits between the chin and the shoulders', () => {
    const n = neckOf(lm(0.2, 0.5))!;
    expect(n.x).toBeCloseTo(0.5, 9);
    expect(n.y).toBeGreaterThan(0.3);
    expect(n.y).toBeLessThan(0.5);
  });

  it('is not found without a head above shoulders', () => {
    expect(neckOf(null)).toBeNull();
    expect(neckOf(lm(0.6, 0.5))).toBeNull();
  });
});
