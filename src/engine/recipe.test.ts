import { describe, expect, it } from 'vitest';
import {
  appendEvent,
  createProject,
  eventsInOrder,
  parseProject,
  serializeProject,
  type CutEvent,
  type SpeedEvent,
} from './recipe';

const cut = (id: string, at: number, atQ?: number): CutEvent =>
  atQ === undefined ? { kind: 'CUT', id, at } : { kind: 'CUT', id, at, atQ };

describe('recipe v0', () => {
  it('roundtrips through serialize/parse identically', () => {
    let p = createProject('test bit');
    p = appendEvent(p, cut('e1', 1.5));
    const speed: SpeedEvent = { kind: 'SPEED', id: 'e2', at: 2.0, rate: 0.25, attackS: 0.1 };
    p = appendEvent(p, speed);
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it('appendEvent never mutates the original', () => {
    const p = createProject('immutability');
    const p2 = appendEvent(p, cut('e1', 0.5));
    expect(p.events).toHaveLength(0);
    expect(p2.events).toHaveLength(1);
  });

  it('orders events by quantized time when present, raw otherwise', () => {
    let p = createProject('ordering');
    p = appendEvent(p, cut('late-raw-early-q', 3.0, 0.5));
    p = appendEvent(p, cut('plain', 1.0));
    const ordered = eventsInOrder(p).map((e) => e.id);
    expect(ordered).toEqual(['late-raw-early-q', 'plain']);
  });

  it('keeps append order for exact ties', () => {
    let p = createProject('ties');
    p = appendEvent(p, cut('first', 1.0));
    p = appendEvent(p, cut('second', 1.0));
    expect(eventsInOrder(p).map((e) => e.id)).toEqual(['first', 'second']);
  });

  it('rejects unknown versions', () => {
    const p = createProject('future');
    const doc = JSON.parse(serializeProject(p)) as Record<string, unknown>;
    doc.version = 999;
    expect(() => parseProject(JSON.stringify(doc))).toThrow(/unsupported version/);
  });

  it('rejects garbage and malformed events', () => {
    expect(() => parseProject('not json at all')).toThrow(/not valid JSON/);
    expect(() => parseProject('42')).toThrow(/not an object/);
    const p = createProject('bad-event');
    const doc = JSON.parse(serializeProject(p)) as { events: unknown[] };
    doc.events.push({ kind: 'CUT', at: 'when the vibe hits' });
    expect(() => parseProject(JSON.stringify(doc))).toThrow(/malformed event/);
  });
});
