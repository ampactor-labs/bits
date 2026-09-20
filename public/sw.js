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
/** Where a shared bit file waits between the POST that delivered it and
 *  the page that opens it. */
const INBOX = 'bits-inbox';
const INBOX_KEY = './inbox-file';

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
  if (!inScope) return;

  // Share target. This has to come BEFORE the non-GET bail-out: the share
  // arrives as a POST, and a worker that ignores every POST would hand it
  // straight back to the network and lose the file.
  if (event.request.method === 'POST' && url.pathname.endsWith('/inbox')) {
    event.respondWith(takeShare(event.request, scope));
    return;
  }

  if (event.request.method !== 'GET') return;

  // The page collects what the share left, once.
  if (url.pathname.endsWith('/inbox-file')) {
    event.respondWith(handInbox());
    return;
  }

  event.respondWith(cacheFirst(event.request));
});

async function takeShare(request, scope) {
  try {
    const form = await request.formData();
    const file = form.get('bit') || form.get('file') || [...form.values()].find((v) => v && v.name);
    if (file) {
      const cache = await caches.open(INBOX);
      await cache.put(
        INBOX_KEY,
        new Response(file, {
          headers: {
            'content-type': file.type || 'application/json',
            'x-bits-name': encodeURIComponent(file.name || 'shared.bits.json'),
          },
        }),
      );
    }
  } catch {
    // Nothing usable in the share; the app opens as normal and says so.
  }
  return Response.redirect(`${scope.pathname}?inbox=1`, 303);
}

async function handInbox() {
  const cache = await caches.open(INBOX);
  const hit = await cache.match(INBOX_KEY);
  if (!hit) return new Response('', { status: 204 });
  await cache.delete(INBOX_KEY);
  return hit;
}

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
