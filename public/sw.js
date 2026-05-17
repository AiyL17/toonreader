/* ─── ToonReader Service Worker ──────────────────────────────────────────────
   Shell assets  → cache-first (instant repeat loads)
   Read-only API → stale-while-revalidate (serve cache instantly, refresh in bg)
   Write API     → network-only (auth, sync, image proxy)
──────────────────────────────────────────────────────────────────────────── */

const SHELL_CACHE = 'toonreader-shell-v6';
const API_CACHE   = 'toonreader-api-v1';

// Static assets that make up the app shell
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  'https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js',
];

// Read-only API paths that benefit from stale-while-revalidate caching.
// Auth, sync, and image-proxy routes are intentionally excluded.
const API_CACHE_PREFIXES = [
  '/api/latest',
  '/api/browse',
  '/api/search',
  '/api/manga/',
];

function isReadOnlyApi(pathname) {
  return API_CACHE_PREFIXES.some(p => pathname.startsWith(p));
}

// ─── Install: cache the app shell ────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// ─── Activate: clean up old caches ───────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== API_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ── Read-only API: stale-while-revalidate ──────────────────────────────────
  // Serve the cached response immediately (zero latency on repeat visits),
  // then update the cache in the background so the next request is fresh.
  if (event.request.method === 'GET' && isReadOnlyApi(url.pathname)) {
    event.respondWith(
      caches.open(API_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);

        // Always kick off a background network fetch to keep the cache warm.
        const networkFetch = fetch(event.request).then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        }).catch(() => null);

        // Return the cached copy instantly if available; otherwise wait for network.
        return cached || networkFetch;
      })
    );
    return;
  }

  // ── Write / auth / image-proxy: always network ────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // ── Shell assets: cache-first ─────────────────────────────────────────────
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
