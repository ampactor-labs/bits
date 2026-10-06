// A still of a bit, for the list. It is drawn from the recipe through the
// same frame builder and renderer the stage and the render use, at a moment far enough in
// that the puppets have moved: one path to pixels, so a poster can never
// show something the film will not.
//
// Nothing is stored. The recipe is the bit, and a poster derived from it
// is always current — a saved one would go stale the moment a puppet was
// recast, and would cost every bit a file.

import { createFramer } from '../engine/frame';
import type { Project } from '../engine/recipe';
import { getAsset } from './assets';
import { loadStageImages, renderFrame2d, STAGE_BG } from './stageDraw';
import { loadVideos, videosReadyAt } from './video';

/** Where in the bit the still is taken. Far enough that a pass has moved
 *  something, early enough that most bits have reached it. */
const AT = 0.35;

const cache = new Map<string, string>();

/** A cached poster is keyed on what would change it. */
const keyOf = (id: string, project: Project) =>
  `${id}:${project.events.length}:${project.updatedAt ?? ''}`;

export async function posterFor(
  showId: string,
  project: Project,
  width = 96,
): Promise<string | null> {
  const key = keyOf(showId, project);
  const hit = cache.get(key);
  if (hit) return hit;
  // The voice track belongs to the audio, which a poster does not decode:
  // every mouth is drawn shut.
  const framer = createFramer(project);
  if (framer.cast.length === 0) return null;

  const W = width;
  const H = Math.round((width * 16) / 9);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = STAGE_BG;
  ctx.fillRect(0, 0, W, H);

  try {
    const images = await loadStageImages(framer.cast, getAsset);
    const t = (project.audio?.durationS ?? 0) * AT;
    const specs = framer.cast.map((p) => p.spec);
    await loadVideos(specs, getAsset);
    await videosReadyAt(specs, t);
    renderFrame2d(ctx, W, H, framer.frameAt(t), images);
    for (const img of images.values()) img.close();
  } catch {
    return null;
  }
  const url = canvas.toDataURL('image/webp', 0.7);
  // One session's worth: posters are cheap to redraw and expensive to keep.
  if (cache.size > 40) cache.clear();
  cache.set(key, url);
  return url;
}
