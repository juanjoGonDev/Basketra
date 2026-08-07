function emitApiLog(detail) {
  window.dispatchEvent(new CustomEvent('basketra:api-log', { detail }));
}

function requestPath(path) {
  try {
    return new URL(path, location.origin).pathname;
  } catch {
    return '/';
  }
}

export async function api(path, options = {}) {
  const method = options.method || 'GET';
  const started = performance.now();
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    if (error?.name !== 'AbortError') {
      emitApiLog({
        event: 'client.network_error',
        level: 'error',
        method,
        path: requestPath(path),
        durationMs: Math.round(performance.now() - started),
        code: 'NETWORK_ERROR',
      });
    }
    throw error;
  }

  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text();

  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && body.error?.message
      ? body.error.message
      : `HTTP ${response.status}`;
    const error = new Error(message);
    if (typeof body === 'object' && body !== null) {
      error.code = body.error?.code;
      error.details = body.error?.details;
    }
    error.status = response.status;
    const requestId = response.headers.get('x-request-id') || (typeof body === 'object' && body !== null ? body.error?.requestId : undefined);
    emitApiLog({
      event: 'client.api_error',
      level: response.status >= 500 ? 'error' : 'warn',
      method,
      path: requestPath(path),
      status: response.status,
      durationMs: Math.round(performance.now() - started),
      ...(error.code ? { code: error.code } : {}),
      ...(requestId ? { requestId } : {}),
    });
    throw error;
  }

  return body;
}

export function realtimeEndpoint() {
  return '/api/v1/realtime';
}

export function setBusy(element, busy) {
  element.disabled = busy;
  element.setAttribute('aria-busy', String(busy));
}

void import('./operations.js').catch(() => {});
