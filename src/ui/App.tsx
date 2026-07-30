import { useState } from 'react';
import { Library } from './Library';
import { Deck } from './Deck';
import { Shows } from './Shows';
import { Stage } from './Stage';

type Screen =
  | { kind: 'shows' }
  | { kind: 'stage'; showId: string }
  | { kind: 'clips' }
  | { kind: 'deck'; file: File; name: string; sourceId: string };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'shows' });

  const back =
    screen.kind === 'stage'
      ? { label: 'bits', to: { kind: 'shows' } as Screen }
      : screen.kind === 'clips'
        ? { label: 'bits', to: { kind: 'shows' } as Screen }
        : screen.kind === 'deck'
          ? { label: 'clips', to: { kind: 'clips' } as Screen }
          : null;

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">BITS</span>
        <span className="spacer" />
        {screen.kind === 'shows' && (
          <button onClick={() => setScreen({ kind: 'clips' })}>clips</button>
        )}
        {back && <button onClick={() => setScreen(back.to)}>{back.label}</button>}
      </header>
      <main className="screen">
        {screen.kind === 'shows' && <Shows onOpen={(showId) => setScreen({ kind: 'stage', showId })} />}
        {screen.kind === 'stage' && <Stage showId={screen.showId} />}
        {screen.kind === 'clips' && (
          <Library
            onOpen={(file, name, sourceId) => setScreen({ kind: 'deck', file, name, sourceId })}
          />
        )}
        {screen.kind === 'deck' && (
          <Deck file={screen.file} name={screen.name} sourceId={screen.sourceId} />
        )}
      </main>
    </div>
  );
}
