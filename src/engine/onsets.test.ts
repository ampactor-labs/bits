import { describe, expect, it } from 'vitest';
import { detectOnsets, quantizeToOnsets } from './onsets';

const RATE = 48000;

/** Silence with sharp decaying bursts at the given times. */
function clickTrack(durationS: number, clickTimes: number[]): Float32Array {
  const samples = new Float32Array(Math.floor(durationS * RATE));
  for (const t of clickTimes) {
    const start = Math.floor(t * RATE);
    for (let i = 0; i < 2400 && start + i < samples.length; i++) {
      samples[start + i] = (1 - i / 2400) * (i % 2 === 0 ? 0.9 : -0.9);
    }
  }
  return samples;
}

describe('detectOnsets', () => {
  it('finds clicks near their true times', () => {
    const truth = [0.5, 1.2, 2.0, 2.8];
    const onsets = detectOnsets(clickTrack(3.5, truth), RATE);
    expect(onsets).toHaveLength(truth.length);
    truth.forEach((t, i) => expect(Math.abs(onsets[i]! - t)).toBeLessThan(0.03));
  });

  it('hears nothing in silence', () => {
    expect(detectOnsets(new Float32Array(RATE * 2), RATE)).toEqual([]);
  });

  it('hears nothing in a steady tone', () => {
    const samples = new Float32Array(RATE * 2);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE);
    expect(detectOnsets(samples, RATE)).toEqual([]);
  });

  it('respects the minimum gap between onsets', () => {
    const onsets = detectOnsets(clickTrack(2, [1.0, 1.05, 1.5]), RATE, { minGapS: 0.15 });
    expect(onsets).toHaveLength(2);
  });

  it('returns empty for too-short input', () => {
    expect(detectOnsets(new Float32Array(100), RATE)).toEqual([]);
  });
});

describe('quantizeToOnsets', () => {
  const grid = [1.0, 2.0, 3.0];

  it('snaps to the nearest onset inside the window', () => {
    expect(quantizeToOnsets(2.08, grid)).toBe(2.0);
    expect(quantizeToOnsets(0.95, grid)).toBe(1.0);
  });

  it('returns undefined when nothing is close', () => {
    expect(quantizeToOnsets(1.5, grid)).toBeUndefined();
    expect(quantizeToOnsets(2.5, grid, 0.2)).toBeUndefined();
  });
});
