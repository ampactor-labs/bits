import { useState } from 'react';
import { Library } from './Library';
import { Deck } from './Deck';

type Screen = { kind: 'library' } | { kind: 'deck'; file: File; name: string; sourceId: string };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'library' });

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">BITS</span>
        <span className="spacer" />
        {screen.kind === 'deck' && (
          <button onClick={() => setScreen({ kind: 'library' })}>library</button>
        )}
      </header>
      <main className="screen">
        {screen.kind === 'library' ? (
          <Library
            onOpen={(file, name, sourceId) => setScreen({ kind: 'deck', file, name, sourceId })}
          />
        ) : (
          <Deck file={screen.file} name={screen.name} sourceId={screen.sourceId} />
        )}
      </main>
    </div>
  );
}
