// Compiles a recipe's event log into a deterministic playback program:
// which source spans play, at what rate, with what punch-in, in what order.
// Everything downstream (jam preview, offline render) runs this one program,
// which is what makes preview and export agree.

import { effectiveTime, type Project, type RecipeEvent, type ZoomEvent } from './recipe';

export interface Zoom {
  cx: number;
  cy: number;
  scale: number;
}

export const IDENTITY_ZOOM: Zoom = { cx: 0.5, cy: 0.5, scale: 1 };

export interface ProgramSegment {
  srcStart: number;
  srcEnd: number;
  rate: number;
  outStart: number;
  outDuration: number;
}

export interface Program {
  segments: ProgramSegment[];
  outputDurationS: number;
  /** CUT marker times (source seconds) that landed inside kept footage. */
  cuts: number[];
  /** rate-1 segments, usable for audio passthrough at render time. */
  audioPassSegments: ProgramSegment[];
}

export const MIN_RATE = 0.05;
export const MAX_RATE = 10;

interface Span {
  start: number;
  end: number;
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

function complement(spans: Span[], durationS: number): Span[] {
  const out: Span[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) out.push({ start: cursor, end: Math.min(s.start, durationS) });
    cursor = Math.max(cursor, s.end);
    if (cursor >= durationS) break;
  }
  if (cursor < durationS) out.push({ start: cursor, end: durationS });
  return out.filter((s) => s.end - s.start > 1e-9);
}

const clampRate = (r: number) => Math.min(MAX_RATE, Math.max(MIN_RATE, r));

export function compileProgram(project: Project, sourceDurationS: number): Program {
  const events = project.events
    .map((e) => ({ e, t: clampTime(effectiveTime(e), sourceDurationS) }))
    .sort((a, b) => a.t - b.t);

  const skips = mergeSpans(
    events
      .filter((x): x is { e: RecipeEvent & { kind: 'SKIP' }; t: number } => x.e.kind === 'SKIP')
      .map((x) => ({ start: x.t, end: clampTime(x.e.endAt, sourceDurationS) }))
      .filter((s) => s.end - s.start > 1e-9),
  );
  const kept = complement(skips, sourceDurationS);

  // Piecewise-constant rate from SPEED edges; rate 1 before the first edge.
  const edges = events.filter((x) => x.e.kind === 'SPEED');
  const rateAt = (srcT: number): number => {
    let rate = 1;
    for (const x of edges) {
      if (x.t <= srcT) rate = clampRate((x.e as RecipeEvent & { kind: 'SPEED' }).rate);
      else break;
    }
    return rate;
  };
  const rateBreaks = edges.map((x) => x.t);

  // Slice kept spans at rate edges so every segment has one constant rate.
  const segments: ProgramSegment[] = [];
  let outCursor = 0;
  for (const span of kept) {
    const breaks = [span.start, ...rateBreaks.filter((b) => b > span.start && b < span.end), span.end];
    for (let i = 0; i < breaks.length - 1; i++) {
      const srcStart = breaks[i]!;
      const srcEnd = breaks[i + 1]!;
      const rate = rateAt(srcStart);
      const outDuration = (srcEnd - srcStart) / rate;
      segments.push({ srcStart, srcEnd, rate, outStart: outCursor, outDuration });
      outCursor += outDuration;
    }
  }

  const cuts = events
    .filter((x) => x.e.kind === 'CUT')
    .map((x) => x.t)
    .filter((t) => kept.some((s) => t >= s.start && t <= s.end));

  return {
    segments,
    outputDurationS: outCursor,
    cuts,
    audioPassSegments: segments.filter((s) => s.rate === 1),
  };
}

function clampTime(t: number, durationS: number): number {
  return Math.min(Math.max(0, t), durationS);
}

/** Maps an output time to the source time the program shows at that moment. */
export function outToSrc(program: Program, outT: number): number {
  const segs = program.segments;
  if (segs.length === 0) return 0;
  const first = segs[0]!;
  if (outT <= 0) return first.srcStart;
  for (const s of segs) {
    if (outT < s.outStart + s.outDuration) {
      return s.srcStart + (outT - s.outStart) * s.rate;
    }
  }
  const last = segs[segs.length - 1]!;
  return last.srcEnd;
}

/** Maps a source time to output time; skipped source times snap to the next kept moment. */
export function srcToOut(program: Program, srcT: number): number {
  const segs = program.segments;
  if (segs.length === 0) return 0;
  for (const s of segs) {
    if (srcT < s.srcStart) return s.outStart;
    if (srcT <= s.srcEnd) return s.outStart + (srcT - s.srcStart) / s.rate;
  }
  return program.outputDurationS;
}

/** Piecewise-linear zoom automation over source time: hold first backward,
 *  hold last forward, lerp between samples. */
export function zoomAtSrc(project: Project, srcT: number): Zoom {
  const samples = project.events
    .filter((e): e is ZoomEvent => e.kind === 'ZOOM')
    .map((e) => ({ t: effectiveTime(e), cx: e.cx, cy: e.cy, scale: e.scale }))
    .sort((a, b) => a.t - b.t);
  if (samples.length === 0) return IDENTITY_ZOOM;
  const first = samples[0]!;
  if (srcT <= first.t) return { cx: first.cx, cy: first.cy, scale: first.scale };
  const last = samples[samples.length - 1]!;
  if (srcT >= last.t) return { cx: last.cx, cy: last.cy, scale: last.scale };
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    if (srcT >= a.t && srcT <= b.t) {
      const f = b.t === a.t ? 0 : (srcT - a.t) / (b.t - a.t);
      return {
        cx: a.cx + (b.cx - a.cx) * f,
        cy: a.cy + (b.cy - a.cy) * f,
        scale: a.scale + (b.scale - a.scale) * f,
      };
    }
  }
  return IDENTITY_ZOOM;
}

/** Rewind-and-re-perform: drop events after tSrc; a SKIP straddling tSrc keeps
 *  its performed head and is clamped to end at tSrc. */
export function truncateAfter(project: Project, tSrc: number): Project {
  const events = project.events.flatMap((e): RecipeEvent[] => {
    const t = effectiveTime(e);
    if (t > tSrc) return [];
    if (e.kind === 'SKIP' && e.endAt > tSrc) return [{ ...e, endAt: tSrc }];
    return [e];
  });
  return { ...project, events };
}
