import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { registerServiceWorker } from './pwa/register';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
