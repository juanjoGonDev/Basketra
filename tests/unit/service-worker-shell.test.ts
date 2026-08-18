import assert from 'node:assert/strict';
import test from 'node:test';

type Listener = (event: Record<string, unknown>) => void;

function requestAddress(request: RequestInfo | URL): string {
  return request instanceof Request ? request.url : String(request);
}

test('service worker installs the complete shell, cleans old caches and handles every fetch path', async () => {
  const listeners = new Map<string, Listener>();
  const addedShells: string[][] = [];
  const deletedCaches: string[] = [];
  const cachedRequests: string[] = [];
  const cacheWrites: string[] = [];
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  let fetchImplementation: typeof fetch = async request => new Response(String(request), { status: 200 });
  let matchImplementation = async (_request: RequestInfo | URL): Promise<Response | undefined> => undefined;

  const cache = {
    async addAll(shell: string[]) {
      addedShells.push([...shell]);
    },
    async put(request: RequestInfo | URL) {
      cacheWrites.push(requestAddress(request));
    },
  };
  const fakeSelf = {
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
      assert.equal(name, 'basketra-shell-v13');
      return cache;
    },
    async keys() {
      return ['basketra-shell-v8', 'basketra-shell-v9', 'basketra-shell-v10', 'basketra-shell-v11', 'basketra-shell-v12', 'basketra-shell-v13'];
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
    assert.ok(addedShells[0]?.includes('/operations.css'));

    let activateWork: Promise<unknown> | undefined;
    activate({ waitUntil(work: Promise<unknown>) { activateWork = work; } });
    await activateWork;
    assert.deepEqual(deletedCaches, ['basketra-shell-v8', 'basketra-shell-v9', 'basketra-shell-v10', 'basketra-shell-v11', 'basketra-shell-v12']);
    assert.equal(claimCalls, 1);

    let responseWork: Promise<Response | undefined> | undefined;
    const respondWith = (work: Promise<Response | undefined>) => { responseWork = work; };

    fetchListener({
      request: new Request('http://basketra.test/api/v1/meta'),
      respondWith,
    });
    assert.equal(responseWork, undefined);

    fetchListener({
      request: new Request('http://basketra.test/', { method: 'POST', body: 'x' }),
      respondWith,
    });
    assert.equal(responseWork, undefined);

    fetchImplementation = async () => new Response('fresh', { status: 200 });
    const freshRequest = new Request('http://basketra.test/operations.js');
    fetchListener({ request: freshRequest, respondWith });
    assert.equal((await responseWork)?.status, 200);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(cacheWrites, [freshRequest.url]);

    responseWork = undefined;
    fetchImplementation = async () => new Response('missing', { status: 404 });
    fetchListener({ request: new Request('http://basketra.test/missing.js'), respondWith });
    assert.equal((await responseWork)?.status, 404);
    assert.deepEqual(cacheWrites, [freshRequest.url]);

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
    assert.ok(cachedRequests.some(value => value === '/index.html'));
  } finally {
    if (originalSelf) Object.defineProperty(globalThis, 'self', originalSelf);
    else Reflect.deleteProperty(globalThis, 'self');
    if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
    else Reflect.deleteProperty(globalThis, 'caches');
    if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
    else Reflect.deleteProperty(globalThis, 'fetch');
  }
});
