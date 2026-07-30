// Generic OPFS asset store: cutout PNGs, recorded audio, anything a show
// references by id.

const ASSETS = 'assets';

async function assetsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(ASSETS, { create: true });
}

export async function saveAsset(blob: Blob, ext: string): Promise<string> {
  const id = `${crypto.randomUUID()}.${ext.replace(/[^a-z0-9]/gi, '')}`;
  const d = await assetsDir();
  const handle = await d.getFileHandle(id, { create: true });
  const writable = await handle.createWritable();
  await blob.stream().pipeTo(writable);
  return id;
}

export async function getAsset(id: string): Promise<File> {
  const d = await assetsDir();
  const handle = await d.getFileHandle(id);
  return handle.getFile();
}

export async function deleteAsset(id: string): Promise<void> {
  const d = await assetsDir();
  await d.removeEntry(id).catch(() => {});
}
