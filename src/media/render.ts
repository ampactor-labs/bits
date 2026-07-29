// Offline render: run the compiled program frame by frame at full quality.
// The preview and this renderer execute the same Program, which is the whole
// determinism contract: what you performed is what exports.

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
import { compileProgram, outToSrc, zoomAtSrc, type Program } from '../engine/program';
import type { Project } from '../engine/recipe';
import { AudioSourceHandle } from './audio';
import { VideoSourceHandle } from './source';

export interface RenderProgress {
  phase: 'video' | 'audio' | 'finalize';
  fraction: number;
}

export interface RenderOptions {
  blob: Blob;
  project: Project;
  fileName?: string;
  fps?: number;
  maxWidth?: number;
  onProgress?: (p: RenderProgress) => void;
}

const even = (n: number) => 2 * Math.round(n / 2);

export async function renderProject(options: RenderOptions): Promise<File> {
  const { blob, project } = options;
  const fps = options.fps ?? 30;
  const maxWidth = options.maxWidth ?? 1080;
  const progress = options.onProgress ?? (() => {});

  const video = await VideoSourceHandle.open(blob);
  try {
    const program = compileProgram(project, video.durationS);
    if (program.outputDurationS <= 0) throw new Error('nothing to render: everything is skipped');

    const outW = even(Math.min(video.width, maxWidth));
    const outH = even((outW / video.width) * video.height);

    if (!(await canEncodeVideo('avc', { width: outW, height: outH }))) {
      throw new Error('this device cannot encode H264 video');
    }

    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });

    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context for render canvas');
    const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH });
    output.addVideoTrack(videoSource, { frameRate: fps });

    // AAC first for messaging-app compatibility; Opus keeps sound on
    // platforms whose WebCodecs lacks an AAC encoder (e.g. Linux Chrome).
    const audio = await AudioSourceHandle.open(blob);
    const audioCodec =
      audio !== null && program.audioPassSegments.length > 0
        ? await getFirstEncodableAudioCodec(['aac', 'opus'])
        : null;
    const audioSource = audioCodec
      ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_MEDIUM })
      : null;
    if (audioSource) output.addAudioTrack(audioSource);

    await output.start();

    // Video pass: monotonic source timestamps take Mediabunny's optimized path.
    const frameCount = Math.max(1, Math.ceil(program.outputDurationS * fps));
    const frameSrcTimes: number[] = [];
    for (let i = 0; i < frameCount; i++) {
      frameSrcTimes.push(outToSrc(program, (i + 0.5) / fps));
    }
    const sink = video.makeSink(outW);
    let frameIndex = 0;
    let lastDrawn: CanvasImageSource | null = null;
    for await (const wc of sink.canvasesAtTimestamps(frameSrcTimes)) {
      const srcT = frameSrcTimes[frameIndex]!;
      const image: CanvasImageSource | null = wc?.canvas ?? lastDrawn;
      if (image) {
        drawZoomed(ctx, image, zoomAtSrc(project, srcT), outW, outH);
        lastDrawn = image;
      }
      await videoSource.add(frameIndex / fps, 1 / fps);
      frameIndex += 1;
      if (frameIndex % 10 === 0) progress({ phase: 'video', fraction: frameIndex / frameCount });
    }
    videoSource.close();

    // Audio pass: passthrough for rate-1 segments, silence elsewhere.
    if (audio && audioSource) {
      await renderAudio(audio, audioSource, program, progress);
      audioSource.close();
    }
    audio?.dispose();

    progress({ phase: 'finalize', fraction: 1 });
    await output.finalize();
    if (!target.buffer) throw new Error('render produced no bytes');
    const name = options.fileName ?? `${project.title || 'bit'}.mp4`;
    return new File([target.buffer], name, { type: 'video/mp4' });
  } finally {
    video.dispose();
  }
}

function drawZoomed(
  ctx: OffscreenCanvasRenderingContext2D,
  image: CanvasImageSource,
  zoom: { cx: number; cy: number; scale: number },
  outW: number,
  outH: number,
) {
  const iw = 'width' in image && typeof image.width === 'number' ? image.width : outW;
  const ih = 'height' in image && typeof image.height === 'number' ? image.height : outH;
  const scale = Math.max(1, zoom.scale);
  const sw = iw / scale;
  const sh = ih / scale;
  const sx = Math.min(Math.max(zoom.cx * iw - sw / 2, 0), iw - sw);
  const sy = Math.min(Math.max(zoom.cy * ih - sh / 2, 0), ih - sh);
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, outW, outH);
}

async function renderAudio(
  audio: AudioSourceHandle,
  audioSource: AudioBufferSource,
  program: Program,
  progress: (p: RenderProgress) => void,
) {
  const sink = audio.makeSink();
  const segments = program.segments;
  let done = 0;
  for (const seg of segments) {
    if (seg.rate !== 1) {
      await addSilence(audioSource, seg.outDuration);
    } else {
      let covered = seg.srcStart;
      for await (const { buffer, timestamp } of sink.buffers(seg.srcStart, seg.srcEnd)) {
        const bufStart = timestamp;
        const bufEnd = timestamp + buffer.duration;
        const from = Math.max(seg.srcStart, bufStart);
        const to = Math.min(seg.srcEnd, bufEnd);
        if (to <= from) continue;
        // Decoder gaps become silence so segment durations stay exact.
        if (from - covered > 0.001) await addSilence(audioSource, from - covered);
        await audioSource.add(sliceAudioBuffer(buffer, from - bufStart, to - bufStart));
        covered = to;
      }
      if (seg.srcEnd - covered > 0.001) await addSilence(audioSource, seg.srcEnd - covered);
    }
    done += 1;
    progress({ phase: 'audio', fraction: done / segments.length });
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

async function addSilence(audioSource: AudioBufferSource, durationS: number) {
  const sampleRate = 48000;
  let remaining = durationS;
  while (remaining > 0.0005) {
    const chunk = Math.min(remaining, 1);
    const buf = new AudioBuffer({
      length: Math.max(1, Math.round(chunk * sampleRate)),
      sampleRate,
      numberOfChannels: 2,
    });
    await audioSource.add(buf);
    remaining -= chunk;
  }
}
