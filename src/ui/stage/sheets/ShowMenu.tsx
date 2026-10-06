// Everything that belongs to the show rather than to one puppet: making
// the film, sending the bit, changing the sound, and the two stage-wide
// effects.

import { Sheet } from '../../../kit/Sheet';
import { Segmented } from '../../../kit/Controls';
import { IconButton } from '../../../kit/IconButton';
import { levelOf, WIRE_AMOUNT, type WireLevel } from './MoreSheet';

export interface ShowMenuProps {
  passCount: number;
  castCount: number;
  canRender: boolean;
  rendered: boolean;
  trails: number;
  foley: number;
  corpse: boolean;
  aspect: '9:16' | '16:9';
  onAspect: (aspect: '9:16' | '16:9') => void;
  onRender: () => void;
  onShareRender: () => void;
  onBitFile: () => void;
  onPerform: () => void;
  canPerform: boolean;
  onSound: () => void;
  onStageWire: (target: 'trails' | 'foley', amount: number) => void;
  /** The stage's look, 0..1 each. */
  shadow: number;
  fog: number;
  onLook: (patch: { shadow?: number; fog?: number }) => void;
  onCorpse: (on: boolean) => void;
  onClose: () => void;
}

/** Three steps each: a look you can name beats a number you have to judge. */
const SHADOWS = [
  { value: 'off' as const, label: 'off', amount: 0 },
  { value: 'soft' as const, label: 'soft', amount: 0.5 },
  { value: 'deep' as const, label: 'deep', amount: 1 },
];
const FOGS = [
  { value: 'off' as const, label: 'off', amount: 0 },
  { value: 'haze' as const, label: 'haze', amount: 0.45 },
  { value: 'thick' as const, label: 'thick', amount: 0.85 },
];
const nearest = <T extends { amount: number }>(steps: T[], v: number): T =>
  steps.reduce((best, s) => (Math.abs(s.amount - v) < Math.abs(best.amount - v) ? s : best));

const LEVELS: { value: WireLevel; label: string }[] = [
  { value: 'off', label: 'off' },
  { value: 'gentle', label: 'gentle' },
  { value: 'wild', label: 'wild' },
];

export function ShowMenu(props: ShowMenuProps) {
  return (
    <Sheet title="this bit" onClose={props.onClose}>
      <span className="status">
        {props.castCount} in the cast · {props.passCount} pass
        {props.passCount === 1 ? '' : 'es'}
      </span>

      <div className="sheet-icons">
        <IconButton
          icon="render"
          label={props.rendered ? 'share the film' : 'make a film'}
          showLabel
          disabled={!props.canRender}
          onClick={props.rendered ? props.onShareRender : props.onRender}
        />
        <IconButton icon="bitfile" label="send the bit" showLabel onClick={props.onBitFile} />
        <IconButton
          icon="body"
          label="perform"
          showLabel
          disabled={!props.canPerform}
          onClick={props.onPerform}
        />
        <IconButton icon="sound" label="the sound" showLabel onClick={props.onSound} />
      </div>

      <div className="sheet-row">
        <span className="sheet-row-label">shape</span>
        <Segmented
          label="the shape of the stage and the film"
          value={props.aspect}
          options={[
            { value: '9:16' as const, label: 'tall' },
            { value: '16:9' as const, label: 'wide' },
          ]}
          onChange={props.onAspect}
        />
      </div>

      <div className="sheet-row">
        <span className="sheet-row-label">trails</span>
        <Segmented
          label="ghost trails behind motion"
          value={levelOf(props.trails)}
          options={LEVELS}
          onChange={(level) => props.onStageWire('trails', WIRE_AMOUNT[level])}
        />
      </div>

      {/* Both come from depth: a flat stage casts shadows on the floor
          and fogs evenly; push sheets back to see them separate. */}
      <div className="sheet-row">
        <span className="sheet-row-label">shadows</span>
        <Segmented
          label="paper shadows"
          value={nearest(SHADOWS, props.shadow).value}
          options={SHADOWS}
          onChange={(v) => props.onLook({ shadow: SHADOWS.find((s) => s.value === v)!.amount })}
        />
      </div>

      <div className="sheet-row">
        <span className="sheet-row-label">fog</span>
        <Segmented
          label="fog with distance"
          value={nearest(FOGS, props.fog).value}
          options={FOGS}
          onChange={(v) => props.onLook({ fog: FOGS.find((s) => s.value === v)!.amount })}
        />
      </div>

      <div className="sheet-row">
        <span className="sheet-row-label">impact foley</span>
        <Segmented
          label="sounds on hard landings"
          value={levelOf(props.foley)}
          options={LEVELS}
          onChange={(level) => props.onStageWire('foley', WIRE_AMOUNT[level])}
        />
      </div>

      <div className="sheet-row">
        <span className="sheet-row-label">record blind</span>
        <Segmented
          label="hide the other passes while recording"
          value={props.corpse ? 'on' : 'off'}
          options={[
            { value: 'off' as const, label: 'off' },
            { value: 'on' as const, label: 'on' },
          ]}
          onChange={(v) => props.onCorpse(v === 'on')}
        />
      </div>
      <span className="status">
        perform: the stage and nothing else, for two people and four hands. blind: perform
        without seeing the other passes, and meet the whole show when the curtain goes up.
      </span>
    </Sheet>
  );
}
