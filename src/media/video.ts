// Video sheets: a clip playing in show time. Which frame shows at a moment
// is a rule, not a race: the latest frame whose timestamp is at or before
// the clip's own time (videoLocalTime). The film asks for that exact frame
// and waits for it; the stage reads ahead and draws the best frame it has,
// so a slow decoder makes the preview late, never the film wrong.
//
// Frames are decoded no larger than 720 px on their long side: plenty for
// a sheet on a phone stage, and a sixth of the memory of 4K.

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { PuppetSpec } from '../engine/recipe';
import { videoLocalTime } from '../engine/video';

const MAX_SIDE = 720;
/** How far ahead the stage decodes, and how much it keeps behind. */
const AHEAD_S = 1;
const BEHIND_S = 0.25;

interface Held {
  t: number;
  end: number;
  canvas: HTMLCanvasElement | OffscreenCanvas;
}

/** What a video file is, read once on import. */
export interface VideoInfo {
  durationS: number;
  width: number;
  height: number;
}

export async function probeVideo(blob: Blob): Promise<VideoInfo | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const durationS = await input.computeDuration();
    return { durationS, width: track.displayWidth, height: track.displayHeight };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

class Clip {
  private frames: Held[] = [];
  private reading: { from: number; stop: boolean } | null = null;

  private constructor(private sink: CanvasSink) {}

  static async open(blob: Blob): Promise<Clip | null> {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const long = Math.max(track.displayWidth, track.displayHeight);
    const scale = Math.min(1, MAX_SIDE / long);
    const sink = new CanvasSink(track, {
      width: Math.max(2, Math.round(track.displayWidth * scale)),
      height: Math.max(2, Math.round(track.displayHeight * scale)),
      fit: 'fill',
    });
    return new Clip(sink);
  }

  /** The best frame held for local time t, or null. */
  frameAt(t: number): Held | null {
    let best: Held | null = null;
    for (const f of this.frames) {
      if (f.t <= t + 1e-6 && (!best || f.t > best.t)) best = f;
    }
    return best;
  }

  private keep(f: Held) {
    if (this.frames.some((x) => x.t === f.t)) return;
    this.frames.push(f);
    this.frames.sort((a, b) => a.t - b.t);
  }

  /** The film's frame: exactly the one on show at t, waited for. */
  async exact(t: number): Promise<void> {
    const have = this.frameAt(t);
    if (have && t < have.end - 1e-6) return;
    const got = await this.sink.getCanvas(Math.max(0, t));
    if (got) this.keep({ t: got.timestamp, end: got.timestamp + got.duration, canvas: got.canvas });
    // A film reads forward: what is behind it will not be asked for again.
    this.frames = this.frames.filter((f) => f.end >= t - BEHIND_S);
  }

  /** The stage's read-ahead: keep frames from just behind t to a second
   *  past it, restarting the reader when the playhead jumps. */
  prefetch(t: number): void {
    this.frames = this.frames.filter((f) => f.end >= t - BEHIND_S && f.t <= t + AHEAD_S * 2);
    const r = this.reading;
    if (r && t >= r.from - 0.05 && t <= r.from + AHEAD_S * 4) return;
    if (r) r.stop = true;
    const run = { from: t, stop: false };
    this.reading = run;
    void (async () => {
      try {
        for await (const c of this.sink.canvases(Math.max(0, t))) {
          if (run.stop) break;
          this.keep({ t: c.timestamp, end: c.timestamp + c.duration, canvas: c.canvas });
          // Wait while far enough ahead of the playhead.
          while (!run.stop && c.timestamp > run.from + AHEAD_S) {
            await new Promise((res) => setTimeout(res, 30));
          }
        }
      } catch {
        // A file that stops decoding leaves the last good frame up.
      } finally {
        if (this.reading === run) this.reading = null;
      }
    })();
  }

  /** The playhead moved on: the reader follows. */
  advance(t: number): void {
    if (this.reading) this.reading.from = Math.max(this.reading.from, t);
  }
}

const clips = new Map<string, Promise<Clip | null>>();

/** Opens a clip once per asset. */
export function openVideo(assetId: string, blob: () => Promise<Blob>): Promise<Clip | null> {
  let hit = clips.get(assetId);
  if (!hit) {
    hit = blob()
      .then((b) => Clip.open(b))
      .catch(() => null);
    clips.set(assetId, hit);
  }
  return hit;
}

/** The clips opened so far, by asset, for the synchronous draw. */
const ready = new Map<string, Clip>();

export async function loadVideos(
  specs: PuppetSpec[],
  getAssetBlob: (assetId: string) => Promise<Blob>,
): Promise<void> {
  for (const spec of specs) {
    if (spec.type !== 'video') continue;
    const clip = await openVideo(spec.assetId, () => getAssetBlob(spec.assetId));
    if (clip) ready.set(spec.assetId, clip);
  }
}

export { videoLocalTime };

/** The frame to draw for a video sheet at show time t, if it has one. */
export function videoFrame(spec: Extract<PuppetSpec, { type: 'video' }>, t: number): CanvasImageSource | null {
  return ready.get(spec.assetId)?.frameAt(videoLocalTime(spec, t))?.canvas ?? null;
}

/** The stage: read ahead of the playhead for every video sheet. */
export function prefetchVideos(specs: PuppetSpec[], t: number): void {
  for (const spec of specs) {
    if (spec.type !== 'video') continue;
    const clip = ready.get(spec.assetId);
    if (!clip) continue;
    const local = videoLocalTime(spec, t);
    clip.prefetch(local);
    clip.advance(local);
  }
}

/** The film: every video sheet's exact frame for t, before t is drawn. */
export async function videosReadyAt(specs: PuppetSpec[], t: number): Promise<void> {
  for (const spec of specs) {
    if (spec.type !== 'video') continue;
    await ready.get(spec.assetId)?.exact(videoLocalTime(spec, t));
  }
}
