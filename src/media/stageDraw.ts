// One drawer for preview and render: same inputs, same pixels. Puppets draw
// as scissored pieces (root clipped to what remains, children hinged at their
// snip lines), mouths flap with the loudness envelope, doodles boil.

import { boilNoise } from '../engine/puppet';
import { worldToLocal, type PuppetPose, type ShowPuppet } from '../engine/show';
import { pointInPoly, type PieceDef, type PuppetPieces } from '../engine/pieces';
import {
  SHAPE_ROUND,
  SHAPE_SLIT,
  SHAPE_WIDE,
  type VoiceMoment,
} from '../engine/envelope';
import { deformGrid, makeWarpGrid, mlsSimilarity, type Pt } from '../engine/warp';
import type { WireMods } from '../engine/wires';
import type { EyesEvent, MouthEvent, PinEvent, PuppetSpec } from '../engine/recipe';

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
  pins: PinEvent[];
}

const WARP_GRID = makeWarpGrid(10, 14);

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawStage(
  ctx: Ctx2D,
  W: number,
  H: number,
  cast: ShowPuppet[],
  poses: Map<string, PuppetPose>,
  images: StageImages,
  visuals: Map<string, PuppetVisual>,
  voices: Map<string, VoiceMoment>,
  tS: number,
  seed: number,
  mods: Map<string, WireMods> = new Map(),
  trailKeep = 0,
): void {
  // Trails: leave a fading ghost of the previous frame instead of a clean
  // wipe (the TouchDesigner feedback-loop trick, canvas edition). The first
  // beats always wipe fully so renders start from black.
  const keep = tS < 0.08 ? 0 : Math.min(0.92, trailKeep);
  if (keep > 0) {
    ctx.fillStyle = STAGE_BG;
    ctx.globalAlpha = 1 - keep;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = STAGE_BG;
    ctx.fillRect(0, 0, W, H);
  }

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

    const mod = mods.get(puppet.id);
    ctx.save();
    ctx.translate((s.x + (mod?.dx ?? 0)) * W, (s.y + (mod?.dy ?? 0)) * H);
    ctx.rotate(s.angle + puppet.home.rot + (mod?.dAngle ?? 0));
    const wireScale = mod?.scaleMul ?? 1;
    ctx.scale((1 + s.squash) * wireScale, (1 - s.squash) * wireScale);

    // Pinned cutouts bend through the MLS warp; everything else draws as
    // scissored pieces (a single uncut piece is the trivial case).
    const img = images.get(puppet.id);
    const warp =
      visual.pins.length > 0 && puppet.spec.type === 'cutout' && img
        ? warpControls(puppet, pose, visual.pins)
        : null;

    if (warp && img) {
      drawWarpedMesh(ctx, img, pw, ph, deformGrid(WARP_GRID, warp.p, warp.q));
    } else {
      drawPiece(ctx, puppet, visual.pieces.root, null, pw, ph, images, tS, seed);
      for (const child of visual.pieces.children) {
        const dangle = pose.dangles[child.snipIndex];
        drawPiece(ctx, puppet, child, dangle?.angle ?? 0, pw, ph, images, tS, seed);
      }
    }

    if (visual.mouth) {
      const at = warp
        ? mlsSimilarity({ x: visual.mouth.mx, y: visual.mouth.my }, warp.p, warp.q)
        : null;
      drawMouth(
        ctx,
        visual.mouth,
        visual.pieces,
        pose,
        pw,
        ph,
        voices.get(puppet.id) ?? { open: 0, shape: 0 },
        at,
      );
    }
    if (visual.eyes) {
      const at = warp
        ? mlsSimilarity({ x: visual.eyes.ex, y: visual.eyes.ey }, warp.p, warp.q)
        : null;
      drawEyes(ctx, visual.eyes, visual.pieces, pose, pw, ph, tS, seed, at);
    }
    ctx.restore();
  }
}

/** Rest and deformed pin positions in puppet-local coords. */
function warpControls(
  puppet: ShowPuppet,
  pose: PuppetPose,
  pins: PinEvent[],
): { p: Pt[]; q: Pt[] } {
  const p: Pt[] = pins.map((e) => ({ x: e.px, y: e.py }));
  const q: Pt[] = pose.pins.map((state, i) => {
    const local = worldToLocal(pose.root, puppet, state.x, state.y);
    return Number.isFinite(local.x) && Number.isFinite(local.y) ? local : { ...p[i]! };
  });
  while (q.length < p.length) q.push({ ...p[q.length]! });
  return { p, q };
}

/** Textured triangle mesh: each grid cell maps rest→deformed with an affine
 *  per triangle, slightly inflated to hide seams. */
function drawWarpedMesh(
  ctx: Ctx2D,
  img: ImageBitmap,
  pw: number,
  ph: number,
  deformed: Float32Array,
): void {
  const { cols, rows, rest } = WARP_GRID;
  const stride = (cols + 1) * 2;
  const lx = (v: number) => (v - 0.5) * pw;
  const ly = (v: number) => (v - 0.5) * ph;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i00 = r * stride + c * 2;
      const i10 = i00 + 2;
      const i01 = i00 + stride;
      const i11 = i01 + 2;
      drawTri(ctx, img, rest, deformed, i00, i10, i01, img.width, img.height, lx, ly);
      drawTri(ctx, img, rest, deformed, i10, i11, i01, img.width, img.height, lx, ly);
    }
  }
}

function drawTri(
  ctx: Ctx2D,
  img: ImageBitmap,
  rest: Float32Array,
  def: Float32Array,
  ia: number,
  ib: number,
  ic: number,
  iw: number,
  ih: number,
  lx: (v: number) => number,
  ly: (v: number) => number,
): void {
  const sx0 = rest[ia]! * iw;
  const sy0 = rest[ia + 1]! * ih;
  const sx1 = rest[ib]! * iw;
  const sy1 = rest[ib + 1]! * ih;
  const sx2 = rest[ic]! * iw;
  const sy2 = rest[ic + 1]! * ih;
  let dx0 = lx(def[ia]!);
  let dy0 = ly(def[ia + 1]!);
  let dx1 = lx(def[ib]!);
  let dy1 = ly(def[ib + 1]!);
  let dx2 = lx(def[ic]!);
  let dy2 = ly(def[ic + 1]!);

  // Inflate the destination triangle a hair around its centroid: seam cover.
  const cx = (dx0 + dx1 + dx2) / 3;
  const cy = (dy0 + dy1 + dy2) / 3;
  const grow = 1.02;
  dx0 = cx + (dx0 - cx) * grow;
  dy0 = cy + (dy0 - cy) * grow;
  dx1 = cx + (dx1 - cx) * grow;
  dy1 = cy + (dy1 - cy) * grow;
  dx2 = cx + (dx2 - cx) * grow;
  dy2 = cy + (dy2 - cy) * grow;

  const den = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
  if (Math.abs(den) < 1e-12) return;
  const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / den;
  const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / den;
  const cc = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / den;
  const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / den;
  const e =
    (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) /
    den;
  const f =
    (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) /
    den;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, cc, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
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
  warpedAt: Pt | null,
): void {
  ctx.save();
  if (!warpedAt) applyCarrierTransform(ctx, pieces, pose, pw, ph, eyes.ex, eyes.ey);
  const cx = ((warpedAt?.x ?? eyes.ex) - 0.5) * pw;
  const cy = ((warpedAt?.y ?? eyes.ey) - 0.5) * ph;
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

/** The mouth rides whichever piece contains it (or its warped position when
 *  pinned). Shapes are spectral-class visemes: closed line, small and wide
 *  vowels, a fricative slit, and a round o/u. */
function drawMouth(
  ctx: Ctx2D,
  mouth: MouthEvent,
  pieces: PuppetPieces,
  pose: PuppetPose,
  pw: number,
  ph: number,
  voice: VoiceMoment,
  warpedAt: Pt | null,
): void {
  ctx.save();
  if (!warpedAt) applyCarrierTransform(ctx, pieces, pose, pw, ph, mouth.mx, mouth.my);
  const mx = ((warpedAt?.x ?? mouth.mx) - 0.5) * pw;
  const my = ((warpedAt?.y ?? mouth.my) - 0.5) * ph;
  const width = mouth.size * pw;
  const open = voice.open;

  // Dark fill for depth, bone stroke for contrast: reads as lips on a photo
  // face and as drawn lines on a doodle over the dark stage.
  if (open < 0.08) {
    ctx.strokeStyle = DOODLE_COLOR;
    ctx.lineWidth = Math.max(2.5, width * 0.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(mx - width / 2, my);
    ctx.lineTo(mx + width / 2, my);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.fillStyle = MOUTH_FILL;
  ctx.strokeStyle = DOODLE_COLOR;
  ctx.lineWidth = Math.max(2, width * 0.07);
  ctx.beginPath();
  switch (voice.shape) {
    case SHAPE_SLIT:
      // Teeth together: wide and thin, whatever the loudness.
      ctx.ellipse(mx, my, width * 0.58, Math.max(1.5, width * 0.09), 0, 0, Math.PI * 2);
      break;
    case SHAPE_ROUND: {
      const r = width * (0.16 + 0.22 * open);
      ctx.ellipse(mx, my, r, r * 1.15, 0, 0, Math.PI * 2);
      break;
    }
    case SHAPE_WIDE:
      ctx.ellipse(mx, my, width * 0.55, open * width * 0.5, 0, 0, Math.PI * 2);
      break;
    default:
      ctx.ellipse(mx, my, width * 0.4, open * width * 0.3, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
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
