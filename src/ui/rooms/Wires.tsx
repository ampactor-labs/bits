// The Wires room: the signal matrix, laid out for a phone. A matrix of ten
// signals by ten targets does not fit a third of a phone's stage, so it is
// read by rows: each signal is a row with a live meter, and the targets it
// can drive are chips along it. A lit chip is a wire; tap a dark one to
// plug it in, a lit one to shape it (how much, how smooth, above what,
// how late) or pull it out.
//
// It replaces the five fixed rows the more panel had, and the stage gets
// the same room for its camera, fog and trails.

import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../kit/Sheet';
import { Slider } from '../../kit/Controls';
import { SHEET_TARGETS, STAGE_TARGETS, type Target, type TargetInfo } from '../../engine/props';
import { isWorldSignal, parseSignal } from '../../engine/signals';
import type { Wire } from '../../engine/wires';

export interface SignalRow {
  id: string;
  label: string;
}

export interface WirePatch {
  amount: number;
  smooth?: number;
  threshold?: number;
  delay?: number;
}

export interface WiresRoomProps {
  /** '' is the stage. */
  pid: string;
  title: string;
  signals: SignalRow[];
  wireAt: (from: string, to: Target) => Wire | undefined;
  /** The signal's value right now, for its meter. */
  sample: (from: string) => number;
  onSet: (from: string, to: Target, patch: WirePatch) => void;
  onClose: () => void;
}

/** The signals every sheet and the stage can read. */
export const COMMON_SIGNALS: SignalRow[] = [
  { id: 'const', label: 'always' },
  { id: 'voice', label: 'the voice' },
  { id: 'beat', label: 'the beat' },
  { id: 'band:bass', label: 'bass' },
  { id: 'band:mid', label: 'middle' },
  { id: 'band:air', label: 'air' },
  { id: 'bright', label: 'brightness' },
  { id: 'lfo:0.5', label: 'slow wave' },
  { id: 'lfo:2', label: 'quick wave' },
  { id: 'rand:1', label: 'wander' },
  { id: 'step:4', label: 'steps' },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function WiresRoom({ pid, title, signals, wireAt, sample, onSet, onClose }: WiresRoomProps) {
  const targets = pid === '' ? STAGE_TARGETS : SHEET_TARGETS;
  const [editing, setEditing] = useState<{ from: string; to: Target } | null>(null);
  const meters = useRef(new Map<string, HTMLSpanElement>());

  // Meters move with the show, written straight to the DOM.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      for (const [id, el] of meters.current) {
        el.style.transform = `scaleX(${Math.min(1, Math.max(0, sample(id)))})`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sample]);

  const chips = (row: SignalRow): TargetInfo[] =>
    // Foley is an on/off for the whole show: only "always" drives it.
    targets.filter((t) => t.id !== 'foley' || row.id === 'const');

  const plug = (from: string, to: Target) => {
    const live = wireAt(from, to);
    if (!live) onSet(from, to, { amount: 0.5 });
    setEditing({ from, to });
  };

  const editor = editing && wireAt(editing.from, editing.to);

  return (
    <Sheet title={`${title} · wires`} onClose={onClose}>
      {editing && editor && (
        <WireEditor
          key={`${editing.from}|${editing.to}`}
          label={`${signals.find((s) => s.id === editing.from)?.label ?? editing.from} → ${
            targets.find((t) => t.id === editing.to)?.label ?? editing.to
          }`}
          wire={editor}
          world={isWorldSignal(parseSignal(editing.from)!)}
          onSet={(patch) => onSet(editing.from, editing.to, patch)}
          onUnplug={() => {
            onSet(editing.from, editing.to, { amount: 0 });
            setEditing(null);
          }}
          onDone={() => setEditing(null)}
        />
      )}
      {signals.map((row) => (
        <div key={row.id} className="wire-row" role="group" aria-label={row.label}>
          <span className="wire-signal">
            <span className="wire-signal-name">{row.label}</span>
            <span className="wire-meter" aria-hidden="true">
              <span
                className="wire-meter-fill"
                ref={(el) => {
                  if (el) meters.current.set(row.id, el);
                  else meters.current.delete(row.id);
                }}
              />
            </span>
          </span>
          <span className="wire-chips">
            {chips(row).map((t) => {
              const w = wireAt(row.id, t.id);
              const on = editing?.from === row.id && editing.to === t.id;
              return (
                <button
                  key={t.id}
                  className={`wire-chip${w ? ' lit' : ''}${on ? ' on' : ''}`}
                  aria-pressed={!!w}
                  aria-label={`${row.label} drives ${t.label}${w ? `, ${pct(w.amount)}` : ''}`}
                  onClick={() => plug(row.id, t.id)}
                >
                  {t.label}
                  {w && <span className="wire-chip-amount">{pct(w.amount)}</span>}
                </button>
              );
            })}
          </span>
        </div>
      ))}
    </Sheet>
  );
}

function WireEditor({
  label,
  wire,
  world,
  onSet,
  onUnplug,
  onDone,
}: {
  label: string;
  wire: Wire;
  world: boolean;
  onSet: (patch: WirePatch) => void;
  onUnplug: () => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<WirePatch>({
    amount: wire.amount,
    ...(wire.smooth !== undefined ? { smooth: wire.smooth } : {}),
    ...(wire.threshold !== undefined ? { threshold: wire.threshold } : {}),
    ...(wire.delay !== undefined ? { delay: wire.delay } : {}),
  });
  const commit = (next: WirePatch) => {
    setDraft(next);
    // Amount 0 would unplug; a wire being shaped stays in.
    onSet({ ...next, amount: next.amount === 0 ? 0.01 : next.amount });
  };
  return (
    <div className="wire-editor" role="group" aria-label={label}>
      <p className="wire-editor-title">{label}</p>
      <Slider
        label="how much"
        value={draft.amount}
        min={-1}
        max={1}
        step={0.05}
        format={(v) => `${v < 0 ? '−' : ''}${Math.round(Math.abs(v) * 100)}%`}
        onChange={(amount) => setDraft({ ...draft, amount })}
        onCommit={(amount) => commit({ ...draft, amount })}
      />
      {/* World signals are read from the frame, so they cannot be shaped
          the same at every frame rate; the room does not pretend to. */}
      {!world && (
        <>
          <Slider
            label="smooth"
            value={draft.smooth ?? 0}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v === 0 ? 'off' : `${(0.02 * Math.pow(250, v)).toFixed(2)}s`)}
            onChange={(smooth) => setDraft({ ...draft, smooth })}
            onCommit={(smooth) => commit({ ...draft, smooth })}
          />
          <Slider
            label="above"
            value={draft.threshold ?? 0}
            min={0}
            max={0.95}
            step={0.05}
            format={pct}
            onChange={(threshold) => setDraft({ ...draft, threshold })}
            onCommit={(threshold) => commit({ ...draft, threshold })}
          />
          <Slider
            label="late by"
            value={draft.delay ?? 0}
            min={0}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}s`}
            onChange={(delay) => setDraft({ ...draft, delay })}
            onCommit={(delay) => commit({ ...draft, delay })}
          />
        </>
      )}
      <div className="cta-row">
        <button onClick={onUnplug}>pull it out</button>
        <button className="primary" onClick={onDone}>
          done
        </button>
      </div>
    </div>
  );
}
