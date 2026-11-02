/*
 * Offline shell. Weights already live in Cache Storage (see lib/model-cache),
 * but without this the app itself still needs the network on reload, so the
 * "断网可用" promise only held while the tab stayed open.
 *
 * Navigations are network-first — a deploy must never be pinned behind a stale
 * shell — and hashed build assets are cache-first. API routes and the 25MB wasm
 * runtime are deliberately left alone: the former must fail loudly offline, the
 * latter is already cached by the model cache under a different key.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const SHELL = `loomscape-shell-${VERSION}`;
const ASSETS = `loomscape-assets-${VERSION}`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('loomscape-shell-') && name !== SHELL)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/runtime/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = (await cache.match(request)) || (await cache.match('/studio'));
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
