// The WebGL2 stage renderer. Canvas2D still draws each sheet: the same
// rasteriser the canvas renderer uses (drawSheetContent) draws a sheet into
// a sprite in its own frame, and this places the sprite on the stage. What
// moves to the GPU is everything that happens between sheets and to whole
// sheets: placement, squash and lean, the camera, trails, shadows, fog,
// fade and colour, and the mirrored edge a moved backdrop shows. A sheet
// that does not change (a photo, a backdrop, a doodle between boil steps)
// keeps its sprite, so a stage-sized backdrop is uploaded once instead of
// redrawn every frame.
//
// It is held to the canvas renderer by the render proof (runGlParity):
// same frames, compared pixel by pixel within a small resampling
// tolerance.

import { viewOf, magnification, type View } from '../../engine/camera';
import type { Frame, LayerFrame } from '../../engine/frame';
import { fogAmount, shadowGap, shadowOffset } from '../../engine/look';
import {
  STAGE_BG,
  drawSheetContent,
  placementOf,
  sheetContentKey,
  sheetMargin,
  sheetSize,
  trailFor,
  type StageImages,
} from '../../media/stageDraw';

const VERT = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_mode;          // 0 sheet, 1 shadow, 2 solid fill
uniform float u_alpha;
uniform mat3 u_hue;
uniform vec4 u_fog;          // rgb, amount
uniform vec4 u_fill;         // premultiplied
uniform vec2 u_blur;         // shadow blur, in texture coords per tap
out vec4 outColor;
void main() {
  if (u_mode == 2) {
    outColor = u_fill;
    return;
  }
  if (u_mode == 1) {
    // A soft silhouette: the sprite's coverage, blurred by a 5x5 kernel
    // whose taps are spaced by the shadow's own blur.
    float a = 0.0;
    float wsum = 0.0;
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        float w = exp(-0.5 * float(i * i + j * j) / 1.44);
        a += texture(u_tex, v_uv + vec2(float(i), float(j)) * u_blur).a * w;
        wsum += w;
      }
    }
    outColor = vec4(0.0, 0.0, 0.0, a / wsum) * u_fill.a;
    return;
  }
  vec4 c = texture(u_tex, v_uv);
  vec3 rgb = clamp(u_hue * c.rgb, 0.0, c.a);
  rgb = mix(rgb, u_fog.rgb * c.a, u_fog.a);
  outColor = vec4(rgb, c.a) * u_alpha;
}`;

const IDENTITY_HUE = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** The CSS hue-rotate matrix, the one the canvas renderer's filter uses,
 *  column-major for GLSL. */
function hueMatrix(deg: number): Float32Array {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const m = [
    0.213 + c * 0.787 - s * 0.213,
    0.715 - c * 0.715 - s * 0.715,
    0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143,
    0.715 + c * 0.285 + s * 0.14,
    0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787,
    0.715 - c * 0.715 + s * 0.715,
    0.072 + c * 0.928 + s * 0.072,
  ];
  // Row-major above; GLSL wants columns.
  return new Float32Array([m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!]);
}

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const BG = hex(STAGE_BG);

type Canvasish = HTMLCanvasElement | OffscreenCanvas;

interface Sprite {
  tex: WebGLTexture;
  /** Sprite size in texels, and texels per sheet pixel. */
  w: number;
  h: number;
  res: number;
  /** Sheet pixels from the sprite's centre to its edge. */
  halfW: number;
  halfH: number;
  bytes: number;
  used: number;
}

export interface GlRenderer {
  draw(W: number, H: number, frame: Frame, images: StageImages): void;
  reset(): void;
  /** True once the context is gone; the caller falls back to Canvas2D. */
  readonly lost: boolean;
  /** Reads the drawn frame top row first, for the parity proof. */
  readPixels(W: number, H: number): Uint8Array;
  dispose(): void;
}

/** Null when this canvas cannot give a WebGL2 context. */
export function createGlRenderer(canvas: Canvasish): GlRenderer | null {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    premultipliedAlpha: true,
    // Trails are the previous frame showing through, so it must survive.
    preserveDrawingBuffer: true,
  }) as WebGL2RenderingContext | null;
  if (!gl) return null;

  let lost = false;
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
  };
  canvas.addEventListener('webglcontextlost', onLost as EventListener);

  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(`gl shader: ${gl.getShaderInfoLog(sh) ?? '?'}`);
    }
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`gl link: ${gl.getProgramInfoLog(prog) ?? '?'}`);
  }
  gl.useProgram(prog);
  const loc = {
    pos: gl.getAttribLocation(prog, 'a_pos'),
    uv: gl.getAttribLocation(prog, 'a_uv'),
    tex: gl.getUniformLocation(prog, 'u_tex'),
    mode: gl.getUniformLocation(prog, 'u_mode'),
    alpha: gl.getUniformLocation(prog, 'u_alpha'),
    hue: gl.getUniformLocation(prog, 'u_hue'),
    fog: gl.getUniformLocation(prog, 'u_fog'),
    fill: gl.getUniformLocation(prog, 'u_fill'),
    blur: gl.getUniformLocation(prog, 'u_blur'),
  };
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc.pos);
  gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(loc.uv);
  gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 16, 8);
  gl.uniform1i(loc.tex, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

  // Sprites drawn by Canvas2D. A cached one per content key; a scratch one
  // per sheet for content that changes every frame.
  const raster = new OffscreenCanvas(1, 1).getContext('2d')!;
  const cache = new Map<string, Sprite>();
  const scratch = new Map<string, Sprite>();
  const CACHE_BYTES = 48 * 1024 * 1024;
  let cacheBytes = 0;
  let clock = 0;
  let lastImages: StageImages | null = null;
  let lastT: number | null = null;

  const freeSprite = (s: Sprite) => gl.deleteTexture(s.tex);
  const evict = () => {
    while (cacheBytes > CACHE_BYTES && cache.size > 0) {
      let oldestKey = '';
      let oldest = Infinity;
      for (const [k, s] of cache) {
        if (s.used < oldest) {
          oldest = s.used;
          oldestKey = k;
        }
      }
      const s = cache.get(oldestKey)!;
      cacheBytes -= s.bytes;
      freeSprite(s);
      cache.delete(oldestKey);
    }
  };

  /** Draws a sheet's content onto the raster canvas and uploads it. */
  const rasterise = (
    layer: LayerFrame,
    W: number,
    H: number,
    frame: Frame,
    images: StageImages,
    res: number,
    margin: number,
    into: Sprite | null,
  ): Sprite => {
    const { pw, ph } = sheetSize(layer, W, H);
    const halfW = pw / 2 + margin;
    const halfH = ph / 2 + margin;
    const w = Math.max(1, Math.min(4096, Math.ceil(halfW * 2 * res)));
    const h = Math.max(1, Math.min(4096, Math.ceil(halfH * 2 * res)));
    if (raster.canvas.width !== w || raster.canvas.height !== h) {
      raster.canvas.width = w;
      raster.canvas.height = h;
    } else {
      raster.setTransform(1, 0, 0, 1, 0, 0);
      raster.clearRect(0, 0, w, h);
    }
    raster.setTransform(res, 0, 0, res, w / 2, h / 2);
    drawSheetContent(raster, layer, W, H, images, frame.t, frame.seed, false);
    const tex = into?.tex ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, raster.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return { tex, w, h, res, halfW: w / 2 / res, halfH: h / 2 / res, bytes: w * h * 4, used: clock };
  };

  /** Which sprite shows this sheet now. */
  const spriteOf = (layer: LayerFrame, W: number, H: number, frame: Frame, images: StageImages, apron: boolean) => {
    // Enough texels that a zoomed or bounced sheet stays sharp; stepped so
    // a pulsing scale does not re-key the cache every frame.
    const zoom = magnification(frame.camera, layer.depth) * Math.abs(layer.mods.scaleMul);
    const res = Math.min(2.5, Math.max(1, Math.ceil(zoom * 4) / 4));
    // A backdrop that mirrors at its edges must end exactly at its box.
    const margin = apron ? 0 : sheetMargin(layer, W, H);
    const key = sheetContentKey(layer, W, H, frame.t);
    if (key !== null) {
      const full = `${key}|${res}|${margin.toFixed(1)}`;
      const hit = cache.get(full);
      if (hit) {
        hit.used = clock;
        return hit;
      }
      const made = rasterise(layer, W, H, frame, images, res, margin, null);
      cache.set(full, made);
      cacheBytes += made.bytes;
      evict();
      return made;
    }
    const id = layer.puppet.id;
    const made = rasterise(layer, W, H, frame, images, res, margin, scratch.get(id) ?? null);
    scratch.set(id, made);
    return made;
  };

  const verts = new Float32Array(16);
  /** One quad: sheet-frame corners through placement and camera to clip
   *  space. `uv` spans the sprite; past 0..1 it mirrors (the apron). */
  const quad = (
    W: number,
    H: number,
    place: { x: number; y: number; rot: number; sx: number; sy: number },
    view: View | null,
    corners: [number, number][],
    uvs: [number, number][],
    shift: [number, number],
  ) => {
    const c = Math.cos(place.rot);
    const s = Math.sin(place.rot);
    corners.forEach(([lx, ly], i) => {
      const ax = lx * place.sx;
      const ay = ly * place.sy;
      let x = place.x + ax * c - ay * s;
      let y = place.y + ax * s + ay * c;
      if (view) {
        const vx = view.a * x + view.c * y + view.e;
        const vy = view.b * x + view.d * y + view.f;
        x = vx;
        y = vy;
      }
      x += shift[0];
      y += shift[1];
      verts[i * 4] = (x / W) * 2 - 1;
      verts[i * 4 + 1] = 1 - (y / H) * 2;
      verts[i * 4 + 2] = uvs[i]![0];
      verts[i * 4 + 3] = uvs[i]![1];
    });
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const fill = (W: number, H: number, rgba: [number, number, number, number]) => {
    gl.uniform1i(loc.mode, 2);
    gl.uniform4f(loc.fill, rgba[0] * rgba[3], rgba[1] * rgba[3], rgba[2] * rgba[3], rgba[3]);
    quad(W, H, { x: 0, y: 0, rot: 0, sx: 1, sy: 1 }, null, [[0, 0], [W, 0], [0, H], [W, H]], [[0, 0], [1, 0], [0, 1], [1, 1]], [0, 0]);
  };

  return {
    get lost() {
      return lost || gl.isContextLost();
    },
    reset() {
      lastT = null;
    },
    draw(W, H, frame, images) {
      if (lost) return;
      clock++;
      // New images (a photo replaced, a bit reopened): nothing cached can
      // be trusted.
      if (images !== lastImages) {
        for (const s of cache.values()) freeSprite(s);
        for (const s of scratch.values()) freeSprite(s);
        cache.clear();
        scratch.clear();
        cacheBytes = 0;
        lastImages = images;
      }
      gl.viewport(0, 0, W, H);
      const keep = trailFor(frame, lastT);
      lastT = frame.t;
      if (keep > 0) fill(W, H, [BG[0], BG[1], BG[2], 1 - keep]);
      else {
        gl.clearColor(BG[0], BG[1], BG[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      const look = frame.look;
      gl.activeTexture(gl.TEXTURE0);
      frame.layers.forEach((layer, i) => {
        const place = placementOf(layer, W, H);
        if (!place) return;
        const view = viewOf(frame.camera, layer.depth, W, H);
        const p = layer.puppet;
        const apron =
          !!view && p.back && p.spec.type === 'cutout' && p.spec.fit === 'cover' && images.has(p.id);
        const sprite = spriteOf(layer, W, H, frame, images, apron);
        gl.bindTexture(gl.TEXTURE_2D, sprite.tex);
        const wrap = apron ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        // The sheet's mirror is inside the sprite already.
        const hx = sprite.halfW;
        const hy = sprite.halfH;
        const span = apron ? 3 : 1;
        const corners: [number, number][] = [
          [-hx * span, -hy * span],
          [hx * span, -hy * span],
          [-hx * span, hy * span],
          [hx * span, hy * span],
        ];
        const lo = apron ? -1 : 0;
        const hi = apron ? 2 : 1;
        const uvs: [number, number][] = [
          [lo, lo],
          [hi, lo],
          [lo, hi],
          [hi, hi],
        ];
        if (look && look.shadow > 0 && !p.back) {
          const off = shadowOffset(look.shadow, shadowGap(frame.layers, i, frame.camera, W, H), W);
          // Canvas shadow blur is twice the gaussian's sigma, in pixels.
          const sigma = off.blur / 2;
          gl.uniform1i(loc.mode, 1);
          gl.uniform4f(loc.fill, 0, 0, 0, 0.55 * look.shadow * (layer.mods.alpha ?? 1));
          gl.uniform2f(loc.blur, (sigma * sprite.res) / 1.2 / sprite.w, (sigma * sprite.res) / 1.2 / sprite.h);
          quad(W, H, place, view, corners, uvs, [off.dx, off.dy]);
        }
        gl.uniform1i(loc.mode, 0);
        gl.uniform1f(loc.alpha, layer.mods.alpha ?? 1);
        gl.uniformMatrix3fv(loc.hue, false, layer.mods.hue ? hueMatrix(layer.mods.hue) : IDENTITY_HUE);
        const haze = look && look.fog > 0 ? fogAmount(look.fog, layer.depth) : 0;
        const fog = look ? hex(look.fogColor) : BG;
        gl.uniform4f(loc.fog, fog[0], fog[1], fog[2], haze);
        quad(W, H, place, view, corners, uvs, [0, 0]);
      });
    },
    readPixels(W, H) {
      const out = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
      // GL rows run bottom up.
      const flipped = new Uint8Array(out.length);
      const row = W * 4;
      for (let y = 0; y < H; y++) flipped.set(out.subarray((H - 1 - y) * row, (H - y) * row), y * row);
      return flipped;
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost as EventListener);
      for (const s of cache.values()) freeSprite(s);
      for (const s of scratch.values()) freeSprite(s);
      cache.clear();
      scratch.clear();
    },
  };
}
