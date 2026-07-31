// The foley cabinet: every sound synthesized on demand, mono 48k, pure and
// deterministic, so renders mix the identical samples the performance played.

export const SFX_RATE = 48000;
export const SFX_NAMES = ['boing', 'slap', 'honk', 'scratch', 'drop'] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/** Impact foley alternates so back-to-back hits don't sound stuck. */
export const impactSfx = (count: number): SfxName => (count % 2 ? 'slap' : 'boing');

/** Squash above this, rising, counts as an impact. */
export const IMPACT_SQUASH = 0.18;

const cache = new Map<SfxName, Float32Array>();

export function renderSfx(name: SfxName): Float32Array {
  const hit = cache.get(name);
  if (hit) return hit;
  const out = synth(name);
  cache.set(name, out);
  return out;
}

function synth(name: SfxName): Float32Array {
  switch (name) {
    case 'boing': {
      // Springy pitch dive with vibrato.
      const n = Math.floor(0.55 * SFX_RATE);
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / SFX_RATE;
        const env = Math.exp(-6 * t);
        const freq = 320 * Math.exp(-2.2 * t) + 40 * Math.sin(2 * Math.PI * 18 * t) * env;
        d[i] = 0.55 * env * Math.sin(2 * Math.PI * freq * t + 6 * Math.sin(2 * Math.PI * 13 * t));
      }
      return d;
    }
    case 'slap': {
      // A short, bright noise crack with a fast decay.
      const n = Math.floor(0.12 * SFX_RATE);
      const d = new Float32Array(n);
      let x = 987654321;
      let lp = 0;
      for (let i = 0; i < n; i++) {
        x = (Math.imul(x, 1103515245) + 12345) >>> 0;
        const noise = (x / 0xffffffff) * 2 - 1;
        lp += 0.45 * (noise - lp);
        d[i] = 0.8 * lp * Math.exp(-40 * (i / SFX_RATE));
      }
      return d;
    }
    case 'honk': {
      // Two detuned reeds, clown-grade.
      const n = Math.floor(0.35 * SFX_RATE);
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / SFX_RATE;
        const env = Math.min(1, t * 40) * Math.exp(-7 * t);
        const a = Math.sign(Math.sin(2 * Math.PI * 185 * t));
        const b = Math.sign(Math.sin(2 * Math.PI * 233 * t));
        d[i] = 0.28 * env * (a + b);
      }
      return d;
    }
    case 'scratch': {
      // Wobbling filtered noise, record-scratch-ish.
      const n = Math.floor(0.3 * SFX_RATE);
      const d = new Float32Array(n);
      let x = 24681357;
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SFX_RATE;
        x = (Math.imul(x, 1103515245) + 12345) >>> 0;
        const noise = (x / 0xffffffff) * 2 - 1;
        const cutoff = 0.15 + 0.8 * Math.abs(Math.sin(2 * Math.PI * 9 * t));
        lp += cutoff * (noise - lp);
        d[i] = 0.6 * lp * Math.sin((Math.PI * i) / n);
      }
      return d;
    }
    case 'drop': {
      // Descending whistle into a sub thump.
      const n = Math.floor(0.7 * SFX_RATE);
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / SFX_RATE;
        const whistle =
          t < 0.42
            ? 0.3 * Math.sin(2 * Math.PI * (900 - 1600 * t) * t) * Math.exp(-2 * t)
            : 0;
        const thump =
          t >= 0.42
            ? 0.7 * Math.exp(-9 * (t - 0.42)) * Math.sin(2 * Math.PI * 55 * (t - 0.42))
            : 0;
        d[i] = whistle + thump;
      }
      return d;
    }
  }
}

/** Mix a sound into a slice of a mix bus. bufStartS is the bus slice's start
 *  on the show timeline; the sfx begins at `at`. */
export function mixSfxInto(
  channel: Float32Array,
  bufStartS: number,
  bufRate: number,
  at: number,
  name: SfxName,
): void {
  const pcm = renderSfx(name);
  const offsetS = bufStartS - at;
  for (let i = 0; i < channel.length; i++) {
    const srcIdx = Math.round((offsetS + i / bufRate) * SFX_RATE);
    if (srcIdx < 0) continue;
    if (srcIdx >= pcm.length) break;
    channel[i] = Math.max(-1, Math.min(1, channel[i]! + pcm[srcIdx]!));
  }
}
