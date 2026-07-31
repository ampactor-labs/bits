// The first-run demo: a bit that builds itself on-device and shows the
// ceiling. Synthesized soundtrack (beat plus two chattering voices), doodle
// cast, wing entrances, a snipped nodding head, talker-rule mouths, eyes,
// wires, trails, and a flung hot dog. It is an ordinary show: open the kit
// and wreck it, that's the tutorial's second act.

import {
  AudioBufferSource,
  BufferTarget,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
  getFirstEncodableAudioCodec,
} from 'mediabunny';
import { parseProject, serializeProject, type Project, type RecipeEvent } from '../engine/recipe';
import { AudioSourceHandle } from '../media/audio';
import { restoreAsset } from '../media/assets';
import { saveProjectJson } from '../media/opfs';

export const DEMO_SHOW_ID = 'show-demo';
const DEMO_AUDIO_ID = 'demo-bit-audio.mp4';
const DEMO_BACKDROP_ID = 'demo-backdrop.png';
const DEMO_CAT_ID = 'demo-cat.png';
const DUR = 12;
const RATE = 48000;

// Beat every 0.6s (100 BPM); voice A chats 2-5.6s, voice B answers 6-9.2s.
const KICKS = Array.from({ length: 20 }, (_, i) => i * 0.6);
const SYLLABLES_A = [2.0, 2.35, 2.7, 3.2, 3.55, 4.1, 4.45, 4.8, 5.3];
const SYLLABLES_B = [6.0, 6.4, 6.75, 7.3, 7.65, 8.0, 8.55, 8.9];

function synthTrack(): AudioBuffer {
  const buf = new AudioBuffer({ length: DUR * RATE, sampleRate: RATE, numberOfChannels: 1 });
  const d = buf.getChannelData(0);
  const add = (at: number, len: number, f: (i: number, n: number) => number) => {
    const start = Math.floor(at * RATE);
    const n = Math.floor(len * RATE);
    for (let i = 0; i < n && start + i < d.length; i++) d[start + i]! += f(i, n);
  };
  for (const k of KICKS) {
    add(k, 0.14, (i, n) => {
      const env = 1 - i / n;
      const freq = 120 - 70 * (i / n);
      return 0.5 * env * env * Math.sin((2 * Math.PI * freq * i) / RATE);
    });
  }
  const syllable = (at: number, pitch: number) =>
    add(at, 0.22, (i, n) => {
      const env = Math.sin((Math.PI * i) / n);
      const wah = 1 + 0.5 * Math.sin((2 * Math.PI * 6 * i) / RATE);
      return 0.3 * env * wah * Math.sin((2 * Math.PI * pitch * i) / RATE);
    });
  SYLLABLES_A.forEach((t, i) => syllable(t, 210 + (i % 3) * 30));
  SYLLABLES_B.forEach((t, i) => syllable(t, 330 + (i % 2) * 45));
  // Finale: both at once.
  [9.6, 10.0, 10.4, 10.8, 11.2].forEach((t, i) => {
    syllable(t, 210 + (i % 3) * 30);
    syllable(t + 0.1, 330 + (i % 2) * 45);
  });
  return buf;
}

async function encodeTrack(): Promise<Blob> {
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const codec = (await getFirstEncodableAudioCodec(['aac', 'opus'])) ?? 'opus';
  const src = new AudioBufferSource({ codec, bitrate: QUALITY_MEDIUM });
  output.addAudioTrack(src);
  await output.start();
  await src.add(synthTrack());
  src.close();
  await output.finalize();
  return new Blob([target.buffer!], { type: 'video/mp4' });
}

/** A painted night-theater backdrop: the demo shows every kind of cast
 *  member, so the stage itself gets scenery. */
async function paintBackdrop(): Promise<Blob> {
  const W = 720;
  const H = 1280;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#101426');
  sky.addColorStop(0.65, '#1c1830');
  sky.addColorStop(1, '#241a20');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  // Moon and a lazy spotlight.
  ctx.fillStyle = '#e8ddc4';
  ctx.beginPath();
  ctx.arc(W * 0.78, H * 0.14, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#101426';
  ctx.beginPath();
  ctx.arc(W * 0.74, H * 0.125, 50, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(240, 226, 190, 0.07)';
  ctx.beginPath();
  ctx.moveTo(W * 0.5, 0);
  ctx.lineTo(W * 0.16, H * 0.86);
  ctx.lineTo(W * 0.84, H * 0.86);
  ctx.closePath();
  ctx.fill();
  // Stage floor: boards.
  ctx.fillStyle = '#2c2018';
  ctx.fillRect(0, H * 0.82, W, H * 0.18);
  ctx.strokeStyle = '#1c1410';
  ctx.lineWidth = 4;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo((W / 6) * i, H * 0.82);
    ctx.lineTo(W * 0.5 + ((W / 6) * i - W * 0.5) * 1.6, H);
    ctx.stroke();
  }
  ctx.strokeStyle = '#3a2c20';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.82);
  ctx.lineTo(W, H * 0.82);
  ctx.stroke();
  return c.convertToBlob({ type: 'image/png' });
}

/** A chunky orange cat with a transparent background: the demo's "photo
 *  cutout", so pins have something to bend. */
async function paintCat(): Promise<{ blob: Blob; w: number; h: number }> {
  const W = 420;
  const H = 460;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const orange = '#e07a30';
  const dark = '#a04f18';
  ctx.fillStyle = orange;
  // Tail curling up the left.
  ctx.beginPath();
  ctx.moveTo(70, 400);
  ctx.quadraticCurveTo(-10, 330, 50, 240);
  ctx.quadraticCurveTo(90, 180, 60, 150);
  ctx.quadraticCurveTo(120, 160, 105, 250);
  ctx.quadraticCurveTo(80, 330, 120, 380);
  ctx.closePath();
  ctx.fill();
  // Body and head.
  ctx.beginPath();
  ctx.ellipse(240, 330, 130, 115, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(240, 165, 95, 85, 0, 0, Math.PI * 2);
  ctx.fill();
  // Ears.
  ctx.beginPath();
  ctx.moveTo(160, 120);
  ctx.lineTo(175, 40);
  ctx.lineTo(225, 95);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(320, 120);
  ctx.lineTo(305, 40);
  ctx.lineTo(255, 95);
  ctx.closePath();
  ctx.fill();
  // Stripes and whiskers.
  ctx.strokeStyle = dark;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  for (const [x0, y0, x1, y1] of [
    [180, 300, 210, 285],
    [175, 340, 210, 330],
    [300, 285, 330, 300],
    [300, 330, 335, 340],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#f4e6d0';
  for (const side of [-1, 1] as const) {
    for (const dy of [-8, 4, 16]) {
      ctx.beginPath();
      ctx.moveTo(240 + side * 40, 195);
      ctx.lineTo(240 + side * 110, 195 + dy);
      ctx.stroke();
    }
  }
  // Nose.
  ctx.fillStyle = '#5c3a2a';
  ctx.beginPath();
  ctx.ellipse(240, 180, 12, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  return { blob: await c.convertToBlob({ type: 'image/png' }), w: W, h: H };
}

// Doodle geometry: crude on purpose; the boil makes crude charming.
const circle = (cx: number, cy: number, r: number, n = 16): number[] => {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
};

const GUY: number[][] = [
  circle(0.5, 0.18, 0.16),
  [0.5, 0.34, 0.5, 0.72],
  [0.5, 0.44, 0.24, 0.6],
  [0.5, 0.44, 0.76, 0.6],
  [0.5, 0.72, 0.3, 0.98],
  [0.5, 0.72, 0.7, 0.98],
];

const BLOB: number[][] = [
  circle(0.5, 0.55, 0.4, 20),
  circle(0.32, 0.18, 0.12),
  circle(0.68, 0.18, 0.12),
];

const HOTDOG: number[][] = [
  [0.05, 0.45, 0.3, 0.3, 0.7, 0.3, 0.95, 0.45],
  [0.05, 0.55, 0.3, 0.72, 0.7, 0.72, 0.95, 0.55],
  [0.15, 0.5, 0.45, 0.42, 0.75, 0.5],
];

/** Sampled walk with a bounce: [t,x,y,...] triples every 80ms. */
function walk(t0: number, t1: number, x0: number, x1: number, y: number, hop = 0.02): number[] {
  const out: number[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += 0.08) {
    const f = (t - t0) / (t1 - t0);
    out.push(
      Number(t.toFixed(3)),
      x0 + (x1 - x0) * f,
      y - hop * Math.abs(Math.sin(f * Math.PI * 5)),
    );
  }
  return out;
}

function events(catW: number, catH: number): RecipeEvent[] {
  let n = 0;
  const id = () => `demo${n++}`;
  const dood = (
    puppetId: string,
    strokes: number[][],
    w: number,
    h: number,
    x: number,
    y: number,
  ): RecipeEvent => ({
    kind: 'CAST',
    id: id(),
    at: 0,
    puppetId,
    puppet: { type: 'doodle', strokes, w, h },
    x,
    y,
    scale: 1,
    rot: 0,
  });
  // Cat box: width as a stage fraction, height from the painted aspect on a
  // 9:16 stage.
  const catBoxW = 0.3;
  const catBoxH = catBoxW * (9 / 16) * (catH / catW);
  return [
    {
      kind: 'CAST',
      id: id(),
      at: 0,
      puppetId: 'backdrop',
      puppet: { type: 'cutout', assetId: DEMO_BACKDROP_ID, w: 1, h: 1 },
      x: 0.5,
      y: 0.5,
      scale: 1,
      rot: 0,
      back: true,
    },
    // Guy and blob peek in from the wings; the hot dog waits fully offstage.
    dood('guy', GUY, 0.26, 0.22, 0.06, 0.62),
    dood('blob', BLOB, 0.24, 0.16, 0.94, 0.64),
    dood('dog', HOTDOG, 0.22, 0.07, -0.3, 0.3),
    // The cat is the "photo" cutout: pinned, so the finale can bend it.
    {
      kind: 'CAST',
      id: id(),
      at: 0,
      puppetId: 'cat',
      puppet: { type: 'cutout', assetId: DEMO_CAT_ID, w: catBoxW, h: catBoxH },
      x: 0.5,
      y: 1.22,
      scale: 1,
      rot: 0,
    },
    { kind: 'PIN', id: id(), at: 0, puppetId: 'cat', px: 0.5, py: 0.75 },
    { kind: 'PIN', id: id(), at: 0, puppetId: 'cat', px: 0.55, py: 0.28 },
    { kind: 'MOUTH', id: id(), at: 0, puppetId: 'cat', mx: 0.57, my: 0.47, size: 0.2 },
    { kind: 'SNIP', id: id(), at: 0, puppetId: 'guy', x0: 0.02, y0: 0.36, x1: 0.98, y1: 0.33 },
    { kind: 'MOUTH', id: id(), at: 0, puppetId: 'guy', mx: 0.5, my: 0.24, size: 0.3 },
    { kind: 'EYES', id: id(), at: 0, puppetId: 'guy', ex: 0.5, ey: 0.12, size: 0.34 },
    { kind: 'MOUTH', id: id(), at: 0, puppetId: 'blob', mx: 0.5, my: 0.62, size: 0.34 },
    { kind: 'EYES', id: id(), at: 0, puppetId: 'blob', ex: 0.5, ey: 0.3, size: 0.4 },
    { kind: 'WIRE', id: id(), at: 0, puppetId: 'guy', source: 'voice', target: 'bounce', amount: 0.5 },
    { kind: 'WIRE', id: id(), at: 0, puppetId: 'blob', source: 'voice', target: 'bounce', amount: 0.5 },
    { kind: 'WIRE', id: id(), at: 0, puppetId: 'blob', source: 'beat', target: 'shake', amount: 0.5 },
    { kind: 'WIRE', id: id(), at: 0, puppetId: '', source: 'on', target: 'trails', amount: 0.5 },
    // Guy walks in from the left wing and chats.
    { kind: 'PASS', id: id(), at: 0.4, puppetId: 'guy', samples: walk(0.4, 2.0, 0.06, 0.3, 0.62) },
    { kind: 'PASS', id: id(), at: 2.0, puppetId: 'guy', samples: walk(2.0, 5.6, 0.3, 0.36, 0.6) },
    // Blob answers from the right.
    { kind: 'PASS', id: id(), at: 4.8, puppetId: 'blob', samples: walk(4.8, 6.0, 0.94, 0.7, 0.64) },
    { kind: 'PASS', id: id(), at: 6.0, puppetId: 'blob', samples: walk(6.0, 9.2, 0.7, 0.66, 0.62) },
    // The snipped head nods "no" during the argument.
    {
      kind: 'PASS',
      id: id(),
      at: 9.3,
      puppetId: 'guy',
      piece: 0,
      samples: [9.3, 0.3, 0.42, 9.6, 0.42, 0.44, 9.9, 0.24, 0.44, 10.2, 0.42, 0.44, 10.5, 0.3, 0.42],
    },
    // The cat rises from below mid-show and heckles.
    {
      kind: 'PASS',
      id: id(),
      at: 5.4,
      puppetId: 'cat',
      samples: [5.4, 0.5, 1.22, 6.2, 0.5, 0.9, 7.0, 0.48, 0.88],
    },
    // Finale: its pinned head gets yanked side to side, warping.
    {
      kind: 'PASS',
      id: id(),
      at: 9.6,
      puppetId: 'cat',
      pin: 1,
      samples: [9.6, 0.53, 0.82, 10.0, 0.62, 0.8, 10.4, 0.42, 0.8, 10.8, 0.6, 0.82, 11.2, 0.5, 0.81],
    },
    // A hot dog is flung across the finale, trailing.
    { kind: 'PASS', id: id(), at: 10.2, puppetId: 'dog', samples: walk(10.2, 11.4, -0.3, 1.3, 0.3, 0.12) },
    // Both keep talking over each other.
    { kind: 'PASS', id: id(), at: 9.5, puppetId: 'blob', samples: walk(9.5, 11.8, 0.66, 0.62, 0.62) },
    {
      kind: 'PASS',
      id: id(),
      at: 10.6,
      puppetId: 'guy',
      samples: walk(10.6, 11.8, 0.36, 0.32, 0.6),
    },
  ];
}

/** Builds the demo show on-device. Returns its show id. */
export async function buildDemoShow(): Promise<string> {
  const audio = await encodeTrack();
  await restoreAsset(DEMO_AUDIO_ID, audio);
  await restoreAsset(DEMO_BACKDROP_ID, await paintBackdrop());
  const cat = await paintCat();
  await restoreAsset(DEMO_CAT_ID, cat.blob);
  const probe = await AudioSourceHandle.open(audio);
  const durationS = probe ? await probe.duration() : DUR;
  probe?.dispose();

  const project: Project = {
    version: 0,
    id: crypto.randomUUID(),
    title: 'how to bits',
    createdAt: new Date().toISOString(),
    seed: 20260730,
    events: events(cat.w, cat.h),
    audio: { assetId: DEMO_AUDIO_ID, durationS },
  };
  // Self-check: the demo must always be a valid recipe.
  const json = serializeProject(parseProject(serializeProject(project)));
  await saveProjectJson(DEMO_SHOW_ID, json);
  return DEMO_SHOW_ID;
}
