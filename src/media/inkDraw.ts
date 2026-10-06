// Inks as canvases for the drawer: one small canvas per genome, refreshed
// when its tick moves. Keyed by the genome object, which is recipe data and
// never changes once written.

import { INK_SIZE, inkPlayer, type Genome, type InkPlayer } from '../engine/ink';

interface Live {
  player: InkPlayer;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  image: ImageData;
  shown: Uint8ClampedArray | null;
}

const live = new WeakMap<Genome, Live>();

/** The ink as it looks at t, on a canvas INK_SIZE square. */
export function inkCanvas(genome: Genome, t: number): OffscreenCanvas {
  let l = live.get(genome);
  if (!l) {
    const canvas = new OffscreenCanvas(INK_SIZE, INK_SIZE);
    const ctx = canvas.getContext('2d')!;
    l = { player: inkPlayer(genome), canvas, ctx, image: ctx.createImageData(INK_SIZE, INK_SIZE), shown: null };
    live.set(genome, l);
  }
  const px = l.player.at(t);
  if (px !== l.shown) {
    l.image.data.set(px);
    l.ctx.putImageData(l.image, 0, 0);
    l.shown = px;
  }
  return l.canvas;
}
