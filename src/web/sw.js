const CACHE = 'basketra-shell-v26';
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
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const supportedProtocol = url.protocol === 'http:' || url.protocol === 'https:';
  const sameOrigin = supportedProtocol && url.origin === self.location.origin;
  if (event.request.method !== 'GET' || !sameOrigin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (!response.ok) return response;
        const copy = response.clone();
        void caches.open(CACHE)
          .then(cache => cache.put(event.request, copy))
          .catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('/index.html'))),
  );
});
