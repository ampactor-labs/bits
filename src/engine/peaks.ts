// Waveform peaks for the timeline.
//
// The timeline used to be an 8px bar 74px wide with an invisible scrubber,
// which told you nothing about where the words are. Peaks are cheap: one
// pass over the mono mixdown the envelope already computes.

/** Per-bucket maximum absolute amplitude, normalised so the loudest bucket
 *  is 1. Pure: same samples in, same peaks out. */
export function peaksFromMono(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(Math.max(1, buckets));
  if (samples.length === 0) return out;
  const per = samples.length / out.length;
  let loudest = 0;
  for (let b = 0; b < out.length; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((b + 1) * per)));
    let peak = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i]!);
      if (v > peak) peak = v;
    }
    out[b] = peak;
    if (peak > loudest) loudest = peak;
  }
  if (loudest > 0) {
    for (let b = 0; b < out.length; b++) out[b] = out[b]! / loudest;
  }
  return out;
}
