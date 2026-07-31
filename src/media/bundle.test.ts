import { describe, expect, it } from 'vitest';
import { appendEvent, createProject, type Project, type RecipeEvent } from '../engine/recipe';
import { referencedAssets, remapAssetIds } from './bundle';

const cutoutCast = (puppetId: string, assetId: string): RecipeEvent => ({
  kind: 'CAST',
  id: `c-${puppetId}-${assetId}`,
  at: 0,
  puppetId,
  puppet: { type: 'cutout', assetId, w: 0.3, h: 0.3 },
  x: 0.5,
  y: 0.5,
  scale: 1,
  rot: 0,
});

const doodleCast = (puppetId: string): RecipeEvent => ({
  kind: 'CAST',
  id: `d-${puppetId}`,
  at: 0,
  puppetId,
  puppet: { type: 'doodle', strokes: [[0, 0, 1, 1]], w: 0.2, h: 0.2 },
  x: 0.5,
  y: 0.5,
  scale: 1,
  rot: 0,
});

const show = (events: RecipeEvent[], audio?: Project['audio']): Project => ({
  ...events.reduce((p, e) => appendEvent(p, e), createProject('bundle test')),
  ...(audio ? { audio } : {}),
});

describe('referencedAssets', () => {
  it('collects the audio spine and every cutout cast, nothing else', () => {
    const proj = show(
      [cutoutCast('a', 'x.png'), cutoutCast('a', 'y.png'), doodleCast('b')],
      { assetId: 'bit.webm', durationS: 4 },
    );
    expect(referencedAssets(proj)).toEqual(new Set(['bit.webm', 'x.png', 'y.png']));
  });

  it('is empty for a fresh project', () => {
    expect(referencedAssets(createProject('empty'))).toEqual(new Set());
  });
});

describe('remapAssetIds', () => {
  it('rewrites the audio ref and every mapped cutout cast', () => {
    const proj = show([cutoutCast('a', 'old.png'), cutoutCast('a', 'old.png')], {
      assetId: 'old.webm',
      durationS: 4,
    });
    const out = remapAssetIds(
      proj,
      new Map([
        ['old.webm', 'new.webm'],
        ['old.png', 'new.png'],
      ]),
    );
    expect(out.audio?.assetId).toBe('new.webm');
    const ids = out.events.map((e) =>
      e.kind === 'CAST' && e.puppet.type === 'cutout' ? e.puppet.assetId : null,
    );
    expect(ids).toEqual(['new.png', 'new.png']);
  });

  it('leaves unmapped ids and non-cutout events untouched', () => {
    const proj = show([cutoutCast('a', 'kept.png'), doodleCast('b')], {
      assetId: 'kept.webm',
      durationS: 2,
    });
    const out = remapAssetIds(proj, new Map([['other.png', 'new.png']]));
    expect(out.audio?.assetId).toBe('kept.webm');
    expect(out.events).toEqual(proj.events);
  });

  it('does not mutate the input project', () => {
    const proj = show([cutoutCast('a', 'old.png')], { assetId: 'old.webm', durationS: 1 });
    remapAssetIds(
      proj,
      new Map([
        ['old.webm', 'new.webm'],
        ['old.png', 'new.png'],
      ]),
    );
    expect(proj.audio?.assetId).toBe('old.webm');
    const first = proj.events[0]!;
    expect(first.kind === 'CAST' && first.puppet.type === 'cutout' && first.puppet.assetId).toBe(
      'old.png',
    );
  });
});
