// The director's view: the stage seen from the side. Each sheet is a dot
// at its place across the stage and its depth, nearest at the bottom by
// the lens. Dragging a dot up pushes the sheet back; letting go records
// one CAST. It is how depth stops being a number in a menu and becomes a
// place you can see sheets standing in.

import { useRef, useState } from 'react';
import { MAX_DEPTH, MIN_DEPTH } from '../../engine/recipe';
import type { ShowPuppet } from '../../engine/show';
import { IconButton } from '../../kit/IconButton';

export interface DirectorViewProps {
  cast: ShowPuppet[];
  selectedId: string | null;
  name: (p: ShowPuppet) => string;
  onDepth: (p: ShowPuppet, depth: number) => void;
  onClose: () => void;
}

const W = 132;
const H = 176;
const PAD = 16;

/** Depth to height and back. Logarithmic: the difference between the
 *  stage and a step back matters far more than between far and further. */
const span = Math.log1p(MAX_DEPTH - MIN_DEPTH);
const yOf = (depth: number) =>
  H - PAD - (Math.log1p(depth - MIN_DEPTH) / span) * (H - 2 * PAD);
const depthOf = (y: number) => {
  const u = Math.min(1, Math.max(0, (H - PAD - y) / (H - 2 * PAD)));
  // Round to a quarter so a drag lands on numbers a person could repeat.
  return Math.round((Math.expm1(u * span) + MIN_DEPTH) * 4) / 4;
};

export function DirectorView({ cast, selectedId, name, onDepth, onClose }: DirectorViewProps) {
  const [drag, setDrag] = useState<{ id: string; depth: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const yAt = (clientY: number) => clientY - (boxRef.current?.getBoundingClientRect().top ?? 0);

  return (
    <div
      ref={boxRef}
      className="director"
      role="group"
      aria-label="the stage from the side"
      style={{ width: W, height: H }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* The stage plane, where depth 0 sits. */}
      <span className="director-plane" style={{ top: yOf(0) }} aria-hidden="true" />
      <span className="director-lens" aria-hidden="true" />
      {cast.map((p) => {
        const depth = drag?.id === p.id ? drag.depth : p.depth;
        return (
          <button
            key={p.id}
            className={`director-dot${p.id === selectedId ? ' on' : ''}${p.back ? ' back' : ''}`}
            style={{ left: PAD + Math.min(1, Math.max(0, p.home.x)) * (W - 2 * PAD), top: yOf(depth) }}
            aria-label={`${name(p)}, depth ${depth}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag({ id: p.id, depth: p.depth });
            }}
            onPointerMove={(e) => {
              if (drag?.id === p.id) setDrag({ id: p.id, depth: depthOf(yAt(e.clientY)) });
            }}
            onPointerUp={() => {
              if (drag?.id === p.id && drag.depth !== p.depth) onDepth(p, drag.depth);
              setDrag(null);
            }}
            onPointerCancel={() => setDrag(null)}
          />
        );
      })}
      <IconButton icon="close" label="close the side view" size={16} className="director-close" onClick={onClose} />
    </div>
  );
}
