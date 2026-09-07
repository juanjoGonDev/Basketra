import assert from 'node:assert/strict';
import test from 'node:test';

type Listener = (event: Record<string, unknown>) => void;

function requestAddress(request: RequestInfo | URL): string {
  return request instanceof Request ? request.url : String(request);
}

test('service worker versions and serves the complete shell cache-first without intercepting APIs', async () => {
  const listeners = new Map<string, Listener>();
  const addedShells: string[][] = [];
  const deletedCaches: string[] = [];
  const cachedRequests: string[] = [];
  const cacheWrites: string[] = [];
  const backgroundWork: Promise<unknown>[] = [];
  let currentCacheName = '';
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  let cachePutFails = false;
  let fetchImplementation: typeof fetch = async request => new Response(String(request), { status: 200 });
  let matchImplementation = async (_request: RequestInfo | URL): Promise<Response | undefined> => undefined;

  const cache = {
    async addAll(shell: string[]) {
      addedShells.push([...shell]);
    },
    async put(request: RequestInfo | URL) {
      cacheWrites.push(requestAddress(request));
      if (cachePutFails) throw new Error('cache unavailable');
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
      assert.equal(name, 'basketra-shell-1.4.2-test');
      currentCacheName ||= name;
      assert.equal(name, currentCacheName);
      return cache;
    },
    async keys() {
      assert.notEqual(currentCacheName, '');
      return ['unrelated-cache', 'basketra-shell-obsolete', currentCacheName];
    },
    async delete(name: string) {
      deletedCaches.push(name);
      return true;
    },
    async match(request: RequestInfo | URL) {
      cachedRequests.push(requestAddress(request));
      return matchImplementation(request);
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
      request: new Request('http://basketra.test/api/v1/meta'),
      respondWith,
      waitUntil,
    });
    assert.equal(responseWork, undefined);

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

    let releaseRefresh: ((response: Response) => void) | undefined;
    const cachedRequest = new Request('http://basketra.test/app.js');
    matchImplementation = async request => requestAddress(request) === cachedRequest.url
      ? new Response('cached', { status: 200 })
      : undefined;
    fetchImplementation = (() => new Promise<Response>(resolve => { releaseRefresh = resolve; })) as typeof fetch;
    fetchListener({ request: cachedRequest, respondWith, waitUntil });
    assert.equal(await (await responseWork)?.text(), 'cached');
    assert.ok(releaseRefresh, 'background refresh must start');
    releaseRefresh(new Response('fresh', { status: 200 }));
    await backgroundWork.at(-1);
    assert.deepEqual(cacheWrites, [cachedRequest.url]);

    responseWork = undefined;
    cachePutFails = true;
    matchImplementation = async () => undefined;
    fetchImplementation = async () => new Response('fresh despite cache failure', { status: 200 });
    const cacheFailureRequest = new Request('http://basketra.test/operations.js');
    fetchListener({ request: cacheFailureRequest, respondWith, waitUntil });
    assert.equal(await (await responseWork)?.text(), 'fresh despite cache failure');
    assert.deepEqual(cacheWrites, [cachedRequest.url, cacheFailureRequest.url]);
    cachePutFails = false;

    responseWork = undefined;
    fetchImplementation = async () => new Response('missing', { status: 404 });
    fetchListener({ request: new Request('http://basketra.test/missing.js'), respondWith, waitUntil });
    assert.equal((await responseWork)?.status, 404);
    assert.deepEqual(cacheWrites, [cachedRequest.url, cacheFailureRequest.url]);

    responseWork = undefined;
    fetchImplementation = async () => { throw new TypeError('offline'); };
    matchImplementation = async request => requestAddress(request) === '/index.html'
      ? new Response('fallback', { status: 200 })
      : undefined;
    fetchListener({ request: new Request('http://basketra.test/unknown-route'), respondWith, waitUntil });
    assert.equal(await (await responseWork)?.text(), 'fallback');
    assert.ok(cachedRequests.some(value => value === '/index.html'));

    responseWork = undefined;
    matchImplementation = async () => undefined;
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
