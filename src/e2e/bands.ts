// Bands in a real browser: a file decoded at its own rate, analysed in the
// worker, must equal the same analysis run inline (the worker is a place,
// not a different calculation), and must hear bass as bass and air as air.

import { analyzeBands } from '../engine/dsp';
import { decodeMono } from '../media/audio';
import { bandsFor } from '../media/bands';

export interface BandsResult {
  sameAsInline: boolean;
  bassLow: number;
  bassHigh: number;
  airLow: number;
  airHigh: number;
}

/** A second of 80 Hz, then a second of 9 kHz, as a 48 kHz WAV. */
function twoToneWav(): Blob {
  const rate = 48000;
  const n = rate * 2;
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const hz = i < rate ? 80 : 9000;
    view.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 16000), true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export async function runBands(): Promise<BandsResult> {
  const wav = twoToneWav();
  const viaWorker = await bandsFor('e2e-two-tone', wav);
  const pcm = await decodeMono(wav);
  if (!viaWorker || !pcm) throw new Error('the two-tone file would not decode');
  const inline = analyzeBands(pcm.samples, pcm.sampleRate);
  const same = (a: Float32Array, b: Float32Array) =>
    a.length === b.length && a.every((v, i) => v === b[i]);
  const at = (track: Float32Array, t: number) => track[Math.round(t * 120)]!;
  return {
    sameAsInline:
      same(viaWorker.bass, inline.bass) &&
      same(viaWorker.mid, inline.mid) &&
      same(viaWorker.air, inline.air) &&
      same(viaWorker.bright, inline.bright),
    bassLow: at(viaWorker.bass, 0.5),
    bassHigh: at(viaWorker.bass, 1.5),
    airLow: at(viaWorker.air, 0.5),
    airHigh: at(viaWorker.air, 1.5),
  };
}
