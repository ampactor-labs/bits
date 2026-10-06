// The Shots room: the show's cuts, laid out as the shots between them. A
// card per shot with a still of how it opens; pick one to frame it (wide,
// everyone in, close on a sheet), slide its cut a beat either way, or take
// the cut out. "cut here" starts a new shot at the playhead, on the beat
// when one is about to land.
//
// Nothing here is new grammar: a shot is the stretch after a CUT, so every
// change is a REMOVE and a CUT, and old players see the same film.

import { Sheet } from '../../kit/Sheet';
import type { CameraPose } from '../../engine/camera';
import type { Shot } from '../../engine/shots';

export interface Framing {
  id: string;
  label: string;
  /** Close on one sheet: the label is the sheet's name. */
  close?: boolean;
  pose: CameraPose;
}

export interface ShotsRoomProps {
  shots: Shot[];
  /** A still of each shot's opening, by index; null while it is drawn. */
  stills: (string | null)[];
  aspect: '9:16' | '16:9';
  selected: number;
  /** The framings on offer for the selected shot, and which one it has. */
  framings: Framing[];
  current: string | null;
  /** Where "cut here" would land, or null when it cannot. */
  cutHereAt: number | null;
  canEarlier: boolean;
  canLater: boolean;
  onSelect: (index: number) => void;
  onFrame: (framing: Framing) => void;
  onMove: (dir: -1 | 1) => void;
  onTakeOut: () => void;
  onCutHere: () => void;
  onClose: () => void;
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

export function ShotsRoom(props: ShotsRoomProps) {
  const { shots, stills, aspect, selected, framings, current } = props;
  const shot = shots[selected];
  return (
    <Sheet title="shots" onClose={props.onClose}>
      <div
        className={`shot-strip ${aspect === '16:9' ? 'wide' : 'tall'}`}
        role="group"
        aria-label="shots"
      >
        {shots.map((s, i) => (
          <button
            key={`${i}-${s.from}`}
            className={`shot-card${i === selected ? ' on' : ''}`}
            aria-pressed={i === selected}
            aria-label={`shot ${i + 1}, from ${fmt(s.from)}`}
            onClick={() => props.onSelect(i)}
          >
            {stills[i] ? <img src={stills[i]!} alt="" /> : <span className="shot-still-wait" />}
            <span className="shot-card-label">
              {i + 1} · {fmt(s.from)}
            </span>
          </button>
        ))}
      </div>
      {shot && (
        <>
          {(['wide', 'close'] as const).map((group) => (
            <div key={group} className="sheet-row">
              <span className="sheet-row-label">{group === 'wide' ? 'framing' : 'close on'}</span>
              <span
                className="shot-framings"
                role="group"
                aria-label={group === 'wide' ? 'framing' : 'close on'}
              >
                {framings
                  .filter((f) => (f.close ? 'close' : 'wide') === group)
                  .map((f) => (
                    <button
                      key={f.id}
                      className={`pill${current === f.id ? ' on' : ''}`}
                      aria-pressed={current === f.id}
                      aria-label={f.close ? `close on ${f.label}` : f.label}
                      onClick={() => props.onFrame(f)}
                    >
                      {f.label}
                    </button>
                  ))}
              </span>
            </div>
          ))}
          {shot.cut && (
            <div className="sheet-row shot-timing">
              <span className="sheet-row-label">
                {selected === 0 ? 'opens framed' : `cuts in at ${fmt(shot.from)}`}
              </span>
              <span className="shot-timing-pills">
                {selected > 0 && (
                  <>
                    <button
                      className="pill"
                      disabled={!props.canEarlier}
                      onClick={() => props.onMove(-1)}
                    >
                      ◀ a beat
                    </button>
                    <button
                      className="pill"
                      disabled={!props.canLater}
                      onClick={() => props.onMove(1)}
                    >
                      a beat ▶
                    </button>
                  </>
                )}
                <button className="pill" onClick={props.onTakeOut}>
                  {selected === 0 ? 'back to wide' : 'take the cut out'}
                </button>
              </span>
            </div>
          )}
        </>
      )}
      <div className="cta-row">
        <button className="primary" disabled={props.cutHereAt === null} onClick={props.onCutHere}>
          {props.cutHereAt === null ? 'cut here' : `cut here, at ${fmt(props.cutHereAt)}`}
        </button>
      </div>
    </Sheet>
  );
}
