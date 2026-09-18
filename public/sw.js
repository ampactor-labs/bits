// BITS service worker: precache the shell, cache-first within scope.
//
// The cache name carries a build stamp that the precache plugin rewrites at
// build time. Without it the file's bytes never change between builds, the
// browser never re-runs install, and every installed phone keeps its first
// shell forever.
//
// The new worker does NOT skip waiting on its own: the running page may
// still lazy-load a chunk that this build has pruned. It waits until the
// page asks (SKIP_WAITING) and reloads itself.

const BUILD = '__BUILD__';
const CACHE = `bits-shell-${BUILD}`;

self.addEventListener('install', (event) => {
  event.waitUntil(install());
});

async function install() {
  const cache = await caches.open(CACHE);
  try {
    const resp = await fetch('./precache.json', { cache: 'no-cache' });
    const { files } = await resp.json();
    await cache.addAll(['./', ...files]);
  } catch {
    // Offline install keeps whatever is already cached.
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(activate());
});

async function activate() {
  // Every cache from an older build goes, so storage does not grow without
  // bound and a stale shell can never win a lookup.
  for (const name of await caches.keys()) {
    if (name.startsWith('bits-shell-') && name !== CACHE) await caches.delete(name);
  }
  await self.clients.claim();
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  const inScope = url.origin === scope.origin && url.pathname.startsWith(scope.pathname);

  if (event.request.method !== 'GET' || !inScope) return;

  event.respondWith(cacheFirst(event.request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const isNavigation = request.mode === 'navigate';
  const cached = await cache.match(isNavigation ? './' : request, { ignoreSearch: isNavigation });
  if (cached) return cached;
  try {
    const resp = await fetch(request);
    if (resp.ok && resp.type === 'basic') {
      await cache.put(request, resp.clone());
    }
    return resp;
  } catch (err) {
    if (isNavigation) {
      const shell = await cache.match('./');
      if (shell) return shell;
    }
    throw err;
  }
}
