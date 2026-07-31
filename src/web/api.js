export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

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
    if (typeof body === 'object' && body !== null) error.code = body.error?.code;
    error.status = response.status;
    throw error;
  }

  return body;
}

export function setBusy(element, busy) {
  element.disabled = busy;
  element.setAttribute('aria-busy', String(busy));
}
