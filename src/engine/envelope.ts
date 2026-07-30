// Loudness envelope of the bit: what drives every mouth. RMS per hop,
// normalized against the track's own loud parts, fast attack, slower release.
// Pure and deterministic: render recomputes the identical envelope.

export const ENVELOPE_HOP_S = 0.02;

export function computeEnvelope(
  samples: Float32Array,
  sampleRate: number,
  hopS = ENVELOPE_HOP_S,
): Float32Array {
  const hop = Math.max(1, Math.round(hopS * sampleRate));
  const frames = Math.max(1, Math.floor(samples.length / hop));
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * hop;
    for (let i = 0; i < hop; i++) {
      const v = samples[base + i] ?? 0;
      sum += v * v;
    }
    rms[f] = Math.sqrt(sum / hop);
  }

  // Normalize against the 95th percentile so one shout doesn't flatten the rest.
  const sorted = [...rms].sort((a, b) => a - b);
  const p95 = sorted[Math.min(frames - 1, Math.floor(frames * 0.95))]! || 1e-6;

  const env = new Float32Array(frames);
  let sm = 0;
  for (let f = 0; f < frames; f++) {
    const raw = Math.min(1, rms[f]! / p95);
    sm = raw > sm ? raw * 0.7 + sm * 0.3 : sm * 0.82 + raw * 0.18;
    env[f] = sm;
  }
  return env;
}

/** Mouth-open amount at time t, in [0, 1]; a gate keeps murmurs shut. */
export function openAt(env: Float32Array, t: number, hopS = ENVELOPE_HOP_S): number {
  if (env.length === 0) return 0;
  const i = Math.min(env.length - 1, Math.max(0, Math.floor(t / hopS)));
  const v = env[i]!;
  return v < 0.08 ? 0 : Math.min(1, (v - 0.08) / 0.85);
}
