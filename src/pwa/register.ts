// Service worker registration, plus the update signal.
//
// A new worker waits rather than taking over, because the running page can
// still lazy-load a chunk the new build pruned. The app offers a reload;
// applyUpdate() tells the waiting worker to take over and reloads once it
// has.

type UpdateListener = () => void;

let waiting: ServiceWorker | null = null;
const listeners = new Set<UpdateListener>();

/** Called when a new build is installed and waiting to take over. */
export function onServiceWorkerUpdate(listener: UpdateListener): () => void {
  listeners.add(listener);
  if (waiting) listener();
  return () => listeners.delete(listener);
}

export function applyServiceWorkerUpdate(): void {
  if (!waiting) {
    location.reload();
    return;
  }
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

function announce(worker: ServiceWorker) {
  waiting = worker;
  for (const listener of listeners) listener();
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => {
        // A worker already waiting from a previous visit.
        if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // No controller means this is the first install, not an update.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              announce(installing);
            }
          });
        });
      })
      .catch((err: unknown) => console.warn('sw registration failed', err));
  });
}
