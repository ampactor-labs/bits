// Undo and redo over an append-only log.
//
// Undo is popping the tail, which is the whole point of the recipe. The
// only complication is a group: events committed together, sharing a
// group id, forming a contiguous run at the end. Undo takes the run.
//
// Redo has to be its mirror, and the obvious implementation is not. Pop a
// group onto a flat stack in log order and redo re-appends only its first
// event — which for the foley nudge is the remove without the re-add, so
// the sound vanishes. The stack holds a group in reverse, and redo keeps
// popping while the next event belongs to the same group.

import type { RecipeEvent } from './recipe';

export interface History {
  events: RecipeEvent[];
  /** Undone events, newest last. A group sits here reversed. */
  redo: RecipeEvent[];
}

/** How many events at the tail belong to the last one's group. */
export function tailRun(events: RecipeEvent[]): number {
  const last = events[events.length - 1];
  if (!last) return 0;
  if (!last.group) return 1;
  let n = 1;
  while (n < events.length && events[events.length - 1 - n]?.group === last.group) n += 1;
  return n;
}

/** Take the tail run off the log and onto the redo stack. */
export function undoStep(h: History): History {
  const n = tailRun(h.events);
  if (n === 0) return h;
  const removed = h.events.slice(h.events.length - n);
  // Reversed, so redo pops them back in the order they were committed.
  const redo = [...h.redo];
  for (let i = removed.length - 1; i >= 0; i--) redo.push(removed[i]!);
  return { events: h.events.slice(0, h.events.length - n), redo };
}

/** Put the newest undone group back, in its original order. */
export function redoStep(h: History): History {
  const redo = [...h.redo];
  const first = redo.pop();
  if (!first) return h;
  const batch: RecipeEvent[] = [first];
  if (first.group) {
    while (redo.length > 0 && redo[redo.length - 1]?.group === first.group) batch.push(redo.pop()!);
  }
  return { events: [...h.events, ...batch], redo };
}
