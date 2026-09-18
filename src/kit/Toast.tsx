// Transient messages with an optional undo. Every destructive action gets
// one, so nothing is lost without a way back (audit F5, F6).
//
// The provider owns the queue; <ToastView /> decides where it renders.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export const TOAST_MS = 5000;

export interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  action?: ToastAction;
  /** Fires when the toast expires without the action being taken. */
  onExpire?: () => void;
}

interface ToastApi {
  show: (message: string, opts?: { action?: ToastAction; onExpire?: () => void; ms?: number }) => void;
  /** Convenience: a message with an "undo" button. */
  undoable: (message: string, undo: () => void, onExpire?: () => void) => void;
}

const Ctx = createContext<ToastApi | null>(null);
const ItemsCtx = createContext<{ items: ToastItem[]; dismiss: (id: number) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const expiries = useRef(new Map<number, () => void>());

  const drop = useCallback((id: number, runExpire: boolean) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    const onExpire = expiries.current.get(id);
    expiries.current.delete(id);
    if (runExpire) onExpire?.();
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastApi['show']>(
    (message, opts) => {
      const id = nextId.current++;
      const item: ToastItem = { id, message };
      if (opts?.action) item.action = opts.action;
      if (opts?.onExpire) {
        item.onExpire = opts.onExpire;
        expiries.current.set(id, opts.onExpire);
      }
      setItems((list) => [...list, item]);
      timers.current.set(
        id,
        setTimeout(() => drop(id, true), opts?.ms ?? TOAST_MS),
      );
    },
    [drop],
  );

  const undoable = useCallback<ToastApi['undoable']>(
    (message, undo, onExpire) => {
      const opts: { action: ToastAction; onExpire?: () => void } = {
        action: { label: 'undo', run: undo },
      };
      if (onExpire) opts.onExpire = onExpire;
      show(message, opts);
    },
    [show],
  );

  // A pending expiry must still run if the tab goes away mid-window,
  // otherwise a trashed bit keeps its assets forever.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== 'hidden') return;
      for (const [id] of timers.current) drop(id, true);
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, [drop]);

  useEffect(() => {
    const running = timers.current;
    return () => {
      for (const t of running.values()) clearTimeout(t);
      running.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, undoable }), [show, undoable]);
  const list = useMemo(
    () => ({ items, dismiss: (id: number) => drop(id, false) }),
    [items, drop],
  );

  return (
    <Ctx.Provider value={api}>
      <ItemsCtx.Provider value={list}>{children}</ItemsCtx.Provider>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}

export function ToastView() {
  const ctx = useContext(ItemsCtx);
  if (!ctx || ctx.items.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {ctx.items.map((t) => (
        <div key={t.id} className="toast">
          <span className="toast-text">{t.message}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                ctx.dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
