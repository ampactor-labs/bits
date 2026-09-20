// The landmine the plan named: a group undo whose redo is not its mirror
// re-appends only the first event of the group. For the foley nudge that
// is the remove without the re-add, and the sound is gone.

import { describe, expect, it } from 'vitest';
import { redoStep, tailRun, undoStep, type History } from './history';
import type { RecipeEvent } from './recipe';

const ev = (id: string, group?: string): RecipeEvent =>
  ({ kind: 'DROP', id, at: 0, puppetId: 'p', ...(group ? { group } : {}) }) as RecipeEvent;

const ids = (list: RecipeEvent[]) => list.map((e) => e.id).join(',');
const h = (events: RecipeEvent[], redo: RecipeEvent[] = []): History => ({ events, redo });

describe('tailRun', () => {
  it('is one for a lone event and zero for nothing', () => {
    expect(tailRun([])).toBe(0);
    expect(tailRun([ev('a')])).toBe(1);
    expect(tailRun([ev('a'), ev('b')])).toBe(1);
  });

  it('is the whole run when the tail is grouped', () => {
    expect(tailRun([ev('a'), ev('b', 'g'), ev('c', 'g')])).toBe(2);
    expect(tailRun([ev('a', 'g'), ev('b', 'g'), ev('c', 'g')])).toBe(3);
  });

  it('stops at a different group', () => {
    expect(tailRun([ev('a', 'g1'), ev('b', 'g2'), ev('c', 'g2')])).toBe(2);
  });
});

describe('undo and redo', () => {
  it('pops one event and puts it back', () => {
    const one = undoStep(h([ev('a'), ev('b')]));
    expect(ids(one.events)).toBe('a');
    expect(ids(one.redo)).toBe('b');
    expect(ids(redoStep(one).events)).toBe('a,b');
  });

  it('pops a whole group and puts all of it back, in order', () => {
    const start = h([ev('a'), ev('b', 'g'), ev('c', 'g')]);
    const undone = undoStep(start);
    expect(ids(undone.events)).toBe('a');
    // The stack holds the group reversed, so redo re-appends it forwards.
    expect(ids(undone.redo)).toBe('c,b');
    const back = redoStep(undone);
    expect(ids(back.events)).toBe('a,b,c');
    expect(back.redo).toHaveLength(0);
  });

  it('is a round trip for any mix of groups and singles', () => {
    const start = h([ev('a'), ev('b', 'g1'), ev('c', 'g1'), ev('d'), ev('e', 'g2'), ev('f', 'g2')]);
    let cur = start;
    for (let i = 0; i < 3; i++) cur = undoStep(cur);
    expect(ids(cur.events)).toBe('a');
    for (let i = 0; i < 3; i++) cur = redoStep(cur);
    expect(ids(cur.events)).toBe(ids(start.events));
    expect(cur.redo).toHaveLength(0);
  });

  it('does nothing at either end', () => {
    expect(undoStep(h([]))).toEqual(h([]));
    expect(redoStep(h([ev('a')]))).toEqual(h([ev('a')]));
  });

  it('never mutates what it was handed', () => {
    const events = [ev('a'), ev('b', 'g'), ev('c', 'g')];
    const redo = [ev('z')];
    const before = { events: ids(events), redo: ids(redo), n: events.length };
    undoStep(h(events, redo));
    redoStep(h(events, redo));
    expect(ids(events)).toBe(before.events);
    expect(ids(redo)).toBe(before.redo);
    expect(events).toHaveLength(before.n);
  });

  it('keeps two groups apart when they are undone back to back', () => {
    let cur = h([ev('a', 'g1'), ev('b', 'g1'), ev('c', 'g2'), ev('d', 'g2')]);
    cur = undoStep(cur);
    cur = undoStep(cur);
    expect(cur.events).toHaveLength(0);
    expect(ids(cur.redo)).toBe('d,c,b,a');
    cur = redoStep(cur);
    // The most recent group comes back first and comes back whole.
    expect(ids(cur.events)).toBe('a,b');
    cur = redoStep(cur);
    expect(ids(cur.events)).toBe('a,b,c,d');
  });
});
