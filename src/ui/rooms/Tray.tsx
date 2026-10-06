// The Seed tray: growing an ink instead of painting one. Six live inks;
// tap the one you like and it moves to the front with five children of
// its own; hold two to cross them; roll for six strangers. Keep puts the
// front one to work: dressing the sheet the tray was opened for, or as a
// new sheet or backdrop of its own.
//
// Choosing by eye between a handful, generation after generation, is how
// a person steers something with thirty dials without touching one.

import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../kit/Sheet';
import { childSeed, cross, dice, mutate, type Genome } from '../../engine/ink';
import { inkCanvas } from '../../media/inkDraw';

export type KeepAs = 'dress' | 'sheet' | 'backdrop';

export interface TrayProps {
  /** The sheet being dressed, or null when casting a new one. */
  target: { name: string } | null;
  /** Where breeding starts: the target's current ink, if it has one. */
  start: Genome | null;
  onKeep: (genome: Genome, as: KeepAs) => void;
  onClose: () => void;
}

const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;
const HOLD_MS = 450;

function family(parent: Genome, seed: number, gen: number): Genome[] {
  return [parent, ...[1, 2, 3, 4, 5].map((i) => mutate(parent, childSeed(seed, gen, i)))];
}

export function Tray({ target, start, onKeep, onClose }: TrayProps) {
  const [seed] = useState(freshSeed);
  const [gen, setGen] = useState(0);
  const [tiles, setTiles] = useState<Genome[]>(() =>
    start ? family(start, seed, 0) : [0, 1, 2, 3, 4, 5].map((i) => dice(childSeed(seed, 0, i))),
  );
  const [marked, setMarked] = useState<number | null>(null);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const holdRef = useRef<{ timer: ReturnType<typeof setTimeout>; i: number; held: boolean } | null>(null);

  // The tiles move, at their own pace; this is a preview, so the wall
  // clock is fine here.
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = (performance.now() - t0) / 1000;
      tiles.forEach((g, i) => {
        const c = canvases.current[i];
        const ctx = c?.getContext('2d');
        if (!c || !ctx) return;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(inkCanvas(g, t), 0, 0, c.width, c.height);
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tiles]);

  const breed = (i: number) => {
    const next = gen + 1;
    setTiles(family(tiles[i]!, seed, next));
    setGen(next);
    setMarked(null);
  };

  const hold = (i: number) => {
    if (marked === null) {
      setMarked(i);
      return;
    }
    if (marked === i) {
      setMarked(null);
      return;
    }
    const next = gen + 1;
    setTiles(family(cross(tiles[marked]!, tiles[i]!, childSeed(seed, next, 0)), seed, next));
    setGen(next);
    setMarked(null);
  };

  const roll = () => {
    const next = gen + 1;
    setTiles([0, 1, 2, 3, 4, 5].map((i) => dice(childSeed(seed ^ 0xa5a5, next, i))));
    setGen(next);
    setMarked(null);
  };

  return (
    <Sheet title={target ? `ink for ${target.name}` : 'grow an ink'} onClose={onClose}>
      <p className="sheet-copy">
        {marked === null ? 'tap one to breed from it. hold two to cross them.' : 'now hold another to cross them.'}
      </p>
      <div className="ink-tray" role="group" aria-label="inks">
        {tiles.map((g, i) => (
          <button
            key={`${gen}-${i}`}
            className={`ink-tile${i === 0 ? ' front' : ''}${marked === i ? ' marked' : ''}`}
            aria-label={i === 0 ? 'the one you chose, tap to breed from it' : `ink ${i + 1}, tap to breed from it`}
            onPointerDown={() => {
              const timer = setTimeout(() => {
                if (holdRef.current) holdRef.current.held = true;
                hold(i);
              }, HOLD_MS);
              holdRef.current = { timer, i, held: false };
            }}
            onPointerUp={() => {
              const h = holdRef.current;
              holdRef.current = null;
              if (!h) return;
              clearTimeout(h.timer);
              if (!h.held && h.i === i) breed(i);
            }}
            onPointerLeave={() => {
              const h = holdRef.current;
              if (h && !h.held) clearTimeout(h.timer);
              holdRef.current = null;
            }}
          >
            <canvas
              width={96}
              height={96}
              ref={(el) => {
                canvases.current[i] = el;
              }}
            />
          </button>
        ))}
      </div>
      <div className="cta-row">
        <button onClick={roll}>roll</button>
        {target ? (
          <button className="primary" onClick={() => onKeep(tiles[0]!, 'dress')}>
            keep it
          </button>
        ) : (
          <>
            <button className="primary" onClick={() => onKeep(tiles[0]!, 'sheet')}>
              a new sheet
            </button>
            <button onClick={() => onKeep(tiles[0]!, 'backdrop')}>the backdrop</button>
          </>
        )}
      </div>
    </Sheet>
  );
}
