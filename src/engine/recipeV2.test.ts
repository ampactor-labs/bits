// Recipe v2: a backdrop is an ordinary sheet in the back layer. What a v1
// app saved has to open looking exactly as it did, so the migration turns a
// v1 backdrop into the v2 sheet that draws the same and drops whatever v1
// silently ignored rather than suddenly obeying it.

import { describe, expect, it } from 'vitest';
import { RECIPE_VERSION, migrateProject, parseProject, type Project } from './recipe';
import { castOf, createShowSim } from './show';
import { assetRefs, mapAssetRefs } from './assetRefs';

const v1 = (events: Record<string, unknown>[]): Record<string, unknown> => ({
  version: 1,
  id: 'p',
  title: 't',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  seed: 7,
  events,
  audio: { assetId: 'bed.m4a', durationS: 3 },
});

const backdrop = {
  kind: 'CAST',
  id: 'c-sky',
  at: 0,
  puppetId: 'sky',
  puppet: { type: 'cutout', assetId: 'sky.img', w: 1, h: 1 },
  // A v1 halo could leave a stray scale and position on a backdrop; v1
  // drew it full-stage regardless.
  x: 0.3,
  y: 0.7,
  scale: 1.6,
  rot: 0.4,
  flip: true,
  back: true,
};
const guy = {
  kind: 'CAST',
  id: 'c-guy',
  at: 0,
  puppetId: 'guy',
  puppet: { type: 'rect', color: '#fff', w: 0.2, h: 0.2 },
  x: 0.5,
  y: 0.5,
  scale: 1,
  rot: 0,
};
const pass = (id: string, puppetId: string) => ({
  kind: 'PASS',
  id,
  at: 0.1,
  puppetId,
  samples: [0.1, 0.2, 0.2, 0.5, 0.4, 0.4],
});

describe('recipe v2 migration', () => {
  const raw = v1([
    backdrop,
    guy,
    {
      kind: 'WIRE',
      id: 'w-sky',
      at: 0,
      puppetId: 'sky',
      source: 'beat',
      target: 'shake',
      amount: 1,
    },
    {
      kind: 'WIRE',
      id: 'w-guy',
      at: 0,
      puppetId: 'guy',
      source: 'beat',
      target: 'shake',
      amount: 1,
    },
    { kind: 'MOUTH', id: 'm-sky', at: 0, puppetId: 'sky', mx: 0.5, my: 0.5, size: 0.2 },
    pass('p-sky', 'sky'),
    pass('p-guy', 'guy'),
    { kind: 'MUTE', id: 'mute-sky', at: 0, puppetId: '', passId: 'p-sky', muted: true },
    { kind: 'MUTE', id: 'mute-guy', at: 0, puppetId: '', passId: 'p-guy', muted: true },
    { kind: 'REMOVE', id: 'r-sky', at: 0, puppetId: '', target: { pass: 'p-sky' } },
  ]);

  it('turns a v1 backdrop into a cover-fit sheet at rest', () => {
    const p = parseProject(JSON.stringify(raw));
    expect(p.version).toBe(RECIPE_VERSION);
    const sky = p.events.find((e) => e.id === 'c-sky');
    expect(sky).toMatchObject({
      x: 0.5,
      y: 0.5,
      scale: 1,
      rot: 0,
      back: true,
      puppet: { type: 'cutout', assetId: 'sky.img', w: 1, h: 1, fit: 'cover' },
    });
    expect(sky && 'flip' in sky).toBe(false);
  });

  it('drops what v1 ignored on a backdrop, and only that', () => {
    const p = parseProject(JSON.stringify(raw));
    expect(p.events.map((e) => e.id)).toEqual(['c-sky', 'c-guy', 'w-guy', 'p-guy', 'mute-guy']);
  });

  it('is idempotent and leaves today’s files alone', () => {
    const once = migrateProject(raw);
    expect(migrateProject(once)).toEqual(once);
    const today = parseProject(JSON.stringify(once));
    expect(parseProject(JSON.stringify(today))).toEqual(today);
  });

  it('goes the whole way from v0', () => {
    const v0 = { ...raw, version: 0 } as Record<string, unknown>;
    delete v0.updatedAt;
    const p = parseProject(JSON.stringify(v0));
    expect(p.version).toBe(RECIPE_VERSION);
    expect(p.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(p.events.find((e) => e.id === 'c-sky')).toMatchObject({
      x: 0.5,
      puppet: { fit: 'cover' },
    });
  });

  it('only backdrops whose latest cast is a backdrop count', () => {
    // A puppet that was a backdrop and then recast in front keeps its passes.
    const p = parseProject(
      JSON.stringify(
        v1([
          backdrop,
          { ...backdrop, id: 'c-sky2', back: undefined, x: 0.4 },
          pass('p-sky', 'sky'),
        ]),
      ),
    );
    expect(p.events.map((e) => e.id)).toEqual(['c-sky', 'c-sky2', 'p-sky']);
  });

  it('rejects fit on anything but a photo', () => {
    const bad = JSON.parse(JSON.stringify(raw)) as {
      events: Record<string, unknown>[];
      version: number;
    };
    bad.version = RECIPE_VERSION;
    bad.events = [
      { ...guy, puppet: { type: 'rect', color: '#fff', w: 0.2, h: 0.2, fit: 'cover' } },
    ];
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/fit is cover, on photos only/);
  });

  it('simulates a backdrop at rest exactly where it was cast', () => {
    const p = parseProject(JSON.stringify(raw));
    const sky = castOf(p).find((c) => c.id === 'sky')!;
    expect(sky.back).toBe(true);
    const pose = createShowSim(p).advanceTo(2).get('sky')!;
    expect(pose.root).toEqual({ x: 0.5, y: 0.5, vx: 0, vy: 0, angle: 0, squash: 0 });
  });
});

describe('asset references', () => {
  it('lists every asset once and rewrites them all', () => {
    const p: Project = parseProject(
      JSON.stringify({
        ...v1([backdrop]),
        version: RECIPE_VERSION,
        events: [
          {
            ...backdrop,
            x: 0.5,
            y: 0.5,
            scale: 1,
            rot: 0,
            flip: undefined,
            puppet: { ...backdrop.puppet, fit: 'cover' },
          },
          { kind: 'VOICE', id: 'v', at: 1, puppetId: 'sky', assetId: 'take.webm', durationS: 1 },
        ],
      }),
    );
    expect([...assetRefs(p)].sort()).toEqual(['bed.m4a', 'sky.img', 'take.webm']);
    const moved = mapAssetRefs(p, (id) => `new-${id}`);
    expect([...assetRefs(moved)].sort()).toEqual(['new-bed.m4a', 'new-sky.img', 'new-take.webm']);
    expect(assetRefs(p).has('sky.img')).toBe(true);
  });
});
