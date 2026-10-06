// Every place a recipe names an asset, in one list. Bundles, remapping on
// import and garbage collection all walk this, so a new kind of sheet that
// carries a file (video, masks, signal tracks) registers it once here and
// cannot travel without its bytes.

import type { Project, RecipeEvent } from './recipe';

/** Rewrites every asset id the project references through `rename`
 *  (return the same id to keep it). Never mutates. */
export function mapAssetRefs(project: Project, rename: (id: string) => string): Project {
  const events = project.events.map((e): RecipeEvent => {
    if (e.kind === 'CAST' && e.puppet.type === 'cutout') {
      const id = rename(e.puppet.assetId);
      return id === e.puppet.assetId ? e : { ...e, puppet: { ...e.puppet, assetId: id } };
    }
    // A puppet's own take travels with the bit, or the file arrives mute
    // for whoever recorded it.
    if (e.kind === 'VOICE') {
      const id = rename(e.assetId);
      return id === e.assetId ? e : { ...e, assetId: id };
    }
    return e;
  });
  const out: Project = { ...project, events };
  if (project.audio) {
    const id = rename(project.audio.assetId);
    if (id !== project.audio.assetId) out.audio = { ...project.audio, assetId: id };
  }
  return out;
}

/** Every asset id the project references. */
export function assetRefs(project: Project): Set<string> {
  const ids = new Set<string>();
  mapAssetRefs(project, (id) => {
    ids.add(id);
    return id;
  });
  return ids;
}
