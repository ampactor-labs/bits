// Ready-made puppets: the same doodle strokes a finger would draw, so a
// sticker behaves exactly like something you drew — it boils, it snips, it
// takes a mouth. Nothing here is a special case in the engine.
//
// Strokes are in puppet-local box coords (0..1), the shape's own frame.

import type { PuppetSpec } from '../../engine/recipe';

interface Sticker {
  name: string;
  /** Box aspect on stage, as a fraction of stage width and height. */
  w: number;
  h: number;
  strokes: number[][];
}

const ring = (cx: number, cy: number, r: number, steps = 24, squash = 1): number[] => {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r * squash);
  }
  return out;
};

const star = (points = 5): number[] => {
  const out: number[] = [];
  for (let i = 0; i <= points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 0.48 : 0.2;
    out.push(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r);
  }
  return out;
};

export const STICKERS: Sticker[] = [
  { name: 'a star', w: 0.3, h: 0.17, strokes: [star()] },
  {
    name: 'a heart',
    w: 0.3, h: 0.17,
    strokes: [
      [
        0.5, 0.92, 0.12, 0.52, 0.12, 0.3, 0.3, 0.16, 0.5, 0.32, 0.7, 0.16, 0.88, 0.3, 0.88, 0.52,
        0.5, 0.92,
      ],
    ],
  },
  {
    name: 'a cloud',
    w: 0.38, h: 0.13,
    strokes: [ring(0.32, 0.6, 0.24, 18), ring(0.55, 0.45, 0.3, 18), ring(0.76, 0.62, 0.2, 18)],
  },
  {
    name: 'a speech bubble',
    w: 0.36, h: 0.16,
    strokes: [
      [0.08, 0.1, 0.92, 0.1, 0.92, 0.66, 0.42, 0.66, 0.22, 0.95, 0.26, 0.66, 0.08, 0.66, 0.08, 0.1],
    ],
  },
  {
    name: 'an arrow',
    w: 0.32, h: 0.1,
    strokes: [
      [0.04, 0.5, 0.86, 0.5],
      [0.62, 0.16, 0.96, 0.5, 0.62, 0.84],
    ],
  },
  {
    name: 'a blob',
    w: 0.26, h: 0.17,
    strokes: [
      [
        0.5, 0.05, 0.85, 0.2, 0.96, 0.55, 0.78, 0.9, 0.42, 0.97, 0.12, 0.76, 0.06, 0.38, 0.22, 0.13,
        0.5, 0.05,
      ],
    ],
  },
];

export const stickerSpec = (index: number): PuppetSpec => {
  const s = STICKERS[index % STICKERS.length]!;
  return { type: 'doodle', strokes: s.strokes, w: s.w, h: s.h, name: s.name };
};
