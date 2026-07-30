import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, type InputAudioTrack } from 'mediabunny';

/** A probed, decodable audio track. Owns its Input; dispose when done. */
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

/** Mono, decimated PCM of the whole track, sized for onset detection.
 *  Naive stride decimation: aliasing is irrelevant to an energy envelope. */
export async function mixdownForOnsets(
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

  constructor(private readonly sink: AudioBufferSink) {}

  async play(fromSrcT: number): Promise<void> {
    this.stop();
    const token = ++this.token;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const ctx = this.ctx;
    const gain = this.gain!;
    const anchor = ctx.currentTime + 0.05;

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
