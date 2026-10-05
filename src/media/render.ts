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
import { impactSfx, mixSfxInto, type SfxName } from '../engine/sfx';
import type { Project } from '../engine/recipe';
import { createFramer } from '../engine/frame';
import { AudioSourceHandle, mixPcmInto } from './audio';
import { analyzeShow, type VoicePcm } from './analyze';
import { STAGE_BG, loadStageImages, renderFrame2d } from './stageDraw';

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
  /** Abort a long render. The output is cancelled and AbortError thrown. */
  signal?: AbortSignal;
}

export class RenderCancelled extends Error {
  constructor() {
    super('render cancelled');
    this.name = 'RenderCancelled';
  }
}

const even = (n: number) => 2 * Math.round(n / 2);

// These moved to the frame builder and the analysis; re-exported for the
// callers that still import them from here.
export { visualsOf, voiceMap, type OwnVoice } from '../engine/frame';
export { collectVoices, type VoicePcm } from './analyze';

/** Lay every take onto one slice of the output bus, in place. Exported so
 *  the browser harness can run the step the render runs: this container's
 *  Chromium has no H.264 encoder, so the render proof cannot reach it, and
 *  a mix nobody can hear is a mix nobody has checked. */
export function mixVoicesInto(buffer: AudioBuffer, busStartS: number, voices: VoicePcm[]): void {
  const busEnd = busStartS + buffer.duration;
  for (const v of voices) {
    if (v.at > busEnd) continue;
    if (v.at + v.samples.length / v.sampleRate < busStartS) continue;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      mixPcmInto(
        buffer.getChannelData(ch),
        busStartS,
        buffer.sampleRate,
        v.samples,
        v.sampleRate,
        v.at,
        v.gain,
      );
    }
  }
}

export async function renderShow(options: RenderShowOptions): Promise<File> {
  const { project } = options;
  const fps = options.fps ?? 30;
  // The film is the shape of the stage it was performed on.
  const wide = project.aspect === '16:9';
  const outW = even(options.width ?? (wide ? 1280 : 720));
  const outH = even(options.height ?? (wide ? 720 : 1280));
  const progress = options.onProgress ?? (() => {});
  const stopIfCancelled = () => {
    if (options.signal?.aborted) throw new RenderCancelled();
  };

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

  // A trim bounds what renders. Show time stays asset time, so the sim and
  // the sound both keep speaking the same clock and no pass is rewritten.
  const trim = project.audio?.trim;
  const fromS = trim ? Math.max(0, Math.min(trim.from, durationS)) : 0;
  const toS = trim ? Math.max(fromS, Math.min(trim.to, durationS)) : durationS;
  const spanS = Math.max(1 / fps, toS - fromS);

  // Per-puppet takes: their envelopes drive their own mouths, and their
  // PCM is mixed into the output so the film says what was recorded.
  const { analysis, pcm: voicePcm } = await analyzeShow(
    project,
    options.audioBlob,
    options.getAssetBlob,
  );
  const framer = createFramer(project, analysis);
  const images = await loadStageImages(framer.cast, options.getAssetBlob);

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
    let impactCount = 0;

    // The renderer only wipes the whole canvas when trails are off or the
    // clock is near zero, so a trimmed render would otherwise start from an
    // untouched (transparent) canvas.
    ctx.fillStyle = STAGE_BG;
    ctx.fillRect(0, 0, outW, outH);

    const frameCount = Math.max(1, Math.ceil(spanS * fps));
    for (let i = 0; i < frameCount; i++) {
      const t = fromS + (i + 0.5) / fps;
      const frame = framer.frameAt(t);
      for (let n = framer.impacts().length; n > 0; n--) {
        sounds.push({ at: t, sfx: impactSfx(impactCount++) });
      }
      renderFrame2d(ctx, outW, outH, frame, images);
      await videoSource.add(i / fps, 1 / fps);
      if (i % 10 === 0) {
        progress({ phase: 'video', fraction: i / frameCount });
        stopIfCancelled();
      }
    }
    videoSource.close();

    if (audio && audioSource) {
      sounds.sort((a, b) => a.at - b.at);
      await passThroughAudio(audio, audioSource, fromS, toS, sounds, voicePcm, progress);
      audioSource.close();
    }

    progress({ phase: 'finalize', fraction: 1 });
    await output.finalize();
    if (!target.buffer) throw new Error('render produced no bytes');
    const name = options.fileName ?? `${project.title || 'show'}.mp4`;
    return new File([target.buffer], name, { type: 'video/mp4' });
  } catch (err) {
    // Leave no half-written output behind when the person backs out.
    await output.cancel().catch(() => {});
    throw err;
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
  fromS: number,
  toS: number,
  sounds: { at: number; sfx: SfxName }[],
  voices: VoicePcm[],
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
    mixVoicesInto(buffer, busStartS, voices);
    await audioSource.add(buffer);
  };

  // Bus times stay in asset seconds, so performed sounds and foley need no
  // offset applied to their `at`.
  let covered = fromS;
  for await (const { buffer, timestamp } of sink.buffers(fromS, toS)) {
    const from = Math.max(fromS, timestamp);
    const to = Math.min(toS, timestamp + buffer.duration);
    if (to <= from) continue;
    geometry.channels = buffer.numberOfChannels;
    geometry.sampleRate = buffer.sampleRate;
    if (from - covered > 0.001) {
      await addSilence(audioSource, from - covered, geometry, covered, mixAndAdd);
    }
    await mixAndAdd(sliceAudioBuffer(buffer, from - timestamp, to - timestamp), from);
    covered = to;
    const span = Math.max(1e-6, toS - fromS);
    progress({ phase: 'audio', fraction: (covered - fromS) / span });
  }
  if (toS - covered > 0.001) {
    await addSilence(audioSource, toS - covered, geometry, covered, mixAndAdd);
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
