import { describe, expect, it } from 'vitest';
import {
  gradeLut,
  gradeParams,
  gradePixels,
  grainTile,
  harmony,
  oklch,
  PAPER_PRESETS,
  type Grade,
} from './grade';

const W = 40;
const H = 40;
const flat = (v: number) => {
  const a = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < a.length; i += 4) a.set([v, v, v, 255], i);
  return a;
};
const run = (grade: Grade, src: Uint8ClampedArray) => {
  const dst = new Uint8ClampedArray(src.length);
  gradePixels(src, dst, W, H, gradeParams(grade, W, 0), grainTile(grade.seed));
  return dst;
};
const at = (a: Uint8ClampedArray, x: number, y: number) => [...a.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];

describe('palettes', () => {
  it('are five in-gamut colours, dark to light', () => {
    for (const kind of ['analogous', 'complement', 'triad', 'duotone'] as const) {
      const colours = harmony(kind, 200);
      expect(colours).toHaveLength(5);
      const lum = colours.map((c) => {
        const n = parseInt(c.slice(1), 16);
        return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
      });
      for (let i = 1; i < 5; i++) expect(lum[i]!).toBeGreaterThan(lum[i - 1]!);
    }
    for (const v of oklch(0.7, 0.4, 30)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('map greys onto the palette by brightness', () => {
    const colours = harmony('complement', 30);
    const lut = gradeLut({ palette: { colors: colours, mix: 1 }, paper: null, seed: 1 });
    // Black lands on the darkest stop, white on the lightest.
    const n0 = parseInt(colours[0]!.slice(1), 16);
    expect([lut[0], lut[1], lut[2]]).toEqual([(n0 >> 16) & 255, (n0 >> 8) & 255, n0 & 255]);
    const out = run({ palette: { colors: colours, mix: 1 }, paper: null, seed: 1 }, flat(128));
    expect(at(out, 20, 20)).not.toEqual([128, 128, 128]);
  });
});

describe('paper', () => {
  it('lifts black, darkens corners, and grains', () => {
    const black = run({ palette: null, paper: { edge: 0, grain: 0, fade: 1, misreg: 0 }, seed: 1 }, flat(0));
    expect(at(black, 20, 20)[0]!).toBeGreaterThan(60);
    const white = run({ palette: null, paper: { edge: 1, grain: 0, fade: 0, misreg: 0 }, seed: 1 }, flat(255));
    expect(at(white, 0, 0)[0]!).toBeLessThan(at(white, 20, 20)[0]!);
    const grey = run({ palette: null, paper: { edge: 0, grain: 1, fade: 0, misreg: 0 }, seed: 1 }, flat(128));
    const seen = new Set<number>();
    for (let i = 0; i < grey.length; i += 4) seen.add(grey[i]!);
    expect(seen.size).toBeGreaterThan(10);
  });

  it('is the same every time for the same seed and moment', () => {
    const g: Grade = { palette: { colors: harmony('triad', 100), mix: 0.8 }, paper: PAPER_PRESETS.risograph!, seed: 7 };
    expect(run(g, flat(90))).toEqual(run(g, flat(90)));
  });
});
