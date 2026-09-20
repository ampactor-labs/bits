// The sound as a thing you can hold: see it, top and tail it, replace it,
// or add more to the end. It used to be an invisible asset with two
// buttons buried in the mode menu.
//
// Trim clamps what plays and what renders. It never moves show time: a
// pass recorded at five seconds is still at five seconds afterwards, so
// topping a bit never shuffles the performance under it.

import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../../kit/Sheet';
import { IconButton } from '../../../kit/IconButton';

export interface SoundTrim {
  from: number;
  to: number;
}

export interface SoundSheetProps {
  durationS: number;
  peaks: Float32Array | null;
  trim: SoundTrim | null;
  source: string;
  onTrim: (trim: SoundTrim | null) => void;
  onRetake: (mode: 'replace' | 'extend') => void;
  onClose: () => void;
}

/** Seconds, with a tenth while a bit is short: m:ss rounds a 2.9 second
 *  take and a 2.1 second trim of it to the same "0:02". */
const fmt = (s: number) => {
  const v = Math.max(0, s);
  if (v < 10) return `${v.toFixed(1)}s`;
  return `${Math.floor(v / 60)}:${Math.floor(v % 60)
    .toString()
    .padStart(2, '0')}`;
};

/** Never let the two handles cross, and keep at least this much sound. */
const MIN_SPAN = 0.4;

export function SoundSheet({
  durationS,
  peaks,
  trim,
  source,
  onTrim,
  onRetake,
  onClose,
}: SoundSheetProps) {
  const waveRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState<SoundTrim>(trim ?? { from: 0, to: durationS });
  const dragRef = useRef<'from' | 'to' | null>(null);

  useEffect(() => {
    const canvas = waveRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    canvas.width = w;
    canvas.height = h;
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

  const pct = (t: number) => (durationS > 0 ? (t / durationS) * 100 : 0);

  const move = (clientX: number) => {
    const track = trackRef.current;
    const which = dragRef.current;
    if (!track || !which) return;
    const r = track.getBoundingClientRect();
    const t = Math.min(durationS, Math.max(0, ((clientX - r.left) / r.width) * durationS));
    setSpan((s) =>
      which === 'from'
        ? { ...s, from: Math.min(t, s.to - MIN_SPAN) }
        : { ...s, to: Math.max(t, s.from + MIN_SPAN) },
    );
  };

  const commit = (next: SoundTrim) => {
    const whole = next.from <= 0.01 && next.to >= durationS - 0.01;
    onTrim(whole ? null : next);
  };

  const nudge = (which: 'from' | 'to', by: number) => {
    const next =
      which === 'from'
        ? { ...span, from: Math.max(0, Math.min(span.from + by, span.to - MIN_SPAN)) }
        : { ...span, to: Math.min(durationS, Math.max(span.to + by, span.from + MIN_SPAN)) };
    setSpan(next);
    commit(next);
  };

  const trimmed = span.from > 0.01 || span.to < durationS - 0.01;

  return (
    <Sheet title="the sound" onClose={onClose}>
      <span className="status">
        {source} · {fmt(span.to - span.from)} of {fmt(durationS)}
      </span>

      <div
        ref={trackRef}
        className="trim-track"
        onPointerMove={(e) => {
          if (dragRef.current) move(e.clientX);
        }}
        onPointerUp={() => {
          if (dragRef.current) {
            dragRef.current = null;
            commit(span);
          }
        }}
        onPointerLeave={() => {
          if (dragRef.current) {
            dragRef.current = null;
            commit(span);
          }
        }}
      >
        <canvas ref={waveRef} className="wave" aria-hidden="true" />
        {/* What the trim throws away, shown as thrown away. */}
        <div className="trim-cut" style={{ left: 0, width: `${pct(span.from)}%` }} />
        <div className="trim-cut" style={{ left: `${pct(span.to)}%`, right: 0 }} />
        <div
          className="trim-handle trim-from"
          style={{ left: `${pct(span.from)}%` }}
          role="slider"
          tabIndex={0}
          aria-label="where the sound starts"
          aria-valuemin={0}
          aria-valuemax={durationS}
          aria-valuenow={span.from}
          aria-valuetext={fmt(span.from)}
          onPointerDown={(e) => {
            dragRef.current = 'from';
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') nudge('from', -0.25);
            if (e.key === 'ArrowRight') nudge('from', 0.25);
          }}
        />
        <div
          className="trim-handle trim-to"
          style={{ left: `${pct(span.to)}%` }}
          role="slider"
          tabIndex={0}
          aria-label="where the sound ends"
          aria-valuemin={0}
          aria-valuemax={durationS}
          aria-valuenow={span.to}
          aria-valuetext={fmt(span.to)}
          onPointerDown={(e) => {
            dragRef.current = 'to';
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') nudge('to', -0.25);
            if (e.key === 'ArrowRight') nudge('to', 0.25);
          }}
        />
      </div>

      <div className="sheet-row">
        <span className="sheet-row-label">
          {trimmed ? `${fmt(span.from)} to ${fmt(span.to)}` : 'the whole take'}
        </span>
        <button
          disabled={!trimmed}
          onClick={() => {
            setSpan({ from: 0, to: durationS });
            onTrim(null);
          }}
        >
          use all of it
        </button>
      </div>

      <div className="sheet-icons">
        <IconButton
          icon="mic"
          label="record new sound"
          showLabel
          onClick={() => onRetake('replace')}
        />
        <IconButton icon="sound" label="record more" showLabel onClick={() => onRetake('extend')} />
      </div>
      <span className="status">
        trimming changes what plays and what renders. everything you performed stays where it is.
      </span>
    </Sheet>
  );
}
