import assert from 'node:assert/strict';
import test from 'node:test';

type Listener = (event: Record<string, unknown>) => void;
type FetchRequest = RequestInfo | URL | { url: string; method: string; mode: string; headers: Headers };

function requestAddress(request: FetchRequest): string {
  if (request instanceof Request) return request.url;
  if (request instanceof URL) return request.href;
  if (typeof request === 'object' && 'url' in request) return request.url;
  return String(request);
}

test('service worker installs a versioned shell and handles cached, degraded and ignored fetch paths', async () => {
  const listeners = new Map<string, Listener>();
  const addedShells: string[][] = [];
  const deletedCaches: string[] = [];
  const cachedRequests: string[] = [];
  const cacheWrites: string[] = [];
  const fetchRequests: string[] = [];
  let currentCacheName = '';
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  let cachePutFails = false;
  let fetchImplementation: (request: FetchRequest, options?: RequestInit) => Promise<Response> = async request => new Response(requestAddress(request), { status: 200 });
  let matchImplementation = async (_request: FetchRequest): Promise<Response | undefined> => undefined;

  const cache = {
    async addAll(shell: string[]) {
      addedShells.push([...shell]);
    },
    async put(request: FetchRequest) {
      cacheWrites.push(requestAddress(request));
      if (cachePutFails) throw new Error('cache unavailable');
    },
  };
  const fakeSelf = {
    location: { origin: 'http://basketra.test' },
    addEventListener(name: string, listener: Listener) {
      listeners.set(name, listener);
    },
    async skipWaiting() {
      skipWaitingCalls += 1;
    },
    clients: {
      async claim() {
        claimCalls += 1;
      },
    },
  };
  const fakeCaches = {
    async open(name: string) {
      assert.equal(name, 'basketra-shell-__BASKETRA_VERSION__');
      currentCacheName ||= name;
      assert.equal(name, currentCacheName);
      return cache;
    },
    async keys() {
      assert.notEqual(currentCacheName, '');
      return ['basketra-shell-obsolete', currentCacheName];
    },
    async delete(name: string) {
      deletedCaches.push(name);
      return true;
    },
    async match(request: FetchRequest) {
      cachedRequests.push(requestAddress(request));
      return matchImplementation(request);
    },
  };

  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const originalSetTimeout = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');
  const originalClearTimeout = Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout');
  Object.defineProperty(globalThis, 'self', { configurable: true, value: fakeSelf });
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: fakeCaches });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: ((request: FetchRequest, options?: RequestInit) => {
      fetchRequests.push(requestAddress(request));
      return fetchImplementation(request, options);
    }) as typeof fetch,
  });

  try {
    await import('../../src/web/sw.js');
    const install = listeners.get('install');
    const activate = listeners.get('activate');
    const fetchListener = listeners.get('fetch');
    assert.ok(install);
    assert.ok(activate);
    assert.ok(fetchListener);

    let installWork: Promise<unknown> | undefined;
    install({ waitUntil(work: Promise<unknown>) { installWork = work; } });
    await installWork;
    assert.equal(skipWaitingCalls, 1);
    assert.equal(addedShells.length, 1);
    assert.ok(addedShells[0]?.includes('/shopping-list-density.js'));
    assert.ok(addedShells[0]?.includes('/shopping-list-density.css'));
    assert.ok(addedShells[0]?.includes('/inventory-swipe.css'));
    assert.ok(addedShells[0]?.includes('/entity-selection.js'));

    let activateWork: Promise<unknown> | undefined;
    activate({ waitUntil(work: Promise<unknown>) { activateWork = work; } });
    await activateWork;
    assert.deepEqual(deletedCaches, ['basketra-shell-obsolete']);
    assert.equal(claimCalls, 1);

    let responseWork: Promise<Response | undefined> | undefined;
    const respondWith = (work: Promise<Response | undefined>) => { responseWork = work; };

    fetchListener({ request: new Request('http://basketra.test/api/v1/meta'), respondWith });
    assert.equal(responseWork, undefined);
    fetchListener({ request: new Request('http://basketra.test/', { method: 'POST', body: 'x' }), respondWith });
    assert.equal(responseWork, undefined);
    fetchListener({ request: { method: 'GET', url: 'chrome-extension://example/content.js' }, respondWith });
    assert.equal(responseWork, undefined);
    fetchListener({ request: new Request('https://example.com/third-party.js'), respondWith });
    assert.equal(responseWork, undefined);

    responseWork = undefined;
    matchImplementation = async request => requestAddress(request).endsWith('/app.js')
      ? new Response('cached-shell', { status: 200 })
      : undefined;
    fetchImplementation = async () => { throw new Error('cached shell must not touch network'); };
    const cachedShell = new Request('http://basketra.test/app.js');
    fetchListener({ request: cachedShell, respondWith });
    assert.equal(await (await responseWork)?.text(), 'cached-shell');
    assert.equal(fetchRequests.includes(cachedShell.url), false);

    responseWork = undefined;
    matchImplementation = async () => undefined;
    fetchImplementation = async () => new Response('fresh-shell', { status: 200 });
    const freshShell = new Request('http://basketra.test/theme.css');
    fetchListener({ request: freshShell, respondWith });
    assert.equal(await (await responseWork)?.text(), 'fresh-shell');
    assert.ok(cacheWrites.includes(freshShell.url));

    responseWork = undefined;
    cachePutFails = true;
    const cacheFailureRequest = new Request('http://basketra.test/operations.js');
    fetchListener({ request: cacheFailureRequest, respondWith });
    assert.equal((await responseWork)?.status, 200);
    cachePutFails = false;

    responseWork = undefined;
    fetchImplementation = async () => new Response('missing', { status: 404 });
    const missingRequest = new Request('http://basketra.test/missing.js');
    fetchListener({ request: missingRequest, respondWith });
    assert.equal((await responseWork)?.status, 404);
    assert.equal(cacheWrites.includes(missingRequest.url), false);

    responseWork = undefined;
    fetchImplementation = async () => { throw new TypeError('offline'); };
    matchImplementation = async request => requestAddress(request).includes('cached.js')
      ? new Response('cached', { status: 200 })
      : undefined;
    fetchListener({ request: new Request('http://basketra.test/cached.js'), respondWith });
    assert.equal(await (await responseWork)?.text(), 'cached');

    responseWork = undefined;
    matchImplementation = async request => requestAddress(request) === '/index.html'
      ? new Response('fallback', { status: 200 })
      : undefined;
    fetchListener({ request: new Request('http://basketra.test/unknown-route'), respondWith });
    assert.equal(await (await responseWork)?.text(), 'fallback');

    responseWork = undefined;
    fetchImplementation = async () => new Response('fresh-navigation', { status: 200 });
    const htmlRequest = new Request('http://basketra.test/lists/list_1', { headers: { accept: 'text/html' } });
    fetchListener({ request: htmlRequest, respondWith });
    assert.equal(await (await responseWork)?.text(), 'fresh-navigation');
    assert.ok(cacheWrites.includes(htmlRequest.url));

    responseWork = undefined;
    fetchImplementation = async () => { throw new TypeError('offline navigation'); };
    const cachedNavigation = new Request('http://basketra.test/lists/list_cached', { headers: { accept: 'text/html' } });
    matchImplementation = async request => requestAddress(request) === cachedNavigation.url
      ? new Response('cached-navigation', { status: 200 })
      : undefined;
    fetchListener({ request: cachedNavigation, respondWith });
    assert.equal(await (await responseWork)?.text(), 'cached-navigation');

    let navigationAborted = false;
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      value: ((callback: () => void) => {
        queueMicrotask(callback);
        return 1;
      }) as typeof setTimeout,
    });
    Object.defineProperty(globalThis, 'clearTimeout', { configurable: true, value: (() => {}) as typeof clearTimeout });
    fetchImplementation = async (_request, options) => await new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => {
        navigationAborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true });
    });
    matchImplementation = async request => requestAddress(request) === '/index.html'
      ? new Response('degraded-fallback', { status: 200 })
      : undefined;

    responseWork = undefined;
    const navigateRequest = {
      method: 'GET',
      url: 'http://basketra.test/lists/list_2',
      mode: 'navigate',
      headers: new Headers(),
    };
    fetchListener({ request: navigateRequest, respondWith });
    assert.equal(await (await responseWork)?.text(), 'degraded-fallback');
    assert.equal(navigationAborted, true);
    assert.ok(cachedRequests.some(value => value === '/index.html'));
  } finally {
    if (originalSelf) Object.defineProperty(globalThis, 'self', originalSelf);
    else Reflect.deleteProperty(globalThis, 'self');
    if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
    else Reflect.deleteProperty(globalThis, 'caches');
    if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
    else Reflect.deleteProperty(globalThis, 'fetch');
    if (originalSetTimeout) Object.defineProperty(globalThis, 'setTimeout', originalSetTimeout);
    else Reflect.deleteProperty(globalThis, 'setTimeout');
    if (originalClearTimeout) Object.defineProperty(globalThis, 'clearTimeout', originalClearTimeout);
    else Reflect.deleteProperty(globalThis, 'clearTimeout');
  }
});
