// Offline render: simulate the show frame by frame at full quality with the
// exact drawStage the preview uses, envelope and all. What was performed is
// what exports.

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  canEncodeVideo,
  getFirstEncodableAudioCodec,
} from 'mediabunny';
import {
  computeVoiceTrack,
  voiceAt,
  EMPTY_VOICE,
  SHAPE_CLOSED,
  type VoiceMoment,
  type VoiceTrack,
} from '../engine/envelope';
import { detectOnsets } from '../engine/onsets';
import { splitPieces } from '../engine/pieces';
import { IMPACT_SQUASH, impactSfx, mixSfxInto, type SfxName } from '../engine/sfx';
import { wireAmount } from '../engine/wires';
import type { Project } from '../engine/recipe';
import { castOf, createShowSim, eyesOf, mouthOf, pinsOf, snipsOf, talkOpenFor } from '../engine/show';
import { effectiveWires, trailStrength, wireModsFor, type WireMods } from '../engine/wires';
import { AudioSourceHandle, mixdownMono } from './audio';
import { drawStage, loadStageImages, type PuppetVisual } from './stageDraw';

export interface RenderProgress {
  phase: 'video' | 'audio' | 'finalize';
  fraction: number;
}

export interface RenderShowOptions {
  audioBlob: Blob | null;
  project: Project;
  getAssetBlob: (assetId: string) => Promise<Blob>;
  fileName?: string;
  width?: number;
  height?: number;
  fps?: number;
  onProgress?: (p: RenderProgress) => void;
}

const even = (n: number) => 2 * Math.round(n / 2);

export function visualsOf(project: Project): Map<string, PuppetVisual> {
  const visuals = new Map<string, PuppetVisual>();
  for (const p of castOf(project)) {
    visuals.set(p.id, {
      pieces: splitPieces(snipsOf(project, p.id)),
      mouth: mouthOf(project, p.id),
      eyes: eyesOf(project, p.id),
      pins: pinsOf(project, p.id),
    });
  }
  return visuals;
}

/** Per-puppet voice moment at t: the shared track gated by the talk-span rule. */
export function voiceMap(
  project: Project,
  visuals: Map<string, PuppetVisual>,
  track: VoiceTrack,
  t: number,
): Map<string, VoiceMoment> {
  const out = new Map<string, VoiceMoment>();
  const base = voiceAt(track, t);
  for (const [id, v] of visuals) {
    if (!v.mouth) continue;
    const open = talkOpenFor(project, id, base.open, t);
    out.set(id, { open, shape: open === 0 ? SHAPE_CLOSED : base.shape });
  }
  return out;
}

export async function renderShow(options: RenderShowOptions): Promise<File> {
  const { project } = options;
  const fps = options.fps ?? 30;
  const outW = even(options.width ?? 720);
  const outH = even(options.height ?? 1280);
  const progress = options.onProgress ?? (() => {});

  const audio = options.audioBlob ? await AudioSourceHandle.open(options.audioBlob) : null;
  let durationS = 0;
  if (audio) durationS = await audio.duration();
  if (durationS <= 0) {
    const lastPass = project.events
      .filter((e) => e.kind === 'PASS')
      .reduce((m, e) => Math.max(m, e.samples[e.samples.length - 3] ?? 0), 0);
    durationS = Math.max(3, lastPass + 1);
  }

  if (!(await canEncodeVideo('avc', { width: outW, height: outH }))) {
    audio?.dispose();
    throw new Error('this device cannot encode H264 video');
  }

  const cast = castOf(project);
  const visuals = visualsOf(project);
  const images = await loadStageImages(cast, options.getAssetBlob);
  const sim = createShowSim(project);

  const mix = options.audioBlob ? await mixdownMono(options.audioBlob) : null;
  const voice = mix ? computeVoiceTrack(mix.samples, mix.sampleRate) : EMPTY_VOICE;
  const onsets = mix ? detectOnsets(mix.samples, mix.sampleRate) : [];
  const wires = effectiveWires(project);

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context for render canvas');
  const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH });
  output.addVideoTrack(videoSource, { frameRate: fps });

  const audioCodec = audio ? await getFirstEncodableAudioCodec(['aac', 'opus']) : null;
  const audioSource = audioCodec
    ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_MEDIUM })
    : null;
  if (audioSource) output.addAudioTrack(audioSource);

  try {
    await output.start();

    // Performed sounds plus derived impact foley (squash spikes, when wired).
    const sounds: { at: number; sfx: SfxName }[] = project.events
      .filter((e) => e.kind === 'SOUND')
      .map((e) => ({ at: e.at, sfx: e.sfx }));
    const foleyOn = wireAmount(wires, '', 'on', 'foley') > 0;
    const prevSquash = new Map<string, number>();
    let impactCount = 0;

    const frameCount = Math.max(1, Math.ceil(durationS * fps));
    for (let i = 0; i < frameCount; i++) {
      const t = (i + 0.5) / fps;
      const poses = sim.advanceTo(t);
      if (foleyOn) {
        for (const [pid, pose] of poses) {
          const prev = prevSquash.get(pid) ?? 0;
          if (pose.root.squash >= IMPACT_SQUASH && prev < IMPACT_SQUASH) {
            sounds.push({ at: t, sfx: impactSfx(impactCount++) });
          }
          prevSquash.set(pid, pose.root.squash);
        }
      }
      const mods = new Map<string, WireMods>();
      for (const p of cast) {
        mods.set(p.id, wireModsFor(wires, p.id, voice, onsets, t, project.seed));
      }
      drawStage(
        ctx,
        outW,
        outH,
        cast,
        poses,
        images,
        visuals,
        voiceMap(project, visuals, voice, t),
        t,
        project.seed,
        mods,
        trailStrength(wires, voice, onsets, t),
      );
      await videoSource.add(i / fps, 1 / fps);
      if (i % 10 === 0) progress({ phase: 'video', fraction: i / frameCount });
    }
    videoSource.close();

    if (audio && audioSource) {
      sounds.sort((a, b) => a.at - b.at);
      await passThroughAudio(audio, audioSource, durationS, sounds, progress);
      audioSource.close();
    }

    progress({ phase: 'finalize', fraction: 1 });
    await output.finalize();
    if (!target.buffer) throw new Error('render produced no bytes');
    const name = options.fileName ?? `${project.title || 'show'}.mp4`;
    return new File([target.buffer], name, { type: 'video/mp4' });
  } finally {
    audio?.dispose();
    for (const img of images.values()) img.close();
  }
}

/** The bit's audio, verbatim, with exact-length silence filling decoder gaps.
 *  Silence matches the source's geometry: encoders demand constant params. */
async function passThroughAudio(
  audio: AudioSourceHandle,
  audioSource: AudioBufferSource,
  durationS: number,
  sounds: { at: number; sfx: SfxName }[],
  progress: (p: RenderProgress) => void,
) {
  const sink = audio.makeSink();
  const geometry = { channels: audio.channels, sampleRate: audio.sampleRate };

  const mixAndAdd = async (buffer: AudioBuffer, busStartS: number) => {
    const busEnd = busStartS + buffer.duration;
    for (const s of sounds) {
      if (s.at > busEnd) break;
      // A sound tail can span slices; mixSfxInto handles partial overlap.
      if (s.at + 1 < busStartS) continue;
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        mixSfxInto(buffer.getChannelData(ch), busStartS, buffer.sampleRate, s.at, s.sfx);
      }
    }
    await audioSource.add(buffer);
  };

  let covered = 0;
  for await (const { buffer, timestamp } of sink.buffers(0, durationS)) {
    const from = Math.max(0, timestamp);
    const to = Math.min(durationS, timestamp + buffer.duration);
    if (to <= from) continue;
    geometry.channels = buffer.numberOfChannels;
    geometry.sampleRate = buffer.sampleRate;
    if (from - covered > 0.001) {
      await addSilence(audioSource, from - covered, geometry, covered, mixAndAdd);
    }
    await mixAndAdd(sliceAudioBuffer(buffer, from - timestamp, to - timestamp), from);
    covered = to;
    progress({ phase: 'audio', fraction: covered / durationS });
  }
  if (durationS - covered > 0.001) {
    await addSilence(audioSource, durationS - covered, geometry, covered, mixAndAdd);
  }
}

function sliceAudioBuffer(buffer: AudioBuffer, fromS: number, toS: number): AudioBuffer {
  const from = Math.max(0, Math.floor(fromS * buffer.sampleRate));
  const to = Math.min(buffer.length, Math.ceil(toS * buffer.sampleRate));
  const length = Math.max(1, to - from);
  const out = new AudioBuffer({
    length,
    sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels,
  });
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = new Float32Array(length);
    buffer.copyFromChannel(data, ch, from);
    out.copyToChannel(data, ch);
  }
  return out;
}

async function addSilence(
  audioSource: AudioBufferSource,
  durationS: number,
  geometry: { channels: number; sampleRate: number },
  busStartS = 0,
  emit?: (buffer: AudioBuffer, busStartS: number) => Promise<void>,
) {
  let remaining = durationS;
  let at = busStartS;
  while (remaining > 0.0005) {
    const chunk = Math.min(remaining, 1);
    const buf = new AudioBuffer({
      length: Math.max(1, Math.round(chunk * geometry.sampleRate)),
      sampleRate: geometry.sampleRate,
      numberOfChannels: Math.max(1, geometry.channels),
    });
    if (emit) await emit(buf, at);
    else await audioSource.add(buf);
    at += chunk;
    remaining -= chunk;
  }
}
