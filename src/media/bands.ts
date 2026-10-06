// Band analysis for a sound, decoded at its own rate and run in a worker.
// Memoised by asset and analysis version: the preview and the film ask for
// the same bands, and get the very same arrays.

import { analyzeBands, BANDS_VERSION } from '../engine/dsp';
import type { Bands } from '../engine/signals';
import { decodeMono } from './audio';

const memo = new Map<string, Promise<Bands | null>>();
let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, (b: Bands) => void>();

function runInWorker(samples: Float32Array, sampleRate: number): Promise<Bands> {
  if (typeof Worker === 'undefined') return Promise.resolve(analyzeBands(samples, sampleRate));
  if (!worker) {
    worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; bands: Bands }>) => {
      waiting.get(e.data.id)?.(e.data.bands);
      waiting.delete(e.data.id);
    };
  }
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage({ id, samples, sampleRate }, [samples.buffer]);
  });
}

/** Bands for a sound file, or null if it will not decode. `key` names the
 *  sound (its asset id); the same key gets the same answer. */
export function bandsFor(key: string, blob: Blob): Promise<Bands | null> {
  const k = `${key}@${BANDS_VERSION}`;
  let hit = memo.get(k);
  if (!hit) {
    hit = decodeMono(blob)
      .then((pcm) => (pcm ? runInWorker(pcm.samples, pcm.sampleRate) : null))
      .catch(() => null);
    memo.set(k, hit);
  }
  return hit;
}
