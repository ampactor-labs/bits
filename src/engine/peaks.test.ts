import { describe, expect, it } from 'vitest';
import { peaksFromMono } from './peaks';

describe('peaksFromMono', () => {
  it('normalises the loudest bucket to one', () => {
    const peaks = peaksFromMono(Float32Array.from([0.1, 0.1, 0.5, 0.5]), 2);
    // Float32 storage, so compare with a tolerance rather than exactly.
    expect(peaks[0]).toBeCloseTo(0.2, 6);
    expect(peaks[1]).toBe(1);
  });

  it('finds the peak inside each bucket, not the average', () => {
    const peaks = peaksFromMono(Float32Array.from([0, 0, 0, 1]), 2);
    expect(Array.from(peaks)).toEqual([0, 1]);
  });

  it('treats a negative swing as loud as a positive one', () => {
    const peaks = peaksFromMono(Float32Array.from([-1, 0, 0.5, 0]), 2);
    expect(Array.from(peaks)).toEqual([1, 0.5]);
  });

  it('returns silence for silence rather than dividing by zero', () => {
    expect(Array.from(peaksFromMono(new Float32Array(8), 4))).toEqual([0, 0, 0, 0]);
  });

  it('handles an empty track and a zero bucket count', () => {
    expect(peaksFromMono(new Float32Array(0), 4)).toHaveLength(4);
    expect(peaksFromMono(Float32Array.from([1]), 0)).toHaveLength(1);
  });

  it('covers every sample, so a late peak is never dropped', () => {
    const samples = new Float32Array(1000);
    samples[999] = 1;
    const peaks = peaksFromMono(samples, 10);
    expect(peaks[9]).toBe(1);
  });

  it('is deterministic', () => {
    const samples = Float32Array.from({ length: 500 }, (_, i) => Math.sin(i / 7));
    expect(Array.from(peaksFromMono(samples, 32))).toEqual(
      Array.from(peaksFromMono(samples, 32)),
    );
  });
});
