// BITS service worker: precache the shell, cache-first within scope, and
// receive Android share-target POSTs into the OPFS inbox.

const CACHE = 'bits-shell-v1';

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
  await self.skipWaiting();
}

self.addEventListener('activate', (event) => {
  event.waitUntil(activate());
});

async function activate() {
  // Prune entries that fell out of the current build's precache list.
  try {
    const resp = await fetch('./precache.json', { cache: 'no-cache' });
    const { files } = await resp.json();
    const keep = new Set([new URL('./', self.registration.scope).href]);
    for (const f of files) keep.add(new URL(f, self.registration.scope).href);
    keep.add(new URL('./precache.json', self.registration.scope).href);
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) {
      if (!keep.has(req.url)) await cache.delete(req);
    }
  } catch {
    // No network at activate: prune next time.
  }
  await self.clients.claim();
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  const inScope = url.origin === scope.origin && url.pathname.startsWith(scope.pathname);

  if (event.request.method === 'POST' && inScope && url.pathname === scope.pathname + 'share-target') {
    event.respondWith(handleShare(event.request));
    return;
  }

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

async function handleShare(request) {
  const formData = await request.formData();
  const files = formData.getAll('media').filter((f) => typeof f !== 'string');
  const root = await navigator.storage.getDirectory();
  const inbox = await root.getDirectoryHandle('inbox', { create: true });
  for (const file of files) {
    const name = `${crypto.randomUUID()}--${(file.name || 'shared').slice(0, 120)}`;
    const handle = await inbox.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await file.stream().pipeTo(writable);
  }
  return Response.redirect('./?shared=1', 303);
}
