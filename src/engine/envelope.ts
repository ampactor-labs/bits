// The voice track: what drives every mouth. Per hop, RMS loudness (normalized
// against the track's own loud parts) plus zero-crossing rate, classified
// into mouth shapes: spectral-class visemes, not phoneme-class, but real
// shaped speech. Pure and deterministic: render recomputes the identical
// track.

export const ENVELOPE_HOP_S = 0.02;

export const SHAPE_CLOSED = 0;
export const SHAPE_SMALL = 1;
export const SHAPE_WIDE = 2;
export const SHAPE_SLIT = 3;
export const SHAPE_ROUND = 4;

export interface VoiceTrack {
  open: Float32Array;
  shape: Uint8Array;
  hopS: number;
}

export const EMPTY_VOICE: VoiceTrack = {
  open: new Float32Array(0),
  shape: new Uint8Array(0),
  hopS: ENVELOPE_HOP_S,
};

export function computeVoiceTrack(
  samples: Float32Array,
  sampleRate: number,
  hopS = ENVELOPE_HOP_S,
): VoiceTrack {
  const hop = Math.max(1, Math.round(hopS * sampleRate));
  const frames = Math.max(1, Math.floor(samples.length / hop));
  const rms = new Float32Array(frames);
  const zcr = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    let crossings = 0;
    const base = f * hop;
    let prev = samples[base] ?? 0;
    for (let i = 0; i < hop; i++) {
      const v = samples[base + i] ?? 0;
      sum += v * v;
      if ((v >= 0) !== (prev >= 0)) crossings += 1;
      prev = v;
    }
    rms[f] = Math.sqrt(sum / hop);
    // Normalized to crossings per sample; 1.0 would be Nyquist-rate flipping.
    zcr[f] = crossings / hop;
  }

  // Normalize loudness against the 95th percentile so one shout doesn't
  // flatten the rest.
  const sorted = [...rms].sort((a, b) => a - b);
  const p95 = sorted[Math.min(frames - 1, Math.floor(frames * 0.95))]! || 1e-6;

  const open = new Float32Array(frames);
  const shape = new Uint8Array(frames);
  let sm = 0;
  for (let f = 0; f < frames; f++) {
    const raw = Math.min(1, rms[f]! / p95);
    sm = raw > sm ? raw * 0.7 + sm * 0.3 : sm * 0.82 + raw * 0.18;
    open[f] = sm;

    if (sm < 0.08) {
      shape[f] = SHAPE_CLOSED;
    } else if (zcr[f]! > 0.16) {
      // Noisy/fricative frames: s, sh, f. Teeth together, lips apart.
      shape[f] = SHAPE_SLIT;
    } else if (zcr[f]! < 0.012 && sm < 0.6) {
      // Very low frequency content at moderate loudness: o/u-ish.
      shape[f] = SHAPE_ROUND;
    } else if (sm > 0.45) {
      shape[f] = SHAPE_WIDE;
    } else {
      shape[f] = SHAPE_SMALL;
    }
  }
  return { open, shape, hopS };
}

export interface VoiceMoment {
  open: number;
  shape: number;
}

/** Mouth state at time t; a gate keeps murmurs shut. */
export function voiceAt(track: VoiceTrack, t: number): VoiceMoment {
  if (track.open.length === 0) return { open: 0, shape: SHAPE_CLOSED };
  const i = Math.min(track.open.length - 1, Math.max(0, Math.floor(t / track.hopS)));
  const v = track.open[i]!;
  const open = v < 0.08 ? 0 : Math.min(1, (v - 0.08) / 0.85);
  return { open, shape: open === 0 ? SHAPE_CLOSED : track.shape[i]! };
}
