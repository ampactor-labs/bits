// End-to-end proof harness, loaded only when the page runs with ?e2e.
// Synthesizes real audio in the browser, casts a scripted show (including a
// scissored puppet with a mouth), renders through the production pipeline,
// and probes the result.

import {
  AudioBufferSource,
  BufferTarget,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
  getFirstEncodableAudioCodec,
} from 'mediabunny';
import { createProject, type Project } from '../engine/recipe';
import { detectOnsets } from '../engine/onsets';
import { AudioSourceHandle, mixdownMono } from '../media/audio';
import { renderShow } from '../media/render';
import { VideoSourceHandle } from '../media/source';

interface ShowE2EResult {
  audioDurationS: number;
  onsetCount: number;
  renderedDurationS: number;
  renderedWidth: number;
  renderedHeight: number;
  renderedBytes: number;
}

const BEEPS = [0.25, 0.75, 1.25, 1.75];

async function makeFixtureAudio(durS = 2): Promise<File> {
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const codec = (await getFirstEncodableAudioCodec(['aac', 'opus'])) ?? 'opus';
  const src = new AudioBufferSource({ codec, bitrate: QUALITY_MEDIUM });
  output.addAudioTrack(src);
  await output.start();
  const sampleRate = 48000;
  const buf = new AudioBuffer({ length: durS * sampleRate, sampleRate, numberOfChannels: 1 });
  const data = buf.getChannelData(0);
  for (const beepAt of BEEPS) {
    const start = Math.floor(beepAt * sampleRate);
    for (let i = 0; i < 0.08 * sampleRate; i++) {
      const env = 1 - i / (0.08 * sampleRate);
      data[start + i] = 0.6 * env * Math.sin((2 * Math.PI * 660 * i) / sampleRate);
    }
  }
  await src.add(buf);
  src.close();
  await output.finalize();
  return new File([target.buffer!], 'bit-audio.mp4', { type: 'video/mp4' });
}

function scriptedShow(): Project {
  const base = createProject('e2e show');
  return {
    ...base,
    events: [
      {
        kind: 'CAST',
        id: 'c1',
        at: 0,
        puppetId: 'hero',
        puppet: { type: 'rect', color: '#f0883e', w: 0.24, h: 0.3 },
        x: 0.3,
        y: 0.4,
        scale: 1,
        rot: 0.1,
      },
      {
        kind: 'CAST',
        id: 'c2',
        at: 0,
        puppetId: 'dood',
        puppet: { type: 'doodle', strokes: [[0, 0, 1, 0.5, 0, 1]], w: 0.2, h: 0.2 },
        x: 0.7,
        y: 0.7,
        scale: 1,
        rot: 0,
      },
      { kind: 'SNIP', id: 's1', at: 0, puppetId: 'hero', x0: 0, y0: 0.3, x1: 1, y1: 0.28 },
      { kind: 'MOUTH', id: 'm1', at: 0, puppetId: 'hero', mx: 0.5, my: 0.15, size: 0.3 },
      { kind: 'EYES', id: 'ey1', at: 0, puppetId: 'hero', ex: 0.5, ey: 0.08, size: 0.3 },
      {
        kind: 'PASS',
        id: 'p1',
        at: 0.2,
        puppetId: 'hero',
        samples: [0.2, 0.3, 0.4, 1.0, 0.8, 0.5, 1.8, 0.3, 0.8],
      },
      {
        kind: 'PASS',
        id: 'p2',
        at: 0.4,
        puppetId: 'hero',
        piece: 0,
        samples: [0.4, 0.5, 0.1, 1.2, 0.7, 0.2],
      },
      { kind: 'DROP', id: 'd1', at: 0, puppetId: 'dood' },
      {
        kind: 'CAST',
        id: 'c3',
        at: 0,
        puppetId: 'dood',
        puppet: { type: 'doodle', strokes: [[0, 0, 1, 0.5, 0, 1]], w: 0.2, h: 0.2 },
        x: 0.6,
        y: 0.8,
        scale: 1.4,
        rot: -0.2,
      },
      { kind: 'WIRE', id: 'w1', at: 0, puppetId: 'hero', source: 'voice', target: 'bounce', amount: 1 },
      { kind: 'WIRE', id: 'w2', at: 0, puppetId: '', source: 'on', target: 'trails', amount: 0.6 },
      { kind: 'PIN', id: 'pin1', at: 0, puppetId: 'dood', px: 0.5, py: 0.1 },
      {
        kind: 'PASS',
        id: 'p3',
        at: 0.5,
        puppetId: 'dood',
        pin: 0,
        samples: [0.5, 0.8, 0.6, 1.5, 0.9, 0.7],
      },
    ],
  };
}

async function runShow(): Promise<ShowE2EResult> {
  const audio = await makeFixtureAudio();
  const probeAudio = await AudioSourceHandle.open(audio);
  const audioDurationS = probeAudio ? await probeAudio.duration() : 0;
  probeAudio?.dispose();

  const mix = await mixdownMono(audio);
  const onsetCount = mix ? detectOnsets(mix.samples, mix.sampleRate).length : 0;

  const rendered = await renderShow({
    audioBlob: audio,
    project: scriptedShow(),
    getAssetBlob: async () => {
      throw new Error('no assets in this fixture');
    },
    width: 360,
    height: 640,
  });

  const probe = await VideoSourceHandle.open(rendered);
  const result: ShowE2EResult = {
    audioDurationS,
    onsetCount,
    renderedDurationS: probe.durationS,
    renderedWidth: probe.width,
    renderedHeight: probe.height,
    renderedBytes: rendered.size,
  };
  probe.dispose();
  return result;
}

declare global {
  interface Window {
    __bitsE2E: { runShow: () => Promise<ShowE2EResult> };
  }
}

window.__bitsE2E = { runShow };
