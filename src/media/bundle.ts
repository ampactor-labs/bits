// A bit as one file: the recipe plus every asset it references, base64 in a
// single JSON. Send it to someone, they open it, the whole show is theirs to
// re-perform. The recipe-in-export stance, made portable.
//
// Import copies assets under fresh ids, so an imported bit never shares
// anything with the bit it came from and double-imports stay independent.
// Duplicating a bit on this phone is the one case that does share, and
// collection checks who else is using an asset before dropping it.

import { assetRefs, mapAssetRefs } from '../engine/assetRefs';
import { parseProject, serializeProject, type Project } from '../engine/recipe';
import { getAsset, saveAsset } from './assets';

const BUNDLE_KIND = 'bits-bundle';
const BUNDLE_VERSION = 0;

interface Bundle {
  kind: typeof BUNDLE_KIND;
  version: typeof BUNDLE_VERSION;
  recipe: string;
  /** assetId -> data URL (mime + base64 in one string). */
  assets: Record<string, string>;
}

/** Every asset id the recipe can reach: the audio spine and cutout casts. */
export function referencedAssets(project: Project): Set<string> {
  return assetRefs(project);
}

/** Rewrite every asset reference through the mapping. Unmapped ids stay:
 *  their assets were absent from the bundle and stay absent on device. */
export function remapAssetIds(project: Project, map: Map<string, string>): Project {
  return mapAssetRefs(project, (id) => map.get(id) ?? id);
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('could not read asset'));
    reader.readAsDataURL(blob);
  });

export async function exportBundle(project: Project): Promise<File> {
  const assets: Record<string, string> = {};
  for (const id of referencedAssets(project)) {
    try {
      assets[id] = await blobToDataUrl(await getAsset(id));
    } catch {
      // A missing asset exports as absent; import degrades the same way.
    }
  }
  const bundle: Bundle = {
    kind: BUNDLE_KIND,
    version: BUNDLE_VERSION,
    recipe: serializeProject(project),
    assets,
  };
  const stem = (project.title || 'bit').replace(/[^\w -]/g, '').trim();
  return new File([JSON.stringify(bundle)], `${stem || 'bit'}.bit.json`, {
    type: 'application/json',
  });
}

const extOf = (id: string): string => {
  const dot = id.lastIndexOf('.');
  return dot > 0 ? id.slice(dot + 1) : 'bin';
};

export async function importBundle(file: File): Promise<Project> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error('not a bit file');
  }
  const b = raw as Partial<Bundle>;
  if (b.kind !== BUNDLE_KIND || typeof b.recipe !== 'string' || typeof b.assets !== 'object') {
    throw new Error('not a bit file');
  }
  if (b.version !== BUNDLE_VERSION) throw new Error('bit file from a newer BITS');
  const project = parseProject(b.recipe);
  // Only referenced assets land; anything else in the file would be an
  // orphan no show could ever collect.
  const wanted = referencedAssets(project);
  const map = new Map<string, string>();
  for (const [id, dataUrl] of Object.entries(b.assets ?? {})) {
    if (typeof dataUrl !== 'string' || !wanted.has(id)) continue;
    const blob = await (await fetch(dataUrl)).blob();
    map.set(id, await saveAsset(blob, extOf(id)));
  }
  return remapAssetIds(project, map);
}
