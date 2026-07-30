// A bit as one file: the recipe plus every asset it references, base64 in a
// single JSON. Send it to someone, they open it, the whole show is theirs to
// re-perform. The recipe-in-export stance, made portable.

import { parseProject, serializeProject, type Project } from '../engine/recipe';
import { getAsset, restoreAsset } from './assets';

const BUNDLE_KIND = 'bits-bundle';
const BUNDLE_VERSION = 0;

interface Bundle {
  kind: typeof BUNDLE_KIND;
  version: typeof BUNDLE_VERSION;
  recipe: string;
  /** assetId -> data URL (mime + base64 in one string). */
  assets: Record<string, string>;
}

function referencedAssets(project: Project): Set<string> {
  const ids = new Set<string>();
  if (project.audio) ids.add(project.audio.assetId);
  for (const e of project.events) {
    if (e.kind === 'CAST' && e.puppet.type === 'cutout') ids.add(e.puppet.assetId);
  }
  return ids;
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
  const name = `${(project.title || 'bit').replace(/[^\w -]/g, '')}.bit.json`;
  return new File([JSON.stringify(bundle)], name, { type: 'application/json' });
}

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
  for (const [id, dataUrl] of Object.entries(b.assets ?? {})) {
    if (typeof dataUrl !== 'string') continue;
    const blob = await (await fetch(dataUrl)).blob();
    await restoreAsset(id, blob);
  }
  return project;
}
