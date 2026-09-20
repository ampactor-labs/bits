// Drawing tools, in the timeline's slot while the doodle mode is open.
//
// They sit below the stage rather than over it: a palette that covers the
// thing being drawn is worse than no palette. The transport above stays
// where it is, so the dock never changes shape.

import { IconButton } from '../../kit/IconButton';

export interface DoodleInk {
  color: string;
  /** Multiplier on the default stroke width. */
  width: number;
}

/** Bone on the dark stage, the two semantic accents, and black for
 *  drawing over a pale photo or backdrop. */
export const DOODLE_COLORS: { value: string; label: string }[] = [
  { value: '#ece5db', label: 'bone' },
  { value: '#f0883e', label: 'orange' },
  { value: '#58a6ff', label: 'blue' },
  { value: '#14110f', label: 'black' },
];

export const DOODLE_WIDTHS: { value: number; label: string }[] = [
  { value: 0.55, label: 'thin' },
  { value: 1, label: 'medium' },
  { value: 1.9, label: 'thick' },
];

export interface DoodleBarProps {
  ink: DoodleInk;
  erasing: boolean;
  strokeCount: number;
  onInk: (ink: DoodleInk) => void;
  onErasing: (on: boolean) => void;
  onCancel: () => void;
  onKeep: () => void;
}

export function DoodleBar({
  ink,
  erasing,
  strokeCount,
  onInk,
  onErasing,
  onCancel,
  onKeep,
}: DoodleBarProps) {
  return (
    <div className="doodlebar">
      <div className="doodle-tools" role="toolbar" aria-label="drawing">
        {DOODLE_COLORS.map((c) => (
          <button
            key={c.value}
            className={`swatch${!erasing && ink.color === c.value ? ' on' : ''}`}
            style={{ '--swatch': c.value } as React.CSSProperties}
            aria-label={c.label}
            aria-pressed={!erasing && ink.color === c.value}
            onClick={() => {
              onErasing(false);
              onInk({ ...ink, color: c.value });
            }}
          />
        ))}
        <span className="doodle-sep" aria-hidden="true" />
        {DOODLE_WIDTHS.map((w) => (
          <button
            key={w.label}
            className={`nib${ink.width === w.value ? ' on' : ''}`}
            aria-label={w.label}
            aria-pressed={ink.width === w.value}
            onClick={() => onInk({ ...ink, width: w.value })}
          >
            <span
              className="nib-dot"
              style={{ width: `${6 + w.value * 7}px`, height: `${6 + w.value * 7}px` }}
              aria-hidden="true"
            />
          </button>
        ))}
        <span className="doodle-sep" aria-hidden="true" />
        {/* Undo is the dock's, which means the last line while drawing.
            Nine 44px controls do not fit across a 390px phone. */}
        <IconButton
          icon="trash"
          label="rub a line out"
          className={erasing ? 'on' : ''}
          aria-pressed={erasing}
          onClick={() => onErasing(!erasing)}
        />
      </div>
      <div className="doodle-done">
        <button onClick={onCancel}>throw it away</button>
        <button className="primary" disabled={strokeCount === 0} onClick={onKeep}>
          put it on stage
        </button>
      </div>
    </div>
  );
}
