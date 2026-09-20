import { describe, expect, it } from 'vitest';
import { soundExtension } from './audioImport';

describe('soundExtension', () => {
  const kept = { blob: new Blob(), durationS: 1, extracted: false };
  const extracted = { blob: new Blob(), durationS: 1, extracted: true };

  it('keeps the original extension when the file was stored as-is', () => {
    expect(soundExtension(kept, new File([], 'chorus.mp3'))).toBe('mp3');
    expect(soundExtension(kept, new File([], 'Voice Memo.M4A'))).toBe('m4a');
  });

  it('stores extracted audio as mp4 whatever the video was called', () => {
    expect(soundExtension(extracted, new File([], 'clip.mov'))).toBe('mp4');
  });

  it('falls back when a name carries no usable extension', () => {
    expect(soundExtension(kept, new File([], 'no-extension'))).toBe('audio');
    expect(soundExtension(kept, new File([], 'weird.tooooolong'))).toBe('audio');
    expect(soundExtension(kept, new Blob())).toBe('audio');
  });
});
