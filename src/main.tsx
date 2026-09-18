import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { registerServiceWorker } from './pwa/register';
import './kit/tokens.css';
import './kit/kit.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();

if (new URLSearchParams(location.search).has('e2e')) {
  void import('./e2e/harness');
  void import('./e2e/uxHooks');
}
