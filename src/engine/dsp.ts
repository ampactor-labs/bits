// Frequency bands from a native-rate decode. The 16 kHz mixdown that every
// mouth is baked from cannot see the "air" band (it stops at 8 kHz), and
// changing it would change every old bit, so bands decode separately.
//
// A Hann-windowed radix-2 FFT every 1/120 s, the sim's grid, so a band
// value lines up with the step it drives. Each band is log energy
// normalised to its own 95th percentile: a quiet song's bass still swings
// the full 0..1, and one loud hit does not flatten the rest.

import type { Bands } from './signals';

/** Bumped whenever the arithmetic below changes what it returns, so any
 *  memo of old results is not reused. */
export const BANDS_VERSION = 1;

const RANGES = {
  bass: [30, 150],
  mid: [150, 2000],
  air: [6000, 16000],
} as const;

/** In-place radix-2 FFT. `re` and `im` have a power-of-two length. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Normalise a track to its own 95th percentile, clamped to 0..1. */
function normalise(track: Float32Array): void {
  const sorted = Float32Array.from(track).sort();
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  if (p95 <= 1e-9) {
    track.fill(0);
    return;
  }
  for (let i = 0; i < track.length; i++) track[i] = Math.min(1, track[i]! / p95);
}

export function analyzeBands(samples: Float32Array, sampleRate: number, rate = 120): Bands {
  const size = sampleRate > 24000 ? 2048 : 1024;
  const hop = sampleRate / rate;
  const frames = Math.max(1, Math.floor(samples.length / hop));
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const binHz = sampleRate / size;
  const binOf = (hz: number) => Math.min(size / 2, Math.max(1, Math.round(hz / binHz)));
  const out = {
    bass: new Float32Array(frames),
    mid: new Float32Array(frames),
    air: new Float32Array(frames),
    bright: new Float32Array(frames),
  };
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const lo = Math.log2(100);
  const hi = Math.log2(10000);
  for (let f = 0; f < frames; f++) {
    // Centred on the frame's moment.
    const start = Math.round(f * hop - size / 2);
    for (let i = 0; i < size; i++) {
      const s = samples[start + i];
      re[i] = s === undefined ? 0 : s * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    let total = 0;
    let weighted = 0;
    const energy = (from: number, to: number) => {
      let e = 0;
      for (let k = binOf(from); k < binOf(to); k++) e += re[k]! * re[k]! + im[k]! * im[k]!;
      return e;
    };
    for (let k = 1; k < size / 2; k++) {
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      total += p;
      weighted += p * k * binHz;
    }
    out.bass[f] = Math.log1p(energy(RANGES.bass[0], RANGES.bass[1]));
    out.mid[f] = Math.log1p(energy(RANGES.mid[0], RANGES.mid[1]));
    out.air[f] = Math.log1p(energy(RANGES.air[0], RANGES.air[1]));
    // Brightness is where the energy sits, not how much there is, so it
    // is absolute: 100 Hz reads 0, 10 kHz reads 1. Silence reads 0.
    const centroid = total > 1e-9 ? weighted / total : 0;
    out.bright[f] =
      centroid > 0 ? Math.min(1, Math.max(0, (Math.log2(centroid) - lo) / (hi - lo))) : 0;
  }
  normalise(out.bass);
  normalise(out.mid);
  normalise(out.air);
  return { rate, ...out };
}
