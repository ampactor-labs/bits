// Passes as spans over the same time axis as the timeline above.
//
// A pass used to be invisible: you could hear it and see it move, but not
// find it, silence it, shorten it, or take one of five away (audit F22,
// F23). Each one is now a span you can tap. A span belonging to a mouthed
// puppet is striped, because that is exactly when it talks — the talker
// rule, drawn.
//
// The panel is capped at a third of the stage and scrolls inside, and the
// playhead runs through it, so it can stay open while the bit plays.

import { useRef, useState, type RefObject } from 'react';
import { IconButton } from '../../kit/IconButton';
import type { LanePass } from '../../engine/show';

export interface Lane {
  puppetId: string;
  name: string;
  /** A mouthed puppet's passes are when it talks. */
  mouthed: boolean;
  passes: LanePass[];
}

export interface LoopRegion {
  from: number;
  to: number;
}

export interface LanesProps {
  lanes: Lane[];
  durationS: number;
  selectedPassId: string | null;
  soloPuppetId: string | null;
  loop: LoopRegion | null;
  /** Painted by the frame loop, like the timeline's. */
  playheadRef: RefObject<HTMLDivElement | null>;
  onSelectPass: (passId: string | null) => void;
  onMute: (passId: string, muted: boolean) => void;
  onDelete: (passId: string) => void;
  onTrim: (passId: string, from: number, to: number) => void;
  onSolo: (puppetId: string | null) => void;
  onLoop: (loop: LoopRegion | null) => void;
}

interface EdgeDrag {
  passId: string;
  edge: 'from' | 'to';
  from: number;
  to: number;
}

const MIN_SPAN = 0.1;
const fmt = (s: number) => (s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`);

export function Lanes({
  lanes,
  durationS,
  selectedPassId,
  soloPuppetId,
  loop,
  playheadRef,
  onSelectPass,
  onMute,
  onDelete,
  onTrim,
  onSolo,
  onLoop,
}: LanesProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<EdgeDrag | null>(null);
  const loopStartRef = useRef<number | null>(null);
  const passCount = lanes.reduce((n, l) => n + l.passes.length, 0);

  const pct = (t: number) => (durationS > 0 ? (t / durationS) * 100 : 0);
  /** Every track shares the body's width, so one measurement serves them
   *  all and an edge drag can start on a span and end anywhere. */
  const timeAt = (clientX: number) => {
    const track = bodyRef.current?.querySelector('.lane-track');
    if (!track) return 0;
    const r = track.getBoundingClientRect();
    return Math.min(durationS, Math.max(0, ((clientX - r.left) / r.width) * durationS));
  };

  const selected = lanes.flatMap((l) => l.passes).find((p) => p.event.id === selectedPassId);
  const selectedLane = lanes.find((l) => l.passes.some((p) => p.event.id === selectedPassId));
  /** While an edge is being dragged the span follows the finger; the
   *  event is written once, on release. */
  const shown = (p: LanePass) =>
    drag && drag.passId === p.event.id ? { from: drag.from, to: drag.to } : p;

  const edgeMove = (e: React.PointerEvent) => {
    setDrag((d) => {
      if (!d) return d;
      const t = timeAt(e.clientX);
      return d.edge === 'from'
        ? { ...d, from: Math.min(t, d.to - MIN_SPAN) }
        : { ...d, to: Math.max(t, d.from + MIN_SPAN) };
    });
  };

  const edgeUp = () => {
    if (drag) onTrim(drag.passId, drag.from, drag.to);
    setDrag(null);
  };

  return (
    <div className="lanes">
      <div className="lanes-head">
        <span className="status">
          {passCount} pass{passCount === 1 ? '' : 'es'}
          {soloPuppetId ? ' · hearing one' : ''}
        </span>
        <IconButton
          icon="loop"
          label={loop ? 'stop looping' : 'loop the whole bit'}
          className={loop ? 'on' : ''}
          onClick={() => onLoop(loop ? null : { from: 0, to: durationS })}
        />
      </div>

      <div ref={bodyRef} className="lanes-body">
        {lanes.length === 0 && (
          <span className="status">
            no passes yet. hold a puppet while the bit plays, and it remembers.
          </span>
        )}
        {lanes.map((lane) => (
          <div key={lane.puppetId} className="lane">
            <button
              className={`lane-name${soloPuppetId === lane.puppetId ? ' on' : ''}`}
              aria-pressed={soloPuppetId === lane.puppetId}
              aria-label={`hear only ${lane.name}`}
              onClick={() => onSolo(soloPuppetId === lane.puppetId ? null : lane.puppetId)}
            >
              {lane.name}
            </button>
            <div className="lane-track">
              {lane.passes.map((p) => {
                const view = shown(p);
                const on = selectedPassId === p.event.id;
                return (
                  <button
                    key={p.event.id}
                    className={[
                      'span',
                      lane.mouthed ? 'span-talks' : '',
                      p.muted ? 'span-muted' : '',
                      on ? 'on' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      left: `${pct(view.from)}%`,
                      width: `${Math.max(1.5, pct(view.to - view.from))}%`,
                    }}
                    aria-label={`${lane.name}, ${fmt(view.from)} to ${fmt(view.to)}${
                      p.muted ? ', muted' : ''
                    }${lane.mouthed ? ', talking' : ''}`}
                    aria-pressed={on}
                    onClick={() => onSelectPass(on ? null : p.event.id)}
                  >
                    {on && (
                      <>
                        <span
                          className="span-edge span-edge-from"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setDrag({
                              passId: p.event.id,
                              edge: 'from',
                              from: view.from,
                              to: view.to,
                            });
                            e.currentTarget.setPointerCapture(e.pointerId);
                          }}
                          onPointerMove={edgeMove}
                          onPointerUp={edgeUp}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span
                          className="span-edge span-edge-to"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setDrag({
                              passId: p.event.id,
                              edge: 'to',
                              from: view.from,
                              to: view.to,
                            });
                            e.currentTarget.setPointerCapture(e.pointerId);
                          }}
                          onPointerMove={edgeMove}
                          onPointerUp={edgeUp}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* The axis: the playhead runs through it, and a drag sets the
          stretch to loop over or punch a new pass into. */}
      <div
        className="lanes-axis"
        onPointerDown={(e) => {
          loopStartRef.current = timeAt(e.clientX);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const start = loopStartRef.current;
          if (start === null) return;
          const now = timeAt(e.clientX);
          if (Math.abs(now - start) < 0.15) return;
          onLoop({ from: Math.min(start, now), to: Math.max(start, now) });
        }}
        onPointerUp={(e) => {
          const start = loopStartRef.current;
          loopStartRef.current = null;
          // A tap, not a drag: clear the stretch rather than leave a
          // sliver nothing can play.
          if (start !== null && Math.abs(timeAt(e.clientX) - start) < 0.15) onLoop(null);
        }}
      >
        {loop && (
          <div
            className="loop-band"
            style={{ left: `${pct(loop.from)}%`, width: `${pct(loop.to - loop.from)}%` }}
          />
        )}
        <div ref={playheadRef} className="lanes-playhead" />
      </div>

      {selected && selectedLane && (
        <div className="lane-actions" role="toolbar" aria-label="this pass">
          <span className="status">
            {selectedLane.name} · {fmt(selected.from)}–{fmt(selected.to)}
            {selected.trimmed ? ' · shortened' : ''}
          </span>
          <IconButton
            icon="mute"
            label={selected.muted ? 'let it play' : 'mute it'}
            className={selected.muted ? 'on' : ''}
            onClick={() => onMute(selected.event.id, !selected.muted)}
          />
          <IconButton
            icon="loop"
            label="fit it to the loop"
            disabled={!loop}
            onClick={() => loop && onTrim(selected.event.id, loop.from, loop.to)}
          />
          <IconButton
            icon="trash"
            label="take this pass out"
            onClick={() => onDelete(selected.event.id)}
          />
        </div>
      )}
    </div>
  );
}
