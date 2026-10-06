import { describe, expect, it } from 'vitest';
import { videoLocalTime } from './video';
import { parseProject, RECIPE_VERSION } from '../engine/recipe';

const clip = (extra: Record<string, unknown> = {}) =>
  ({ type: 'video', assetId: 'a.mp4', durationS: 4, w: 0.5, h: 0.3, ...extra }) as Parameters<typeof videoLocalTime>[0];

describe('where a clip is', () => {
  it('starts at its first frame until its moment comes', () => {
    expect(videoLocalTime(clip({ at: 2 }), 1)).toBe(0);
    expect(videoLocalTime(clip({ at: 2, clipFrom: 1 }), 0)).toBe(1);
  });

  it('plays in show time from its start, and loops', () => {
    expect(videoLocalTime(clip({ at: 1 }), 2.5)).toBeCloseTo(1.5, 12);
    expect(videoLocalTime(clip({ at: 0 }), 5)).toBeCloseTo(1, 12);
    expect(videoLocalTime(clip({ at: 0, clipFrom: 1 }), 4)).toBeCloseTo(2, 12);
  });

  it('holds its last frame when told not to loop', () => {
    expect(videoLocalTime(clip({ loop: false }), 9)).toBeCloseTo(4 - 1e-3, 9);
  });
});

describe('recipe v8', () => {
  const header = { id: 'x', title: 'x', createdAt: '', seed: 1 };
  const cast = (puppet: object) => ({
    kind: 'CAST',
    id: 'c',
    at: 0,
    puppetId: 'v',
    puppet,
    x: 0.5,
    y: 0.5,
    scale: 1,
    rot: 0,
  });
  const parse = (version: number, events: Record<string, unknown>[]) =>
    parseProject(JSON.stringify({ ...header, version, events }));

  it('moves a v7 file up untouched', () => {
    expect(parse(7, []).version).toBe(RECIPE_VERSION);
  });

  it('takes a clip with a start inside it, and nothing else', () => {
    expect(parse(8, [cast(clip({ at: 1, clipFrom: 0.5 }))]).events).toHaveLength(1);
    expect(() => parse(8, [cast(clip({ durationS: 0 }))])).toThrow(/video/);
    expect(() => parse(8, [cast(clip({ clipFrom: 5 }))])).toThrow(/video/);
    expect(() => parse(8, [cast(clip({ assetId: '' }))])).toThrow(/video/);
  });
});
