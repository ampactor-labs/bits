// The stage's modes, and every way between them.
//
// They were an ad-hoc string on a ref, set from twenty places, and the
// only way to know whether a transition was legal was to read all twenty.
// This file is that knowledge, as data: what a mode allows, and which
// moves exist.
//
// It is deliberately not a framework. The stage still owns its state; this
// says which moves are legal and what each mode permits, so a new mode
// cannot quietly acquire the ability to record.

export type Mode =
  | 'loading'
  | 'needsAudio'
  | 'micLive'
  | 'idle'
  | 'playing'
  | 'recording'
  | 'doodling'
  | 'snipping'
  | 'mouthing'
  | 'eyeing'
  | 'pinning';

/** A mode entered from idle that acts on the selected puppet and returns
 *  to idle when it is done or cancelled. */
export const TOOL_MODES = ['snipping', 'mouthing', 'eyeing', 'pinning'] as const;
export type ToolMode = (typeof TOOL_MODES)[number];

export const isTool = (m: Mode): m is ToolMode => (TOOL_MODES as readonly string[]).includes(m);

/** The clock is running and the recipe is being read frame by frame. */
export const isBusy = (m: Mode): boolean => m === 'playing' || m === 'recording';

/** A finger on the stage belongs to the gesture layer rather than to a
 *  puppet: placing a feature, cutting, or drawing. */
export const isPlacing = (m: Mode): boolean => isTool(m) || m === 'doodling';

export interface ModeRules {
  /** The transport can start a take. */
  canRecord: boolean;
  /** The transport can play. */
  canPlay: boolean;
  /** A puppet can be selected and its halo shown. */
  canSelect: boolean;
  /** The recipe can be edited from a sheet or a menu. */
  canEdit: boolean;
}

const RULES: Record<Mode, ModeRules> = {
  loading: { canRecord: false, canPlay: false, canSelect: false, canEdit: false },
  needsAudio: { canRecord: false, canPlay: false, canSelect: false, canEdit: false },
  micLive: { canRecord: false, canPlay: false, canSelect: false, canEdit: false },
  idle: { canRecord: true, canPlay: true, canSelect: true, canEdit: true },
  playing: { canRecord: false, canPlay: false, canSelect: false, canEdit: false },
  recording: { canRecord: false, canPlay: false, canSelect: false, canEdit: false },
  doodling: { canRecord: false, canPlay: false, canSelect: false, canEdit: false },
  snipping: { canRecord: false, canPlay: false, canSelect: true, canEdit: false },
  mouthing: { canRecord: false, canPlay: false, canSelect: true, canEdit: false },
  eyeing: { canRecord: false, canPlay: false, canSelect: true, canEdit: false },
  pinning: { canRecord: false, canPlay: false, canSelect: true, canEdit: false },
};

export const rulesFor = (m: Mode): ModeRules => RULES[m];

/** Every move the stage can make, as from -> to. Anything not here is a
 *  bug, and `canEnter` is how the stage finds out before making it. */
const MOVES: Record<Mode, readonly Mode[]> = {
  // The first load decides whether there is a bit to stand on.
  loading: ['idle', 'needsAudio'],
  // The sound comes first, from the mic or a file. "keep the old sound"
  // backs out of a retake.
  needsAudio: ['micLive', 'idle'],
  // A take ends, is thrown away, or hits the cap.
  micLive: ['idle', 'needsAudio'],
  idle: ['playing', 'recording', 'doodling', 'snipping', 'mouthing', 'eyeing', 'pinning', 'micLive', 'needsAudio'],
  // Playback ends at the stretch, the trim, or the end of the sound.
  playing: ['idle'],
  // A take ends the same way, and its grabs become passes.
  recording: ['idle'],
  doodling: ['idle'],
  snipping: ['idle'],
  mouthing: ['idle'],
  eyeing: ['idle'],
  pinning: ['idle'],
};

export const canEnter = (from: Mode, to: Mode): boolean =>
  from === to || MOVES[from].includes(to);

export const movesFrom = (from: Mode): readonly Mode[] => MOVES[from];
