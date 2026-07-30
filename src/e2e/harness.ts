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

interface ShowE2EResult {
  audioDurationS: number;
  renderedDurationS: number;
  renderedWidth: number;
  renderedHeight: number;
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
  for (let i = 0; i < data.length; i++) {
    data[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
  }
  await src.add(buf);
  src.close();
  await output.finalize();
  return new File([target.buffer!], 'bit-audio.mp4', { type: 'video/mp4' });
}

/** The puppet-show pipeline, end to end: audio spine, cast, a recorded pass,
 *  spring simulation, render, re-probe. */
async function runShow(): Promise<ShowE2EResult> {
  const audio = await makeFixtureAudio();
  const probeAudio = await (await import('../media/audio')).AudioSourceHandle.open(audio);
  const audioDurationS = probeAudio ? await probeAudio.duration() : 0;
  probeAudio?.dispose();

  const base = createProject('e2e show');
  const project: Project = {
    ...base,
    events: [
      {
        kind: 'CAST',
        id: 'c1',
        at: 0,
        puppetId: 'hero',
        puppet: { type: 'rect', color: '#f0883e', w: 0.2, h: 0.12 },
        x: 0.2,
        y: 0.2,
        scale: 1,
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
      },
      {
        kind: 'PASS',
        id: 'p1',
        at: 0.2,
        puppetId: 'hero',
        samples: [0.2, 0.2, 0.2, 1.0, 0.8, 0.5, 1.8, 0.3, 0.8],
      },
    ],
  };

  const rendered = await (await import('../media/render')).renderShow({
    audioBlob: audio,
    project,
    getAssetBlob: async () => {
      throw new Error('no assets in this fixture');
    },
    width: 360,
    height: 640,
  });

  const probe = await VideoSourceHandle.open(rendered);
  const result: ShowE2EResult = {
    audioDurationS,
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
    __bitsE2E: { run: () => Promise<E2EResult>; runShow: () => Promise<ShowE2EResult> };
  }
}

window.__bitsE2E = { run, runShow };
