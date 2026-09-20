// A translucent strip laid over the top of the stage. Over, not above:
// with a title bar, a timeline and a dock all taking their own rows, a 9:16
// stage on a 390x844 phone comes out about 337px wide. Laying the title
// over the stage gives 48px of that height back.
//
// It also gives a bit a name you can see and change. Every bit was called
// "untitled bit", and renaming was a system prompt on the list.

import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../../kit/IconButton';

export interface TitleBarProps {
  title: string;
  onRename: (title: string) => void;
  onBack: () => void;
  onMenu: () => void;
}

export function TitleBar({ title, onRename, onBack, onMenu }: TitleBarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // The draft is seeded when editing starts rather than synced by an
  // effect, so a rename cannot race a re-render.
  const startEdit = () => {
    setDraft(title);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== title) onRename(next);
    else setDraft(title);
  };

  return (
    <div className="titlebar" onPointerDown={(e) => e.stopPropagation()}>
      <IconButton icon="back" label="bits" onClick={onBack} />
      {editing ? (
        <input
          ref={inputRef}
          className="titlebar-input"
          value={draft}
          aria-label="bit name"
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button className="titlebar-name" onClick={startEdit}>
          {title || 'untitled bit'}
        </button>
      )}
      <IconButton icon="more" label="this bit" onClick={onMenu} />
    </div>
  );
}
