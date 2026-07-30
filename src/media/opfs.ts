// Origin-private file system store for source media. Filenames carry the id
// and the original name: "<uuid>--<original-name>".

const SOURCES = 'sources';
const INBOX = 'inbox';

export interface StoredSource {
  id: string;
  name: string;
  bytes: number;
  lastModified: number;
}

async function dir(name: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(name, { create: true });
}

function sanitizeName(name: string): string {
  return name.replaceAll('/', '_').replaceAll('\\', '_').slice(0, 120) || 'clip';
}

function splitEntryName(entryName: string): { id: string; name: string } {
  const sep = entryName.indexOf('--');
  if (sep === -1) return { id: entryName, name: entryName };
  return { id: entryName, name: entryName.slice(sep + 2) };
}

async function writeFileTo(dirHandle: FileSystemDirectoryHandle, entryName: string, file: File) {
  const handle = await dirHandle.getFileHandle(entryName, { create: true });
  const writable = await handle.createWritable();
  await file.stream().pipeTo(writable);
}

export async function saveSource(file: File): Promise<StoredSource> {
  const entryName = `${crypto.randomUUID()}--${sanitizeName(file.name)}`;
  await writeFileTo(await dir(SOURCES), entryName, file);
  const { name } = splitEntryName(entryName);
  return { id: entryName, name, bytes: file.size, lastModified: file.lastModified };
}

export async function listSources(): Promise<StoredSource[]> {
  const d = await dir(SOURCES);
  const out: StoredSource[] = [];
  for await (const [entryName, handle] of d.entries()) {
    if (handle.kind !== 'file') continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    const { name } = splitEntryName(entryName);
    out.push({ id: entryName, name, bytes: file.size, lastModified: file.lastModified });
  }
  out.sort((a, b) => b.lastModified - a.lastModified);
  return out;
}

export async function getSourceFile(id: string): Promise<File> {
  const d = await dir(SOURCES);
  const handle = await d.getFileHandle(id);
  return handle.getFile();
}

export async function deleteSource(id: string): Promise<void> {
  const d = await dir(SOURCES);
  await d.removeEntry(id);
}

/** Files the service worker stashed from Android share-target land in inbox/;
 *  move them into sources/ on app start. */
export async function drainInbox(): Promise<number> {
  const inbox = await dir(INBOX);
  const sources = await dir(SOURCES);
  let moved = 0;
  for await (const [entryName, handle] of inbox.entries()) {
    if (handle.kind !== 'file') continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    const target = entryName.includes('--')
      ? entryName
      : `${crypto.randomUUID()}--${sanitizeName(entryName)}`;
    await writeFileTo(sources, target, file);
    await inbox.removeEntry(entryName);
    moved += 1;
  }
  return moved;
}

const PROJECTS = 'projects';

/** One project per source for now, keyed by the source's entry name. */
export async function saveProjectJson(sourceId: string, json: string): Promise<void> {
  const d = await dir(PROJECTS);
  const handle = await d.getFileHandle(`${sourceId}.json`, { create: true });
  const writable = await handle.createWritable();
  await writable.write(json);
  await writable.close();
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

export async function loadProjectJson(sourceId: string): Promise<string | null> {
  const d = await dir(PROJECTS);
  try {
    const handle = await d.getFileHandle(`${sourceId}.json`);
    return await (await handle.getFile()).text();
  } catch {
    return null;
  }
}

export async function ensurePersistence(): Promise<boolean> {
  if (!navigator.storage.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
