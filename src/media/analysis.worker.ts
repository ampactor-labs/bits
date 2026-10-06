// Off the main thread: a minute of song is about seven thousand FFTs, and
// the stage has a frame to draw every sixteen milliseconds.

import { analyzeBands } from '../engine/dsp';

self.onmessage = (e: MessageEvent<{ id: number; samples: Float32Array; sampleRate: number }>) => {
  const { id, samples, sampleRate } = e.data;
  const bands = analyzeBands(samples, sampleRate);
  (self as unknown as Worker).postMessage({ id, bands }, [
    bands.bass.buffer,
    bands.mid.buffer,
    bands.air.buffer,
    bands.bright.buffer,
  ]);
};
