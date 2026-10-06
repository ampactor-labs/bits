import { describe, expect, it } from 'vitest';
import { deserializeTracks, serializeTracks } from './videoAnalysis';
import type { VideoTracks } from '../engine/video';

describe('a stored read', () => {
  it('comes back exactly as it went in', async () => {
    const n = 7;
    const t: VideoTracks = {
      rate: 15,
      motion: Float32Array.from({ length: n }, (_, i) => i / 7),
      flowx: Float32Array.from({ length: n }, (_, i) => -i / 9),
      flowy: Float32Array.from({ length: n }, (_, i) => i / 11),
      pose: {
        head: Float32Array.from({ length: n * 3 }, (_, i) => i / 21),
        leftHand: new Float32Array(n * 3).fill(0.25),
        rightHand: new Float32Array(n * 3).fill(0.75),
      },
      masks: { w: 3, h: 2, frames: Array.from({ length: n }, (_, i) => new Uint8Array(6).fill(i * 30)) },
    };
    const back = await deserializeTracks(serializeTracks(t));
    expect(back).toEqual(t);
  });

  it('keeps a read with no models: motion only', async () => {
    const t: VideoTracks = {
      rate: 15,
      motion: new Float32Array([0, 1]),
      flowx: new Float32Array([0, 0.5]),
      flowy: new Float32Array([0, -0.5]),
      pose: null,
      masks: null,
    };
    expect(await deserializeTracks(serializeTracks(t))).toEqual(t);
  });
});
