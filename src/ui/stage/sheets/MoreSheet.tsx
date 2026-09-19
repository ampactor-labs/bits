// Everything else about one puppet: what it is called, how big, how
// floppy, what the sound does to it, where it sits in the stack, and how
// to get rid of it.
//
// Wires used to be tap-to-cycle with one or two dots for a level, which
// gave no clue there were three states. They are named now.

import { useState } from 'react';
import { Sheet } from '../../../kit/Sheet';
import { Segmented, Slider } from '../../../kit/Controls';
import { IconButton } from '../../../kit/IconButton';
import type { SpringPreset, WireSource, WireTarget } from '../../../engine/recipe';
import type { ShowPuppet } from '../../../engine/show';

export type WireLevel = 'off' | 'gentle' | 'wild';

export const WIRE_AMOUNT: Record<WireLevel, number> = { off: 0, gentle: 0.5, wild: 1 };
export const levelOf = (amount: number): WireLevel =>
  amount === 0 ? 'off' : amount <= 0.5 ? 'gentle' : 'wild';

const LEVELS = [
  { value: 'off' as const, label: 'off' },
  { value: 'gentle' as const, label: 'gentle' },
  { value: 'wild' as const, label: 'wild' },
];

const SPRINGS = [
  { value: 'paper' as const, label: 'paper' },
  { value: 'felt' as const, label: 'felt' },
  { value: 'rubber' as const, label: 'rubber' },
];

const WIRES: { source: WireSource; target: WireTarget; label: string }[] = [
  { source: 'voice', target: 'bounce', label: 'voice makes it bounce' },
  { source: 'voice', target: 'shake', label: 'voice makes it shake' },
  { source: 'voice', target: 'lean', label: 'voice makes it lean' },
  { source: 'beat', target: 'bounce', label: 'beat makes it bounce' },
  { source: 'beat', target: 'shake', label: 'beat makes it shake' },
];

export interface MoreSheetProps {
  puppet: ShowPuppet;
  name: string;
  wireAmount: (source: WireSource, target: WireTarget) => number;
  hand: 'left' | 'right' | 'none';
  onRename: (name: string) => void;
  onWire: (source: WireSource, target: WireTarget, amount: number) => void;
  onScale: (scale: number) => void;
  onSpring: (spring: SpringPreset) => void;
  onHand: (hand: 'left' | 'right' | 'none') => void;
  onDuplicate: () => void;
  onLayer: (dir: 'front' | 'back') => void;
  onCenter: () => void;
  onDrop: () => void;
  onClose: () => void;
}

export function MoreSheet(props: MoreSheetProps) {
  const { puppet, name } = props;
  const [draft, setDraft] = useState(name);
  const [scale, setScale] = useState(puppet.home.scale);
  const [showWires, setShowWires] = useState(false);

  if (showWires) {
    return (
      <Sheet title={`${name} · wires`} onClose={() => setShowWires(false)}>
        {WIRES.map((w) => (
          <div key={`${w.source}-${w.target}`} className="sheet-row">
            <span className="sheet-row-label">{w.label}</span>
            <Segmented
              label={w.label}
              value={levelOf(props.wireAmount(w.source, w.target))}
              options={LEVELS}
              onChange={(level) => props.onWire(w.source, w.target, WIRE_AMOUNT[level])}
            />
          </div>
        ))}
      </Sheet>
    );
  }

  return (
    <Sheet title={name} onClose={props.onClose}>
      <input
        className="text-field"
        value={draft}
        aria-label="puppet name"
        maxLength={40}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => props.onRename(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') props.onRename(draft);
        }}
      />

      <Slider
        label="size"
        value={scale}
        min={0.2}
        max={4}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={setScale}
        onCommit={props.onScale}
      />

      <div className="sheet-row">
        <span className="sheet-row-label">feel</span>
        <Segmented
          label="how floppy it is"
          value={puppet.spring}
          options={SPRINGS}
          onChange={props.onSpring}
        />
      </div>

      <button onClick={() => setShowWires(true)}>wires</button>

      <div className="sheet-row">
        <span className="sheet-row-label">your hand</span>
        <Segmented
          label="which hand drives it"
          value={props.hand}
          options={[
            { value: 'none' as const, label: 'none' },
            { value: 'left' as const, label: 'left' },
            { value: 'right' as const, label: 'right' },
          ]}
          onChange={props.onHand}
        />
      </div>

      <div className="sheet-icons">
        <IconButton icon="duplicate" label="duplicate" showLabel onClick={props.onDuplicate} />
        <IconButton
          icon="layerUp"
          label="to the front"
          showLabel
          onClick={() => props.onLayer('front')}
        />
        <IconButton
          icon="layerDown"
          label="to the back"
          showLabel
          onClick={() => props.onLayer('back')}
        />
        <IconButton icon="center" label="centre it" showLabel onClick={props.onCenter} />
      </div>

      <button onClick={props.onDrop}>drop from the cast</button>
    </Sheet>
  );
}
