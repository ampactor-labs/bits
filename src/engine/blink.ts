// Blinking: now and then, never on a beat, never in step with anyone
// else. A pair of eyes blinks once in each 3.5 s window, at a moment in
// that window drawn from the seed and the sheet's name, and a blink takes
// an eighth of a second. Pure: the same eyes blink at the same moments in
// every preview and every film.

import { boilNoise } from './puppet';

const WINDOW_S = 3.5;
const BLINK_S = 0.13;

const nameHash = (id: string): number => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** How closed the eyes are at t: 0 open, 1 shut. */
export function blinkAt(seed: number, puppetId: string, t: number): number {
  const w = Math.floor(t / WINDOW_S);
  const u = 0.5 + 0.5 * boilNoise(seed ^ nameHash(puppetId), w, 77);
  const start = w * WINDOW_S + 0.4 + u * (WINDOW_S - 0.8);
  const k = (t - start) / BLINK_S;
  if (k < 0 || k > 1) return 0;
  // Down fast, up a little slower.
  return k < 0.4 ? k / 0.4 : 1 - (k - 0.4) / 0.6;
}
