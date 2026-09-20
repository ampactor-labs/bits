// The guidance strip at the top of the stage. Hints say what a tool wants
// and carry their own cancel; errors say what went wrong and can be
// dismissed. An error is never a screen of its own: the stage stays
// mounted underneath (audit F4, F25).

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { IconButton } from './IconButton';

export interface BannerHint {
  kind: 'hint';
  text: string;
  cancel?: { label: string; run: () => void };
}

export interface BannerError {
  kind: 'error';
  text: string;
}

export type BannerState = BannerHint | BannerError | null;

interface BannerApi {
  hint: (text: string, cancel?: { label: string; run: () => void }) => void;
  error: (text: string) => void;
  clear: () => void;
  current: BannerState;
}

const Ctx = createContext<BannerApi | null>(null);

export function BannerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BannerState>(null);

  const hint = useCallback((text: string, cancel?: { label: string; run: () => void }) => {
    setState(cancel ? { kind: 'hint', text, cancel } : { kind: 'hint', text });
  }, []);
  const error = useCallback((text: string) => setState({ kind: 'error', text }), []);
  const clear = useCallback(() => setState(null), []);

  const api = useMemo<BannerApi>(
    () => ({ hint, error, clear, current: state }),
    [hint, error, clear, state],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useBanner(): BannerApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBanner outside BannerProvider');
  return ctx;
}

export function BannerView() {
  const { current, clear } = useBanner();
  if (!current) return null;
  return (
    <div className={`banner banner-${current.kind}`} role={current.kind === 'error' ? 'alert' : 'status'}>
      <span className="banner-text">{current.text}</span>
      {current.kind === 'hint' && current.cancel && (
        <button
          className="banner-cancel"
          onClick={() => {
            current.cancel!.run();
            clear();
          }}
        >
          {current.cancel.label}
        </button>
      )}
      {current.kind === 'error' && <IconButton icon="close" label="dismiss" size={20} onClick={clear} />}
    </div>
  );
}
