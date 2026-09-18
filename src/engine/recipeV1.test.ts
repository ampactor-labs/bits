// Recipe v1: the semantics that, if wrong, propagate into bit files already
// on someone's phone. Every case here is one the plan's review caught.

import { describe, expect, it } from 'vitest';
import {
  RECIPE_VERSION,
  createProject,
  migrateProject,
  parseProject,
  serializeProject,
  type Project,
  type RecipeEvent,
} from './recipe';
import { castOf, effectivePasses, mouthOf, pinsOf, snipsOf, talkOpenFor } from './show';
import { localToWorld, worldToLocal } from './show';
import { restingPuppet, stepPuppet } from './puppet';
import { splitPieces } from './pieces';

const project = (events: RecipeEvent[]): Project => ({
  ...createProject('t', new Date('2026-01-01')),
  events,
});

const cast = (puppetId: string, extra: Partial<RecipeEvent> = {}): RecipeEvent =>
  ({
    kind: 'CAST',
    id: `c-${puppetId}-${Math.random().toString(36).slice(2, 8)}`,
    at: 0,
    puppetId,
    puppet: { type: 'rect', color: '#fff', w: 0.2, h: 0.2 },
    x: 0.5,
    y: 0.5,
    scale: 1,
    rot: 0,
    ...extra,
  }) as RecipeEvent;

const pass = (id: string, puppetId: string, samples: number[], extra = {}): RecipeEvent =>
  ({ kind: 'PASS', id, at: samples[0]!, puppetId, samples, ...extra }) as RecipeEvent;

describe('v0 files', () => {
  const v0 = JSON.stringify({
    version: 0,
    id: 'old',
    title: 'an old bit',
    createdAt: '2026-07-31T00:00:00.000Z',
    seed: 7,
    events: [
      {
        kind: 'CAST',
        id: 'c1',
        at: 0,
        puppetId: 'a',
        puppet: { type: 'rect', color: '#f00', w: 0.2, h: 0.3 },
        x: 0.4,
        y: 0.6,
        scale: 1,
        rot: 0,
      },
      { kind: 'PASS', id: 'p1', at: 0, puppetId: 'a', samples: [0, 0.1, 0.1, 1, 0.9, 0.9] },
    ],
  });

  it('still opens, and arrives as v1 with updatedAt filled in', () => {
    const p = parseProject(v0);
    expect(p.version).toBe(RECIPE_VERSION);
    expect(p.updatedAt).toBe('2026-07-31T00:00:00.000Z');
    expect(p.events).toHaveLength(2);
  });

  it('draws in exactly the old order, because nothing reorders it', () => {
    const p = parseProject(v0);
    expect(castOf(p).map((c) => c.id)).toEqual(['a']);
    expect(castOf(p)[0]!.flip).toBe(false);
    expect(castOf(p)[0]!.spring).toBe('felt');
  });

  it('migrates idempotently', () => {
    const once = migrateProject(JSON.parse(v0));
    const twice = migrateProject(once);
    expect(twice).toEqual(once);
  });

  it('survives a round trip through the writer', () => {
    const p = parseProject(serializeProject(parseProject(v0)));
    expect(p.version).toBe(RECIPE_VERSION);
  });
});

describe('REORDER', () => {
  it('survives the next CAST, which a drag commits on release', () => {
    const base = project([cast('a'), cast('b'), cast('c')]);
    // Newest cast is in front by the old rule.
    expect(castOf(base).map((p) => p.id)).toEqual(['a', 'b', 'c']);

    const reordered = project([
      ...base.events,
      { kind: 'REORDER', id: 'r1', at: 0, puppetId: '', order: ['c', 'b', 'a'] },
    ]);
    expect(castOf(reordered).map((p) => p.id)).toEqual(['c', 'b', 'a']);

    // Dragging 'c' commits a CAST; without the combined rule this fronted
    // it again and silently undid the reorder.
    const afterDrag = project([...reordered.events, cast('c', { x: 0.7 })]);
    expect(castOf(afterDrag).map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('puts a newly cast puppet on top, among the ones it does not name', () => {
    const p = project([
      cast('a'),
      cast('b'),
      { kind: 'REORDER', id: 'r1', at: 0, puppetId: '', order: ['b', 'a'] },
      cast('d'),
    ]);
    expect(castOf(p).map((x) => x.id)).toEqual(['b', 'a', 'd']);
  });

  it('ignores names that have left the cast', () => {
    const p = project([
      cast('a'),
      cast('b'),
      { kind: 'REORDER', id: 'r1', at: 0, puppetId: '', order: ['b', 'gone', 'a'] },
      { kind: 'DROP', id: 'd1', at: 0, puppetId: 'b' },
    ]);
    expect(castOf(p).map((x) => x.id)).toEqual(['a']);
  });

  it('keeps backdrops behind everything', () => {
    const p = project([
      cast('bg', { back: true }),
      cast('a'),
      { kind: 'REORDER', id: 'r1', at: 0, puppetId: '', order: ['a', 'bg'] },
    ]);
    expect(castOf(p).map((x) => x.id)).toEqual(['bg', 'a']);
  });
});

describe('pin slots', () => {
  const twoPins = [
    cast('a'),
    { kind: 'PIN', id: 'pin0', at: 0, puppetId: 'a', px: 0.2, py: 0.2 },
    { kind: 'PIN', id: 'pin1', at: 0, puppetId: 'a', px: 0.8, py: 0.8 },
  ] as RecipeEvent[];

  it('nulls a removed slot rather than compacting it', () => {
    const p = project([
      ...twoPins,
      { kind: 'REMOVE', id: 'x', at: 0, puppetId: 'a', target: { pin: 0 } },
    ]);
    const slots = pinsOf(p, 'a');
    expect(slots).toHaveLength(2);
    expect(slots[0]).toBeNull();
    // Slot 1 still holds the pin a PASS with pin:1 names.
    expect(slots[1]?.px).toBe(0.8);
  });

  it('never reuses a freed slot', () => {
    const p = project([
      ...twoPins,
      { kind: 'REMOVE', id: 'x', at: 0, puppetId: 'a', target: { pin: 0 } },
      { kind: 'PIN', id: 'pin2', at: 0, puppetId: 'a', px: 0.5, py: 0.1 },
    ]);
    const slots = pinsOf(p, 'a');
    expect(slots).toHaveLength(3);
    expect(slots[0]).toBeNull();
    expect(slots[2]?.px).toBe(0.5);
  });

  it('re-places a slot by index without disturbing the others', () => {
    const p = project([
      ...twoPins,
      { kind: 'PIN', id: 'moved', at: 0, puppetId: 'a', px: 0.35, py: 0.35, index: 0 },
    ]);
    const slots = pinsOf(p, 'a');
    expect(slots).toHaveLength(2);
    expect(slots[0]?.px).toBe(0.35);
    expect(slots[1]?.px).toBe(0.8);
  });

  it('rejects an index that names no slot', () => {
    const bad = serializeProject(
      project([cast('a'), { kind: 'PIN', id: 'p', at: 0, puppetId: 'a', px: 0.1, py: 0.1, index: 3 }]),
    );
    expect(() => parseProject(bad)).toThrow(/PIN index/);
  });
});

describe('snip slots and pin exclusivity', () => {
  const snipped = [
    cast('a'),
    { kind: 'PIN', id: 'pin0', at: 0, puppetId: 'a', px: 0.2, py: 0.2 },
    { kind: 'SNIP', id: 's0', at: 0, puppetId: 'a', x0: 0, y0: 0.4, x1: 1, y1: 0.4 },
  ] as RecipeEvent[];

  it('suppresses pins while a live snip exists', () => {
    expect(pinsOf(project(snipped), 'a')).toEqual([]);
  });

  it('brings the pins back when the last snip is removed', () => {
    const p = project([
      ...snipped,
      { kind: 'REMOVE', id: 'x', at: 0, puppetId: 'a', target: { snip: 0 } },
    ]);
    const slots = pinsOf(p, 'a');
    expect(slots).toHaveLength(1);
    expect(slots[0]?.px).toBe(0.2);
  });

  it('keeps piece indices stable across a removal', () => {
    const p = project([
      cast('a'),
      { kind: 'SNIP', id: 's0', at: 0, puppetId: 'a', x0: 0, y0: 0.3, x1: 1, y1: 0.3 },
      { kind: 'SNIP', id: 's1', at: 0, puppetId: 'a', x0: 0, y0: 0.7, x1: 1, y1: 0.7 },
      { kind: 'REMOVE', id: 'x', at: 0, puppetId: 'a', target: { snip: 0 } },
    ]);
    const slots = snipsOf(p, 'a');
    expect(slots[0]).toBeNull();
    const pieces = splitPieces(slots);
    // The surviving piece still answers to the index its passes name.
    expect(pieces.children.map((c) => c.snipIndex)).toEqual([1]);
  });
});

describe('mute, trim and removal of passes', () => {
  const base = [
    cast('a'),
    pass('p1', 'a', [0, 0.1, 0.1, 2, 0.9, 0.9]),
    { kind: 'MOUTH', id: 'm', at: 0, puppetId: 'a', mx: 0.5, my: 0.5, size: 0.2 },
  ] as RecipeEvent[];

  it('drops a muted pass from the sim and from the talking span', () => {
    const p = project([...base, { kind: 'MUTE', id: 'mu', at: 0, puppetId: '', passId: 'p1', muted: true }]);
    expect(effectivePasses(p, 'a')).toHaveLength(0);
    // With no live pass at all, a mouthed puppet talks freely again.
    expect(talkOpenFor(p, 'a', 0.8, 1)).toBe(0.8);
  });

  it('un-mutes on the latest wins rule', () => {
    const p = project([
      ...base,
      { kind: 'MUTE', id: 'mu', at: 0, puppetId: '', passId: 'p1', muted: true },
      { kind: 'MUTE', id: 'mu2', at: 0, puppetId: '', passId: 'p1', muted: false },
    ]);
    expect(effectivePasses(p, 'a')).toHaveLength(1);
  });

  it('clamps a trimmed pass to its window', () => {
    const p = project([
      ...base,
      { kind: 'TRIM', id: 'tr', at: 0, puppetId: '', passId: 'p1', from: 0.5, to: 1.5 },
    ]);
    const [eff] = effectivePasses(p, 'a');
    expect(eff!.from).toBe(0.5);
    expect(eff!.to).toBe(1.5);
    expect(talkOpenFor(p, 'a', 1, 1)).toBe(1);
    expect(talkOpenFor(p, 'a', 1, 1.9)).toBe(0);
  });

  it('removes a pass entirely', () => {
    const p = project([
      ...base,
      { kind: 'REMOVE', id: 'rm', at: 0, puppetId: '', target: { pass: 'p1' } },
    ]);
    expect(effectivePasses(p, 'a')).toHaveLength(0);
  });

  it('ignores a mute whose pass is absent, as corpse recording leaves it', () => {
    const p = project([...base, { kind: 'MUTE', id: 'mu', at: 0, puppetId: '', passId: 'p1', muted: true }]);
    const stripped = { ...p, events: p.events.filter((e) => e.kind !== 'PASS') };
    expect(() => effectivePasses(stripped, 'a')).not.toThrow();
    expect(effectivePasses(stripped, 'a')).toHaveLength(0);
  });

  it('rejects a mute that names no earlier pass', () => {
    const bad = serializeProject(
      project([cast('a'), { kind: 'MUTE', id: 'mu', at: 0, puppetId: '', passId: 'nope', muted: true }]),
    );
    expect(() => parseProject(bad)).toThrow(/MUTE passId/);
  });
});

describe('mouth and eyes removal', () => {
  it('forgets a removed mouth and honours a later one', () => {
    const p = project([
      cast('a'),
      { kind: 'MOUTH', id: 'm1', at: 0, puppetId: 'a', mx: 0.5, my: 0.5, size: 0.2 },
      { kind: 'REMOVE', id: 'x', at: 0, puppetId: 'a', target: { mouth: true } },
    ]);
    expect(mouthOf(p, 'a')).toBeNull();

    const readded = project([
      ...p.events,
      { kind: 'MOUTH', id: 'm2', at: 0, puppetId: 'a', mx: 0.4, my: 0.6, size: 0.3 },
    ]);
    expect(mouthOf(readded, 'a')?.id).toBe('m2');
  });
});

describe('flip', () => {
  const puppet = (flip: boolean) => castOf(project([cast('a', { flip })]))[0]!;

  it('mirrors the local frame, so world and local stay inverses', () => {
    const p = puppet(true);
    const root = restingPuppet(0.5, 0.5);
    const world = localToWorld(root, p, 0.25, 0.75);
    const back = worldToLocal(root, p, world.x, world.y);
    expect(back.x).toBeCloseTo(0.25, 10);
    expect(back.y).toBeCloseTo(0.75, 10);
  });

  it('puts a local point on the opposite side of the puppet', () => {
    const root = restingPuppet(0.5, 0.5);
    const plain = localToWorld(root, puppet(false), 0.25, 0.5);
    const flipped = localToWorld(root, puppet(true), 0.25, 0.5);
    expect(plain.x).toBeLessThan(0.5);
    expect(flipped.x).toBeGreaterThan(0.5);
    // Mirrored about the puppet's centre, by the same distance.
    expect(flipped.x - 0.5).toBeCloseTo(0.5 - plain.x, 10);
    expect(flipped.y).toBeCloseTo(plain.y, 10);
  });

  it('leaves an unflipped puppet exactly as it was', () => {
    const root = restingPuppet(0.5, 0.5);
    const p = puppet(false);
    expect(localToWorld(root, p, 0.3, 0.3)).toEqual(
      localToWorld(root, { ...p, flip: false }, 0.3, 0.3),
    );
  });
});

describe('spring presets', () => {
  /** Chase a target one unit away and report how the puppet got there. */
  const chase = (spring: Parameters<typeof stepPuppet>[3]) => {
    let s = restingPuppet(0, 0);
    let overshoot = 0;
    let stepsTo90 = Infinity;
    for (let i = 0; i < 240; i++) {
      s = stepPuppet(s, { x: 1, y: 0 }, undefined, spring);
      overshoot = Math.max(overshoot, s.x - 1);
      if (stepsTo90 === Infinity && s.x >= 0.9) stepsTo90 = i;
    }
    return { overshoot, stepsTo90, settled: s.x };
  };

  it('treats an unset spring as felt, so v0 recipes replay identically', () => {
    expect(chase(undefined)).toEqual(chase('felt'));
  });

  it('gets floppier from paper through felt to rubber', () => {
    // Overshoot is what "floppy" means here: rubber sails past the finger
    // and comes back, paper barely moves past it at all.
    expect(chase('paper').overshoot).toBeLessThan(chase('felt').overshoot);
    expect(chase('felt').overshoot).toBeLessThan(chase('rubber').overshoot);
    expect(chase('rubber').overshoot).toBeGreaterThan(0.05);
  });

  it('keeps paper the quickest to the target', () => {
    expect(chase('paper').stepsTo90).toBeLessThan(chase('felt').stepsTo90);
  });

  it('settles on the target whichever preset it uses', () => {
    for (const s of ['paper', 'felt', 'rubber'] as const) {
      expect(chase(s).settled).toBeCloseTo(1, 4);
    }
  });

  it('is deterministic', () => {
    expect(chase('rubber')).toEqual(chase('rubber'));
  });
});

describe('event ids and groups', () => {
  it('rejects a duplicate id', () => {
    const bad = JSON.stringify({
      ...createProject('t', new Date('2026-01-01')),
      events: [cast('a'), cast('b')].map((e) => ({ ...e, id: 'same' })),
    });
    expect(() => parseProject(bad)).toThrow(/duplicate event id/);
  });

  it('accepts a contiguous group', () => {
    const ok = serializeProject(
      project([
        cast('a'),
        { ...(cast('b') as RecipeEvent), group: 'g1' },
        { ...(cast('c') as RecipeEvent), group: 'g1' },
      ]),
    );
    expect(parseProject(ok).events).toHaveLength(3);
  });

  it('rejects a group that reopens later', () => {
    const bad = serializeProject(
      project([
        { ...(cast('a') as RecipeEvent), group: 'g1' },
        cast('b'),
        { ...(cast('c') as RecipeEvent), group: 'g1' },
      ]),
    );
    expect(() => parseProject(bad)).toThrow(/not contiguous/);
  });
});
