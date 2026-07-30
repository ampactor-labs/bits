// One drawer for preview and render: same inputs, same pixels. Puppets draw
// as scissored pieces (root clipped to what remains, children hinged at their
// snip lines), mouths flap with the loudness envelope, doodles boil.

import { boilNoise } from '../engine/puppet';
import type { PuppetPose } from '../engine/show';
import type { ShowPuppet } from '../engine/show';
import { pointInPoly, type PieceDef, type PuppetPieces } from '../engine/pieces';
import type { EyesEvent, MouthEvent, PuppetSpec } from '../engine/recipe';

export const STAGE_BG = '#101010';
const DOODLE_COLOR = '#ece5db';
const MOUTH_FILL = '#120d0b';
const BOIL_FPS = 8;
const BOIL_VARIANTS = 3;
const BOIL_AMP = 0.014;

export type StageImages = Map<string, ImageBitmap>;

export interface PuppetVisual {
  pieces: PuppetPieces;
  mouth: MouthEvent | null;
  eyes: EyesEvent | null;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawStage(
  ctx: Ctx2D,
  W: number,
  H: number,
  cast: ShowPuppet[],
  poses: Map<string, PuppetPose>,
  images: StageImages,
  visuals: Map<string, PuppetVisual>,
  mouthOpen: Map<string, number>,
  tS: number,
  seed: number,
): void {
  ctx.fillStyle = STAGE_BG;
  ctx.fillRect(0, 0, W, H);

  for (const puppet of cast) {
    if (puppet.back) {
      drawBackdrop(ctx, W, H, images.get(puppet.id));
      continue;
    }
    const pose = poses.get(puppet.id);
    const visual = visuals.get(puppet.id);
    if (!pose || !visual) continue;
    const s = pose.root;
    const pw = puppet.spec.w * W * puppet.home.scale;
    const ph = puppet.spec.h * H * puppet.home.scale;

    ctx.save();
    ctx.translate(s.x * W, s.y * H);
    ctx.rotate(s.angle + puppet.home.rot);
    ctx.scale(1 + s.squash, 1 - s.squash);

    drawPiece(ctx, puppet, visual.pieces.root, null, pw, ph, images, tS, seed);
    for (const child of visual.pieces.children) {
      const dangle = pose.dangles[child.snipIndex];
      drawPiece(ctx, puppet, child, dangle?.angle ?? 0, pw, ph, images, tS, seed);
    }

    if (visual.mouth) {
      drawMouth(ctx, visual.mouth, visual.pieces, pose, pw, ph, mouthOpen.get(puppet.id) ?? 0);
    }
    if (visual.eyes) {
      drawEyes(ctx, visual.eyes, visual.pieces, pose, pw, ph, tS, seed);
    }
    ctx.restore();
  }
}

/** Googly eyes: sclera pair pinned to the puppet, pupils lagging its motion
 *  with a little seeded jitter. Ride the containing piece like mouths do. */
function drawEyes(
  ctx: Ctx2D,
  eyes: EyesEvent,
  pieces: PuppetPieces,
  pose: PuppetPose,
  pw: number,
  ph: number,
  tS: number,
  seed: number,
): void {
  ctx.save();
  applyCarrierTransform(ctx, pieces, pose, pw, ph, eyes.ex, eyes.ey);
  const cx = (eyes.ex - 0.5) * pw;
  const cy = (eyes.ey - 0.5) * ph;
  const eyeR = (eyes.size * pw) / 4.4;
  const gap = eyeR * 1.3;
  const variant = Math.floor(tS * BOIL_FPS) % BOIL_VARIANTS;
  const lagX = clamp(-pose.root.vx * 0.05, -0.55, 0.55) * eyeR;
  const lagY = clamp(-pose.root.vy * 0.05, -0.55, 0.55) * eyeR;
  const jitX = boilNoise(seed, variant, 4242) * eyeR * 0.08;
  const jitY = boilNoise(seed, variant, 5353) * eyeR * 0.08;

  for (const side of [-1, 1]) {
    const ex = cx + side * gap;
    ctx.fillStyle = '#f4efe7';
    ctx.beginPath();
    ctx.ellipse(ex, cy, eyeR, eyeR * 1.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#17120e';
    ctx.beginPath();
    ctx.ellipse(ex + lagX + jitX, cy + lagY + jitY, eyeR * 0.42, eyeR * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Shared by mouths and eyes: transform onto the piece containing the point. */
function applyCarrierTransform(
  ctx: Ctx2D,
  pieces: PuppetPieces,
  pose: PuppetPose,
  pw: number,
  ph: number,
  lx: number,
  ly: number,
): void {
  const carrier = pieces.children.find((c) => pointInPoly(c.poly, lx, ly));
  if (carrier?.joint) {
    const dangle = pose.dangles[carrier.snipIndex];
    const jx = (carrier.joint.x - 0.5) * pw;
    const jy = (carrier.joint.y - 0.5) * ph;
    ctx.translate(jx, jy);
    ctx.rotate(dangle?.angle ?? 0);
    ctx.translate(-jx, -jy);
  }
}

function drawBackdrop(ctx: Ctx2D, W: number, H: number, img: ImageBitmap | undefined): void {
  if (!img) return;
  const scale = Math.max(W / img.width, H / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function drawPiece(
  ctx: Ctx2D,
  puppet: ShowPuppet,
  piece: PieceDef,
  dangleAngle: number | null,
  pw: number,
  ph: number,
  images: StageImages,
  tS: number,
  seed: number,
): void {
  ctx.save();
  if (dangleAngle !== null && piece.joint) {
    const jx = (piece.joint.x - 0.5) * pw;
    const jy = (piece.joint.y - 0.5) * ph;
    ctx.translate(jx, jy);
    ctx.rotate(dangleAngle);
    ctx.translate(-jx, -jy);
  }
  if (piece.poly.length >= 3) {
    ctx.beginPath();
    for (let i = 0; i < piece.poly.length; i++) {
      const [px, py] = piece.poly[i]!;
      const x = (px - 0.5) * pw;
      const y = (py - 0.5) * ph;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.clip();
  }
  drawContent(ctx, puppet.spec, puppet.id, pw, ph, images, tS, seed);
  ctx.restore();
}

function drawContent(
  ctx: Ctx2D,
  spec: PuppetSpec,
  puppetId: string,
  pw: number,
  ph: number,
  images: StageImages,
  tS: number,
  seed: number,
): void {
  switch (spec.type) {
    case 'cutout': {
      const img = images.get(puppetId);
      if (img) ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
      break;
    }
    case 'rect':
      ctx.fillStyle = spec.color;
      ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      break;
    case 'doodle':
      drawDoodle(ctx, spec.strokes, pw, ph, tS, seed);
      break;
  }
}

/** Strokes are normalized to the puppet box; boiling lines cycle seeded
 *  jitter variants so a single drawing never sits still. */
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

/** The mouth rides whichever piece contains it, so a snipped-off head keeps
 *  its own mouth. Closed is a lip line; open is an ellipse scaled by the
 *  envelope. */
function drawMouth(
  ctx: Ctx2D,
  mouth: MouthEvent,
  pieces: PuppetPieces,
  pose: PuppetPose,
  pw: number,
  ph: number,
  open: number,
): void {
  ctx.save();
  applyCarrierTransform(ctx, pieces, pose, pw, ph, mouth.mx, mouth.my);
  const mx = (mouth.mx - 0.5) * pw;
  const my = (mouth.my - 0.5) * ph;
  const width = mouth.size * pw;
  const height = Math.max(0.06, open) * mouth.size * pw * 0.85;

  ctx.fillStyle = MOUTH_FILL;
  ctx.beginPath();
  ctx.ellipse(mx, my, width / 2, height / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  if (open < 0.08) {
    ctx.strokeStyle = MOUTH_FILL;
    ctx.lineWidth = Math.max(2, width * 0.09);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(mx - width / 2, my);
    ctx.lineTo(mx + width / 2, my);
    ctx.stroke();
  }
  ctx.restore();
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
