// How the stage looks beyond what each sheet is: paper shadows and depth
// haze. Pure numbers here; the renderer does the drawing. Both come from
// depth, so they only say anything once sheets sit at different depths,
// and a bit with no LOOK takes the plain drawing path untouched.

import { magnification, toScreen, type CameraPose } from './camera';
import type { LayerFrame } from './frame';

/** A layer's on-screen box, in normalised coords, ignoring rotation: good
 *  enough to tell which sheet a shadow falls on. */
export function screenBox(
  layer: LayerFrame,
  camera: CameraPose | null,
  W: number,
  H: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const p = layer.puppet;
  const root = layer.pose?.root ?? { x: p.home.x, y: p.home.y };
  const c = toScreen(camera, layer.depth, root.x, root.y, W, H);
  const m = magnification(camera, layer.depth);
  const hw = (p.spec.w * p.home.scale * m) / 2;
  const hh = (p.spec.h * p.home.scale * m) / 2;
  return { x0: c.x - hw, y0: c.y - hh, x1: c.x + hw, y1: c.y + hh };
}

/** How far a sheet's shadow falls, in depth units: the gap to the nearest
 *  sheet painted behind it that it overlaps on screen. Nothing behind it
 *  but the stage: one unit, the floor. */
export function shadowGap(
  layers: LayerFrame[],
  i: number,
  camera: CameraPose | null,
  W: number,
  H: number,
): number {
  const me = screenBox(layers[i]!, camera, W, H);
  for (let j = i - 1; j >= 0; j--) {
    const o = screenBox(layers[j]!, camera, W, H);
    const overlaps = o.x0 < me.x1 && o.x1 > me.x0 && o.y0 < me.y1 && o.y1 > me.y0;
    if (overlaps) return Math.max(0, layers[j]!.depth - layers[i]!.depth);
  }
  return 1;
}

/** The shadow's offset and blur in pixels, for a look's shadow amount and
 *  a depth gap. Light from the upper left; further gaps throw it further
 *  and softer, which is what reads as depth on paper. */
export function shadowOffset(shadow: number, gap: number, W: number): { dx: number; dy: number; blur: number } {
  const reach = W * 0.012 * shadow * Math.min(4, 0.6 + gap);
  return { dx: reach, dy: reach * 1.3, blur: reach * 1.4 };
}

/** How much fog covers a sheet at this depth, for a look's fog amount. A
 *  sheet at the stage plane is touched lightly; the horizon nearly gone. */
export function fogAmount(fog: number, depth: number): number {
  return fog * (1 - Math.exp(-(depth + 1.5) / 4));
}
