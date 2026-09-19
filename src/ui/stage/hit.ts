// What a finger is on, and how far it has travelled. The pointer model's
// arithmetic, out where it can be tested.
//
// These used to live in a closure inside the pointer effect, which meant
// the rules that decide whether a tap selects or moves a puppet could only
// be checked by driving a browser.

import { pointInPoly } from '../../engine/pieces';
import { restingPuppet } from '../../engine/puppet';
import { castOf, worldToLocal, type Channel, type PuppetPose, type ShowPuppet } from '../../engine/show';
import type { Project } from '../../engine/recipe';
import type { PuppetVisual } from '../../media/stageDraw';

/** A tap is a release that never travelled this far. In CSS pixels, not a
 *  fraction of the stage: the old normalised measure gave nearly twice the
 *  slop vertically as horizontally on a 9:16 stage. */
export const DRAG_PX = 6;
/** How near a finger has to land to take hold of a feature. */
export const HANDLE_HIT_PX = 22;
/** How far outside its own box a feature has to be dragged to come off. A
 *  fifth of the box either way: far enough that nudging a mouth to the chin
 *  never throws it away, near enough to find without aiming. */
export const REMOVE_BAND = 0.2;
/** How near a pin has to be grabbed, in stage units. */
const PIN_GRAB = 0.045;

export type HandleKey = 'mouth' | 'eyes' | `pin:${number}`;

export interface StageScene {
  project: Project;
  poses: Map<string, PuppetPose>;
  visuals: Map<string, PuppetVisual>;
}

/** One transform for hit testing and for drawing. The private copy this
 *  replaces ignored the spring's lean, so hits disagreed with the drawer on
 *  a leaning puppet, and it knew nothing about flip. */
export function toLocal(
  poses: Map<string, PuppetPose>,
  p: ShowPuppet,
  x: number,
  y: number,
): { x: number; y: number } {
  return worldToLocal(poses.get(p.id)?.root ?? restingPuppet(p.home.x, p.home.y), p, x, y);
}

/** Hit a puppet and which handle: a warp pin, a snipped-off piece
 *  (accounting for its swing), or the body. Front to back, so what is on
 *  top is what you grab. */
export function hitTest(
  scene: StageScene,
  x: number,
  y: number,
): { puppet: ShowPuppet; channel: Channel } | null {
  const cast = castOf(scene.project);
  for (let i = cast.length - 1; i >= 0; i--) {
    const p = cast[i]!;
    if (p.back) continue;
    const local = toLocal(scene.poses, p, x, y);
    const visual = scene.visuals.get(p.id);
    const pose = scene.poses.get(p.id);
    if (visual && pose) {
      for (let pi = 0; pi < pose.pins.length; pi++) {
        // A removed slot keeps its index but has nothing to grab.
        if (!visual.pins[pi]) continue;
        const pin = pose.pins[pi]!;
        if (Math.hypot(x - pin.x, y - pin.y) < PIN_GRAB) {
          return { puppet: p, channel: { pin: pi } };
        }
      }
      for (const child of visual.pieces.children) {
        const dangle = pose.dangles[child.snipIndex]?.angle ?? 0;
        const j = child.joint!;
        const ca = Math.cos(-dangle);
        const sa = Math.sin(-dangle);
        const rx = j.x + (local.x - j.x) * ca - (local.y - j.y) * sa;
        const ry = j.y + (local.x - j.x) * sa + (local.y - j.y) * ca;
        if (pointInPoly(child.poly, rx, ry)) {
          return { puppet: p, channel: { piece: child.snipIndex } };
        }
      }
      if (pointInPoly(visual.pieces.root.poly, local.x, local.y)) {
        return { puppet: p, channel: null };
      }
    }
    // A puppet with no cut-out silhouette yet is still grabbable by its box.
    const hw = Math.max(0.06, (p.spec.w * p.home.scale) / 2);
    const hh = Math.max(0.06, (p.spec.h * p.home.scale) / 2);
    const s = pose?.root ?? { x: p.home.x, y: p.home.y };
    if (Math.abs(x - s.x) <= hw && Math.abs(y - s.y) <= hh) {
      return { puppet: p, channel: null };
    }
  }
  return null;
}

/** The feature handle nearest a point, in frame pixels, or null.
 *
 *  Handles are pointer-events: none so a pinch's first finger can never
 *  land on one instead of on the stage; the gesture layer hit-tests them
 *  itself against the pixels the frame loop wrote. */
export function handleAt(
  handles: Map<string, { x: number; y: number }>,
  px: number,
  py: number,
): HandleKey | null {
  let best: HandleKey | null = null;
  let bestD = HANDLE_HIT_PX;
  for (const [key, pos] of handles) {
    const d = Math.hypot(px - pos.x, py - pos.y);
    if (d < bestD) {
      bestD = d;
      best = key as HandleKey;
    }
  }
  return best;
}

/** True once a handle has been dragged clear enough of its puppet that
 *  letting go takes the feature off. */
export function outsideBox(local: { x: number; y: number }): boolean {
  return (
    local.x < -REMOVE_BAND ||
    local.x > 1 + REMOVE_BAND ||
    local.y < -REMOVE_BAND ||
    local.y > 1 + REMOVE_BAND
  );
}

/** Which stroke a fingertip is on, or -1. Rubbing out a whole line beats a
 *  pixel eraser on a phone: one tap, and the line it takes is obvious. */
export function strokeNear(strokes: number[][], x: number, y: number, r = 0.045): number {
  for (let si = strokes.length - 1; si >= 0; si--) {
    const stroke = strokes[si]!;
    for (let i = 0; i + 3 < stroke.length; i += 2) {
      const ax = stroke[i]!;
      const ay = stroke[i + 1]!;
      const bx = stroke[i + 2]!;
      const by = stroke[i + 3]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2));
      if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) < r) return si;
    }
    // A dot is a stroke of one point, and has to be rubbed out too.
    if (stroke.length === 2 && Math.hypot(x - stroke[0]!, y - stroke[1]!) < r) return si;
  }
  return -1;
}

/** Stage coords from a pointer event. Soft bounds well past the frame:
 *  puppets enter and exit through the wings, and a drag that wanders
 *  offstage still comes back. */
export function normPoint(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return {
    x: Math.min(1.75, Math.max(-0.75, (clientX - rect.left) / rect.width)),
    y: Math.min(1.75, Math.max(-0.75, (clientY - rect.top) / rect.height)),
  };
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
