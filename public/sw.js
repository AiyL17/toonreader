/* ─── ToonReader Service Worker ──────────────────────────────────────────────
   Shell assets  → cache-first (instant repeat loads)
   Read-only API → stale-while-revalidate (serve cache instantly, refresh in bg)
   Image proxy   → cache-first with 24 h TTL and 300-entry cap
   Write API     → network-only (auth, sync)
──────────────────────────────────────────────────────────────────────────── */

const SHELL_CACHE = 'toonreader-shell-v8';
const API_CACHE   = 'toonreader-api-v2';
const IMG_CACHE   = 'toonreader-img-v1';

// Maximum number of entries to keep in each runtime cache.
// Prevents unbounded growth on long-lived SW installations.
const API_CACHE_MAX  = 300;
const IMG_CACHE_MAX  = 300;

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
// Auth, sync, and image-proxy routes are intentionally excluded here
// (image proxy has its own cache strategy below).
const API_CACHE_PREFIXES = [
  '/api/latest',
  '/api/browse',
  '/api/search',
  '/api/manga/',
];

function isReadOnlyApi(pathname) {
  return API_CACHE_PREFIXES.some(p => pathname.startsWith(p));
}

function isImageProxy(pathname) {
  return pathname.startsWith('/api/image');
}

// ─── Trim cache to maxEntries (evict oldest first) ────────────────────────────
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys  = await cache.keys();
  if (keys.length > maxEntries) {
    // Delete oldest entries (keys are ordered by insertion time)
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map(k => cache.delete(k)));
  }
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
  const KNOWN = new Set([SHELL_CACHE, API_CACHE, IMG_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !KNOWN.has(key))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ── Image proxy: cache-first, 24 h TTL, capped at IMG_CACHE_MAX entries ───
  if (event.request.method === 'GET' && isImageProxy(url.pathname)) {
    event.respondWith(
      caches.open(IMG_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;

        try {
          const response = await fetch(event.request);
          if (response.ok) {
            cache.put(event.request, response.clone());
            // Trim asynchronously so it doesn't block the response
            trimCache(IMG_CACHE, IMG_CACHE_MAX).catch(() => {});
          }
          return response;
        } catch {
          return new Response('', { status: 503, statusText: 'Network unavailable' });
        }
      })
    );
    return;
  }

  // ── Read-only API: stale-while-revalidate, capped at API_CACHE_MAX ────────
  // Serve the cached response immediately (zero latency on repeat visits),
  // then update the cache in the background so the next request is fresh.
  if (event.request.method === 'GET' && isReadOnlyApi(url.pathname)) {
    event.respondWith(
      caches.open(API_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);

        // Always kick off a background network fetch to keep the cache warm.
        const networkFetch = fetch(event.request).then((response) => {
          if (response.ok) {
            cache.put(event.request, response.clone());
            trimCache(API_CACHE, API_CACHE_MAX).catch(() => {});
          }
          return response;
        }).catch(() => null);

        // Return the cached copy instantly if available; otherwise wait for network.
        return cached || networkFetch;
      })
    );
    return;
  }

  // ── Write / auth: always network ──────────────────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Network unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
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
