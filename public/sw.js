/*
 * BrewMaster POS — offline app shell.
 *
 * WHY THIS EXISTS
 * The POS was described as "offline-first" and its DATA layer genuinely is: orders
 * live in IndexedDB and survive a dropped connection. But there was no service
 * worker, no manifest, and no public/ directory at all — so the app SHELL still
 * came from the network on every load. Verified during the audit: with the network
 * cut, a full page load failed with net::ERR_INTERNET_DISCONNECTED and the app was
 * gone. Offline only worked as long as nobody closed or refreshed the tab — and
 * pressing F5 is the first thing anyone does when a screen looks stuck. A cashier
 * who refreshed during an outage lost the till until the line came back.
 *
 * WHY HAND-WRITTEN INSTEAD OF vite-plugin-pwa
 * No new build dependency, and the caching policy stays explicit and reviewable in
 * one file — which matters here, because the dangerous failure mode for a POS is
 * not a cache miss, it is a stale cache pinning tills to an old build after a
 * deploy. The strategy below is chosen specifically to make that impossible.
 *
 * STRATEGY
 *   • Navigations      → network-first, fall back to the cached shell. Online, the
 *                        freshest index.html always wins, so a deploy is picked up
 *                        immediately. Offline, the shell is served from cache and
 *                        the SPA boots against IndexedDB.
 *   • /assets/*        → cache-first. Vite content-hashes these filenames, so a
 *                        given URL is immutable; a new build produces new URLs.
 *   • Other same-origin GETs → stale-while-revalidate.
 *   • Cross-origin     → never touched. The Worker API (api.engaz.tech) must never
 *                        be served from cache: stale money data is worse than an
 *                        honest network error, and the app already has retry and
 *                        queueing logic for a failed call.
 */

const VERSION = 'v1';
const SHELL_CACHE = `brewmaster-shell-${VERSION}`;
const ASSET_CACHE = `brewmaster-assets-${VERSION}`;
const SHELL_URL = '/index.html';

// Kept deliberately small: just enough to boot the SPA. Hashed assets are cached
// on first use instead of being enumerated here, so this list never goes stale.
const SHELL_FILES = ['/', SHELL_URL, '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one missing file cannot fail the whole install.
      await Promise.all(
        SHELL_FILES.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.map((n) => (keep.has(n) ? null : caches.delete(n))));
      await self.clients.claim();
    })()
  );
});

// Lets a freshly deployed worker take over without waiting for every tab to close.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

/** Only cache real, complete, same-origin responses. */
function isCacheable(response) {
  return !!response && response.status === 200 && response.type === 'basic';
}

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    if (isCacheable(fresh)) {
      // Keep the shell current so the offline copy is the latest known good one.
      void cache.put(SHELL_URL, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = (await cache.match(SHELL_URL)) || (await cache.match('/'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>غير متصل</title>' +
        '<body style="font-family:system-ui;padding:2rem;text-align:center">' +
        '<h1>مفيش اتصال</h1><p>الصفحة لسه مش متخزنة على الجهاز. لما النت يرجع افتح الصفحة تاني.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (isCacheable(fresh)) void cache.put(request, fresh.clone());
  return fresh;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((fresh) => {
      if (isCacheable(fresh)) void cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => null);
  if (cached) {
    void network;
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  throw new Error('offline and not cached');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never interfere with writes, or with anything that is not a plain GET.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin (the D1 Worker API above all) is passed straight through:
  // serving cached money data would be worse than a clear network failure.
  if (url.origin !== self.location.origin) return;

  // Range requests (media seeking) must not be answered from a full cached body.
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
