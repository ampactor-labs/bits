// OPFS project store: one JSON recipe per show.

const PROJECTS = 'projects';

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

export async function ensurePersistence(): Promise<boolean> {
  if (!navigator.storage.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
