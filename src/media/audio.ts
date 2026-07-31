import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, type InputAudioTrack } from 'mediabunny';

/** A probed, decodable audio track. Owns its Input; dispose when done. */
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
    const { AudioBufferSource, BufferTarget, Mp4OutputFormat, Output, QUALITY_MEDIUM } =
      await import('mediabunny');
    const { getFirstEncodableAudioCodec } = await import('mediabunny');
    const codec = (await getFirstEncodableAudioCodec(['aac', 'opus'])) ?? 'opus';
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const src = new AudioBufferSource({ codec, bitrate: QUALITY_MEDIUM });
    output.addAudioTrack(src);
    await output.start();
    for (const handle of [ha, hb]) {
      for await (const { buffer } of handle.makeSink().buffers()) {
        await src.add(buffer);
      }
    }
    src.close();
    await output.finalize();
    return target.buffer ? new Blob([target.buffer], { type: 'video/mp4' }) : null;
  } catch {
    return null;
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

/** Live audio for the jam: schedules decoded buffers on a WebAudio clock from a
 *  given source time. The deck stops it during slow/skip holds and restarts it
 *  on release; this class stays dumb on purpose. */
export class JamAudio {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private token = 0;
  private scheduled = new Set<AudioBufferSourceNode>();
  private clock: { from: number; anchor: number } | null = null;

  constructor(private readonly sink: AudioBufferSink) {}

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
    const gain = this.gain!;
    const anchor = ctx.currentTime + 0.05;
    if (token === this.token) this.clock = { from: fromSrcT, anchor };

    for await (const { buffer, timestamp } of this.sink.buffers(fromSrcT)) {
      if (token !== this.token) return;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(gain);
      const when = anchor + (timestamp - fromSrcT);
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
