import { describe, expect, it } from 'vitest';
import { appendEvent, createProject, type Project, type RecipeEvent } from './recipe';
import {
  compileProgram,
  IDENTITY_ZOOM,
  outToSrc,
  srcToOut,
  truncateAfter,
  zoomAtSrc,
} from './program';

// Distributive omit: Omit over the union directly would collapse to common keys.
type NoId<T> = T extends unknown ? Omit<T, 'id'> : never;

let nextId = 0;
const ev = (e: NoId<RecipeEvent>): RecipeEvent => ({ ...e, id: `e${nextId++}` }) as RecipeEvent;

const withEvents = (events: NoId<RecipeEvent>[]): Project =>
  events.reduce((p, e) => appendEvent(p, ev(e)), createProject('t'));

describe('compileProgram', () => {
  it('maps an empty recipe to one realtime segment', () => {
    const prog = compileProgram(createProject('empty'), 10);
    expect(prog.segments).toHaveLength(1);
    expect(prog.segments[0]).toMatchObject({ srcStart: 0, srcEnd: 10, rate: 1, outStart: 0 });
    expect(prog.outputDurationS).toBe(10);
  });

  it('removes skipped spans from the output', () => {
    const prog = compileProgram(withEvents([{ kind: 'SKIP', at: 2, endAt: 5 }]), 10);
    expect(prog.segments.map((s) => [s.srcStart, s.srcEnd])).toEqual([
      [0, 2],
      [5, 10],
    ]);
    expect(prog.outputDurationS).toBe(7);
  });

  it('merges overlapping skips', () => {
    const prog = compileProgram(
      withEvents([
        { kind: 'SKIP', at: 2, endAt: 5 },
        { kind: 'SKIP', at: 4, endAt: 6 },
      ]),
      10,
    );
    expect(prog.segments.map((s) => [s.srcStart, s.srcEnd])).toEqual([
      [0, 2],
      [6, 10],
    ]);
    expect(prog.outputDurationS).toBe(6);
  });

  it('stretches output time through slow-motion spans', () => {
    // 0-4 realtime, 4-6 at quarter speed, 6-10 realtime.
    const prog = compileProgram(
      withEvents([
        { kind: 'SPEED', at: 4, rate: 0.25 },
        { kind: 'SPEED', at: 6, rate: 1 },
      ]),
      10,
    );
    expect(prog.segments.map((s) => [s.srcStart, s.srcEnd, s.rate])).toEqual([
      [0, 4, 1],
      [4, 6, 0.25],
      [6, 10, 1],
    ]);
    expect(prog.outputDurationS).toBe(4 + 2 / 0.25 + 4);
  });

  it('slices rate edges inside kept spans and keeps skips dominant', () => {
    const prog = compileProgram(
      withEvents([
        { kind: 'SPEED', at: 3, rate: 0.5 },
        { kind: 'SKIP', at: 1, endAt: 4 },
      ]),
      10,
    );
    // Kept: [0,1] at rate 1, [4,10] at rate 0.5 (edge at 3 still governs after the skip).
    expect(prog.segments.map((s) => [s.srcStart, s.srcEnd, s.rate])).toEqual([
      [0, 1, 1],
      [4, 10, 0.5],
    ]);
    expect(prog.outputDurationS).toBe(1 + 6 / 0.5);
  });

  it('drops cut markers that fall inside skipped footage', () => {
    const prog = compileProgram(
      withEvents([
        { kind: 'CUT', at: 3 },
        { kind: 'CUT', at: 7 },
        { kind: 'SKIP', at: 2, endAt: 5 },
      ]),
      10,
    );
    expect(prog.cuts).toEqual([7]);
  });

  it('prefers quantized times when present', () => {
    const prog = compileProgram(
      withEvents([{ kind: 'SKIP', at: 2.05, atQ: 2, endAt: 5 }]),
      10,
    );
    expect(prog.segments[0]!.srcEnd).toBe(2);
  });

  it('exposes rate-1 segments for audio passthrough', () => {
    const prog = compileProgram(withEvents([{ kind: 'SPEED', at: 5, rate: 0.5 }]), 10);
    expect(prog.audioPassSegments.map((s) => [s.srcStart, s.srcEnd])).toEqual([[0, 5]]);
  });

  it('clamps event times and skip ends to the source duration', () => {
    const prog = compileProgram(withEvents([{ kind: 'SKIP', at: 8, endAt: 99 }]), 10);
    expect(prog.segments.map((s) => [s.srcStart, s.srcEnd])).toEqual([[0, 8]]);
  });
});

describe('time mapping', () => {
  const prog = compileProgram(
    withEvents([
      { kind: 'SKIP', at: 2, endAt: 5 },
      { kind: 'SPEED', at: 6, rate: 0.5 },
    ]),
    10,
  );
  // Segments: [0,2]@1 -> out [0,2]; [5,6]@1 -> out [2,3]; [6,10]@0.5 -> out [3,11].

  it('outToSrc walks segments and rates', () => {
    expect(outToSrc(prog, 0)).toBe(0);
    expect(outToSrc(prog, 1.5)).toBe(1.5);
    expect(outToSrc(prog, 2.5)).toBe(5.5);
    expect(outToSrc(prog, 5)).toBe(7);
    expect(outToSrc(prog, 999)).toBe(10);
  });

  it('srcToOut inverts kept times and snaps skipped times forward', () => {
    expect(srcToOut(prog, 1.5)).toBe(1.5);
    expect(srcToOut(prog, 3)).toBe(2); // inside the skip: snaps to out time of src 5
    expect(srcToOut(prog, 8)).toBe(3 + 2 / 0.5);
    expect(srcToOut(prog, 99)).toBe(prog.outputDurationS);
  });

  it('round-trips kept source times', () => {
    for (const t of [0.5, 1.9, 5.2, 6.5, 9.9]) {
      expect(outToSrc(prog, srcToOut(prog, t))).toBeCloseTo(t, 9);
    }
  });
});

describe('zoomAtSrc', () => {
  it('returns identity with no samples', () => {
    expect(zoomAtSrc(createProject('z'), 3)).toEqual(IDENTITY_ZOOM);
  });

  it('holds edges and lerps between samples', () => {
    const p = withEvents([
      { kind: 'ZOOM', at: 2, cx: 0.5, cy: 0.5, scale: 1 },
      { kind: 'ZOOM', at: 4, cx: 0.7, cy: 0.3, scale: 2 },
    ]);
    expect(zoomAtSrc(p, 0)).toEqual({ cx: 0.5, cy: 0.5, scale: 1 });
    expect(zoomAtSrc(p, 3)).toEqual({ cx: 0.6, cy: 0.4, scale: 1.5 });
    expect(zoomAtSrc(p, 9)).toEqual({ cx: 0.7, cy: 0.3, scale: 2 });
  });
});

describe('truncateAfter', () => {
  it('drops later events and clamps a straddling skip', () => {
    const p = withEvents([
      { kind: 'CUT', at: 1 },
      { kind: 'SKIP', at: 2, endAt: 6 },
      { kind: 'CUT', at: 5 },
      { kind: 'ZOOM', at: 7, cx: 0.5, cy: 0.5, scale: 2 },
    ]);
    const cut = truncateAfter(p, 4);
    expect(cut.events.map((e) => e.kind)).toEqual(['CUT', 'SKIP']);
    const skip = cut.events[1] as RecipeEvent & { kind: 'SKIP' };
    expect(skip.endAt).toBe(4);
  });

  it('is a no-op when nothing is later', () => {
    const p = withEvents([{ kind: 'CUT', at: 1 }]);
    expect(truncateAfter(p, 5)).toEqual(p);
  });
});
