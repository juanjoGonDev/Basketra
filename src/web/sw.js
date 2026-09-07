const CACHE_PREFIX = 'basketra-shell-';
const CACHE_VERSION = new URL(self.location.href).searchParams.get('version');
const CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
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

async function fetchAndCache(request) {
  const response = await fetch(request);
  if (!response.ok) return response;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  } catch {
    // Cache refresh is opportunistic; the network response remains authoritative.
  }
  return response;
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const supportedProtocol = url.protocol === 'http:' || url.protocol === 'https:';
  const sameOrigin = supportedProtocol && url.origin === self.location.origin;
  if (event.request.method !== 'GET' || !sameOrigin || url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) {
      event.waitUntil(fetchAndCache(event.request).then(() => undefined).catch(() => undefined));
      return cached;
    }

    try {
      return await fetchAndCache(event.request);
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
