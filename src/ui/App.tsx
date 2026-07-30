import { useState } from 'react';
import { Shows } from './Shows';
import { Stage } from './Stage';

type Screen = { kind: 'shows' } | { kind: 'stage'; showId: string };

export function App() {
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
