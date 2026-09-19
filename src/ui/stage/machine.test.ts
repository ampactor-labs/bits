// One test per transition, plus the rules that keep a mode from quietly
// acquiring an ability it should not have.

import { describe, expect, it } from 'vitest';
import {
  TOOL_MODES,
  canEnter,
  isBusy,
  isPlacing,
  isTool,
  movesFrom,
  rulesFor,
  type Mode,
} from './machine';

const ALL: Mode[] = [
  'loading',
  'needsAudio',
  'micLive',
  'idle',
  'playing',
  'recording',
  'doodling',
  'snipping',
  'mouthing',
  'eyeing',
  'pinning',
];

describe('the stage machine', () => {
  it.each(ALL)('%s can always stay where it is', (m) => {
    expect(canEnter(m, m)).toBe(true);
  });

  it.each(ALL.flatMap((from) => movesFrom(from).map((to) => [from, to] as const)))(
    '%s -> %s is a move the stage makes',
    (from, to) => {
      expect(canEnter(from, to)).toBe(true);
    },
  );

  it('everything that is not idle comes back to idle', () => {
    for (const m of ALL) {
      if (m === 'idle' || m === 'loading') continue;
      expect(movesFrom(m)).toContain('idle');
    }
  });

  it('refuses the moves nobody should make', () => {
    // Recording cannot start from a tool, or a tap meant for a mouth lands
    // on a puppet mid-take.
    for (const tool of TOOL_MODES) expect(canEnter(tool, 'recording')).toBe(false);
    // A take cannot become playback without passing through idle, where
    // the open grabs are closed into passes.
    expect(canEnter('recording', 'playing')).toBe(false);
    expect(canEnter('playing', 'recording')).toBe(false);
    // Nothing goes back to loading; the show is loaded once.
    for (const m of ALL) expect(canEnter(m, 'loading')).toBe(m === 'loading');
    // The mic screen is not somewhere you wander into from a tool.
    expect(canEnter('doodling', 'micLive')).toBe(false);
  });

  it('only idle can record, play, or be edited', () => {
    for (const m of ALL) {
      const r = rulesFor(m);
      if (m === 'idle') {
        expect(r).toEqual({ canRecord: true, canPlay: true, canSelect: true, canEdit: true });
      } else {
        expect(r.canRecord).toBe(false);
        expect(r.canPlay).toBe(false);
        expect(r.canEdit).toBe(false);
      }
    }
  });

  it('a tool keeps the selection it is acting on', () => {
    for (const tool of TOOL_MODES) {
      expect(isTool(tool)).toBe(true);
      expect(rulesFor(tool).canSelect).toBe(true);
      expect(isPlacing(tool)).toBe(true);
    }
    // Drawing belongs to the stage, not to a puppet.
    expect(isTool('doodling')).toBe(false);
    expect(isPlacing('doodling')).toBe(true);
    expect(rulesFor('doodling').canSelect).toBe(false);
  });

  it('knows when the clock is running', () => {
    expect(isBusy('playing')).toBe(true);
    expect(isBusy('recording')).toBe(true);
    expect(ALL.filter(isBusy)).toHaveLength(2);
  });
});
