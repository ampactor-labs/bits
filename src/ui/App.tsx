import { useEffect, useState } from 'react';
import { Shows } from './Shows';
import { Stage } from './Stage';
import { BannerProvider } from '../kit/Banner';
import { ToastProvider, ToastView, useToast } from '../kit/Toast';
import { applyServiceWorkerUpdate, onServiceWorkerUpdate } from '../pwa/register';

type Screen = { kind: 'shows' } | { kind: 'stage'; showId: string };

/** A new build is installed and waiting; offer the reload rather than
 *  taking it under the user's fingers mid-performance. */
function UpdateWatch() {
  const toast = useToast();
  useEffect(
    () =>
      onServiceWorkerUpdate(() => {
        toast.show('new version ready', {
          action: { label: 'reload', run: applyServiceWorkerUpdate },
          ms: 20000,
        });
      }),
    [toast],
  );
  return null;
}

function Screens() {
  const [screen, setScreen] = useState<Screen>({ kind: 'shows' });

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">BITS</span>
        <span className="spacer" />
        {screen.kind === 'stage' && (
          <button onClick={() => setScreen({ kind: 'shows' })}>bits</button>
        )}
      </header>
      <main className="screen">
        {screen.kind === 'shows' ? (
          <Shows onOpen={(showId) => setScreen({ kind: 'stage', showId })} />
        ) : (
          <Stage showId={screen.showId} />
        )}
      </main>
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <BannerProvider>
        <UpdateWatch />
        <Screens />
        <ToastView />
      </BannerProvider>
    </ToastProvider>
  );
}
