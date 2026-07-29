import { useState } from 'react';
import { Library } from './Library';
import { Player } from './Player';

type Screen = { kind: 'library' } | { kind: 'player'; file: File; name: string };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'library' });

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">BITS</span>
        <span className="spacer" />
        {screen.kind === 'player' && (
          <button onClick={() => setScreen({ kind: 'library' })}>library</button>
        )}
      </header>
      <main className="screen">
        {screen.kind === 'library' ? (
          <Library onOpen={(file, name) => setScreen({ kind: 'player', file, name })} />
        ) : (
          <Player file={screen.file} name={screen.name} />
        )}
      </main>
    </div>
  );
}
