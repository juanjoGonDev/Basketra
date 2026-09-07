import assert from 'node:assert/strict';
import test from 'node:test';

type Listener = (event: Record<string, unknown>) => void;

function requestAddress(request: RequestInfo | URL): string {
  return request instanceof Request ? request.url : String(request);
}

test('service worker versions the shell and keeps a bounded read-only Shopping List fallback', async () => {
  const listeners = new Map<string, Listener>();
  const addedShells: string[][] = [];
  const deletedCaches: string[] = [];
  const shellMatches: string[] = [];
  const shellWrites: string[] = [];
  const dataWrites: string[] = [];
  const backgroundWork: Promise<unknown>[] = [];
  let currentShellCache = '';
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  let cachePutFails = false;
  let fetchImplementation: typeof fetch = async request => new Response(String(request), { status: 200 });
  let shellMatchImplementation = async (_request: RequestInfo | URL): Promise<Response | undefined> => undefined;
  let dataMatchImplementation = async (_request: RequestInfo | URL): Promise<Response | undefined> => undefined;

  const shellCache = {
    async addAll(shell: string[]) {
      addedShells.push([...shell]);
    },
    async put(request: RequestInfo | URL) {
      shellWrites.push(requestAddress(request));
      if (cachePutFails) throw new Error('cache unavailable');
    },
  };
  const dataCache = {
    async put(request: RequestInfo | URL) {
      dataWrites.push(requestAddress(request));
      if (cachePutFails) throw new Error('cache unavailable');
    },
    async match(request: RequestInfo | URL) {
      return dataMatchImplementation(request);
    },
  };
  const fakeSelf = {
    location: {
      origin: 'http://basketra.test',
      href: 'http://basketra.test/sw.js?version=1.4.2-test',
    },
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
      if (name === 'basketra-offline-data-v1') return dataCache;
      assert.equal(name, 'basketra-shell-1.4.2-test');
      currentShellCache ||= name;
      assert.equal(name, currentShellCache);
      return shellCache;
    },
    async keys() {
      assert.notEqual(currentShellCache, '');
      return ['unrelated-cache', 'basketra-offline-data-v1', 'basketra-shell-obsolete', currentShellCache];
    },
    async delete(name: string) {
      deletedCaches.push(name);
      return true;
    },
    async match(request: RequestInfo | URL) {
      shellMatches.push(requestAddress(request));
      return shellMatchImplementation(request);
    },
  };

  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'self', { configurable: true, value: fakeSelf });
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: fakeCaches });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: ((...args: Parameters<typeof fetch>) => fetchImplementation(...args)) as typeof fetch,
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
    assert.ok(addedShells[0]?.includes('/receipt-ai-recovery.js'));
    assert.ok(addedShells[0]?.includes('/receipts.js'));
    assert.ok(addedShells[0]?.includes('/modern.css'));
    assert.ok(addedShells[0]?.includes('/catalog.js'));
    assert.ok(addedShells[0]?.includes('/icon.svg'));

    let activateWork: Promise<unknown> | undefined;
    activate({ waitUntil(work: Promise<unknown>) { activateWork = work; } });
    await activateWork;
    assert.deepEqual(deletedCaches, ['basketra-shell-obsolete']);
    assert.equal(claimCalls, 1);

    let responseWork: Promise<Response> | undefined;
    const respondWith = (work: Promise<Response>) => { responseWork = work; };
    const waitUntil = (work: Promise<unknown>) => { backgroundWork.push(work); };

    fetchListener({
      request: new Request('http://basketra.test/', { method: 'POST', body: 'x' }),
      respondWith,
      waitUntil,
    });
    assert.equal(responseWork, undefined);

    fetchListener({
      request: { method: 'GET', url: 'chrome-extension://example/content.js' },
      respondWith,
      waitUntil,
    });
    assert.equal(responseWork, undefined);

    fetchListener({
      request: new Request('https://example.com/third-party.js'),
      respondWith,
      waitUntil,
    });
    assert.equal(responseWork, undefined);

    const allowedDataUrls = [
      'http://basketra.test/api/v1/meta',
      'http://basketra.test/api/v1/categories',
      'http://basketra.test/api/v1/shopping-lists',
      'http://basketra.test/api/v1/shopping-lists/list_1',
      'http://basketra.test/api/v1/shopping-lists/list_1/estimate',
      'http://basketra.test/api/v1/products/parents/product_1/variants',
      'http://basketra.test/api/v1/stores/suggestions?limit=12',
    ];
    fetchImplementation = async request => new Response(`network:${requestAddress(request)}`, { status: 200 });
    for (const address of allowedDataUrls) {
      responseWork = undefined;
      fetchListener({ request: new Request(address), respondWith, waitUntil });
      assert.equal(await (await responseWork)?.text(), `network:${address}`);
    }
    assert.deepEqual(dataWrites, allowedDataUrls);

    responseWork = undefined;
    fetchListener({
      request: new Request('http://basketra.test/api/v1/settings/ai-provider'),
      respondWith,
      waitUntil,
    });
    assert.equal(responseWork, undefined);

    responseWork = undefined;
    fetchListener({
      request: new Request('http://basketra.test/api/v1/stores/suggestions?limit=12&latitudeMicrodegrees=123'),
      respondWith,
      waitUntil,
    });
    assert.equal(responseWork, undefined);

    responseWork = undefined;
    fetchListener({
      request: new Request('http://basketra.test/api/v1/meta', { method: 'POST', body: '{}' }),
      respondWith,
      waitUntil,
    });
    assert.equal(responseWork, undefined);

    responseWork = undefined;
    const notFoundDataRequest = new Request('http://basketra.test/api/v1/shopping-lists/missing');
    fetchImplementation = async () => new Response('missing', { status: 404 });
    fetchListener({ request: notFoundDataRequest, respondWith, waitUntil });
    assert.equal((await responseWork)?.status, 404);
    assert.equal(dataWrites.includes(notFoundDataRequest.url), false);

    responseWork = undefined;
    const cachedDataRequest = new Request('http://basketra.test/api/v1/shopping-lists/list_cached');
    fetchImplementation = async () => { throw new TypeError('offline'); };
    dataMatchImplementation = async request => requestAddress(request) === cachedDataRequest.url
      ? new Response('cached data', { status: 200 })
      : undefined;
    fetchListener({ request: cachedDataRequest, respondWith, waitUntil });
    assert.equal(await (await responseWork)?.text(), 'cached data');

    responseWork = undefined;
    const uncachedDataRequest = new Request('http://basketra.test/api/v1/shopping-lists/list_uncached');
    dataMatchImplementation = async () => undefined;
    fetchListener({ request: uncachedDataRequest, respondWith, waitUntil });
    assert.ok(responseWork);
    await assert.rejects(responseWork, /offline/);

    let releaseRefresh: ((response: Response) => void) | undefined;
    const cachedShellRequest = new Request('http://basketra.test/app.js');
    shellMatchImplementation = async request => requestAddress(request) === cachedShellRequest.url
      ? new Response('cached shell', { status: 200 })
      : undefined;
    fetchImplementation = (() => new Promise<Response>(resolve => { releaseRefresh = resolve; })) as typeof fetch;
    responseWork = undefined;
    fetchListener({ request: cachedShellRequest, respondWith, waitUntil });
    assert.equal(await (await responseWork)?.text(), 'cached shell');
    assert.ok(releaseRefresh, 'background refresh must start');
    releaseRefresh(new Response('fresh shell', { status: 200 }));
    await backgroundWork.at(-1);
    assert.deepEqual(shellWrites, [cachedShellRequest.url]);

    responseWork = undefined;
    const weakNetworkRequest = new Request('http://basketra.test/lists.js');
    shellMatchImplementation = async request => requestAddress(request) === weakNetworkRequest.url
      ? new Response('cached while network fails', { status: 200 })
      : undefined;
    fetchImplementation = async () => { throw new TypeError('weak network'); };
    fetchListener({ request: weakNetworkRequest, respondWith, waitUntil });
    assert.equal(await (await responseWork)?.text(), 'cached while network fails');
    await backgroundWork.at(-1);
    assert.deepEqual(shellWrites, [cachedShellRequest.url]);

    responseWork = undefined;
    cachePutFails = true;
    shellMatchImplementation = async () => undefined;
    fetchImplementation = async () => new Response('fresh despite cache failure', { status: 200 });
    const cacheFailureRequest = new Request('http://basketra.test/operations.js');
    fetchListener({ request: cacheFailureRequest, respondWith, waitUntil });
    assert.equal(await (await responseWork)?.text(), 'fresh despite cache failure');
    assert.deepEqual(shellWrites, [cachedShellRequest.url, cacheFailureRequest.url]);
    cachePutFails = false;

    responseWork = undefined;
    fetchImplementation = async () => new Response('missing', { status: 404 });
    fetchListener({ request: new Request('http://basketra.test/missing.js'), respondWith, waitUntil });
    assert.equal((await responseWork)?.status, 404);
    assert.deepEqual(shellWrites, [cachedShellRequest.url, cacheFailureRequest.url]);

    responseWork = undefined;
    fetchImplementation = async () => { throw new TypeError('offline'); };
    shellMatchImplementation = async request => requestAddress(request) === '/index.html'
      ? new Response('fallback', { status: 200 })
      : undefined;
    fetchListener({ request: new Request('http://basketra.test/unknown-route'), respondWith, waitUntil });
    assert.equal(await (await responseWork)?.text(), 'fallback');
    assert.ok(shellMatches.some(value => value === '/index.html'));

    responseWork = undefined;
    shellMatchImplementation = async () => undefined;
    fetchListener({ request: new Request('http://basketra.test/another-route'), respondWith, waitUntil });
    assert.ok(responseWork);
    await assert.rejects(responseWork, /offline/);

    responseWork = undefined;
    fetchListener({ request: new Request('http://basketra.test/uncached.js'), respondWith, waitUntil });
    assert.ok(responseWork);
    await assert.rejects(responseWork, /offline/);
  } finally {
    if (originalSelf) Object.defineProperty(globalThis, 'self', originalSelf);
    else Reflect.deleteProperty(globalThis, 'self');
    if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
    else Reflect.deleteProperty(globalThis, 'caches');
    if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
    else Reflect.deleteProperty(globalThis, 'fetch');
  }
});
