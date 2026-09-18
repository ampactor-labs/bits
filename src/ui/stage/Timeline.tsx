// The timeline. It used to be an 8px bar 74px wide on a 390px phone, with
// an invisible range input over it and no duration shown, so you could
// neither see where the words were nor tell how long the bit was.
//
// Now it owns a full-width row: the waveform, the beat ticks the onset
// grid found, a playhead you can see and grab, and the time as "now / all".
// The loop paints the moving parts through refs, so scrubbing and playback
// cost no React renders.

import { useEffect, useRef, type RefObject } from 'react';

export interface TimelineProps {
  durationS: number;
  peaks: Float32Array | null;
  onsets: number[];
  disabled: boolean;
  onSeek: (t: number) => void;
  /** Written by the frame loop; see Stage's paintClock. */
  fillRef: RefObject<HTMLDivElement | null>;
  handleRef: RefObject<HTMLDivElement | null>;
  seekRef: RefObject<HTMLInputElement | null>;
  timeTextRef: RefObject<HTMLSpanElement | null>;
  initialT: number;
}

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${Math.floor(Math.max(0, s) % 60)
    .toString()
    .padStart(2, '0')}`;

export function Timeline({
  durationS,
  peaks,
  onsets,
  disabled,
  onSeek,
  fillRef,
  handleRef,
  seekRef,
  timeTextRef,
  initialT,
}: TimelineProps) {
  const waveRef = useRef<HTMLCanvasElement>(null);

  // The waveform only changes when the sound does, so it is painted on
  // change rather than per frame.
  useEffect(() => {
    const canvas = waveRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!peaks || peaks.length === 0) return;
    const style = getComputedStyle(canvas);
    ctx.fillStyle = style.getPropertyValue('--wave-color').trim() || '#9a9186';
    const bar = Math.max(1, Math.floor(dpr));
    const gap = bar;
    const count = Math.max(1, Math.floor(w / (bar + gap)));
    for (let i = 0; i < count; i++) {
      const peak = peaks[Math.floor((i / count) * peaks.length)] ?? 0;
      const barH = Math.max(bar, peak * h * 0.9);
      ctx.fillRect(i * (bar + gap), (h - barH) / 2, bar, barH);
    }
  }, [peaks]);

  const pct = durationS > 0 ? (initialT / durationS) * 100 : 0;

  return (
    <div className="timeline">
      <div className="track">
        {/* Clipped: the waveform, the ticks and the played-so-far fill. */}
        <div className="track-clip">
          <canvas ref={waveRef} className="wave" aria-hidden="true" />
          {durationS > 0 &&
            onsets.map((o, i) => (
              <span key={i} className="beat" style={{ left: `${(o / durationS) * 100}%` }} />
            ))}
          <div ref={fillRef} className="fill" style={{ width: `${pct}%` }} />
        </div>
        {/* Unclipped: the handle is a circle wider than the bar, and at
            either end half of it would otherwise be cut off. */}
        <div ref={handleRef} className="playhead" style={{ left: `${pct}%` }} />
        <input
          ref={seekRef}
          className="seek"
          type="range"
          min={0}
          max={durationS || 1}
          step={0.01}
          defaultValue={initialT}
          disabled={disabled}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="playhead"
          aria-valuetext={`${fmt(initialT)} of ${fmt(durationS)}`}
        />
      </div>
      <span className="times">
        <span ref={timeTextRef}>{fmt(initialT)}</span>
        <span className="times-sep"> / </span>
        <span className="times-total">{fmt(durationS)}</span>
      </span>
    </div>
  );
}
