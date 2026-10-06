// One drawer for preview and render: same inputs, same pixels. Puppets draw
// as scissored pieces (root clipped to what remains, children hinged at their
// snip lines), mouths flap with the loudness envelope, doodles boil.

import { viewOf } from '../engine/camera';
import { fogAmount, shadowGap, shadowOffset } from '../engine/look';
import { gradeParams, gradePixels, grainTile } from '../engine/grade';
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
import type { Frame, LayerFrame, PuppetVisual } from '../engine/frame';

export type { PuppetVisual } from '../engine/frame';
import type { EyesEvent, MouthEvent, PinEvent, PuppetSpec } from '../engine/recipe';
import type { Genome } from '../engine/ink';
import { inkCanvas } from './inkDraw';

export const STAGE_BG = '#101010';
const DOODLE_COLOR = '#ece5db';
const MOUTH_FILL = '#120d0b';
const BOIL_FPS = 8;
const BOIL_VARIANTS = 3;
const BOIL_AMP = 0.014;

export type StageImages = Map<string, ImageBitmap>;

const WARP_GRID = makeWarpGrid(10, 14);

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Draws one frame. The canvas renderer: what every frame looked like
 *  before there was any other, and the reference the others are held to. */
export function renderFrame2d(ctx: Ctx2D, W: number, H: number, frame: Frame, images: StageImages): void {
  // Trails: leave a fading ghost of the previous frame instead of a clean
  // wipe (the TouchDesigner feedback-loop trick, canvas edition). The first
  // beats always wipe fully so renders start from black.
  const tS = frame.t;
  const keep = tS < 0.08 ? 0 : Math.min(0.92, frame.trail);
  if (keep > 0) {
    ctx.fillStyle = STAGE_BG;
    ctx.globalAlpha = 1 - keep;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = STAGE_BG;
    ctx.fillRect(0, 0, W, H);
  }

  // Only shadows and fog need each sheet drawn on its own; a palette or
  // paper grades the finished frame (see createRenderer2d).
  const look = frame.look && (frame.look.shadow > 0 || frame.look.fog > 0) ? frame.look : null;
  frame.layers.forEach((layer, i) => {
    if (!look) {
      drawProjected(ctx, W, H, frame, layer, images);
      return;
    }
    // A look draws each sheet on its own first, so its fog tints only the
    // sheet and its shadow is the whole sheet's silhouette: a shadow cast
    // from inside the sheet's clip would be cut off at its edges.
    const sprite = spriteFor(W, H);
    sprite.setTransform(1, 0, 0, 1, 0, 0);
    sprite.globalCompositeOperation = 'source-over';
    sprite.clearRect(0, 0, W, H);
    drawProjected(sprite, W, H, frame, layer, images);
    const haze = look.fog > 0 ? fogAmount(look.fog, layer.depth) : 0;
    if (haze > 0) {
      sprite.globalCompositeOperation = 'source-atop';
      sprite.globalAlpha = haze;
      sprite.fillStyle = look.fogColor;
      sprite.fillRect(0, 0, W, H);
      sprite.globalAlpha = 1;
      sprite.globalCompositeOperation = 'source-over';
    }
    ctx.save();
    // The back layer has nothing behind it to fall on.
    if (look.shadow > 0 && !layer.puppet.back) {
      const gap = shadowGap(frame.layers, i, frame.camera, W, H);
      const off = shadowOffset(look.shadow, gap, W);
      ctx.shadowColor = `rgba(0, 0, 0, ${(0.55 * look.shadow).toFixed(3)})`;
      ctx.shadowOffsetX = off.dx;
      ctx.shadowOffsetY = off.dy;
      ctx.shadowBlur = off.blur;
    }
    ctx.drawImage(sprite.canvas, 0, 0);
    ctx.restore();
  });
}

/** One layer through the camera. At rest there is no transform at all. */
function drawProjected(ctx: Ctx2D, W: number, H: number, frame: Frame, layer: LayerFrame, images: StageImages): void {
  const view = viewOf(frame.camera, layer.depth, W, H);
  if (!view) {
    drawLayer(ctx, W, H, layer, images, frame.t, frame.seed, false);
    return;
  }
  // The camera is one similarity per sheet, applied on top of whatever
  // the caller set (device pixels), so everything inside the sheet
  // follows it.
  ctx.save();
  ctx.transform(view.a, view.b, view.c, view.d, view.e, view.f);
  drawLayer(ctx, W, H, layer, images, frame.t, frame.seed, true);
  ctx.restore();
}

/** One scratch canvas for every looked layer, kept the stage's size. */
let sprite: OffscreenCanvasRenderingContext2D | null = null;
function spriteFor(W: number, H: number): OffscreenCanvasRenderingContext2D {
  if (!sprite || sprite.canvas.width !== W || sprite.canvas.height !== H) {
    sprite = new OffscreenCanvas(W, H).getContext('2d')!;
  }
  return sprite;
}

/** A canvas renderer that remembers the frame before. Trails are a ghost
 *  of the previous frame, so how much of it survives has to depend on how
 *  long ago that frame was: a 60 fps preview used to fade twice as fast as
 *  the 30 fps film. `keep` is defined per thirtieth of a second, so a film
 *  at 30 fps draws exactly what it always did. */
export interface Renderer2d {
  draw(ctx: Ctx2D, W: number, H: number, frame: Frame, images: StageImages): void;
  /** Forget the previous frame: the next one wipes clean. */
  reset(): void;
}

/** How much of the previous frame survives under this one, given when
 *  that frame was: per thirtieth of a second, so 30 fps is exact. */
function trailSince(frame: Frame, lastT: number | null): number {
  let trail = Math.min(0.92, frame.trail);
  if (lastT !== null && trail > 0) {
    const dt = frame.t - lastT;
    // Going back, a jump the eye reads as a cut, or a real one: start
    // clean.
    if (dt < 0 || dt > 0.25 || (frame.cutAt !== null && frame.cutAt > lastT)) trail = 0;
    else {
      const thirtieths = dt * 30;
      if (Math.abs(thirtieths - 1) > 1e-9) trail = Math.pow(trail, thirtieths);
    }
  }
  return trail;
}

/** The fade every renderer applies before drawing a frame: the canvas
 *  renderer's own rule, for renderers that do not go through it. */
export function trailFor(frame: Frame, lastT: number | null): number {
  const trail = trailSince(frame, lastT);
  return frame.t < 0.08 ? 0 : Math.min(0.92, trail);
}

export function createRenderer2d(): Renderer2d {
  let lastT: number | null = null;
  // A graded show draws onto a working canvas, which keeps the trails, and
  // puts a graded copy on screen: grading the screen itself would grade
  // every ghost again each frame it survives.
  let work: OffscreenCanvasRenderingContext2D | null = null;
  let grading = false;
  let grain: { seed: number; tile: Uint8Array } | null = null;
  let out: ImageData | null = null;
  return {
    draw(ctx, W, H, frame, images) {
      const grade = frame.look && (frame.look.palette || frame.look.paper) ? frame.look : null;
      if (!!grade !== grading) {
        // Switching in or out: the working canvas has no history worth
        // keeping.
        grading = !!grade;
        lastT = null;
      }
      if (grade) {
        if (!work || work.canvas.width !== W || work.canvas.height !== H) {
          work = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
          lastT = null;
        }
        const trail = trailSince(frame, lastT);
        lastT = frame.t;
        renderFrame2d(work, W, H, trail === frame.trail ? frame : { ...frame, trail }, images);
        if (!grain || grain.seed !== frame.seed) grain = { seed: frame.seed, tile: grainTile(frame.seed) };
        if (!out || out.width !== W || out.height !== H) out = new ImageData(W, H);
        const params = gradeParams({ palette: grade.palette, paper: grade.paper, seed: frame.seed }, W, frame.t);
        gradePixels(work.getImageData(0, 0, W, H).data, out.data, W, H, params, grain.tile);
        ctx.putImageData(out, 0, 0);
        return;
      }
      const trail = trailSince(frame, lastT);
      lastT = frame.t;
      renderFrame2d(ctx, W, H, trail === frame.trail ? frame : { ...frame, trail }, images);
    },
    reset() {
      lastT = null;
    },
  };
}

function drawLayer(
  ctx: Ctx2D,
  W: number,
  H: number,
  layer: LayerFrame,
  images: StageImages,
  tS: number,
  seed: number,
  moved: boolean,
): void {
  const place = placementOf(layer, W, H);
  if (!place) return;
  const mod = layer.mods;
  ctx.save();
  // Wired fade and colour. Absent unless wired, so an unwired sheet never
  // touches either and draws as it always did.
  if (mod.alpha !== undefined) ctx.globalAlpha *= mod.alpha;
  if (mod.hue) ctx.filter = `hue-rotate(${mod.hue.toFixed(1)}deg)`;
  ctx.translate(place.x, place.y);
  ctx.rotate(place.rot);
  ctx.scale(place.sx, place.sy);
  drawSheetContent(ctx, layer, W, H, images, tS, seed, moved);
  ctx.restore();
}

/** Where a sheet's own frame sits on the stage, in pixels: the spring's
 *  position, lean and squash, plus whatever the wires add. Null when the
 *  sheet has nothing to draw. */
export interface Placement {
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
}

export function placementOf(layer: LayerFrame, W: number, H: number): Placement | null {
  const { puppet, pose, visual, mods: mod } = layer;
  if (!pose || !visual) return null;
  const s = pose.root;
  return {
    x: (s.x + mod.dx) * W,
    y: (s.y + mod.dy) * H,
    rot: s.angle + puppet.home.rot + mod.dAngle,
    sx: (1 + s.squash) * mod.scaleMul,
    sy: (1 - s.squash) * mod.scaleMul,
  };
}

/** The sheet's box in pixels, before squash and wires. */
export function sheetSize(layer: LayerFrame, W: number, H: number): { pw: number; ph: number } {
  const p = layer.puppet;
  return { pw: p.spec.w * W * p.home.scale, ph: p.spec.h * H * p.home.scale };
}

/** Everything a sheet is, drawn in its own frame (origin at its centre,
 *  unrotated): pieces or the warp, then mouth and eyes. The canvas
 *  renderer draws it straight onto the stage; the GL renderer draws it
 *  onto a sprite and places that. One rasteriser for a sheet's content,
 *  so the two can only differ in how the result is placed. */
export function drawSheetContent(
  ctx: Ctx2D,
  layer: LayerFrame,
  W: number,
  H: number,
  images: StageImages,
  tS: number,
  seed: number,
  apron: boolean,
): void {
  const { puppet, pose, visual } = layer;
  if (!pose || !visual) return;
  const { pw, ph } = sheetSize(layer, W, H);

  // Pinned cutouts bend through the MLS warp; everything else draws as
  // scissored pieces (a single uncut piece is the trivial case).
  const img = images.get(puppet.id);
  const warp =
    visual.pins.some((pin) => pin !== null) && puppet.spec.type === 'cutout' && img
      ? warpControls(puppet, pose, visual.pins)
      : null;

  // The mirror goes here, after the root frame, so pieces, mouths, eyes
  // and the warp mesh all follow it. localToWorld already agrees.
  if (puppet.flip) ctx.scale(-1, 1);

  // A backdrop the camera has moved would slide off and show the void
  // behind it, so it carries a mirrored apron: the photo reflected across
  // each edge, which reads as more of the same place rather than a seam.
  if (apron && puppet.back && img && puppet.spec.type === 'cutout' && puppet.spec.fit === 'cover') {
    drawApron(ctx, puppet.spec, puppet.id, pw, ph, images, tS, seed);
  }

  if (warp && img) {
    const crop = cropOf(puppet.spec, img, pw, ph);
    drawWarpedMesh(ctx, img, crop, pw, ph, deformGrid(WARP_GRID, warp.p, warp.q));
  } else {
    drawPiece(ctx, puppet, visual.pieces.root, null, pw, ph, images, tS, seed, visual.ink);
    for (const child of visual.pieces.children) {
      const dangle = pose.dangles[child.snipIndex];
      drawPiece(ctx, puppet, child, dangle?.angle ?? 0, pw, ph, images, tS, seed, visual.ink);
    }
  }

  if (visual.mouth) {
    const at = warp
      ? mlsSimilarity({ x: visual.mouth.mx, y: visual.mouth.my }, warp.p, warp.q)
      : null;
    drawMouth(ctx, visual.mouth, visual.pieces, pose, pw, ph, layer.voice, at);
  }
  if (visual.eyes) {
    const at = warp
      ? mlsSimilarity({ x: visual.eyes.ex, y: visual.eyes.ey }, warp.p, warp.q)
      : null;
    drawEyes(ctx, visual.eyes, visual.pieces, pose, pw, ph, tS, seed, at);
  }
}

/** When a sheet's drawn content can be reused from an earlier frame: the
 *  same key draws the same pixels. Null when it changes every frame
 *  (a mouth, eyes, dangling pieces, a warp). Doodles and words boil, so
 *  they key on the boil variant. */
export function sheetContentKey(layer: LayerFrame, W: number, H: number, tS: number): string | null {
  const { puppet, visual } = layer;
  if (!visual) return null;
  if (visual.mouth || visual.eyes) return null;
  // Inks move every tick.
  if (visual.ink || puppet.spec.type === 'ink') return null;
  if (visual.pieces.children.length > 0) return null;
  if (visual.pins.some((pin) => pin !== null)) return null;
  const { pw, ph } = sheetSize(layer, W, H);
  const boils = puppet.spec.type === 'doodle' || puppet.spec.type === 'text';
  const variant = boils ? Math.floor(tS * BOIL_FPS) % BOIL_VARIANTS : 0;
  return `${puppet.id}#${specId(puppet.spec)}|${pw.toFixed(2)}|${ph.toFixed(2)}|${puppet.flip ? 1 : 0}|${variant}|${visual.pieces.root.poly.length}`;
}

/** A number per spec object: a recoloured or re-drawn sheet has a new spec,
 *  so its cached sprite is never reused. Specs are immutable recipe data. */
const specIds = new WeakMap<PuppetSpec, number>();
let nextSpecId = 0;
function specId(spec: PuppetSpec): number {
  let id = specIds.get(spec);
  if (id === undefined) {
    id = nextSpecId++;
    specIds.set(spec, id);
  }
  return id;
}

/** How far past its box a sheet's content can reach, in pixels: pieces
 *  swing out on their hinges, eyes and mouths sit near the edge, strokes
 *  have width. */
export function sheetMargin(layer: LayerFrame, W: number, H: number): number {
  const { pw, ph } = sheetSize(layer, W, H);
  const swings = (layer.visual?.pieces.children.length ?? 0) > 0;
  const warps = layer.visual?.pins.some((pin) => pin !== null) ?? false;
  return swings || warps ? Math.hypot(pw, ph) * 0.6 : Math.max(8, Math.min(pw, ph) * 0.12);
}

/** The eight neighbours of a cover-fit box, each mirrored so its edge
 *  meets the box's own edge with the same pixels. */
function drawApron(
  ctx: Ctx2D,
  spec: PuppetSpec,
  puppetId: string,
  pw: number,
  ph: number,
  images: StageImages,
  tS: number,
  seed: number,
): void {
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      if (i === 0 && j === 0) continue;
      ctx.save();
      ctx.translate(i * pw, j * ph);
      ctx.scale(i === 0 ? 1 : -1, j === 0 ? 1 : -1);
      // A little past the shared edge, under the box itself: two
      // anti-aliased clips meeting on one line let the stage show through
      // as a hairline seam.
      ctx.beginPath();
      ctx.rect(-pw / 2 - 1.5, -ph / 2 - 1.5, pw + 3, ph + 3);
      ctx.clip();
      drawContent(ctx, spec, puppetId, pw, ph, images, tS, seed);
      ctx.restore();
    }
  }
}

const IDENTITY: WireMods = { scaleMul: 1, dx: 0, dy: 0, dAngle: 0 };

/** The old call shape, kept for the harness's small fixtures. */
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
  renderFrame2d(
    ctx,
    W,
    H,
    {
      t: tS,
      seed,
      trail: trailKeep,
      camera: null,
      look: null,
      cutAt: null,
      layers: cast.map((puppet) => ({
        puppet,
        pose: poses.get(puppet.id),
        visual: visuals.get(puppet.id),
        voice: voices.get(puppet.id) ?? { open: 0, shape: 0 },
        mods: mods.get(puppet.id) ?? IDENTITY,
        depth: puppet.depth,
      })),
    },
    images,
  );
}

/** Rest and deformed pin positions in puppet-local coords. */
function warpControls(
  puppet: ShowPuppet,
  pose: PuppetPose,
  pins: (PinEvent | null)[],
): { p: Pt[]; q: Pt[] } {
  // Removed slots are skipped in both lists together, so the deformer only
  // ever sees live control points and their current positions.
  const p: Pt[] = [];
  const q: Pt[] = [];
  pins.forEach((pin, i) => {
    if (!pin) return;
    const rest = { x: pin.px, y: pin.py };
    p.push(rest);
    const state = pose.pins[i];
    if (!state) {
      q.push({ ...rest });
      return;
    }
    const local = worldToLocal(pose.root, puppet, state.x, state.y);
    q.push(Number.isFinite(local.x) && Number.isFinite(local.y) ? local : { ...rest });
  });
  return { p, q };
}

/** Textured triangle mesh: each grid cell maps rest→deformed with an affine
 *  per triangle, slightly inflated to hide seams. */
/** The part of the image a box shows: all of it, or for a cover-fit image
 *  the centred crop that fills the box. */
interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

function cropOf(spec: PuppetSpec, img: ImageBitmap, pw: number, ph: number): Crop {
  if (spec.type !== 'cutout' || spec.fit !== 'cover') return { x: 0, y: 0, w: img.width, h: img.height };
  const scale = Math.max(pw / img.width, ph / img.height);
  const w = pw / scale;
  const h = ph / scale;
  return { x: (img.width - w) / 2, y: (img.height - h) / 2, w, h };
}

function drawWarpedMesh(
  ctx: Ctx2D,
  img: ImageBitmap,
  crop: Crop,
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
      drawTri(ctx, img, rest, deformed, i00, i10, i01, crop, lx, ly);
      drawTri(ctx, img, rest, deformed, i10, i11, i01, crop, lx, ly);
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
  crop: Crop,
  lx: (v: number) => number,
  ly: (v: number) => number,
): void {
  const sx0 = crop.x + rest[ia]! * crop.w;
  const sy0 = crop.y + rest[ia + 1]! * crop.h;
  const sx1 = crop.x + rest[ib]! * crop.w;
  const sy1 = crop.y + rest[ib + 1]! * crop.h;
  const sx2 = crop.x + rest[ic]! * crop.w;
  const sy2 = crop.y + rest[ic + 1]! * crop.h;
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
  ink: Genome | null = null,
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
  if (ink) drawDressed(ctx, puppet, pw, ph, images, tS, seed, ink);
  else drawContent(ctx, puppet.spec, puppet.id, pw, ph, images, tS, seed, puppet.flip);
  ctx.restore();
}

/** One scratch canvas for dressing, reused. */
let dressing: OffscreenCanvasRenderingContext2D | null = null;

/** A sheet dressed in an ink keeps its own shape and takes the ink's
 *  colours, like paper cut from patterned stock: its content is drawn
 *  alone, the ink laid over exactly where that content is, and the result
 *  placed where the content would have gone. */
function drawDressed(
  ctx: Ctx2D,
  puppet: ShowPuppet,
  pw: number,
  ph: number,
  images: StageImages,
  tS: number,
  seed: number,
  ink: Genome,
): void {
  // Strokes and words reach a little past the box.
  const m = Math.max(4, Math.min(pw, ph) * 0.1);
  const tw = pw + m * 2;
  const th = ph + m * 2;
  // Drawn at the resolution it lands at, so it is as sharp as undressed.
  const tr = ctx.getTransform();
  const k = Math.min(3, Math.max(1, Math.hypot(tr.a, tr.b)));
  const w = Math.min(2048, Math.ceil(tw * k));
  const h = Math.min(2048, Math.ceil(th * k));
  if (!dressing) dressing = new OffscreenCanvas(w, h).getContext('2d')!;
  const d = dressing;
  if (d.canvas.width !== w || d.canvas.height !== h) {
    d.canvas.width = w;
    d.canvas.height = h;
  }
  d.setTransform(1, 0, 0, 1, 0, 0);
  d.globalCompositeOperation = 'source-over';
  d.clearRect(0, 0, w, h);
  d.setTransform(w / tw, 0, 0, h / th, w / 2, h / 2);
  drawContent(d, puppet.spec, puppet.id, pw, ph, images, tS, seed, puppet.flip);
  d.globalCompositeOperation = 'source-atop';
  d.imageSmoothingEnabled = true;
  d.imageSmoothingQuality = 'high';
  d.drawImage(inkCanvas(ink, tS), -pw / 2, -ph / 2, pw, ph);
  d.globalCompositeOperation = 'source-over';
  ctx.drawImage(d.canvas, -tw / 2, -th / 2, tw, th);
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
  flip = false,
): void {
  switch (spec.type) {
    case 'cutout': {
      const img = images.get(puppetId);
      if (!img) break;
      if (spec.fit === 'cover') {
        // Cropped to the box, never stretched: a backdrop fills the stage
        // the way it always has.
        const scale = Math.max(pw / img.width, ph / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      } else {
        ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
      }
      break;
    }
    case 'rect':
      ctx.fillStyle = spec.color;
      ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      break;
    case 'ink': {
      // Grown at a small fixed size and scaled smoothly: soft, like print.
      const smooth = ctx.imageSmoothingEnabled;
      const quality = ctx.imageSmoothingQuality;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(inkCanvas(spec.genome, tS), -pw / 2, -ph / 2, pw, ph);
      ctx.imageSmoothingEnabled = smooth;
      ctx.imageSmoothingQuality = quality;
      break;
    }
    case 'doodle':
      drawDoodle(ctx, spec.strokes, spec.strokeStyle, pw, ph, tS, seed);
      break;
    case 'text': {
      // Word puppets: bold characters that boil like doodles. A flipped
      // word moves to the mirrored position but keeps its letters legible,
      // so the mirror is undone around the (centred) glyph run.
      if (flip) ctx.scale(-1, 1);
      const text = spec.text || '?';
      const chars = [...text];
      const fontPx = Math.min(ph * 0.72, (pw * 1.55) / Math.max(1, chars.length));
      ctx.font = `800 ${fontPx}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = DOODLE_COLOR;
      const variant = Math.floor(tS * BOIL_FPS) % BOIL_VARIANTS;
      const widths = chars.map((c) => ctx.measureText(c).width);
      let x = -widths.reduce((a, b) => a + b, 0) / 2;
      chars.forEach((c, i) => {
        const jx = boilNoise(seed, variant, 1000 + i) * fontPx * 0.05;
        const jy = boilNoise(seed, variant, 2000 + i) * fontPx * 0.08;
        ctx.fillText(c, x + jx, jy);
        x += widths[i]!;
      });
      break;
    }
  }
}

/** Strokes are normalized to the puppet box; boiling lines cycle seeded
 *  jitter variants so a single drawing never sits still. */
function drawDoodle(
  ctx: Ctx2D,
  strokes: number[][],
  styles: { color: string; width: number }[] | undefined,
  pw: number,
  ph: number,
  tS: number,
  seed: number,
): void {
  const variant = Math.floor(tS * BOIL_FPS) % BOIL_VARIANTS;
  const amp = BOIL_AMP * Math.max(pw, ph);
  const base = Math.max(2, pw * 0.045);
  ctx.strokeStyle = DOODLE_COLOR;
  ctx.lineWidth = base;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let pointIndex = 0;
  for (let si = 0; si < strokes.length; si++) {
    const stroke = strokes[si]!;
    // A doodle drawn before colours existed has no styles at all, so it
    // keeps the one bone line it was drawn with.
    const style = styles?.[si];
    if (style) {
      ctx.strokeStyle = style.color;
      ctx.lineWidth = Math.max(1.5, base * style.width);
    }
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

/** A puppet on its own, centred and scaled to fit a square. Chips used to
 *  be one emoji per type, so a photo and a word were both a smiley and
 *  three doodles were three pencils (audit F12). */
export function drawPuppetThumbnail(
  ctx: Ctx2D,
  spec: PuppetSpec,
  image: ImageBitmap | undefined,
  size: number,
  seed: number,
): void {
  ctx.clearRect(0, 0, size, size);
  const pad = size * 0.12;
  const box = size - pad * 2;
  // Keep the puppet's own proportions inside the square.
  const ratio = spec.w / Math.max(1e-6, spec.h);
  const w = ratio >= 1 ? box : box * ratio;
  const h = ratio >= 1 ? box / ratio : box;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  const images: StageImages = new Map();
  if (image) images.set('thumb', image);
  drawContent(ctx, spec, 'thumb', w, h, images, 0, seed);
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
