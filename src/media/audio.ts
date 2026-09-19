import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, type InputAudioTrack } from 'mediabunny';

/** A probed, decodable audio track. Owns its Input; dispose when done. */
/** Decode the given sources in order and write their PCM into one
 *  audio-only mp4. Shared by "extend the bit" and by importing a file
 *  whose container carries video we do not want to keep. */
export async function encodeAudioOnly(handles: AudioSourceHandle[]): Promise<Blob | null> {
  if (handles.length === 0) return null;
  try {
    const {
      AudioBufferSource,
      BufferTarget,
      Mp4OutputFormat,
      Output,
      QUALITY_MEDIUM,
      getFirstEncodableAudioCodec,
    } = await import('mediabunny');
    const codec = (await getFirstEncodableAudioCodec(['aac', 'opus'])) ?? 'opus';
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const src = new AudioBufferSource({ codec, bitrate: QUALITY_MEDIUM });
    output.addAudioTrack(src);
    await output.start();
    for (const handle of handles) {
      for await (const { buffer } of handle.makeSink().buffers()) {
        await src.add(buffer);
      }
    }
    src.close();
    await output.finalize();
    return target.buffer ? new Blob([target.buffer], { type: 'video/mp4' }) : null;
  } catch {
    return null;
  }
}

/** Concatenate two recordings into one (the "extend the bit" path): decode
 *  both, butt-join the PCM, re-encode. */
export async function concatAudio(a: Blob, b: Blob): Promise<Blob | null> {
  const [ha, hb] = [await AudioSourceHandle.open(a), await AudioSourceHandle.open(b)];
  if (!ha || !hb) {
    ha?.dispose();
    hb?.dispose();
    return null;
  }
  try {
    return await encodeAudioOnly([ha, hb]);
  } finally {
    ha.dispose();
    hb.dispose();
  }
}

export class AudioSourceHandle {
  private constructor(
    private readonly input: Input,
    readonly track: InputAudioTrack,
  ) {}

  /** Returns null when the file has no decodable audio. */
  static async open(blob: Blob): Promise<AudioSourceHandle | null> {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track || !(await track.canDecode())) {
        input.dispose();
        return null;
      }
      return new AudioSourceHandle(input, track);
    } catch {
      input.dispose();
      return null;
    }
  }

  makeSink(): AudioBufferSink {
    return new AudioBufferSink(this.track);
  }

  duration(): Promise<number> {
    return this.input.computeDuration();
  }

  get channels(): number {
    return this.track.numberOfChannels;
  }

  get sampleRate(): number {
    return this.track.sampleRate;
  }

  dispose(): void {
    this.input.dispose();
  }
}

/** Mono, decimated PCM of the whole track: feeds both the onset grid and the
 *  mouth envelope. Naive stride decimation: aliasing is irrelevant to energy. */
export async function mixdownMono(
  blob: Blob,
  targetRate = 16000,
): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  const audio = await AudioSourceHandle.open(blob);
  if (!audio) return null;
  try {
    const sink = audio.makeSink();
    const chunks: Float32Array[] = [];
    let total = 0;
    let stride = 1;
    let effectiveRate = targetRate;
    for await (const { buffer } of sink.buffers()) {
      stride = Math.max(1, Math.round(buffer.sampleRate / targetRate));
      effectiveRate = buffer.sampleRate / stride;
      const ch = buffer.getChannelData(0);
      const out = new Float32Array(Math.floor(ch.length / stride));
      for (let i = 0; i < out.length; i++) out[i] = ch[i * stride]!;
      chunks.push(out);
      total += out.length;
    }
    const samples = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      samples.set(c, offset);
      offset += c.length;
    }
    return { samples, sampleRate: effectiveRate };
  } finally {
    audio.dispose();
  }
}

/** The whole thing as mono PCM at its own rate. mixdownMono decimates to
 *  16kHz, which is right for an envelope and wrong for anything anyone is
 *  meant to hear. */
export async function decodeMono(
  blob: Blob,
): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  const audio = await AudioSourceHandle.open(blob);
  if (!audio) return null;
  try {
    const sink = audio.makeSink();
    const chunks: Float32Array[] = [];
    let total = 0;
    let rate = 48000;
    for await (const { buffer } of sink.buffers()) {
      rate = buffer.sampleRate;
      const ch = buffer.getChannelData(0);
      const out = new Float32Array(ch.length);
      out.set(ch);
      chunks.push(out);
      total += out.length;
    }
    const samples = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      samples.set(c, offset);
      offset += c.length;
    }
    return { samples, sampleRate: rate };
  } finally {
    audio.dispose();
  }
}

/** Add one track into a slice of another, both in show seconds. Resampling
 *  is linear, which is plenty for speech and keeps the render honest about
 *  where a word lands. */
export function mixPcmInto(
  dst: Float32Array,
  dstStartS: number,
  dstRate: number,
  src: Float32Array,
  srcRate: number,
  atS: number,
  gain = 1,
): void {
  for (let i = 0; i < dst.length; i++) {
    const srcT = dstStartS + i / dstRate - atS;
    if (srcT < 0) continue;
    const pos = srcT * srcRate;
    const i0 = Math.floor(pos);
    if (i0 + 1 >= src.length) break;
    const f = pos - i0;
    const v = src[i0]! * (1 - f) + src[i0 + 1]! * f;
    dst[i] = Math.max(-1, Math.min(1, dst[i]! + v * gain));
  }
}

/** One puppet's take on the jam's clock. */
export interface VoiceLane {
  sink: AudioBufferSink;
  /** Where the take's own zero sits in show time. */
  at: number;
  gain: number;
}

/** Live audio for the jam: schedules decoded buffers on a WebAudio clock from a
 *  given source time. The deck stops it during slow/skip holds and restarts it
 *  on release; this class stays dumb on purpose. */
export class JamAudio {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private token = 0;
  private scheduled = new Set<AudioBufferSourceNode>();
  private clock: { from: number; anchor: number } | null = null;
  /** Per-puppet takes, laid over the bed at their own offsets. */
  private voices: VoiceLane[] = [];

  constructor(private readonly sink: AudioBufferSink) {}

  /** Replaces the whole set. Takes effect on the next play. */
  setVoices(voices: VoiceLane[]): void {
    this.voices = voices;
  }

  /** Current playback position on the AudioContext clock; null when stopped.
   *  The preview loop uses this so mouths flap on the audio's time, not the
   *  compositor's. */
  positionS(): number | null {
    if (!this.clock || !this.ctx) return null;
    return this.clock.from + (this.ctx.currentTime - this.clock.anchor);
  }

  private async ensureCtx(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  /** Fire a one-shot PCM sound right now (foley board, impact foley). */
  async playSfx(pcm: Float32Array, sampleRate = 48000): Promise<void> {
    const ctx = await this.ensureCtx();
    const buf = ctx.createBuffer(1, pcm.length, sampleRate);
    buf.copyToChannel(new Float32Array(pcm), 0);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(this.gain!);
    node.start();
  }

  /** Two click beats before a punch-in, so the cue never ambushes you.
   *  Resolves when the last click lands. */
  async countIn(beats = 2, intervalS = 0.5): Promise<void> {
    const ctx = await this.ensureCtx();
    const start = ctx.currentTime + 0.08;
    for (let i = 0; i < beats; i++) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.frequency.value = i === beats - 1 ? 1568 : 1046;
      env.gain.setValueAtTime(0.0001, start + i * intervalS);
      env.gain.exponentialRampToValueAtTime(0.4, start + i * intervalS + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, start + i * intervalS + 0.09);
      osc.connect(env);
      env.connect(this.gain!);
      osc.start(start + i * intervalS);
      osc.stop(start + i * intervalS + 0.1);
    }
    const untilS = start + beats * intervalS - ctx.currentTime;
    await new Promise((r) => setTimeout(r, Math.max(0, untilS * 1000)));
  }

  async play(fromSrcT: number): Promise<void> {
    this.stop();
    const token = ++this.token;
    const ctx = await this.ensureCtx();
    const anchor = ctx.currentTime + 0.05;
    if (token === this.token) this.clock = { from: fromSrcT, anchor };

    // Voices schedule alongside the bed rather than after it: awaiting the
    // bed's whole decode first would leave every take silent until it
    // finished.
    for (const v of this.voices) {
      void this.schedule(v.sink, fromSrcT, anchor, token, v.at, v.gain).catch(() => {
        // A take that will not decode leaves its puppet on the bed.
      });
    }
    await this.schedule(this.sink, fromSrcT, anchor, token, 0, 1);
  }

  /** Lay one track onto the context clock. `offsetS` is where the track's
   *  own zero sits in show time. */
  private async schedule(
    sink: AudioBufferSink,
    fromSrcT: number,
    anchor: number,
    token: number,
    offsetS: number,
    gainValue: number,
  ): Promise<void> {
    const ctx = this.ctx!;
    let out: AudioNode = this.gain!;
    if (gainValue !== 1) {
      const node = ctx.createGain();
      node.gain.value = gainValue;
      node.connect(this.gain!);
      out = node;
    }
    // A take starting after the playhead begins at its own zero; one
    // already under way starts partway in.
    const startInTrack = Math.max(0, fromSrcT - offsetS);
    if (offsetS + startInTrack > fromSrcT + 600) return;
    for await (const { buffer, timestamp } of sink.buffers(startInTrack)) {
      if (token !== this.token) return;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(out);
      const when = anchor + (offsetS + timestamp - fromSrcT);
      if (when >= ctx.currentTime) {
        node.start(when);
      } else {
        const late = ctx.currentTime - when;
        if (late < buffer.duration) node.start(ctx.currentTime, late);
        else continue;
      }
      this.scheduled.add(node);
      node.onended = () => this.scheduled.delete(node);
      // Stay ~2s ahead of the clock, then let the decoder breathe.
      const ahead = when - ctx.currentTime;
      if (ahead > 2) {
        await new Promise((r) => setTimeout(r, (ahead - 2) * 1000));
        if (token !== this.token) return;
      }
    }
  }

  stop(): void {
    this.token += 1;
    this.clock = null;
    for (const node of this.scheduled) {
      try {
        node.stop();
      } catch {
        // Already stopped; fine.
      }
    }
    this.scheduled.clear();
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.gain = null;
  }
}
