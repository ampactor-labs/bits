// End-to-end proof harness, loaded only when the page runs with ?e2e.
// Synthesizes a real mp4 in the browser, performs a scripted recipe over it,
// renders through the production pipeline, and probes the result. What the
// unit tests cannot touch (WebCodecs, mux/demux), this does for real.

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
  getFirstEncodableAudioCodec,
} from 'mediabunny';
import { compileProgram } from '../engine/program';
import { detectOnsets } from '../engine/onsets';
import { createProject, type Project, type RecipeEvent } from '../engine/recipe';
import { mixdownForOnsets } from '../media/audio';
import { renderProject } from '../media/render';
import { VideoSourceHandle } from '../media/source';

interface E2EResult {
  fixtureDurationS: number;
  expectedOutDurationS: number;
  renderedDurationS: number;
  renderedWidth: number;
  renderedHeight: number;
  onsetsInFixture: number[];
  renderedBytes: number;
}

const BEEPS = [0.25, 0.75, 1.25, 1.75];

async function makeFixtureClip(durS = 2, fps = 30): Promise<File> {
  const W = 320;
  const H = 240;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d')!;

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_MEDIUM });
  output.addVideoTrack(videoSource, { frameRate: fps });
  const audioCodec = (await getFirstEncodableAudioCodec(['aac', 'opus'])) ?? 'opus';
  const audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_MEDIUM });
  output.addAudioTrack(audioSource);
  await output.start();

  const frames = durS * fps;
  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    ctx.fillStyle = `hsl(${(t / durS) * 300}, 70%, 45%)`;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect((i * 7) % (W - 40), (i * 11) % (H - 40), 40, 40);
    await videoSource.add(t, 1 / fps);
  }
  videoSource.close();

  const sampleRate = 48000;
  const audio = new AudioBuffer({ length: durS * sampleRate, sampleRate, numberOfChannels: 2 });
  for (let ch = 0; ch < 2; ch++) {
    const data = audio.getChannelData(ch);
    for (const beepAt of BEEPS) {
      const start = Math.floor(beepAt * sampleRate);
      for (let i = 0; i < 0.08 * sampleRate; i++) {
        const env = 1 - i / (0.08 * sampleRate);
        data[start + i] = 0.6 * env * Math.sin((2 * Math.PI * 880 * i) / sampleRate);
      }
    }
  }
  await audioSource.add(audio);
  audioSource.close();

  await output.finalize();
  return new File([target.buffer!], 'fixture.mp4', { type: 'video/mp4' });
}

function scriptedProject(): Project {
  let n = 0;
  const id = () => `e2e${n++}`;
  const events: RecipeEvent[] = [
    { kind: 'CUT', id: id(), at: 0.2 },
    { kind: 'SKIP', id: id(), at: 0.5, endAt: 1.0 },
    { kind: 'SPEED', id: id(), at: 1.2, rate: 0.5 },
    { kind: 'SPEED', id: id(), at: 1.5, rate: 1 },
    { kind: 'ZOOM', id: id(), at: 1.3, cx: 0.5, cy: 0.5, scale: 2 },
  ];
  return { ...createProject('e2e bit'), events };
}

async function run(): Promise<E2EResult> {
  const fixture = await makeFixtureClip();
  const project = scriptedProject();

  const probeIn = await VideoSourceHandle.open(fixture);
  const program = compileProgram(project, probeIn.durationS);
  const expectedOutDurationS = program.outputDurationS;
  const fixtureDurationS = probeIn.durationS;
  probeIn.dispose();

  const mix = await mixdownForOnsets(fixture);
  const onsetsInFixture = mix ? detectOnsets(mix.samples, mix.sampleRate) : [];

  const rendered = await renderProject({ blob: fixture, project, maxWidth: 320 });

  const probeOut = await VideoSourceHandle.open(rendered);
  const result: E2EResult = {
    fixtureDurationS,
    expectedOutDurationS,
    renderedDurationS: probeOut.durationS,
    renderedWidth: probeOut.width,
    renderedHeight: probeOut.height,
    onsetsInFixture,
    renderedBytes: rendered.size,
  };
  probeOut.dispose();
  return result;
}

declare global {
  interface Window {
    __bitsE2E: { run: () => Promise<E2EResult> };
  }
}

window.__bitsE2E = { run };
