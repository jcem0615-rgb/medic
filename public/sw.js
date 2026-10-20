/* MediClinic app-shell service worker.
   Strategy: network-first for navigations (so a deploy is picked up immediately,
   with the cached shell as the offline fallback), cache-first for hashed static assets.
   Bump CACHE_VERSION on every release — the activate handler drops older caches. */

const CACHE_VERSION = 'mediclinic-v1';
const SHELL = '/index.html';
const PRECACHE = [
  '/',
  SHELL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // addAll rejects the whole batch on one 404, so tolerate individual misses.
      await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'mc-skip-waiting') self.skipWaiting();
});

const isStatic = (url) =>
  /\.(?:js|css|woff2?|png|svg|jpg|jpeg|webp|ico|json|webmanifest)$/i.test(new URL(url).pathname);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Don't touch cross-origin requests (Google Fonts handles its own caching headers).
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          cache.put(SHELL, fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE_VERSION);
          return (await cache.match(SHELL)) || (await cache.match('/')) || Response.error();
        }
      })(),
    );
    return;
  }

  // Static assets: cache-first, then revalidate in the background.
  if (isStatic(request.url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const hit = await cache.match(request);
        if (hit) {
          event.waitUntil(
            fetch(request)
              .then((res) => res.ok && cache.put(request, res.clone()))
              .catch(() => {}),
          );
          return hit;
        }
        try {
          const res = await fetch(request);
          if (res.ok) cache.put(request, res.clone());
          return res;
        } catch {
          return Response.error();
        }
      })(),
    );
  }
});
