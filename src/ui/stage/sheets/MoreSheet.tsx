// Everything else about one puppet: what it is called, how big, how
// floppy, what the sound does to it, where it sits in the stack, and how
// to get rid of it.
//
// Its wires open the Wires room (ui/rooms/Wires.tsx), where any signal can
// drive any of its targets.

import { useState } from 'react';
import { Sheet } from '../../../kit/Sheet';
import { Segmented, Slider } from '../../../kit/Controls';
import { IconButton } from '../../../kit/IconButton';
import type { SpringPreset } from '../../../engine/recipe';
import type { ShowPuppet } from '../../../engine/show';

export type WireLevel = 'off' | 'gentle' | 'wild';

export const WIRE_AMOUNT: Record<WireLevel, number> = { off: 0, gentle: 0.5, wild: 1 };
export const levelOf = (amount: number): WireLevel =>
  amount === 0 ? 'off' : amount <= 0.5 ? 'gentle' : 'wild';

const SPRINGS = [
  { value: 'paper' as const, label: 'paper' },
  { value: 'felt' as const, label: 'felt' },
  { value: 'rubber' as const, label: 'rubber' },
];

/** How far back a sheet sits. Named stops rather than a slider: depth only
 *  shows once the camera moves, so a number would be a guess, and a few
 *  places a puppeteer would name are easier to choose between. */
const DEPTHS = [
  { value: 'near' as const, label: 'near', depth: -0.6 },
  { value: 'stage' as const, label: 'stage', depth: 0 },
  { value: 'back' as const, label: 'back', depth: 1 },
  { value: 'far' as const, label: 'far', depth: 3 },
  { value: 'horizon' as const, label: 'horizon', depth: 10 },
];
type DepthStop = (typeof DEPTHS)[number]['value'];
const stopOf = (depth: number): DepthStop =>
  DEPTHS.reduce((best, d) =>
    Math.abs(d.depth - depth) < Math.abs(best.depth - depth) ? d : best,
  ).value;

export interface MoreSheetProps {
  puppet: ShowPuppet;
  name: string;
  hand: 'left' | 'right' | 'none';
  /** Its own take, if it has one, in seconds. */
  voiceS: number | null;
  onVoice: () => void;
  onDropVoice: () => void;
  onRename: (name: string) => void;
  /** Opens the Wires room for this sheet. */
  onWires: () => void;
  onScale: (scale: number) => void;
  onDepth: (depth: number) => void;
  /** Opens the side view of the whole stage. */
  onSideView: () => void;
  /** Opens the Seed tray to dress this sheet in an ink. */
  onInk: () => void;
  /** True when it is dressed; offers taking it off. */
  inked: boolean;
  onInkOff: () => void;
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

      {/* Free at rest: nothing moves until the camera does. */}
      <div className="sheet-row">
        <span className="sheet-row-label">how far back</span>
        <Segmented
          label="how far back it sits"
          value={stopOf(puppet.depth)}
          options={DEPTHS}
          onChange={(stop) => props.onDepth(DEPTHS.find((d) => d.value === stop)!.depth)}
        />
      </div>

      <button onClick={props.onSideView}>see the stage from the side</button>

      <div className="sheet-row">
        <span className="sheet-row-label">ink</span>
        <span className="sheet-icons">
          <IconButton
            icon="ink"
            label={props.inked ? 'breed its ink' : 'dress it in an ink'}
            onClick={props.onInk}
          />
          {props.inked && <IconButton icon="trash" label="take the ink off" onClick={props.onInkOff} />}
        </span>
      </div>

      <button onClick={props.onWires}>wires</button>

      {/* A puppet with a take of its own flaps to that take, so two people
          can record their halves separately and the right mouth moves. */}
      <div className="sheet-row">
        <span className="sheet-row-label">
          {props.voiceS === null
            ? 'its own voice'
            : `its own voice · ${props.voiceS.toFixed(1)}s`}
        </span>
        <span className="sheet-icons">
          <IconButton
            icon="mic"
            label={props.voiceS === null ? 'record its voice' : 'record it again'}
            onClick={props.onVoice}
          />
          {props.voiceS !== null && (
            <IconButton icon="trash" label="back to the bit" onClick={props.onDropVoice} />
          )}
        </span>
      </div>

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
        {/* The back layer has no order to change and its middle is the
            stage's, so a backdrop gets neither. */}
        {!props.puppet.back && (
          <>
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
          </>
        )}
      </div>

      <button onClick={props.onDrop}>drop from the cast</button>
    </Sheet>
  );
}
