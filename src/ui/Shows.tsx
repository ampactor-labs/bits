import { useEffect, useState } from 'react';
import { parseProject, serializeProject } from '../engine/recipe';
import { deleteAsset } from '../media/assets';
import {
  deleteProject,
  ensurePersistence,
  listProjectIds,
  loadProjectJson,
  saveProjectJson,
} from '../media/opfs';

const SHOW_PREFIX = 'show-';

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

export function Shows({ onOpen }: { onOpen: (showId: string) => void }) {
  const [rows, setRows] = useState<ShowRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensurePersistence();
      const loaded = await loadRows();
      if (!cancelled) setRows(loaded);
    })().catch(() => setRows([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const newShow = () => onOpen(`${SHOW_PREFIX}${Date.now()}`);

  /** Deleting a show also collects its audio and cutout assets, so OPFS
   *  doesn't fill with orphans. */
  const remove = async (id: string) => {
    const json = await loadProjectJson(id);
    if (json) {
      try {
        const p = parseProject(json);
        const assetIds = new Set<string>();
        if (p.audio) assetIds.add(p.audio.assetId);
        for (const e of p.events) {
          if (e.kind === 'CAST' && e.puppet.type === 'cutout') assetIds.add(e.puppet.assetId);
        }
        for (const assetId of assetIds) await deleteAsset(assetId);
      } catch {
        // Unparseable: delete the project file alone.
      }
    }
    await deleteProject(id);
    setRows(await loadRows());
  };

  const rename = async (id: string, current: string) => {
    const title = window.prompt('name this bit', current)?.trim();
    if (!title) return;
    const json = await loadProjectJson(id);
    if (!json) return;
    try {
      const p = parseProject(json);
      await saveProjectJson(id, serializeProject({ ...p, title }));
      setRows(await loadRows());
    } catch {
      // Unparseable: leave it be.
    }
  };

  return (
    <div>
      <div className="transport">
        <button className="primary" onClick={newShow}>
          + new bit
        </button>
      </div>
      {rows === null ? null : rows.length === 0 ? (
        <p className="empty">
          no bits yet.
          <br />
          record the sound, cast some puppets, put on the show.
        </p>
      ) : (
        <ul className="source-list">
          {rows.map((r) => (
            <li key={r.id} className="source-row" onClick={() => onOpen(r.id)}>
              <span className="name">{r.title}</span>
              <span className="size">
                {r.passes} pass{r.passes === 1 ? '' : 'es'}
              </span>
              <button
                className="delete"
                aria-label={`rename ${r.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void rename(r.id, r.title);
                }}
              >
                ✎
              </button>
              <button
                className="delete"
                aria-label={`delete ${r.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(r.id);
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
