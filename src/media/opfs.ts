// OPFS project store: one JSON recipe per show.
//
// Deleting is a two-step: the recipe moves to trash/ and its assets are
// only collected once the undo window has closed. An interrupted window
// leaves the recipe in trash/, which the next launch sweeps, so a tab
// closing mid-undo can neither lose a bit nor leak its storage.

const PROJECTS = 'projects';
const TRASH = 'trash';

async function dir(name: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(name, { create: true });
}

export async function saveProjectJson(id: string, json: string): Promise<void> {
  const d = await dir(PROJECTS);
  const handle = await d.getFileHandle(`${id}.json`, { create: true });
  const writable = await handle.createWritable();
  await writable.write(json);
  await writable.close();
}

export async function loadProjectJson(id: string): Promise<string | null> {
  const d = await dir(PROJECTS);
  try {
    const handle = await d.getFileHandle(`${id}.json`);
    return await (await handle.getFile()).text();
  } catch {
    return null;
  }
}

export async function listProjectIds(prefix: string): Promise<string[]> {
  const d = await dir(PROJECTS);
  const out: string[] = [];
  for await (const [entryName, handle] of d.entries()) {
    if (handle.kind === 'file' && entryName.startsWith(prefix) && entryName.endsWith('.json')) {
      out.push(entryName.slice(0, -'.json'.length));
    }
  }
  return out.sort().reverse();
}

export async function deleteProject(id: string): Promise<void> {
  const d = await dir(PROJECTS);
  await d.removeEntry(`${id}.json`).catch(() => {});
}

async function move(from: string, to: string, id: string): Promise<boolean> {
  const src = await dir(from);
  let text: string;
  try {
    const handle = await src.getFileHandle(`${id}.json`);
    text = await (await handle.getFile()).text();
  } catch {
    return false;
  }
  const dst = await dir(to);
  const out = await dst.getFileHandle(`${id}.json`, { create: true });
  const writable = await out.createWritable();
  await writable.write(text);
  await writable.close();
  await src.removeEntry(`${id}.json`).catch(() => {});
  return true;
}

/** Soft delete: the bit leaves the list but nothing is collected yet. */
export function moveProjectToTrash(id: string): Promise<boolean> {
  return move(PROJECTS, TRASH, id);
}

/** Undo of the above, while the toast is still up. */
export function restoreProjectFromTrash(id: string): Promise<boolean> {
  return move(TRASH, PROJECTS, id);
}

export async function listTrashedIds(): Promise<string[]> {
  const d = await dir(TRASH);
  const out: string[] = [];
  for await (const [entryName, handle] of d.entries()) {
    if (handle.kind === 'file' && entryName.endsWith('.json')) {
      out.push(entryName.slice(0, -'.json'.length));
    }
  }
  return out;
}

export async function loadTrashedJson(id: string): Promise<string | null> {
  const d = await dir(TRASH);
  try {
    const handle = await d.getFileHandle(`${id}.json`);
    return await (await handle.getFile()).text();
  } catch {
    return null;
  }
}

/** Final removal, once the assets have been collected. */
export async function purgeTrashed(id: string): Promise<void> {
  const d = await dir(TRASH);
  await d.removeEntry(`${id}.json`).catch(() => {});
}

export async function ensurePersistence(): Promise<boolean> {
  if (!navigator.storage.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
