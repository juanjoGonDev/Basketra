const CACHE_PREFIX = 'basketra-shell-';
const CACHE_VERSION = new URL(self.location.href).searchParams.get('version');
const CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
const DATA_CACHE = 'basketra-offline-data-v1';
const DATA_NETWORK_TIMEOUT_MS = 1500;
const SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/api.js',
  '/routes.js',
  '/catalog.js',
  '/category-suggestion.js',
  '/catalog.css',
  '/inventory.js',
  '/inventory.css',
  '/inventory-swipe.js',
  '/ticket-history.js',
  '/ticket-history.css',
  '/ticket-history-values.js',
  '/operations.js',
  '/operations.css',
  '/state.js',
  '/lists.js',
  '/receipts.js',
  '/receipt-state.js',
  '/receipt-capture.js',
  '/receipt-lifecycle.js',
  '/receipt-processing.js',
  '/receipt-review.js',
  '/receipt-review.css',
  '/receipt-editor-invoice.js',
  '/receipt-editor-invoice.css',
  '/receipt-ai-recovery.js',
  '/ui.js',
  '/styles.css',
  '/modern.css',
  '/theme.js',
  '/theme.css',
  '/manifest.webmanifest',
  '/icon.svg',
];

function isOfflineDataRequest(url) {
  return url.pathname === '/api/v1/meta'
    || url.pathname === '/api/v1/categories'
    || url.pathname === '/api/v1/shopping-lists'
    || /^\/api\/v1\/shopping-lists\/[^/]+(?:\/estimate)?$/.test(url.pathname)
    || /^\/api\/v1\/products\/parents\/[^/]+\/variants$/.test(url.pathname)
    || (url.pathname === '/api/v1/stores/suggestions' && url.search === '?limit=12');
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
        .map(key => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

async function cacheSuccessfulResponse(cacheName, request, response) {
  if (!response.ok) return response;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch {
    // A cache write must never make a successful network read fail.
  }
  return response;
}

async function fetchShell(request) {
  return cacheSuccessfulResponse(CACHE, request, await fetch(request));
}

async function fetchOfflineData(request) {
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(DATA_NETWORK_TIMEOUT_MS) });
    return await cacheSuccessfulResponse(DATA_CACHE, request, response);
  } catch (error) {
    const cache = await caches.open(DATA_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const supportedProtocol = url.protocol === 'http:' || url.protocol === 'https:';
  const sameOrigin = supportedProtocol && url.origin === self.location.origin;
  if (event.request.method !== 'GET' || !sameOrigin) return;

  if (url.pathname.startsWith('/api/')) {
    if (!isOfflineDataRequest(url)) return;
    event.respondWith(fetchOfflineData(event.request));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) {
      event.waitUntil(fetchShell(event.request).then(() => undefined).catch(() => undefined));
      return cached;
    }

    try {
      return await fetchShell(event.request);
    } catch (error) {
      const lastSegment = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
      if (!lastSegment.includes('.')) {
        const fallback = await caches.match('/index.html');
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
