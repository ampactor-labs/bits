// The pointer model's arithmetic. These rules used to be checkable only by
// driving a browser, which meant a regression in "does this tap select or
// move" showed up as a screenshot that looked slightly wrong.

import { describe, expect, it } from 'vitest';
import {
  DRAG_PX,
  clamp01,
  handleAt,
  hitTest,
  normPoint,
  outsideBox,
  strokeNear,
  toLocal,
  type StageScene,
} from './hit';
import { createProject, type Project, type RecipeEvent } from '../../engine/recipe';
import { castOf, createShowSim } from '../../engine/show';
import { visualsOf } from '../../media/render';

const cast = (id: string, x: number, y: number, extra: Partial<RecipeEvent> = {}): RecipeEvent =>
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

const scene = (events: RecipeEvent[]): StageScene => {
  const project: Project = { ...createProject('t', new Date('2026-01-01')), events, seed: 1 };
  return {
    project,
    poses: createShowSim(project).advanceTo(0),
    visuals: visualsOf(project),
  };
};

describe('hitTest', () => {
  it('finds the puppet under the finger and misses the empty stage', () => {
    const s = scene([cast('cat', 0.3, 0.4), cast('dog', 0.7, 0.6)]);
    expect(hitTest(s, 0.3, 0.4)?.puppet.id).toBe('cat');
    expect(hitTest(s, 0.7, 0.6)?.puppet.id).toBe('dog');
    expect(hitTest(s, 0.05, 0.95)).toBeNull();
  });

  it('grabs what is on top when two overlap', () => {
    // Later CAST draws in front, so it is what a finger takes hold of.
    const s = scene([cast('under', 0.5, 0.5), cast('over', 0.5, 0.5)]);
    expect(hitTest(s, 0.5, 0.5)?.puppet.id).toBe('over');
  });

  it('never hands back a backdrop', () => {
    const s = scene([cast('sky', 0.5, 0.5, { back: true, puppet: { type: 'rect', color: '#111', w: 1, h: 1 } })]);
    expect(hitTest(s, 0.5, 0.5)).toBeNull();
  });

  it('takes a pin over the body it is pinned to', () => {
    const s = scene([
      cast('cat', 0.5, 0.5, { puppet: { type: 'cutout', assetId: 'a', w: 0.3, h: 0.3 } }),
      { kind: 'PIN', id: 'p1', at: 0, puppetId: 'cat', px: 0.5, py: 0.2 } as RecipeEvent,
    ]);
    const pinned = s.poses.get('cat')!.pins[0]!;
    expect(hitTest(s, pinned.x, pinned.y)).toEqual({ puppet: expect.anything(), channel: { pin: 0 } });
    expect(hitTest(s, 0.5, 0.5)?.channel).toBeNull();
  });

  it('ignores a pin slot that was removed, keeping the slot', () => {
    const s = scene([
      cast('cat', 0.5, 0.5, { puppet: { type: 'cutout', assetId: 'a', w: 0.3, h: 0.3 } }),
      { kind: 'PIN', id: 'p1', at: 0, puppetId: 'cat', px: 0.5, py: 0.2 } as RecipeEvent,
      { kind: 'PIN', id: 'p2', at: 0, puppetId: 'cat', px: 0.5, py: 0.8 } as RecipeEvent,
      { kind: 'REMOVE', id: 'r1', at: 0, puppetId: 'cat', target: { pin: 0 } } as RecipeEvent,
    ]);
    const live = s.poses.get('cat')!.pins[1]!;
    expect(hitTest(s, live.x, live.y)?.channel).toEqual({ pin: 1 });
  });
});

describe('toLocal', () => {
  it('puts the centre of a puppet at the centre of its box', () => {
    const s = scene([cast('cat', 0.4, 0.6)]);
    const p = castOf(s.project)[0]!;
    const local = toLocal(s.poses, p, 0.4, 0.6);
    expect(local.x).toBeCloseTo(0.5, 2);
    expect(local.y).toBeCloseTo(0.5, 2);
  });

  it('mirrors for a flipped puppet, so a pin lands under the finger', () => {
    const s = scene([cast('cat', 0.5, 0.5, { flip: true })]);
    const p = castOf(s.project)[0]!;
    const left = toLocal(s.poses, p, 0.45, 0.5);
    // The finger is left of centre; on a mirrored frame that is the right
    // of the puppet's own box.
    expect(left.x).toBeGreaterThan(0.5);
  });
});

describe('handleAt', () => {
  const handles = new Map([
    ['mouth', { x: 100, y: 100 }],
    ['pin:0', { x: 140, y: 100 }],
  ]);

  it('takes the nearest handle within reach', () => {
    expect(handleAt(handles, 103, 104)).toBe('mouth');
    expect(handleAt(handles, 136, 100)).toBe('pin:0');
  });

  it('takes nothing when the finger is past the reach of any', () => {
    expect(handleAt(handles, 100, 140)).toBeNull();
  });

  it('breaks a tie towards the closer one, not the later one', () => {
    expect(handleAt(handles, 115, 100)).toBe('mouth');
    expect(handleAt(handles, 128, 100)).toBe('pin:0');
  });
});

describe('outsideBox', () => {
  it('keeps a feature nudged to the edge, and lets go of one dragged clear', () => {
    expect(outsideBox({ x: 0.5, y: 0.5 })).toBe(false);
    expect(outsideBox({ x: 0.5, y: 1.1 })).toBe(false);
    expect(outsideBox({ x: 0.5, y: 1.3 })).toBe(true);
    expect(outsideBox({ x: -0.3, y: 0.5 })).toBe(true);
  });
});

describe('strokeNear', () => {
  const strokes = [
    [0.1, 0.1, 0.5, 0.1],
    [0.1, 0.9, 0.5, 0.9],
  ];

  it('finds the line under the finger, topmost first', () => {
    expect(strokeNear(strokes, 0.3, 0.11)).toBe(0);
    expect(strokeNear(strokes, 0.3, 0.89)).toBe(1);
    expect(strokeNear(strokes, 0.3, 0.5)).toBe(-1);
  });

  it('rubs out a dot, which is a stroke of one point', () => {
    expect(strokeNear([[0.4, 0.4]], 0.41, 0.41)).toBe(0);
    expect(strokeNear([[0.4, 0.4]], 0.9, 0.9)).toBe(-1);
  });
});

describe('normPoint', () => {
  const rect = { left: 10, top: 20, width: 100, height: 200 };

  it('maps the frame to 0..1', () => {
    expect(normPoint(rect, 60, 120)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('lets a drag wander into the wings and come back', () => {
    expect(normPoint(rect, -40, 120).x).toBeCloseTo(-0.5, 5);
    // But not so far that a puppet is lost past recovery.
    expect(normPoint(rect, -1000, 120).x).toBe(-0.75);
    expect(normPoint(rect, 9000, 120).x).toBe(1.75);
  });
});

describe('the thresholds', () => {
  it('measures a tap in pixels, not in stage fractions', () => {
    // A fraction of the stage would give nearly twice the slop vertically
    // as horizontally on a 9:16 box.
    expect(DRAG_PX).toBeGreaterThan(0);
    expect(Number.isInteger(DRAG_PX)).toBe(true);
  });

  it('clamps a placed feature into its own box', () => {
    expect(clamp01(-0.3)).toBe(0);
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(0.42)).toBe(0.42);
  });
});
