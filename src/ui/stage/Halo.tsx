// The halo: a puppet's own tools, on the puppet.
//
// It is a bar in a fixed order, not a ring. Six 44px buttons need about
// 300px, which does not fit around a puppet on a 375px phone, and a ring
// would put the same button in different places on different phones. The
// bar sits above the puppet's box, below it when there is no room above,
// and docks to the stage's bottom edge when there is room for neither.
//
// Buttons are real buttons, for taps and for screen readers, but they go
// non-interactive while a pointer is down on the stage: otherwise a
// pinch's second finger would land on one and fire it on release.

import type { RefObject } from 'react';
import { IconButton } from '../../kit/IconButton';
import type { IconName } from '../../kit/Icon';

export type HaloAction =
  | 'mouth'
  | 'eyes'
  | 'snip'
  | 'pin'
  | 'flip'
  | 'more'
  | 'replace'
  | 'drop';

export interface HaloProps {
  /** What the selected puppet is called, for the toolbar's own name. */
  name: string;
  /** Backdrops get a much shorter halo: they fill the stage and are never
   *  hit-tested, so they are selected from the cast sheet instead. */
  backdrop: boolean;
  /** False when the puppet is snipped: cut paper or bend it, not both. */
  canPin: boolean;
  /** True while any pointer is down on the stage. */
  inert: boolean;
  onAction: (action: HaloAction) => void;
  barRef: RefObject<HTMLDivElement | null>;
  outlineRef: RefObject<HTMLDivElement | null>;
}

const PUPPET_ACTIONS: { action: HaloAction; icon: IconName; label: string }[] = [
  { action: 'mouth', icon: 'mouth', label: 'mouth' },
  { action: 'eyes', icon: 'eyes', label: 'eyes' },
  { action: 'snip', icon: 'scissors', label: 'snip' },
  { action: 'pin', icon: 'pin', label: 'pin' },
  { action: 'flip', icon: 'flip', label: 'flip' },
  { action: 'more', icon: 'more', label: 'more' },
];

const BACKDROP_ACTIONS: { action: HaloAction; icon: IconName; label: string }[] = [
  { action: 'replace', icon: 'backdrop', label: 'replace the backdrop' },
  { action: 'drop', icon: 'trash', label: 'remove the backdrop' },
];

export function Halo({
  name,
  backdrop,
  canPin,
  inert,
  onAction,
  barRef,
  outlineRef,
}: HaloProps) {
  const actions = backdrop ? BACKDROP_ACTIONS : PUPPET_ACTIONS;
  return (
    <>
      <div ref={outlineRef} className="sel-outline" aria-hidden="true" />
      <div
        ref={barRef}
        className={`halo${inert ? ' halo-inert' : ''}`}
        role="toolbar"
        aria-label={`${name} tools`}
      >
        {actions.map((a) => (
          <IconButton
            key={a.action}
            icon={a.icon}
            label={a.label}
            disabled={a.action === 'pin' && !canPin}
            onClick={() => onAction(a.action)}
          />
        ))}
      </div>
    </>
  );
}
