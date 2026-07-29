// Async iteration members of FileSystemDirectoryHandle are shipped in every
// Chromium the app targets but lag in TypeScript's lib.dom. Interface merging
// is a no-op once lib.dom catches up.
interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<FileSystemHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}
