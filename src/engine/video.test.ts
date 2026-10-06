import { describe, expect, it } from 'vitest';
import { maskIndex, poseToSamples, videoSignalAt, type VideoSpec, type VideoTracks } from './video';
import { parseSignal, timeSignalAt } from './signals';

const spec: VideoSpec = { type: 'video', assetId: 'a.mp4', durationS: 2, at: 1, w: 0.5, h: 0.4 };

function tracks(): VideoTracks {
  const n = 30;
  const head = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    head[i * 3] = i / (n - 1);
    head[i * 3 + 1] = 0.5;
    // Unseen for a stretch in the middle.
    head[i * 3 + 2] = i >= 10 && i < 15 ? 0 : 1;
  }
  return {
    rate: 15,
    motion: Float32Array.from({ length: n }, (_, i) => i / (n - 1)),
    flowx: new Float32Array(n).fill(0.5),
    flowy: new Float32Array(n),
    pose: { head, leftHand: new Float32Array(n * 3), rightHand: new Float32Array(n * 3) },
    masks: { w: 4, h: 4, frames: Array.from({ length: n }, () => new Uint8Array(16)) },
  };
}

describe('a read clip', () => {
  it('gives its motion at show time, through its own start', () => {
    const t = tracks();
    expect(videoSignalAt(spec, t, 'motion', 0.5)).toBe(0);
    expect(videoSignalAt(spec, t, 'motion', 2)).toBeCloseTo(15 / 29, 6);
    const src = { voice: { open: new Float32Array(), shape: new Uint8Array(), hopS: 0.02 }, onsets: [], voices: new Map(), bands: null, seed: 1, videos: new Map([['v', { spec, tracks: t }]]) };
    expect(timeSignalAt(parseSignal('video:v.flowx')!, src as never, 1.5)).toBeCloseTo(0.5, 6);
    expect(timeSignalAt(parseSignal('video:nobody.motion')!, src as never, 1.5)).toBe(0);
  });

  it('names the mask on show: the latest at or before', () => {
    const t = tracks();
    expect(maskIndex(t, 0)).toBe(0);
    expect(maskIndex(t, 0.999)).toBe(14);
    expect(maskIndex(t, 1)).toBe(15);
    expect(maskIndex(t, 99)).toBe(29);
  });

  it('turns a pose track into a pass in stage coordinates, skipping what was unseen', () => {
    const samples = poseToSamples(spec, tracks(), 'head', { x: 0.5, y: 0.5, w: 0.5, h: 0.4, rot: 0 });
    // Thirty samples, five unseen.
    expect(samples.length / 3).toBe(25);
    // Starts at the clip's start in show time, at the left of the sheet.
    expect(samples[0]).toBe(1);
    expect(samples[1]).toBeCloseTo(0.25, 9);
    expect(samples[2]).toBeCloseTo(0.5, 9);
    // Times rise, and the head moves left to right across the sheet.
    for (let i = 3; i < samples.length; i += 3) {
      expect(samples[i]!).toBeGreaterThan(samples[i - 3]!);
      expect(samples[i + 1]!).toBeGreaterThan(samples[i - 2]!);
    }
  });

  it('parses its signal names, and only those', () => {
    expect(parseSignal('video:v.motion')).toEqual({ kind: 'video', pid: 'v', of: 'motion' });
    expect(parseSignal('video:v.speed')).toBeNull();
    expect(parseSignal('video:.motion')).toBeNull();
  });
});
