export const DEFAULT_REQUEST_THROTTLE_MS = 1000;

function defaultBaseUrl() {
  return globalThis.location?.origin || 'http://localhost';
}

function requestMethod(input, init = {}) {
  return String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function requestUrl(input, baseUrl) {
  return new URL(input instanceof Request ? input.url : String(input), baseUrl);
}

function abortError() {
  return new DOMException('Request was aborted', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
}

function defaultWait(milliseconds, signal) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason instanceof Error ? signal.reason : abortError());
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function normalizedHeaderIdentity(headers) {
  if (!headers) return '';
  const normalized = [...new Headers(headers).entries()]
    .map(([name, value]) => `${name.toLowerCase()}:${value}`)
    .sort();
  return normalized.join('|');
}

function readIdentity(input, init, baseUrl) {
  const url = requestUrl(input, baseUrl);
  return [
    requestMethod(input, init),
    url.href,
    normalizedHeaderIdentity(init.headers),
    init.credentials || '',
  ].join(' ');
}

function isCoalescibleRead(input, init) {
  const method = requestMethod(input, init);
  return (method === 'GET' || method === 'HEAD')
    && init.body === undefined
    && init.signal === undefined;
}

export function requestBucketKey(input, init = {}, baseUrl = defaultBaseUrl()) {
  const url = requestUrl(input, baseUrl);
  return `${requestMethod(input, init)} ${url.pathname}`;
}

export function createRequestCoordinator({
  baseUrl = defaultBaseUrl(),
  fetchImpl = globalThis.fetch.bind(globalThis),
  now = () => Date.now(),
  wait = defaultWait,
  throttleMs = DEFAULT_REQUEST_THROTTLE_MS,
} = {}) {
  if (!Number.isFinite(throttleMs) || throttleMs < 0) {
    throw new RangeError('Request throttle must be a non-negative finite number');
  }

  const buckets = new Map();
  const inFlightReads = new Map();

  const enqueue = (bucketKey, signal, execute) => {
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        lastStartedAt: Number.NEGATIVE_INFINITY,
        tail: Promise.resolve(),
      };
      buckets.set(bucketKey, bucket);
    }

    const previous = bucket.tail.catch(() => undefined);
    const task = previous.then(async () => {
      throwIfAborted(signal);
      const elapsed = now() - bucket.lastStartedAt;
      const delay = Number.isFinite(bucket.lastStartedAt)
        ? Math.max(0, throttleMs - elapsed)
        : 0;
      if (delay > 0) await wait(delay, signal);
      throwIfAborted(signal);
      bucket.lastStartedAt = now();
      return execute();
    });
    bucket.tail = task.then(() => undefined, () => undefined);
    return task;
  };

  const request = (input, init = {}) => {
    const bucketKey = requestBucketKey(input, init, baseUrl);
    const coalescible = isCoalescibleRead(input, init);
    const identity = coalescible ? readIdentity(input, init, baseUrl) : '';
    if (coalescible) {
      const existing = inFlightReads.get(identity);
      if (existing) return existing.then(response => response.clone());
    }

    const transport = enqueue(bucketKey, init.signal, () => fetchImpl(input, init));
    if (!coalescible) return transport;

    inFlightReads.set(identity, transport);
    void transport.finally(() => {
      if (inFlightReads.get(identity) === transport) inFlightReads.delete(identity);
    }).catch(() => {});
    return transport.then(response => response.clone());
  };

  return { request };
}
