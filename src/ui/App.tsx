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
    <div className={`app${screen.kind === 'stage' ? ' app-stage' : ''}`}>
      {/* The stage carries its own title strip, laid over the stage rather
          than above it, so it does not cost the stage 48px of height. */}
      {screen.kind === 'shows' && (
        <header className="topbar">
          <span className="wordmark">BITS</span>
          <span className="spacer" />
        </header>
      )}
      <main className="screen">
        {screen.kind === 'shows' ? (
          <Shows onOpen={(showId) => setScreen({ kind: 'stage', showId })} />
        ) : (
          <Stage showId={screen.showId} onBack={() => setScreen({ kind: 'shows' })} />
        )}
      </main>
      {/* A 9:16 stage in a short landscape window is a postage stamp. The
          stage keeps its state underneath; a landscape stage with its own
          aspect comes later. */}
      {screen.kind === 'stage' && (
        <div className="rotate-card">
          <p>turn your phone.</p>
          <p className="rotate-sub">the stage is tall.</p>
        </div>
      )}
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
