const CACHE = 'basketra-shell-__BASKETRA_VERSION__';
const NAVIGATION_TIMEOUT_MS = 1_500;
const SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/api.js',
  '/routes.js',
  '/catalog.js',
  '/category-suggestion.js',
  '/components.js',
  '/components.css',
  '/catalog.css',
  '/inventory.js',
  '/inventory.css',
  '/inventory-swipe.js',
  '/inventory-swipe.css',
  '/entity-selection.js',
  '/ticket-history.js',
  '/ticket-history.css',
  '/ticket-history-values.js',
  '/operations.js',
  '/operations.css',
  '/state.js',
  '/lists.js',
  '/shopping-list-density.js',
  '/shopping-list-density.css',
  '/receipts.js',
  '/receipt-state.js',
  '/receipt-capture.js',
  '/receipt-lifecycle.js',
  '/receipt-processing.js',
  '/receipt-review.js',
  '/receipt-line-pickers.js',
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
const SHELL_PATHS = new Set(SHELL);
const NETWORK_FIRST_SHELL_PATHS = new Set(['/receipt-review.css']);

async function putSuccessfulResponse(request, response) {
  if (!response.ok) return;
  const copy = response.clone();
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, copy);
  } catch {
    // Cache writes are an acceleration only; the network response remains authoritative.
  }
}

async function fetchAndCache(request, options) {
  const response = await fetch(request, options);
  await putSuccessfulResponse(request, response);
  return response;
}

async function cachedShellAsset(request) {
  const cached = await caches.match(request);
  return cached || fetchAndCache(request);
}

async function boundedNavigation(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
  let response;
  try {
    response = await fetchAndCache(request, { signal: controller.signal });
  } catch {
    response = (await caches.match(request)) || await caches.match('/index.html');
  } finally {
    clearTimeout(timer);
  }
  return response;
}

async function networkWithFallback(request) {
  try {
    return await fetchAndCache(request);
  } catch {
    return (await caches.match(request)) || caches.match('/index.html');
  }
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
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const supportedProtocol = url.protocol === 'http:' || url.protocol === 'https:';
  const sameOrigin = supportedProtocol && url.origin === self.location.origin;
  if (event.request.method !== 'GET' || !sameOrigin || url.pathname.startsWith('/api/')) return;

  const navigation = event.request.mode === 'navigate'
    || event.request.headers.get('accept')?.includes('text/html') === true;
  if (navigation) {
    event.respondWith(boundedNavigation(event.request));
    return;
  }

  if (NETWORK_FIRST_SHELL_PATHS.has(url.pathname)) {
    event.respondWith(networkWithFallback(event.request));
    return;
  }

  if (SHELL_PATHS.has(url.pathname)) {
    event.respondWith(cachedShellAsset(event.request));
    return;
  }

  event.respondWith(networkWithFallback(event.request));
});
