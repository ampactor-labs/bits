// The stage player: turns the stage's state into frames on its canvases.
// The frame loop in Stage.tsx decides when (the clock, the mode, a seek);
// this decides what, through the one frame builder and one renderer, and
// keeps the last frame it drew so anything else that shows the stage (the
// director view) reads the same frame rather than building its own.

import type { RefObject } from 'react';
import { toScreen } from '../../engine/camera';
import { composeFrame, type Analysis, type Frame, type PuppetVisual } from '../../engine/frame';
import type { Project } from '../../engine/recipe';
import { castOf, createShowSim, type PuppetPose, type ShowSim } from '../../engine/show';
import type { WireMap } from '../../engine/wires';
import { createRenderer2d, type StageImages } from '../../media/stageDraw';
import type { DoodleInk } from './DoodleBar';
import type { StagingDrag } from './gestures';

export interface PlayerSources {
  visualsRef: RefObject<Map<string, PuppetVisual>>;
  wiresRef: RefObject<WireMap>;
  imagesRef: RefObject<StageImages>;
  /** What the sound says, as of now. */
  analysis: () => Analysis;
}

export interface StagePlayer {
  /** A playing frame from a running sim, with trails. */
  playing(ctx: CanvasRenderingContext2D, W: number, H: number, project: Project, sim: ShowSim, t: number): Frame;
  /** A still at the playhead, drawn clean, with a drag in progress applied.
   *  Simulated from the nearest checkpoint, so scrubbing a long bit steps
   *  at most a second of sim rather than everything before the playhead. */
  still(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    project: Project,
    staging: StagingDrag | null,
    t: number,
  ): Frame;
  /** The last frame drawn, and the poses it was drawn from. */
  lastFrame(): Frame | null;
  lastPoses(): Map<string, PuppetPose>;
}

export function createStagePlayer(sources: PlayerSources): StagePlayer {
  const renderer = createRenderer2d();
  let last: Frame | null = null;
  let poses = new Map<string, PuppetPose>();

  const draw = (ctx: CanvasRenderingContext2D, W: number, H: number, frame: Frame) => {
    renderer.draw(ctx, W, H, frame, sources.imagesRef.current);
    last = frame;
    return frame;
  };

  return {
    playing(ctx, W, H, project, sim, t) {
      poses = sim.advanceTo(t);
      return draw(
        ctx,
        W,
        H,
        composeFrame({
          project,
          cast: castOf(project),
          visuals: sources.visualsRef.current,
          wires: sources.wiresRef.current,
          analysis: sources.analysis(),
          poses,
          t,
          camera: sim.camera(),
        }),
      );
    },
    still(ctx, W, H, project, staging, t) {
      let cast = castOf(project);
      if (staging) {
        cast = cast.map((p) =>
          p.id === staging.puppetId
            ? { ...p, home: { x: staging.x, y: staging.y, scale: staging.scale, rot: staging.rot } }
            : p,
        );
      }
      const sim = createShowSim(
        { ...project, events: applyStagingCast(project, staging) },
        0,
        undefined,
        undefined,
        { resumeAt: t },
      );
      poses = sim.advanceTo(t);
      return draw(
        ctx,
        W,
        H,
        composeFrame({
          project,
          cast,
          visuals: sources.visualsRef.current,
          wires: sources.wiresRef.current,
          analysis: sources.analysis(),
          poses,
          t,
          // A still is drawn clean: there is no previous frame to ghost.
          trails: false,
          camera: sim.camera(),
        }),
      );
    },
    lastFrame: () => last,
    lastPoses: () => poses,
  };
}

/** While staging drags, the sim needs the overridden home too. */
function applyStagingCast(project: Project, staging: StagingDrag | null): Project['events'] {
  if (!staging) return project.events;
  return project.events.map((e) =>
    e.kind === 'CAST' && e.puppetId === staging.puppetId
      ? { ...e, x: staging.x, y: staging.y, scale: staging.scale, rot: staging.rot }
      : e,
  );
}

/** What the current tool has in hand, for the overlay. */
export interface ToolMarks {
  strokes: number[][] | null;
  inks: DoodleInk[];
  snip: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** Pin rings, then whatever the current tool is drawing. All on the
 *  overlay, never the stage: the stage canvas holds only frames. */
export function drawMarks(
  overlay: HTMLCanvasElement,
  W: number,
  H: number,
  frame: Frame,
  poses: Map<string, PuppetPose>,
  marks: ToolMarks,
): void {
  const octx = sizedOverlay(overlay, W, H);
  if (!octx) return;
  octx.clearRect(0, 0, W, H);
  for (const layer of frame.layers) {
    const p = layer.puppet;
    const pose = poses.get(p.id);
    const visual = layer.visual;
    if (!pose || !visual || visual.pins.length === 0) continue;
    octx.strokeStyle = '#58a6ff';
    octx.lineWidth = 2;
    pose.pins.forEach((pin, pi) => {
      if (!visual.pins[pi]) return;
      const at = toScreen(frame.camera, p.depth, pin.x, pin.y, W, H);
      octx.beginPath();
      octx.arc(at.x * W, at.y * H, Math.max(6, W * 0.012), 0, Math.PI * 2);
      octx.stroke();
    });
  }
  if (marks.strokes) drawStrokes(octx, W, H, marks.strokes, marks.inks);
  if (marks.snip) {
    const s = marks.snip;
    octx.strokeStyle = '#58a6ff';
    octx.setLineDash([8, 8]);
    octx.lineWidth = 3;
    octx.beginPath();
    octx.moveTo(s.x0 * W, s.y0 * H);
    octx.lineTo(s.x1 * W, s.y1 * H);
    octx.stroke();
    octx.setLineDash([]);
  }
}

/** The overlay canvas, kept the stage canvas's size. */
export function sizedOverlay(
  overlay: HTMLCanvasElement,
  W: number,
  H: number,
): CanvasRenderingContext2D | null {
  if (overlay.width !== W || overlay.height !== H) {
    overlay.width = W;
    overlay.height = H;
  }
  return overlay.getContext('2d');
}

function drawStrokes(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  strokes: number[][],
  inks: DoodleInk[],
): void {
  const base = Math.max(2, W * 0.012);
  ctx.strokeStyle = '#ece5db';
  ctx.lineWidth = base;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [si, stroke] of strokes.entries()) {
    const ink = inks[si];
    if (ink) {
      ctx.strokeStyle = ink.color;
      ctx.lineWidth = Math.max(1.5, base * ink.width);
    }
    ctx.beginPath();
    for (let i = 0; i + 1 < stroke.length; i += 2) {
      const x = stroke[i]! * W;
      const y = stroke[i + 1]! * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
