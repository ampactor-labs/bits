// The mic take, while it is happening. It used to be the word "recording…"
// and a stop button: no level, so a muted mic looked identical to a live
// one, and no clock, so the cap arrived out of nowhere (audit F29).

import type { RefObject } from 'react';
import { Meter } from '../../kit/Controls';

export interface RecordPanelProps {
  mode: 'replace' | 'extend';
  /** Whose take this is, when it belongs to one puppet rather than the bit. */
  voiceFor: string | null;
  capS: number;
  /** The frame loop writes these; nothing here re-renders per frame. */
  meterRef: RefObject<HTMLDivElement | null>;
  meterFillRef: RefObject<HTMLDivElement | null>;
  elapsedRef: RefObject<HTMLSpanElement | null>;
  onDone: () => void;
  onCancel: () => void;
}

export const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function RecordPanel({
  mode,
  voiceFor,
  capS,
  meterRef,
  meterFillRef,
  elapsedRef,
  onDone,
  onCancel,
}: RecordPanelProps) {
  return (
    <div className="stage-cta record-panel" onPointerDown={(e) => e.stopPropagation()}>
      <p className="live">
        {voiceFor ? `say ${voiceFor}'s lines` : mode === 'extend' ? 'keep going' : 'do the bit'}
      </p>
      {voiceFor && <span className="status">the bit is playing. headphones help.</span>}
      <Meter level={0} label="how loud you are" nodeRef={meterRef} fillRef={meterFillRef} />
      <span className="rec-clock">
        <span ref={elapsedRef}>0:00</span>
        <span className="times-sep"> / </span>
        <span className="times-total">{clock(capS)}</span>
      </span>
      <div className="cta-row">
        <button className="primary" onClick={onDone}>
          done
        </button>
        <button onClick={onCancel}>throw it away</button>
      </div>
    </div>
  );
}
