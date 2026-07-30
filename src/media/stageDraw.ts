// One drawer for preview and render: same inputs, same pixels.

import { boilNoise, type PuppetState } from '../engine/puppet';
import type { ShowPuppet } from '../engine/show';

export const STAGE_BG = '#101010';
const DOODLE_COLOR = '#ece5db';
const BOIL_FPS = 8;
const BOIL_VARIANTS = 3;
const BOIL_AMP = 0.014;

export type StageImages = Map<string, ImageBitmap>;

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawStage(
  ctx: Ctx2D,
  W: number,
  H: number,
  cast: ShowPuppet[],
  states: Map<string, PuppetState>,
  images: StageImages,
  tS: number,
  seed: number,
): void {
  ctx.fillStyle = STAGE_BG;
  ctx.fillRect(0, 0, W, H);

  for (const puppet of cast) {
    const s = states.get(puppet.id);
    if (!s) continue;
    const pw = puppet.spec.w * W * puppet.home.scale;
    const ph = puppet.spec.h * H * puppet.home.scale;

    ctx.save();
    ctx.translate(s.x * W, s.y * H);
    ctx.rotate(s.angle);
    ctx.scale(1 + s.squash, 1 - s.squash);

    switch (puppet.spec.type) {
      case 'cutout': {
        const img = images.get(puppet.id);
        if (img) ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
        break;
      }
      case 'rect':
        ctx.fillStyle = puppet.spec.color;
        ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
        break;
      case 'doodle':
        drawDoodle(ctx, puppet.spec.strokes, pw, ph, tS, seed);
        break;
    }
    ctx.restore();
  }
}

/** Strokes are normalized [x0,y0,x1,y1,...] in the puppet box; boiling lines
 *  cycle seeded jitter variants so a single drawing never sits still. */
function drawDoodle(
  ctx: Ctx2D,
  strokes: number[][],
  pw: number,
  ph: number,
  tS: number,
  seed: number,
): void {
  const variant = Math.floor(tS * BOIL_FPS) % BOIL_VARIANTS;
  const amp = BOIL_AMP * Math.max(pw, ph);
  ctx.strokeStyle = DOODLE_COLOR;
  ctx.lineWidth = Math.max(2, pw * 0.045);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let pointIndex = 0;
  for (const stroke of strokes) {
    ctx.beginPath();
    for (let i = 0; i + 1 < stroke.length; i += 2) {
      const x = (stroke[i]! - 0.5) * pw + boilNoise(seed, variant, pointIndex) * amp;
      const y = (stroke[i + 1]! - 0.5) * ph + boilNoise(seed, variant, pointIndex + 7919) * amp;
      pointIndex += 1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** Load cutout bitmaps for a cast; rects and doodles need none. */
export async function loadStageImages(
  cast: ShowPuppet[],
  getAssetBlob: (assetId: string) => Promise<Blob>,
): Promise<StageImages> {
  const images: StageImages = new Map();
  for (const p of cast) {
    if (p.spec.type === 'cutout') {
      try {
        images.set(p.id, await createImageBitmap(await getAssetBlob(p.spec.assetId)));
      } catch {
        // Missing asset: puppet simply doesn't draw.
      }
    }
  }
  return images;
}
