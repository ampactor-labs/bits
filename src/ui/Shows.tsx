import { useCallback, useEffect, useRef, useState } from 'react';
import { parseProject, serializeProject, type Project } from '../engine/recipe';
import { castOf } from '../engine/show';
import { ShowPoster } from './ShowPoster';
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
import { onInstallAvailable, promptInstall } from '../pwa/install';
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
  cast: number;
  durationS: number;
  updatedAt: string;
  remixOf: string | null;
  project: Project | null;
}

/** "3 passes · 0:12 · yesterday". The list used to say only the title and
 *  a pass count, so three bits called "untitled bit" were one bit three
 *  times over (audit F35). */
export function rowSummary(row: ShowRow, now = Date.now()): string {
  const bits: string[] = [];
  if (row.cast > 0) bits.push(`${row.cast} in the cast`);
  bits.push(`${row.passes} pass${row.passes === 1 ? '' : 'es'}`);
  if (row.durationS > 0) {
    bits.push(
      `${Math.floor(row.durationS / 60)}:${Math.floor(row.durationS % 60)
        .toString()
        .padStart(2, '0')}`,
    );
  }
  const when = Date.parse(row.updatedAt);
  if (!Number.isNaN(when)) {
    const days = Math.floor((now - when) / 86400000);
    bits.push(days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`);
  }
  return bits.join(' · ');
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
        cast: castOf(p).length,
        durationS: p.audio?.durationS ?? 0,
        updatedAt: p.updatedAt ?? p.createdAt,
        remixOf: p.remixOf?.title ?? null,
        project: p,
      });
    } catch {
      out.push({
        id,
        title: id,
        passes: 0,
        cast: 0,
        durationS: 0,
        updatedAt: '',
        remixOf: null,
        project: null,
      });
    }
  }
  return out;
}

/** Collect the assets a trashed recipe owned, then drop the recipe.
 *
 *  An asset a living bit still names is left alone. A duplicate shares its
 *  originals rather than copying eleven megabytes of photo, so collecting
 *  blind would empty the copy the moment the original went. */
async function collectTrashed(id: string): Promise<void> {
  const json = await loadTrashedJson(id);
  if (json) {
    try {
      const p = parseProject(json);
      const keep = new Set<string>();
      for (const other of await listProjectIds(SHOW_PREFIX)) {
        const otherJson = await loadProjectJson(other);
        if (!otherJson) continue;
        try {
          for (const a of referencedAssets(parseProject(otherJson))) keep.add(a);
        } catch {
          // Unparseable neighbours cannot vouch for anything.
        }
      }
      for (const assetId of referencedAssets(p)) {
        if (!keep.has(assetId)) await deleteAsset(assetId);
      }
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
  const [canInstall, setCanInstall] = useState(false);
  useEffect(() => onInstallAvailable(setCanInstall), []);
  const [renameText, setRenameText] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const onOpenRef = useRef(onOpen);
  const toast = useToast();
  const banner = useBanner();
  /** Mirrored so the import path can be a stable callback. */
  const bannerRef = useRef(banner);
  useEffect(() => {
    onOpenRef.current = onOpen;
    bannerRef.current = banner;
  }, [onOpen, banner]);

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

  const importBit = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    setStatus('opening…');
    try {
      const incoming = await importBundle(file);
      // A credit, not a link: nothing is fetched and nothing merges. It
      // survives being remixed again, so a chain stays legible.
      const project: Project = {
        ...incoming,
        id: crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
        ...(incoming.remixOf
          ? { remixOf: incoming.remixOf }
          : { remixOf: { title: incoming.title, id: incoming.id } }),
      };
      const id = freshShowId();
      await saveProjectJson(id, serializeProject(project));
      setStatus('');
      onOpenRef.current(id);
    } catch (err) {
      setStatus('');
      bannerRef.current.error(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** A bit shared in from elsewhere waits in the worker's inbox; the
   *  redirect that brought us here says so. */
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('inbox')) return;
    history.replaceState(null, '', location.pathname);
    void (async () => {
      try {
        const resp = await fetch('inbox-file');
        if (resp.status !== 200) return;
        const blob = await resp.blob();
        const name = decodeURIComponent(resp.headers.get('x-bits-name') ?? 'shared.json');
        await importBit(new File([blob], name, { type: blob.type }));
      } catch {
        bannerRef.current.error('that share could not be opened');
      }
    })();
  }, [importBit]);

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

  /** A copy to wreck, with the original left alone. The assets are shared
   *  rather than copied: eleven megabytes of photo per duplicate would
   *  fill a phone, and collection now checks who else is using one. */
  const duplicate = async (row: ShowRow) => {
    setMenu(null);
    const json = await loadProjectJson(row.id);
    if (!json) return;
    try {
      const copy: Project = {
        ...parseProject(json),
        id: crypto.randomUUID(),
        title: `${row.title} again`,
        updatedAt: new Date().toISOString(),
      };
      const id = freshShowId();
      await saveProjectJson(id, serializeProject(copy));
      setRows(await loadRows());
      toast.show(`copied ${row.title}`);
    } catch {
      banner.error('that bit could not be copied');
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
            void importBit(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button className="primary" onClick={newShow}>
          + new bit
        </button>
        <button onClick={() => importRef.current?.click()}>open a bit file</button>
        {canInstall && (
          <button
            onClick={() => {
              void promptInstall().then((outcome) => {
                if (outcome === 'accepted') toast.show('BITS is on your home screen');
              });
            }}
          >
            keep it on your phone
          </button>
        )}
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
                <ShowPoster showId={r.id} project={r.project} />
                <span className="row-lines">
                  <span className="name">{r.title}</span>
                  <span className="size">{rowSummary(r)}</span>
                  {r.remixOf && <span className="size">after {r.remixOf}</span>}
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
          <button onClick={() => void duplicate(menu.row)}>make a copy</button>
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
