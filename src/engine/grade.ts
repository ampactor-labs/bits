// The grade: what the whole picture is printed on and with. A palette
// remaps every colour onto five chosen ones by brightness (a gradient map),
// and paper adds what printing on paper does: a faded, lifted black, a
// little misregistration between the inks, grain, and darkened edges.
//
// One definition for both renderers. The canvas renderer runs gradePixels
// on the frame; the GL renderer runs the same arithmetic in a shader, fed
// by the lookup table and grain tile built here, so they agree to within
// rounding. Grading never feeds back into the trails: renderers grade a
// copy of the frame, so a ghost is not re-graded every frame it survives.

export interface Palette {
  /** Five #rrggbb stops, darkest first. */
  colors: string[];
  /** 0..1, how far the picture moves onto the palette. */
  mix: number;
}

export interface Paper {
  /** 0..1 each. */
  edge: number;
  grain: number;
  fade: number;
  misreg: number;
}

export interface Grade {
  palette: Palette | null;
  paper: Paper | null;
  seed: number;
}

/** The paper the faded blacks lift toward. */
const PAPER_TONE: [number, number, number] = [0.93, 0.89, 0.81];

// --- palettes from colour harmonies ---------------------------------------

/** OKLCH to sRGB, clipped into gamut by pulling chroma in. */
export function oklch(L: number, C: number, hDeg: number): [number, number, number] {
  for (let c = C; c >= 0; c -= 0.005) {
    const h = (hDeg * Math.PI) / 180;
    const a = c * Math.cos(h);
    const b = c * Math.sin(h);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3;
    const m = m_ ** 3;
    const s = s_ ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    if (lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) {
      return lin.map((v) => {
        const x = Math.min(1, Math.max(0, v));
        return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
      }) as [number, number, number];
    }
  }
  return [L, L, L];
}

const toHex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;

export type Harmony = 'analogous' | 'complement' | 'triad' | 'duotone';

/** Five stops, dark to light, walking the hues a harmony picks. Even
 *  lightness steps in OKLCH, so the map keeps the picture's tonal shape. */
export function harmony(kind: Harmony, hue: number): string[] {
  const hues: number[] =
    kind === 'analogous'
      ? [hue - 40, hue - 20, hue, hue + 20, hue + 40]
      : kind === 'complement'
        ? [hue, hue, hue + 90, hue + 180, hue + 180]
        : kind === 'triad'
          ? [hue, hue + 120, hue + 240, hue + 120, hue]
          : [hue, hue, hue + 180, hue + 180, hue + 180];
  return hues.map((h, i) => toHex(oklch(0.18 + i * 0.18, i === 0 || i === 4 ? 0.05 : 0.14, ((h % 360) + 360) % 360)));
}

/** Paper the way the London film was printed, and a few of its cousins. */
export const PAPER_PRESETS: Record<string, Paper> = {
  newsprint: { edge: 0.4, grain: 0.55, fade: 0.35, misreg: 0.2 },
  risograph: { edge: 0.2, grain: 0.35, fade: 0.15, misreg: 0.7 },
  cardboard: { edge: 0.7, grain: 0.8, fade: 0.5, misreg: 0 },
  postcard: { edge: 0.55, grain: 0.2, fade: 0.25, misreg: 0.1 },
};

// --- the shared tables ----------------------------------------------------

const hexRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** 256 entries, RGBA: what each brightness becomes, palette and fade
 *  together. The GL renderer uploads this very array. */
export function gradeLut(grade: Grade): Uint8Array {
  const out = new Uint8Array(256 * 4);
  const stops = grade.palette?.colors.map(hexRgb) ?? null;
  for (let i = 0; i < 256; i++) {
    const L = i / 255;
    let c: [number, number, number] = [L, L, L];
    if (stops) {
      const f = L * (stops.length - 1);
      const k = Math.min(stops.length - 2, Math.floor(f));
      const u = f - k;
      const a = stops[k]!;
      const b = stops[k + 1]!;
      c = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
    out[i * 4] = Math.round(c[0] * 255);
    out[i * 4 + 1] = Math.round(c[1] * 255);
    out[i * 4 + 2] = Math.round(c[2] * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

export const GRAIN_TILE = 128;

/** A tile of seeded grain, 0..255, shared by both renderers. */
export function grainTile(seed: number): Uint8Array {
  const out = new Uint8Array(GRAIN_TILE * GRAIN_TILE);
  let a = (seed ^ 0x6a09e667) >>> 0;
  for (let i = 0; i < out.length; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 255;
  }
  return out;
}

/** Grain moves on twos, like the film it imitates: a new offset into the
 *  tile every twelfth of a second. */
export function grainOffset(seed: number, t: number): [number, number] {
  const k = Math.floor(t * 12);
  const h = Math.imul((k + 1) ^ seed, 0x9e3779b1) >>> 0;
  return [h % GRAIN_TILE, (h >>> 8) % GRAIN_TILE];
}

/** Everything per-frame a renderer needs, in pixels. */
export interface GradeParams {
  lut: Uint8Array;
  mix: number;
  fade: number;
  grain: number;
  edge: number;
  /** Misregistration shift in pixels. */
  shift: number;
  grainAt: [number, number];
}

export function gradeParams(grade: Grade, W: number, t: number): GradeParams {
  const paper = grade.paper;
  return {
    lut: gradeLut(grade),
    mix: grade.palette ? grade.palette.mix : 0,
    fade: paper ? paper.fade : 0,
    grain: paper ? paper.grain : 0,
    edge: paper ? paper.edge : 0,
    shift: paper ? Math.round(paper.misreg * W * 0.004) : 0,
    grainAt: grainOffset(grade.seed, t),
  };
}

/** Grades `src` into `dst`, both W×H RGBA. Pure arithmetic, the shader's
 *  twin: per pixel, misregistered inks, a palette by brightness, a lift
 *  toward paper, grain, and darkened edges. */
export function gradePixels(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  W: number,
  H: number,
  p: GradeParams,
  grain: Uint8Array,
): void {
  const { lut, mix, fade, edge, shift } = p;
  const lift = fade * 0.4;
  const g = p.grain * 0.18;
  for (let y = 0; y < H; y++) {
    const ny = (y + 0.5) / H - 0.5;
    const yUp = Math.max(0, y - shift);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // Each ink lands a little off the others.
      const ri = (y * W + Math.min(W - 1, x + shift)) * 4;
      const bi = (yUp * W + Math.max(0, x - shift)) * 4;
      let r = src[ri]! / 255;
      let gg = src[i + 1]! / 255;
      let b = src[bi + 2]! / 255;
      if (mix > 0) {
        const L = Math.min(255, Math.round((0.2126 * r + 0.7152 * gg + 0.0722 * b) * 255)) * 4;
        r += (lut[L]! / 255 - r) * mix;
        gg += (lut[L + 1]! / 255 - gg) * mix;
        b += (lut[L + 2]! / 255 - b) * mix;
      }
      if (lift > 0) {
        // Darks lift toward the paper; lights are already paper.
        r += (PAPER_TONE[0] - r) * lift * (1 - r);
        gg += (PAPER_TONE[1] - gg) * lift * (1 - gg);
        b += (PAPER_TONE[2] - b) * lift * (1 - b);
      }
      if (g > 0) {
        const n = grain[((y + p.grainAt[1]) % GRAIN_TILE) * GRAIN_TILE + ((x + p.grainAt[0]) % GRAIN_TILE)]! / 255 - 0.5;
        r += n * g;
        gg += n * g;
        b += n * g;
      }
      if (edge > 0) {
        const nx = (x + 0.5) / W - 0.5;
        const d = Math.sqrt(nx * nx + ny * ny) * 2;
        const v = 1 - edge * 0.55 * Math.min(1, Math.max(0, (d - 0.55) / 0.75));
        r *= v;
        gg *= v;
        b *= v;
      }
      dst[i] = r * 255;
      dst[i + 1] = gg * 255;
      dst[i + 2] = b * 255;
      dst[i + 3] = 255;
    }
  }
}
