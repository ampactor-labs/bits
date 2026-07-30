// Energy-flux onset detection: frame the signal, half-wave-rectify the energy
// derivative, pick peaks over an adaptive local threshold. Deliberately simple;
// claps, plosives, and beats are what the quantize grid needs to catch.

export interface OnsetOptions {
  frameSize?: number;
  hopSize?: number;
  /** Threshold = local mean + k * local stddev. */
  k?: number;
  /** Half-width of the local stats window, in frames. */
  statsWindow?: number;
  minGapS?: number;
  /** An onset must rise at least this fraction over the previous frame's
   *  energy; kills false peaks from framing ripple on steady signals. */
  relRise?: number;
}

export function detectOnsets(
  samples: Float32Array,
  sampleRate: number,
  options: OnsetOptions = {},
): number[] {
  const frameSize = options.frameSize ?? 1024;
  const hopSize = options.hopSize ?? 512;
  const k = options.k ?? 1.5;
  const statsWindow = options.statsWindow ?? 20;
  const minGapS = options.minGapS ?? 0.15;
  const relRise = options.relRise ?? 0.1;

  if (samples.length < frameSize * 2) return [];

  const frameCount = Math.floor((samples.length - frameSize) / hopSize) + 1;
  const energy = new Float64Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    let sum = 0;
    const base = f * hopSize;
    for (let i = 0; i < frameSize; i++) {
      const v = samples[base + i]!;
      sum += v * v;
    }
    energy[f] = Math.sqrt(sum / frameSize);
  }

  // Half-wave rectified energy rise.
  const flux = new Float64Array(frameCount);
  for (let f = 1; f < frameCount; f++) {
    flux[f] = Math.max(0, energy[f]! - energy[f - 1]!);
  }

  const onsets: number[] = [];
  const minGapFrames = Math.max(1, Math.round((minGapS * sampleRate) / hopSize));
  let lastOnsetFrame = -minGapFrames;
  for (let f = 1; f < frameCount - 1; f++) {
    const lo = Math.max(0, f - statsWindow);
    const hi = Math.min(frameCount, f + statsWindow + 1);
    let mean = 0;
    for (let i = lo; i < hi; i++) mean += flux[i]!;
    mean /= hi - lo;
    let variance = 0;
    for (let i = lo; i < hi; i++) {
      const d = flux[i]! - mean;
      variance += d * d;
    }
    const std = Math.sqrt(variance / (hi - lo));
    const threshold = mean + k * std + 1e-6;
    const risesEnough = flux[f]! > relRise * energy[f - 1]! + 1e-4;

    const isPeak =
      risesEnough && flux[f]! > threshold && flux[f]! >= flux[f - 1]! && flux[f]! >= flux[f + 1]!;
    if (isPeak && f - lastOnsetFrame >= minGapFrames) {
      onsets.push((f * hopSize) / sampleRate);
      lastOnsetFrame = f;
    }
  }
  return onsets;
}

