import { useEffect, useState } from 'react';
import { parseProject } from '../engine/recipe';
import { deleteProject, ensurePersistence, listProjectIds, loadProjectJson } from '../media/opfs';

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

  const remove = async (id: string) => {
    await deleteProject(id);
    setRows(await loadRows());
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
