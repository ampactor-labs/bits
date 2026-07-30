import { describe, expect, it } from 'vitest';
import {
  appendEvent,
  createProject,
  parseProject,
  serializeProject,
  type RecipeEvent,
} from './recipe';

const cast = (puppetId: string): RecipeEvent => ({
  kind: 'CAST',
  id: `c-${puppetId}`,
  at: 0,
  puppetId,
  puppet: { type: 'rect', color: '#f0883e', w: 0.2, h: 0.2 },
  x: 0.5,
  y: 0.5,
  scale: 1,
  rot: 0,
});

describe('recipe v0', () => {
  it('roundtrips a full show through serialize/parse identically', () => {
    let p = createProject('test bit');
    p = { ...p, audio: { assetId: 'a1.webm', durationS: 12.5 } };
    p = appendEvent(p, cast('hero'));
    p = appendEvent(p, {
      kind: 'PASS',
      id: 'p1',
      at: 0.5,
      puppetId: 'hero',
      samples: [0.5, 0.1, 0.1, 1.5, 0.9, 0.9],
    });
    p = appendEvent(p, { kind: 'SNIP', id: 's1', at: 0, puppetId: 'hero', x0: 0, y0: 0.3, x1: 1, y1: 0.32 });
    p = appendEvent(p, { kind: 'MOUTH', id: 'm1', at: 0, puppetId: 'hero', mx: 0.5, my: 0.25, size: 0.2 });
    p = appendEvent(p, { kind: 'DROP', id: 'd1', at: 0, puppetId: 'hero' });
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it('appendEvent never mutates the original', () => {
    const p = createProject('immutability');
    const p2 = appendEvent(p, cast('a'));
    expect(p.events).toHaveLength(0);
    expect(p2.events).toHaveLength(1);
  });

  it('rejects unknown versions and garbage', () => {
    const doc = JSON.parse(serializeProject(createProject('future'))) as Record<string, unknown>;
    doc.version = 999;
    expect(() => parseProject(JSON.stringify(doc))).toThrow(/unsupported version/);
    expect(() => parseProject('nope')).toThrow(/not valid JSON/);
    expect(() => parseProject('42')).toThrow(/not an object/);
  });

  it('rejects malformed events of each kind', () => {
    const withEvent = (e: object) => {
      const doc = JSON.parse(serializeProject(createProject('bad'))) as { events: object[] };
      doc.events.push({ id: 'x', at: 0, ...e });
      return JSON.stringify(doc);
    };
    expect(() => parseProject(withEvent({ kind: 'PASS', puppetId: 'a', samples: [1, 2] }))).toThrow(
      /sample triples/,
    );
    expect(() => parseProject(withEvent({ kind: 'SNIP', puppetId: 'a', x0: 0 }))).toThrow(/line/);
    expect(() =>
      parseProject(withEvent({ kind: 'MOUTH', puppetId: 'a', mx: 0.5, my: 0.5, size: 0 })),
    ).toThrow(/positive size/);
    expect(() => parseProject(withEvent({ kind: 'CAST', puppetId: 'a' }))).toThrow(/CAST event/);
    expect(() => parseProject(withEvent({ kind: 'WIGGLE', puppetId: 'a' }))).toThrow(/unknown event/);
    expect(() => parseProject(withEvent({ kind: 'PASS', samples: [0, 0, 0] }))).toThrow(/puppetId/);
  });
});
