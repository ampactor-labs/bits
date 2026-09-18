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
import { createProject, parseProject, type CastEvent, type Project } from '../engine/recipe';
import { castOf as castOfProject } from '../engine/show';
import { visualsOf } from '../media/render';
import { drawStage, STAGE_BG } from '../media/stageDraw';
import { createShowSim } from '../engine/show';
import { detectOnsets } from '../engine/onsets';
import { castOf } from '../engine/show';
import { AudioSourceHandle, mixdownMono } from '../media/audio';
import { deleteAsset, getAsset, saveAsset } from '../media/assets';
import { exportBundle, importBundle } from '../media/bundle';
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
      { kind: 'WIRE', id: 'w3', at: 0, puppetId: '', source: 'on', target: 'foley', amount: 1 },
      { kind: 'SOUND', id: 'snd1', at: 0.6, puppetId: '', sfx: 'honk' },
      {
        kind: 'CAST',
        id: 'c4',
        at: 0,
        puppetId: 'title',
        puppet: { type: 'text', text: 'E2E BIT', w: 0.5, h: 0.1 },
        x: 0.5,
        y: 0.12,
        scale: 1,
        rot: 0,
      },
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

interface BundleE2EResult {
  fileName: string;
  audioRemapped: boolean;
  cutoutRemapped: boolean;
  audioBytesMatch: boolean;
  cutoutBytes: number;
  castCount: number;
  passCount: number;
  survivesOriginalDelete: boolean;
}

/** The remix loop, end to end on real OPFS: export a bit with real assets,
 *  import it back, and prove the copy owns its storage: fresh ids, identical
 *  bytes, and the import keeps playing after the original's assets die. */
async function runBundle(): Promise<BundleE2EResult> {
  const audioId = await saveAsset(await makeFixtureAudio(), 'mp4');
  const png = new OffscreenCanvas(64, 64);
  png.getContext('2d')!.fillRect(8, 8, 48, 48);
  const cutoutId = await saveAsset(await png.convertToBlob({ type: 'image/png' }), 'png');

  const cutCast: CastEvent = {
    kind: 'CAST',
    id: 'cc',
    at: 0,
    puppetId: 'photo',
    puppet: { type: 'cutout', assetId: cutoutId, w: 0.3, h: 0.3 },
    x: 0.5,
    y: 0.62,
    scale: 1,
    rot: 0,
  };
  const project: Project = {
    ...scriptedShow(),
    title: '🎭 roundtrip bit!!',
    audio: { assetId: audioId, durationS: 2 },
    events: [...scriptedShow().events, cutCast],
  };

  const file = await exportBundle(project);
  const imported = await importBundle(file);

  const importedAudioId = imported.audio?.assetId ?? '';
  const photo = imported.events.find(
    (e): e is CastEvent => e.kind === 'CAST' && e.puppetId === 'photo',
  );
  const importedCutoutId =
    photo && photo.puppet.type === 'cutout' ? photo.puppet.assetId : '';

  const originalAudioBytes = (await getAsset(audioId)).size;
  const importedAudioBytes = (await getAsset(importedAudioId)).size;
  const cutoutBytes = (await getAsset(importedCutoutId)).size;

  // The exporter deletes their copy; the import must keep playing.
  await deleteAsset(audioId);
  await deleteAsset(cutoutId);
  let survivesOriginalDelete = true;
  try {
    await getAsset(importedAudioId);
    await getAsset(importedCutoutId);
  } catch {
    survivesOriginalDelete = false;
  }

  return {
    fileName: file.name,
    audioRemapped: importedAudioId !== '' && importedAudioId !== audioId,
    cutoutRemapped: importedCutoutId !== '' && importedCutoutId !== cutoutId,
    audioBytesMatch: importedAudioBytes === originalAudioBytes && importedAudioBytes > 0,
    cutoutBytes,
    castCount: castOf(imported).length,
    passCount: imported.events.filter((e) => e.kind === 'PASS').length,
    survivesOriginalDelete,
  };
}

/** A bit saved by the shipped v0 app, byte for byte. It must keep opening
 *  and keep rendering to the same shape forever. */
const V0_RECIPE = JSON.stringify({
  version: 0,
  id: 'v0-fixture',
  title: 'a bit from before',
  createdAt: '2026-07-31T12:00:00.000Z',
  seed: 20260731,
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
    { kind: 'SNIP', id: 's1', at: 0, puppetId: 'hero', x0: 0, y0: 0.3, x1: 1, y1: 0.28 },
    { kind: 'MOUTH', id: 'm1', at: 0, puppetId: 'hero', mx: 0.5, my: 0.15, size: 0.3 },
    {
      kind: 'PASS',
      id: 'p1',
      at: 0.2,
      puppetId: 'hero',
      samples: [0.2, 0.3, 0.4, 1.0, 0.8, 0.5, 1.8, 0.3, 0.8],
    },
  ],
});

interface V0E2EResult {
  parsedVersion: number;
  updatedAt: string;
  castCount: number;
  renderedDurationS: number;
  renderedWidth: number;
  renderedHeight: number;
  renderedBytes: number;
}

/** The compatibility promise, tested rather than asserted. */
async function runV0(): Promise<V0E2EResult> {
  const audio = await makeFixtureAudio();
  const project = parseProject(V0_RECIPE);
  const rendered = await renderShow({
    audioBlob: audio,
    project,
    getAssetBlob: async () => {
      throw new Error('no assets in this fixture');
    },
    width: 360,
    height: 640,
  });
  const probe = await VideoSourceHandle.open(rendered);
  const out: V0E2EResult = {
    parsedVersion: project.version,
    updatedAt: project.updatedAt ?? '',
    castCount: castOfProject(project).length,
    renderedDurationS: probe.durationS,
    renderedWidth: probe.width,
    renderedHeight: probe.height,
    renderedBytes: rendered.size,
  };
  probe.dispose();
  return out;
}

interface FlipE2EResult {
  /** Fraction of sampled pixels whose mirrored partner agrees. Never quite
   *  1: rasterising a mirrored stroke re-samples its anti-aliasing. */
  mirrorMatch: number;
  /** Fraction of pixels that differ between flipped and unflipped, so the
   *  test cannot pass on a symmetric image by accident. */
  changed: number;
  /** Ink centroid in x, 0..1 across the canvas, for each version. A mirror
   *  puts them at equal distances either side of the middle; this is
   *  immune to anti-aliasing. */
  centroidPlain: number;
  centroidFlipped: number;
}

/** Flip has to be a frame transform, not a draw-time scale. The cheapest
 *  proof it is applied at all, in the one place that reads pixels. */
async function runFlip(): Promise<FlipE2EResult> {
  const W = 96;
  const H = 96;
  const draw = (flip: boolean): ImageData => {
    const base: Project = {
      ...createProject('flip'),
      events: [
        {
          kind: 'CAST',
          id: 'c1',
          at: 0,
          puppetId: 'a',
          // Off-centre in local space, so a mirror is visible.
          puppet: { type: 'doodle', strokes: [[0.05, 0.2, 0.35, 0.2, 0.35, 0.8]], w: 0.8, h: 0.8 },
          x: 0.5,
          y: 0.5,
          scale: 1,
          rot: 0,
          ...(flip ? { flip: true } : {}),
        } as CastEvent,
      ],
    };
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = STAGE_BG;
    ctx.fillRect(0, 0, W, H);
    const cast = castOfProject(base);
    const sim = createShowSim(base);
    drawStage(ctx, W, H, cast, sim.advanceTo(0.5), new Map(), visualsOf(base), new Map(), 0.5, base.seed);
    return ctx.getImageData(0, 0, W, H);
  };

  const plain = draw(false);
  const flipped = draw(true);
  const lum = (d: ImageData, x: number, y: number) => d.data[(y * W + x) * 4]!;

  let matched = 0;
  let total = 0;
  let changed = 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x++) {
      total += 1;
      if (Math.abs(lum(flipped, x, y) - lum(plain, W - 1 - x, y)) <= 8) matched += 1;
      if (Math.abs(lum(flipped, x, y) - lum(plain, x, y)) > 8) changed += 1;
    }
  }

  // Ink centroid: the doodle is bone on a near-black stage, so bright
  // pixels are the drawing.
  const centroid = (d: ImageData) => {
    let sum = 0;
    let weight = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = lum(d, x, y);
        if (v < 80) continue;
        sum += x * v;
        weight += v;
      }
    }
    return weight === 0 ? 0.5 : sum / weight / (W - 1);
  };

  return {
    mirrorMatch: matched / total,
    changed: changed / total,
    centroidPlain: centroid(plain),
    centroidFlipped: centroid(flipped),
  };
}

declare global {
  interface Window {
    __bitsE2E: {
      runShow: () => Promise<ShowE2EResult>;
      runBundle: () => Promise<BundleE2EResult>;
      runV0: () => Promise<V0E2EResult>;
      runFlip: () => Promise<FlipE2EResult>;
    };
  }
}

window.__bitsE2E = { runShow, runBundle, runV0, runFlip };
