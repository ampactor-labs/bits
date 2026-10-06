// What a show's sound says, decoded once. The preview and the export call
// the same functions on the same bytes, so a mouth cannot flap differently
// in the film than it did on the stage.

import { computeVoiceTrack, EMPTY_VOICE } from '../engine/envelope';
import type { Analysis, OwnVoice } from '../engine/frame';
import { detectOnsets } from '../engine/onsets';
import type { Project } from '../engine/recipe';
import { castOf, voiceOf } from '../engine/show';
import { decodeMono, mixdownMono } from './audio';
import { bandsFor } from './bands';

/** The bit's own track: loudness, visemes and the beat grid. */
export async function analyzeBed(blob: Blob | null): Promise<Pick<Analysis, 'voice' | 'onsets'>> {
  const mix = blob ? await mixdownMono(blob) : null;
  if (!mix) return { voice: EMPTY_VOICE, onsets: [] };
  return {
    voice: computeVoiceTrack(mix.samples, mix.sampleRate),
    onsets: detectOnsets(mix.samples, mix.sampleRate),
  };
}

/** One puppet's take, decoded and placed in show time. */
export interface VoicePcm {
  samples: Float32Array;
  sampleRate: number;
  at: number;
  gain: number;
}

/** Every take the recipe names, decoded twice: once coarse for the
 *  envelope that drives its mouth, once at full rate for the mix. A take
 *  that will not open leaves its puppet on the bed, which is what it had
 *  before anyone recorded for it. */
export async function collectVoices(
  project: Project,
  getAssetBlob: (assetId: string) => Promise<Blob>,
): Promise<{ voices: Map<string, OwnVoice>; pcm: VoicePcm[] }> {
  const voices = new Map<string, OwnVoice>();
  const pcm: VoicePcm[] = [];
  for (const p of castOf(project)) {
    const own = voiceOf(project, p.id);
    if (!own) continue;
    try {
      const blob = await getAssetBlob(own.assetId);
      const env = await mixdownMono(blob);
      const full = await decodeMono(blob);
      if (env) {
        voices.set(p.id, {
          track: computeVoiceTrack(env.samples, env.sampleRate),
          at: own.at,
          durationS: own.durationS,
        });
      }
      if (full) pcm.push({ ...full, at: own.at, gain: own.gain ?? 1 });
    } catch {
      // A missing take leaves that puppet on the bed.
    }
  }
  return { voices, pcm };
}

/** Everything: the bed plus every puppet's own take. The takes' full-rate
 *  samples come back too, for whoever mixes them. */
export async function analyzeShow(
  project: Project,
  bed: Blob | null,
  getAssetBlob: (assetId: string) => Promise<Blob>,
): Promise<{ analysis: Analysis; pcm: VoicePcm[] }> {
  const { voice, onsets } = await analyzeBed(bed);
  const { voices, pcm } = await collectVoices(project, getAssetBlob);
  // Bands only when a wire listens to them: they cost a decode and a few
  // thousand FFTs.
  const bands =
    bed && project.audio && usesBands(project) ? await bandsFor(project.audio.assetId, bed) : null;
  return { analysis: { voice, onsets, voices, bands }, pcm };
}

/** True when some wire reads a band or the brightness. */
export function usesBands(project: Project): boolean {
  return project.events.some(
    (e) => e.kind === 'WIRE' && (e.from.startsWith('band:') || e.from === 'bright'),
  );
}
