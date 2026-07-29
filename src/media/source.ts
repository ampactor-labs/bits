import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Input,
  type InputVideoTrack,
} from 'mediabunny';

/** A probed, decodable video source. Owns the Mediabunny Input; dispose when done. */
export class VideoSourceHandle {
  private constructor(
    private readonly input: Input,
    readonly track: InputVideoTrack,
    readonly durationS: number,
    readonly width: number,
    readonly height: number,
  ) {}

  static async open(blob: Blob): Promise<VideoSourceHandle> {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('no video track in this file');
      if (!(await track.canDecode())) {
        throw new Error(`this device cannot decode ${track.codec ?? 'this codec'}`);
      }
      const durationS = await input.computeDuration();
      return new VideoSourceHandle(input, track, durationS, track.displayWidth, track.displayHeight);
    } catch (err) {
      input.dispose();
      throw err;
    }
  }

  /** Preview-tier sink: capped width, pooled canvases so VRAM stays flat. */
  makeSink(maxWidth = 720): CanvasSink {
    const width = Math.min(this.width, maxWidth);
    return new CanvasSink(this.track, { width, poolSize: 3 });
  }

  dispose(): void {
    this.input.dispose();
  }
}
