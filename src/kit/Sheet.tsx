// A bottom sheet. It may cover the dock, the timeline, and at most a third
// of the stage: the budget is --sheet-max, computed from --stage-h, which
// StageView keeps current. A raw vh would eat the dock and the timeline
// first and leave no room for content, which is how the old kit overflowed
// off the top of the screen (audit F1, F2).
//
// Scrolls, sticky header, focus trap, Escape and backdrop close.

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from './IconButton';

export interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional control rendered at the right of the sticky header. */
  action?: ReactNode;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function Sheet({ title, onClose, children, action }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<Element | null>(null);

  const focusables = useCallback(
    () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  useEffect(() => {
    restoreTo.current = document.activeElement;
    focusables()[0]?.focus();
    const previous = restoreTo.current;
    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    };
  }, [focusables]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [focusables, onClose]);

  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" onPointerDown={onClose} />
      <div
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <span className="sheet-grab" aria-hidden="true" />
          <span className="sheet-title">{title}</span>
          <span className="sheet-head-action">{action}</span>
          <IconButton icon="close" label="close" size={20} onClick={onClose} />
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
