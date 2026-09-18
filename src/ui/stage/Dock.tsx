// The dock: the five controls that are always there, in a shape that never
// changes. Record becomes stop while busy; everything else dims.
//
// Redo used to live three taps deep inside the tools panel while undo sat
// on the bar; they belong side by side.

import { IconButton } from '../../kit/IconButton';

export interface DockProps {
  busy: boolean;
  canRecord: boolean;
  canPlay: boolean;
  canUndo: boolean;
  canRedo: boolean;
  toolsOpen: boolean;
  onRecord: () => void;
  onPlay: () => void;
  onStop: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onTools: () => void;
}

export function Dock({
  busy,
  canRecord,
  canPlay,
  canUndo,
  canRedo,
  toolsOpen,
  onRecord,
  onPlay,
  onStop,
  onUndo,
  onRedo,
  onTools,
}: DockProps) {
  return (
    <div className="dock" role="toolbar" aria-label="transport">
      <IconButton icon="undo" label="undo" disabled={busy || !canUndo} onClick={onUndo} />
      <IconButton icon="redo" label="redo" disabled={busy || !canRedo} onClick={onRedo} />
      {busy ? (
        <button className="dock-rec dock-stop on-accent" aria-label="stop" onClick={onStop}>
          <span className="dock-glyph" aria-hidden="true" />
        </button>
      ) : (
        <button
          className="dock-rec on-accent"
          aria-label="record a pass"
          disabled={!canRecord}
          onClick={onRecord}
        >
          <span className="dock-glyph" aria-hidden="true" />
        </button>
      )}
      <IconButton icon="play" label="play" disabled={busy || !canPlay} onClick={onPlay} />
      <IconButton
        icon="plus"
        label="tools"
        className={toolsOpen ? 'on' : ''}
        disabled={busy}
        onClick={onTools}
      />
    </div>
  );
}
