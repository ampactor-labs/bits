import { describe, expect, it } from 'vitest';
import { analyzeBands, fft } from './dsp';

const tone = (hz: number, rate: number, seconds: number, from = 0, to = seconds) => {
  const s = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < s.length; i++) {
    const t = i / rate;
    if (t >= from && t < to) s[i] = 0.5 * Math.sin(2 * Math.PI * hz * t);
  }
  return s;
};

describe('fft', () => {
  it('puts a sine in its own bin', () => {
    const n = 1024;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 37 * i) / n);
    fft(re, im);
    const mag = (k: number) => Math.hypot(re[k]!, im[k]!);
    let best = 0;
    for (let k = 1; k < n / 2; k++) if (mag(k) > mag(best)) best = k;
    expect(best).toBe(37);
    expect(mag(37)).toBeCloseTo(n / 2, 0);
  });
});

describe('bands', () => {
  const rate = 48000;

  it('hear bass as bass and air as air', () => {
    const lowThenHigh = new Float32Array(rate * 2);
    lowThenHigh.set(tone(80, rate, 1));
    lowThenHigh.set(tone(9000, rate, 1), rate);
    const b = analyzeBands(lowThenHigh, rate);
    const at = (track: Float32Array, t: number) => track[Math.round(t * 120)]!;
    expect(at(b.bass, 0.5)).toBeGreaterThan(0.9);
    expect(at(b.air, 0.5)).toBeLessThan(0.3);
    expect(at(b.air, 1.5)).toBeGreaterThan(0.9);
    expect(at(b.bass, 1.5)).toBeLessThan(0.3);
    expect(at(b.bright, 1.5)).toBeGreaterThan(at(b.bright, 0.5));
  });

  it('come out on the 120 Hz grid', () => {
    const b = analyzeBands(tone(440, rate, 1.5), rate);
    expect(b.rate).toBe(120);
    expect(b.mid.length).toBe(180);
  });

  it('read silence as nothing', () => {
    const b = analyzeBands(new Float32Array(rate), rate);
    expect(Math.max(...b.bass, ...b.mid, ...b.air, ...b.bright)).toBe(0);
  });
});
