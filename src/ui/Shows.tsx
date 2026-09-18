import { useCallback, useEffect, useRef, useState } from 'react';
import { parseProject, serializeProject } from '../engine/recipe';
import { deleteAsset } from '../media/assets';
import { importBundle, referencedAssets } from '../media/bundle';
import {
  deleteProject,
  ensurePersistence,
  listProjectIds,
  listTrashedIds,
  loadProjectJson,
  loadTrashedJson,
  moveProjectToTrash,
  purgeTrashed,
  restoreProjectFromTrash,
  saveProjectJson,
} from '../media/opfs';
import { Sheet } from '../kit/Sheet';
import { IconButton } from '../kit/IconButton';
import { useToast } from '../kit/Toast';
import { useBanner } from '../kit/Banner';

const SHOW_PREFIX = 'show-';
const DEMO_FLAG = 'bits-demo-v3';

/** Timestamp keeps the list newest-first; the suffix keeps two imports in
 *  the same millisecond from landing on one id. */
const freshShowId = () => `${SHOW_PREFIX}${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;

interface ShowRow {
  id: string;
  title: string;
  passes: number;
}

async function loadRows(): Promise<ShowRow[]> {
  const ids = await listProjectIds(SHOW_PREFIX);
  const out: ShowRow[] = [];
  for (const id of ids) {
    const json = await loadProjectJson(id);
    if (!json) continue;
    try {
      const p = parseProject(json);
      out.push({
        id,
        title: p.title,
        passes: p.events.filter((e) => e.kind === 'PASS').length,
      });
    } catch {
      out.push({ id, title: id, passes: 0 });
    }
  }
  return out;
}

/** Collect the assets a trashed recipe owned, then drop the recipe. */
async function collectTrashed(id: string): Promise<void> {
  const json = await loadTrashedJson(id);
  if (json) {
    try {
      const p = parseProject(json);
      for (const assetId of referencedAssets(p)) await deleteAsset(assetId);
    } catch {
      // Unparseable: drop the recipe alone.
    }
  }
  await purgeTrashed(id);
}

/** Anything left in the trash from a previous visit: the undo window
 *  closed when the tab did, so finish the job now. */
async function sweepTrash(): Promise<void> {
  for (const id of await listTrashedIds()) await collectTrashed(id);
}

type Menu = { kind: 'menu'; row: ShowRow } | { kind: 'rename'; row: ShowRow } | null;

export function Shows({ onOpen }: { onOpen: (showId: string) => void }) {
  const [rows, setRows] = useState<ShowRow[] | null>(null);
  const [status, setStatus] = useState('');
  const [menu, setMenu] = useState<Menu>(null);
  const [renameText, setRenameText] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const onOpenRef = useRef(onOpen);
  const toast = useToast();
  const banner = useBanner();
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  const openDemo = useCallback(async () => {
    try {
      const { buildDemoShow } = await import('../demo/demoBit');
      const demoId = await buildDemoShow();
      // Only once it exists: writing the flag first meant a failure or a
      // closed tab lost the tutorial forever (audit F27).
      localStorage.setItem(DEMO_FLAG, '1');
      onOpenRef.current(demoId);
    } catch {
      banner.error('could not build the demo');
    }
  }, [banner]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensurePersistence();
      await sweepTrash();
      // First exposure: seed the demo bit and walk straight onto its stage.
      if (!localStorage.getItem(DEMO_FLAG)) {
        const existing = await listProjectIds(SHOW_PREFIX);
        if (existing.length === 0) {
          try {
            const { buildDemoShow } = await import('../demo/demoBit');
            const demoId = await buildDemoShow();
            localStorage.setItem(DEMO_FLAG, '1');
            if (!cancelled) {
              onOpenRef.current(demoId);
              return;
            }
          } catch {
            // No demo is better than a broken welcome, and the flag stays
            // unset so the next launch tries again.
          }
        }
      }
      const loaded = await loadRows();
      if (!cancelled) setRows(loaded);
    })().catch(() => setRows([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const newShow = () => onOpen(freshShowId());

  const importBit = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setStatus('opening…');
    try {
      const project = await importBundle(file);
      const id = freshShowId();
      await saveProjectJson(id, serializeProject(project));
      setStatus('');
      onOpen(id);
    } catch (err) {
      setStatus('');
      banner.error(err instanceof Error ? err.message : String(err));
    }
  };

  /** Soft delete. The row goes, the recipe waits in the trash, and the
   *  assets are only collected once the undo window closes (audit F6). */
  const remove = async (row: ShowRow) => {
    setMenu(null);
    const moved = await moveProjectToTrash(row.id);
    if (!moved) {
      await deleteProject(row.id);
      setRows(await loadRows());
      return;
    }
    setRows(await loadRows());
    toast.undoable(
      `deleted ${row.title}`,
      () => {
        void (async () => {
          await restoreProjectFromTrash(row.id);
          setRows(await loadRows());
        })();
      },
      () => void collectTrashed(row.id),
    );
  };

  const commitRename = async (row: ShowRow, title: string) => {
    setMenu(null);
    const trimmed = title.trim();
    if (!trimmed) return;
    const json = await loadProjectJson(row.id);
    if (!json) return;
    try {
      const p = parseProject(json);
      await saveProjectJson(row.id, serializeProject({ ...p, title: trimmed }));
      setRows(await loadRows());
    } catch {
      banner.error('that bit could not be renamed');
    }
  };

  return (
    <div>
      <div className="transport">
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            void importBit(e.target.files);
            e.target.value = '';
          }}
        />
        <button className="primary" onClick={newShow}>
          + new bit
        </button>
        <button onClick={() => importRef.current?.click()}>open a bit file</button>
        {status && <span className="status">{status}</span>}
      </div>
      {rows === null ? null : rows.length === 0 ? (
        <div className="empty">
          <p>no bits yet.</p>
          <p>record the sound, cast some puppets, put on the show.</p>
          <button onClick={() => void openDemo()}>open the demo</button>
        </div>
      ) : (
        <ul className="source-list">
          {rows.map((r) => (
            <li key={r.id} className="source-row">
              <button className="row-open" onClick={() => onOpen(r.id)}>
                <span className="name">{r.title}</span>
                <span className="size">
                  {r.passes} pass{r.passes === 1 ? '' : 'es'}
                </span>
              </button>
              <IconButton
                icon="more"
                label={`more for ${r.title}`}
                onClick={() => {
                  setRenameText(r.title);
                  setMenu({ kind: 'menu', row: r });
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {menu?.kind === 'menu' && (
        <Sheet title={menu.row.title} onClose={() => setMenu(null)}>
          <button onClick={() => setMenu({ kind: 'rename', row: menu.row })}>rename</button>
          <button onClick={() => void remove(menu.row)}>delete</button>
        </Sheet>
      )}

      {menu?.kind === 'rename' && (
        <Sheet title="name this bit" onClose={() => setMenu(null)}>
          <input
            className="text-field"
            value={renameText}
            autoFocus
            aria-label="bit name"
            onChange={(e) => setRenameText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename(menu.row, renameText);
            }}
          />
          <button className="primary" onClick={() => void commitRename(menu.row, renameText)}>
            save
          </button>
        </Sheet>
      )}
    </div>
  );
}
