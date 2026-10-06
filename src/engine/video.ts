// What a video sheet knows about itself once it has been read: how much
// it moves and which way, where the person in it is, and where their head
// and hands go. Computed once at import, stored as an asset, and from then
// on plain data: model output differs across devices, so it is a result
// kept, never a recipe re-run.
//
// The pure parts live here: where a clip is at a show moment, reading its
// tracks at that moment, and turning a pose track into an ordinary pass.

import type { PuppetSpec } from './recipe';

export type VideoSpec = Extract<PuppetSpec, { type: 'video' }>;

/** Where in the clip a sheet is at show time t. */
export function videoLocalTime(spec: VideoSpec, t: number): number {
  const from = spec.clipFrom ?? 0;
  const span = Math.max(1e-3, spec.durationS - from);
  const local = t - (spec.at ?? 0);
  if (local <= 0) return from;
  if (spec.loop === false) return from + Math.min(local, span - 1e-3);
  return from + (local % span);
}

/** The joints a pose track keeps: enough to puppet with. */
export const JOINTS = ['head', 'leftHand', 'rightHand'] as const;
export type Joint = (typeof JOINTS)[number];

/** A clip's analysis, sampled at `rate` per second of clip time. */
export interface VideoTracks {
  rate: number;
  /** How much changes between samples, 0..1 (normalised to its own 95th
   *  percentile, like the bands). */
  motion: Float32Array;
  /** Which way the picture drifts, -1..1 each. */
  flowx: Float32Array;
  flowy: Float32Array;
  /** Per joint: x, y in the frame's 0..1, and visibility 0..1. */
  pose: Record<Joint, Float32Array> | null;
  /** Person masks: one alpha plane per sample. */
  masks: { w: number; h: number; frames: Uint8Array[] } | null;
}

const sampleAt = (track: Float32Array, rate: number, t: number): number => {
  if (track.length === 0) return 0;
  const f = Math.max(0, t * rate);
  const i = Math.floor(f);
  if (i >= track.length - 1) return track[track.length - 1]!;
  const u = f - i;
  return track[i]! * (1 - u) + track[i + 1]! * u;
};

/** A motion signal at show time t. */
export function videoSignalAt(
  spec: VideoSpec,
  tracks: VideoTracks,
  of: 'motion' | 'flowx' | 'flowy',
  t: number,
): number {
  return sampleAt(tracks[of], tracks.rate, videoLocalTime(spec, t));
}

/** The mask frame on show at clip time `local`: the latest at or before. */
export function maskIndex(tracks: VideoTracks, local: number): number {
  const n = tracks.masks?.frames.length ?? 0;
  return Math.min(n - 1, Math.max(0, Math.floor(local * tracks.rate + 1e-6)));
}

/** Where a sheet sits, for mapping a point in its frame onto the stage.
 *  The video sheet's home: passes made from it are stage coordinates, so
 *  they mean the same thing wherever the sheet goes later. */
export interface SheetFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
}

/** A joint's path as PASS samples [t, x, y, ...] in show time and stage
 *  coordinates, across one play of the clip. Gaps where the joint was not
 *  seen are left out, so the pass holds its last point through them. */
export function poseToSamples(
  spec: VideoSpec,
  tracks: VideoTracks,
  joint: Joint,
  sheet: SheetFrame,
  minVisibility = 0.5,
): number[] {
  const track = tracks.pose?.[joint];
  if (!track) return [];
  const out: number[] = [];
  const from = spec.clipFrom ?? 0;
  const start = spec.at ?? 0;
  const c = Math.cos(sheet.rot);
  const s = Math.sin(sheet.rot);
  const n = track.length / 3;
  for (let i = 0; i < n; i++) {
    const local = i / tracks.rate;
    if (local < from || local > spec.durationS) continue;
    const vis = track[i * 3 + 2]!;
    if (vis < minVisibility) continue;
    const lx = (track[i * 3]! - 0.5) * sheet.w;
    const ly = (track[i * 3 + 1]! - 0.5) * sheet.h;
    out.push(start + (local - from), sheet.x + lx * c - ly * s, sheet.y + lx * s + ly * c);
  }
  return out;
}
