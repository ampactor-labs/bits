import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteSource,
  drainInbox,
  ensurePersistence,
  getSourceFile,
  listSources,
  saveSource,
  type StoredSource,
} from '../media/opfs';

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

export function Library({
  onOpen,
}: {
  onOpen: (file: File, name: string, sourceId: string) => void;
}) {
  const [sources, setSources] = useState<StoredSource[] | null>(null);
  const [status, setStatus] = useState('');
  const pickerRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setSources(await listSources());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensurePersistence();
      const moved = await drainInbox();
      if (cancelled) return;
      if (moved > 0) setStatus(`${moved} shared file${moved === 1 ? '' : 's'} added`);
      await refresh();
    })().catch((err: unknown) => setStatus(String(err)));
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const onPicked = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setStatus('importing…');
    for (const file of Array.from(files)) {
      await saveSource(file);
    }
    setStatus('');
    await refresh();
  };

  const open = async (s: StoredSource) => {
    onOpen(await getSourceFile(s.id), s.name, s.id);
  };

  const remove = async (s: StoredSource) => {
    await deleteSource(s.id);
    await refresh();
  };

  return (
    <div>
      <input
        ref={pickerRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={(e) => void onPicked(e.target.files)}
      />
      <div className="transport">
        <button className="primary" onClick={() => pickerRef.current?.click()}>
          + import clips
        </button>
        {status && <span className="status">{status}</span>}
      </div>
      {sources === null ? null : sources.length === 0 ? (
        <p className="empty">
          no clips yet.
          <br />
          import something you two shot.
        </p>
      ) : (
        <ul className="source-list">
          {sources.map((s) => (
            <li key={s.id} className="source-row" onClick={() => void open(s)}>
              <span className="name">{s.name}</span>
              <span className="size">{formatBytes(s.bytes)}</span>
              <button
                className="delete"
                aria-label={`delete ${s.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(s);
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
