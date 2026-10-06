import { describe, expect, it } from 'vitest';
import { fixtureAnalysis, fixtureProject } from '../e2e/fixtures';
import {
  CAMERA_ID,
  FOCAL,
  REST_CAMERA,
  inFront,
  isRestCamera,
  magnification,
  toScreen,
  toStage,
  viewOf,
  type CameraPose,
} from './camera';
import { createFramer, composeFrame, paintOrder, visualsOf } from './frame';
import { parseProject, RECIPE_VERSION, type Project, type RecipeEvent } from './recipe';
import { castOf, createShowSim } from './show';
import { effectiveWires } from './wires';

const W = 390;
const H = 693;
const cam = (patch: Partial<CameraPose>): CameraPose => ({ ...REST_CAMERA, ...patch });

describe('the camera', () => {
  it('is an exact identity at rest, whatever the depth', () => {
    expect(isRestCamera({ ...REST_CAMERA })).toBe(true);
    for (const depth of [-1, 0, 2, 9]) {
      expect(viewOf(REST_CAMERA, depth, W, H)).toBeNull();
      expect(toScreen(REST_CAMERA, depth, 0.3, 0.7, W, H)).toEqual({ x: 0.3, y: 0.7 });
    }
    expect(viewOf(null, 3, W, H)).toBeNull();
  });

  it('slides far sheets less: parallax is f / (f + depth)', () => {
    const panned = cam({ x: 0.6 });
    for (const depth of [0, 1, 2, 6]) {
      const at = toScreen(panned, depth, 0.5, 0.5, W, H);
      const slide = 0.5 - at.x;
      expect(slide).toBeCloseTo(0.1 * (FOCAL / (FOCAL + depth)), 12);
      expect(at.y).toBeCloseTo(0.5, 12);
    }
  });

  it('grows near sheets faster on a dolly', () => {
    const dolly = cam({ z: 1 });
    expect(magnification(dolly, 0)).toBeCloseTo(2, 12);
    expect(magnification(dolly, 2)).toBeCloseTo(4 / 3, 12);
    expect(magnification(REST_CAMERA, 0)).toBe(1);
    expect(inFront(cam({ z: 1.9 }), 0)).toBe(true);
    expect(inFront(cam({ z: 1.96 }), 0)).toBe(false);
  });

  it('rolls without shearing the stage', () => {
    // A quarter turn about the middle: a point right of centre by d pixels
    // ends up below it by d pixels, on a stage that is not square.
    const roll = cam({ rot: Math.PI / 2 });
    const d = 50;
    const at = toScreen(roll, 0, 0.5 + d / W, 0.5, W, H);
    expect(at.x * W).toBeCloseTo(W / 2, 9);
    expect(at.y * H).toBeCloseTo(H / 2 + d, 9);
  });

  it('round-trips a point through any camera at any depth', () => {
    const cams = [
      cam({ x: 0.3, y: 0.62 }),
      cam({ z: 0.8, rot: 0.4 }),
      cam({ x: 0.7, y: 0.4, z: -1, rot: -1.2, scale: 1.7 }),
    ];
    for (const c of cams) {
      for (const depth of [-0.5, 0, 1.5, 7]) {
        for (const [x, y] of [
          [0.1, 0.2],
          [0.5, 0.5],
          [0.93, 0.71],
        ] as const) {
          const s = toScreen(c, depth, x, y, W, H);
          const back = toStage(c, depth, s.x, s.y, W, H);
          expect(back.x).toBeCloseTo(x, 10);
          expect(back.y).toBeCloseTo(y, 10);
        }
      }
    }
  });
});

let n = 0;
const ev = (e: Record<string, unknown>) => ({ id: `e${n++}`, at: 0, ...e }) as RecipeEvent;

function cameraShow(): Project {
  const base = fixtureProject();
  const pan: number[] = [];
  const dolly: number[] = [];
  for (let i = 0; i <= 30; i++) {
    const t = 0.5 + i * 0.1;
    pan.push(t, 0.5 + 0.15 * Math.sin(i / 5), 0.5);
    dolly.push(t, 0.6 * (i / 30), 0);
  }
  return {
    ...base,
    events: [
      ...base.events,
      ev({ kind: 'PASS', at: 0.5, puppetId: CAMERA_ID, samples: pan }),
      ev({ kind: 'PASS', at: 0.5, puppetId: CAMERA_ID, samples: dolly, prop: 'z' }),
    ],
  };
}

describe('the camera in the sim', () => {
  it('is absent from a show that never moves it', () => {
    const sim = createShowSim(fixtureProject());
    sim.advanceTo(2);
    expect(sim.camera()).toBeNull();
    expect(createFramer(fixtureProject()).frameAt(2).camera).toBeNull();
  });

  it('rests exactly while a live stage could move it but has not', () => {
    const sim = createShowSim(fixtureProject(), 0, () => null);
    sim.advanceTo(2);
    expect(sim.camera()).toEqual(REST_CAMERA);
  });

  it('follows its passes with weight: pan and dolly', () => {
    const sim = createShowSim(cameraShow());
    sim.advanceTo(0.4);
    expect(sim.camera()).toEqual(REST_CAMERA);
    sim.advanceTo(3.5);
    const c = sim.camera()!;
    expect(c.z).toBeGreaterThan(0.4);
    expect(c.x).not.toBe(0.5);
    // A scalar pass touches nothing but its own number.
    expect(c.rot).toBe(0);
    expect(c.scale).toBe(1);
  });

  it('puts the camera on the frame, and leaves it off at rest', () => {
    const framer = createFramer(cameraShow(), fixtureAnalysis());
    expect(framer.frameAt(0.3).camera).toBeNull();
    expect(framer.frameAt(2).camera).not.toBeNull();
  });
});

describe('depth', () => {
  const withDepth = (depths: Record<string, number>): Project => {
    const base = fixtureProject();
    return {
      ...base,
      events: base.events.map((e) =>
        e.kind === 'CAST' && depths[e.puppetId] !== undefined
          ? { ...e, depth: depths[e.puppetId]! }
          : e,
      ),
    };
  };

  it('paints further sheets first, inside their layer', () => {
    const order = (p: Project) => paintOrder(castOf(p)).map((s) => s.id);
    expect(order(fixtureProject())).toEqual(castOf(fixtureProject()).map((s) => s.id));
    // The word pushed back goes behind the others; the sky stays behind
    // everything however near it is brought.
    expect(order(withDepth({ word: 3, sky: -1 }))).toEqual(['sky', 'word', 'bg', 'guy', 'cat']);
  });

  it('culls a sheet the camera has flown past', () => {
    const p = withDepth({ word: -1 });
    const frame = composeFrame({
      project: p,
      cast: castOf(p),
      visuals: visualsOf(p),
      wires: effectiveWires(p),
      analysis: fixtureAnalysis(),
      poses: createShowSim(p).advanceTo(1),
      t: 1,
      camera: cam({ z: 1 }),
    });
    expect(frame.layers.map((l) => l.puppet.id)).not.toContain('word');
    expect(frame.layers.find((l) => l.puppet.id === 'cat')!.depth).toBe(0);
  });
});

describe('checkpoints', () => {
  it('a seek from a checkpoint lands exactly where a fresh sim does', () => {
    const p = cameraShow();
    // Fill the book by playing through.
    createShowSim(p).advanceTo(3.9);
    for (const t of [0.2, 1.0, 1.73, 2.5, 3.333]) {
      const fresh = createShowSim(p);
      const poses = fresh.advanceTo(t);
      const resumed = createShowSim(p, 0, undefined, undefined, { resumeAt: t });
      expect(resumed.advanceTo(t)).toEqual(poses);
      expect(resumed.camera()).toEqual(fresh.camera());
    }
  });

  it('a live stage can resume from one too', () => {
    const p = cameraShow();
    createShowSim(p).advanceTo(3);
    const fresh = createShowSim(p, 0, () => null);
    const resumed = createShowSim(p, 0, () => null, undefined, { resumeAt: 2.4 });
    expect(resumed.advanceTo(2.4)).toEqual(fresh.advanceTo(2.4));
    expect(resumed.camera()).toEqual(fresh.camera());
  });
});

describe('recipe v3', () => {
  const header = { id: 'x', title: 'x', createdAt: '', seed: 1 };
  const parse = (version: number, events: Record<string, unknown>[]) =>
    parseProject(JSON.stringify({ ...header, version, events }));
  const cast = (extra: Record<string, unknown> = {}) => ({
    kind: 'CAST',
    id: 'c',
    at: 0,
    puppetId: 'a',
    puppet: { type: 'rect', color: '#fff', w: 0.2, h: 0.2 },
    x: 0.5,
    y: 0.5,
    scale: 1,
    rot: 0,
    ...extra,
  });

  it('moves a v2 file up untouched', () => {
    const p = parse(2, [cast()]);
    expect(p.version).toBe(RECIPE_VERSION);
    expect(p.events).toEqual([cast()]);
  });

  it('takes depth within its range', () => {
    expect((parse(3, [cast({ depth: 2.5 })]).events[0] as { depth: number }).depth).toBe(2.5);
    expect(() => parse(3, [cast({ depth: 40 })])).toThrow(/depth/);
    expect(() => parse(3, [cast({ depth: 'far' })])).toThrow(/depth/);
  });

  it('keeps the camera id for the camera', () => {
    expect(() => parse(3, [cast({ puppetId: CAMERA_ID })])).toThrow(/camera/);
    const pass = { kind: 'PASS', id: 'p', at: 0, puppetId: CAMERA_ID, samples: [0, 1, 0, 1, 1.2, 0] };
    expect(parse(3, [{ ...pass, prop: 'z' }]).events).toHaveLength(1);
    expect(() => parse(3, [{ ...pass, prop: 'hue' }])).toThrow(/prop/);
    expect(() => parse(3, [{ ...pass, puppetId: 'a', prop: 'z' }])).toThrow(/camera/);
    expect(() => parse(3, [{ ...pass, pin: 0 }])).toThrow(/camera/);
  });
});
