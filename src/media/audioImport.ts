// Sound from a file, not only from the mic.
//
// The first screen used to ask a person to talk out loud before anything
// happened at all, which is the widest part of the funnel and the easiest
// to lose someone at. A voice memo, a song, or the audio off a video is a
// bit's spine just as well.
//
// An audio-only container is kept byte for byte: no re-encode, nothing
// lost, and it is the fast path. A container carrying video is decoded to
// its audio track and re-encoded, because storing a whole video to use its
// sound would cost a phone a great deal for nothing.

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { AudioSourceHandle, encodeAudioOnly } from './audio';

export interface ImportedSound {
  blob: Blob;
  durationS: number;
  /** True when the audio had to be re-encoded out of a video container. */
  extracted: boolean;
}

export class NoSoundInFileError extends Error {
  constructor() {
    super('no sound in that file');
    this.name = 'NoSoundInFileError';
  }
}

/** True when the container also carries video, so its audio is worth
 *  extracting rather than storing whole. Throws when there is no decodable
 *  audio at all. */
async function probeForVideo(file: Blob): Promise<boolean> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const audio = await input.getPrimaryAudioTrack();
    if (!audio || !(await audio.canDecode())) throw new NoSoundInFileError();
    return (await input.getPrimaryVideoTrack()) !== null;
  } catch (err) {
    if (err instanceof NoSoundInFileError) throw err;
    throw new NoSoundInFileError();
  } finally {
    input.dispose();
  }
}

/** Probe a picked file and return a blob the show can use as its spine.
 *  Throws NoSoundInFileError when there is no decodable audio. */
export async function importSoundFile(file: Blob): Promise<ImportedSound> {
  const hasVideo = await probeForVideo(file);

  if (!hasVideo) {
    const handle = await AudioSourceHandle.open(file);
    if (!handle) throw new NoSoundInFileError();
    try {
      return { blob: file, durationS: await handle.duration(), extracted: false };
    } finally {
      handle.dispose();
    }
  }

  const handle = await AudioSourceHandle.open(file);
  if (!handle) throw new NoSoundInFileError();
  let out: Blob | null;
  try {
    out = await encodeAudioOnly([handle]);
  } finally {
    handle.dispose();
  }
  if (!out) throw new NoSoundInFileError();

  const probe = await AudioSourceHandle.open(out);
  if (!probe) throw new NoSoundInFileError();
  try {
    return { blob: out, durationS: await probe.duration(), extracted: true };
  } finally {
    probe.dispose();
  }
}

/** What the picker accepts. Video is allowed: we take its audio. */
export const SOUND_FILE_ACCEPT = 'audio/*,video/*';

/** The extension to store the imported blob under. */
export function soundExtension(sound: ImportedSound, file: File | Blob): string {
  if (sound.extracted) return 'mp4';
  const name = 'name' in file && typeof file.name === 'string' ? file.name : '';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'audio';
}
