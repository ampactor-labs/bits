/** Mic capture for the bit: MediaRecorder to a webm/opus blob, with a live
 *  level and an elapsed clock so the take can be watched rather than
 *  guessed at (audit F29). */
export class MicRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private frame: Float32Array<ArrayBuffer> | null = null;
  private startedAt = 0;
  private peak = 0;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : '';
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    // Metering is a nicety on top of the take: if the audio graph will not
    // come up, the recording still happens, silently.
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(this.stream).connect(analyser);
      this.audioCtx = ctx;
      this.analyser = analyser;
      this.frame = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
    } catch {
      this.analyser = null;
    }
    this.startedAt = performance.now();
    this.peak = 0;
    this.recorder.start(250);
  }

  /** 0..1 for a meter: RMS, curved so a normal speaking voice sits around
   *  two thirds rather than down in the noise floor. */
  level(): number {
    const analyser = this.analyser;
    const frame = this.frame;
    if (!analyser || !frame) return 0;
    analyser.getFloatTimeDomainData(frame);
    let sum = 0;
    for (const v of frame) sum += v * v;
    const rms = Math.sqrt(sum / frame.length);
    const shown = Math.min(1, Math.sqrt(rms * 6));
    this.peak = Math.max(this.peak, shown);
    return shown;
  }

  /** The loudest the take has been, so "did it hear me at all?" has an
   *  answer after the fact. */
  get peakLevel(): number {
    return this.peak;
  }

  get elapsedS(): number {
    return this.recorder ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
    this.frame = null;
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const rec = this.recorder;
      if (!rec) {
        reject(new Error('not recording'));
        return;
      }
      rec.onstop = () => {
        this.release();
        this.recorder = null;
        resolve(new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.stop();
    });
  }

  /** Throw the take away. The tracks have to be released either way, or
   *  the recording dot stays lit in the browser chrome. */
  cancel(): void {
    const rec = this.recorder;
    this.recorder = null;
    this.chunks = [];
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        // already stopping
      }
    }
    this.release();
  }

  get active(): boolean {
    return this.recorder !== null;
  }
}
