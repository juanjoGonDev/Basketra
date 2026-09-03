import { test, expect } from '@playwright/test';

const MEBIBYTE = 1024 * 1024;
const MINUTE_MS = 60 * 1000;

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

async function openRuntimeSettings(page) {
  await navigate(page, 'Ajustes');
  await page.getByRole('tab', { name: 'IA', exact: true }).click();
}

function publicRuntime(overrides = {}) {
  return {
    ai: {
      configured: true,
      baseUrl: 'http://host.docker.internal:3001/v1/',
      model: 'default',
      maxRetries: 1,
      apiKeyConfigured: true,
      apiKeyMask: '••••safe',
    },
    overpassBaseUrl: 'https://overpass-api.de/api/',
    maxBodyBytes: 32 * MEBIBYTE,
    idleHibernateAfterMs: 5 * MINUTE_MS,
    updatedAt: '2026-09-02T19:00:00.000Z',
    ...overrides,
  };
}

function aiStatus(runtime) {
  const ai = runtime.ai;
  const configured = Boolean(ai.baseUrl && ai.model);
  return {
    configured,
    status: configured ? 'configured' : 'missing',
    missing: [
      ...(ai.baseUrl ? [] : ['URL de WebAPI']),
      ...(ai.model ? [] : ['Modelo']),
    ],
    ...(ai.baseUrl ? { baseUrl: ai.baseUrl } : {}),
    ...(ai.model ? { model: ai.model } : {}),
    ...(ai.apiKeyMask ? { apiKeyMask: ai.apiKeyMask } : {}),
    maxRetries: ai.maxRetries,
    loopbackWarning: false,
    requiresContainerRecreate: false,
    recommendedHostUrl: 'http://host.docker.internal:3001/v1/',
  };
}

function nextRuntime(current, patch) {
  const replacingToken = typeof patch.aiApiKey === 'string';
  const clearingToken = patch.aiApiKey === null;
  return {
    ai: {
      configured: Boolean(patch.aiBaseUrl && patch.aiModel),
      baseUrl: patch.aiBaseUrl,
      model: patch.aiModel,
      maxRetries: patch.aiMaxRetries,
      apiKeyConfigured: clearingToken ? false : replacingToken ? true : current.ai.apiKeyConfigured,
      apiKeyMask: clearingToken ? null : replacingToken ? '••••alue' : current.ai.apiKeyMask,
    },
    overpassBaseUrl: patch.overpassBaseUrl,
    maxBodyBytes: patch.maxBodyBytes,
    idleHibernateAfterMs: patch.idleHibernateAfterMs,
    updatedAt: '2026-09-02T19:01:00.000Z',
  };
}

async function installAuxiliaryRoutes(page, runtimeProvider) {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(runtimeProvider()),
  }));
  await page.route('**/api/v1/diagnostics', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      startedAt: '2026-09-02T18:00:00.000Z',
      memory: { rss: 64 * MEBIBYTE },
      runtime: { version: '1.0.0', revision: 'abcdef1234567890', startedAt: '2026-09-02T18:00:00.000Z' },
    }),
  }));
  await page.route('**/api/v1/logs?limit=500', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ events: [] }),
  }));
  await page.route('**/api/v1/restore/imports', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ backups: [] }),
  }));
}

test('runtime settings persist without restart and preserve, replace, then clear the write-only token', async ({ page }) => {
  let runtime = publicRuntime();
  const writes = [];

  await page.route('**/api/v1/settings/runtime', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: runtime }) });
      return;
    }
    const patch = route.request().postDataJSON();
    writes.push(patch);
    runtime = nextRuntime(runtime, patch);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: runtime }) });
  });
  await installAuxiliaryRoutes(page, () => aiStatus(runtime));

  await page.goto('/');
  await openRuntimeSettings(page);

  await expect(page.locator('#runtime-ai-base-url')).toHaveValue('http://host.docker.internal:3001/v1/');
  await expect(page.locator('#runtime-ai-model')).toHaveValue('default');
  await expect(page.locator('#runtime-ai-api-key')).toHaveValue('');
  await expect(page.locator('#runtime-ai-token-help')).toContainText('••••safe');
  await expect(page.locator('#runtime-max-body-mib')).toHaveValue('32');
  expect(await page.locator('#runtime-max-body-mib').evaluate(input => input.checkValidity())).toBe(true);

  await page.locator('#runtime-ai-base-url').fill('http://192.168.1.20:3001/v1/');
  await page.locator('#runtime-ai-model').fill('gpt-5');
  await page.locator('#runtime-ai-max-retries').fill('3');
  await page.getByText('Red y recursos locales', { exact: true }).click();
  await page.locator('#runtime-overpass-base-url').fill('https://overpass.kumi.systems/api/');
  await page.locator('#runtime-max-body-mib').fill('64');
  await page.locator('#runtime-idle-minutes').fill('10');
  expect(await page.locator('#runtime-max-body-mib').evaluate(input => input.checkValidity())).toBe(true);
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();

  await expect.poll(() => writes.length).toBe(1);
  expect(Object.hasOwn(writes[0], 'aiApiKey')).toBe(false);
  expect(writes[0]).toMatchObject({
    aiBaseUrl: 'http://192.168.1.20:3001/v1/',
    aiModel: 'gpt-5',
    aiMaxRetries: 3,
    overpassBaseUrl: 'https://overpass.kumi.systems/api/',
    maxBodyBytes: 64 * MEBIBYTE,
    idleHibernateAfterMs: 10 * MINUTE_MS,
  });
  await expect(page.locator('#runtime-settings-save-state')).toContainText('Configuración guardada en SQLite');
  await expect(page.locator('#runtime-ai-token-help')).toContainText('••••safe');

  const replacementToken = ['runtime', 'token', 'replacement', 'value'].join('-');
  await page.locator('#runtime-ai-api-key').fill(replacementToken);
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].aiApiKey).toBe(replacementToken);
  await expect(page.locator('#runtime-ai-api-key')).toHaveValue('');
  await expect(page.locator('#runtime-ai-token-help')).toContainText('••••alue');

  const clearToken = page.locator('#runtime-ai-clear-token');
  const clearTokenRow = page.locator('label.switch-row', { has: clearToken });
  await clearTokenRow.click();
  await expect(clearToken).toBeChecked();
  await expect(page.locator('#runtime-ai-api-key')).toBeDisabled();
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2].aiApiKey).toBeNull();
  await expect(page.locator('#runtime-ai-clear-token')).toBeDisabled();
  await expect(page.locator('#runtime-ai-token-help')).toContainText('No hay token guardado');
  await expect(page.locator('#ai-configuration-detail')).toContainText('gpt-5');
  await expect(page.locator('#runtime-settings-save-state')).toContainText('no hace falta reiniciar');
});

test('runtime editor keeps defensive defaults and does not overwrite dirty fields during heartbeat refresh', async ({ page }) => {
  let runtime = {
    overpassBaseUrl: '',
    maxBodyBytes: 32 * MEBIBYTE,
    idleHibernateAfterMs: 5 * MINUTE_MS,
    updatedAt: '2026-09-02T19:00:00.000Z',
  };
  let runtimeReads = 0;
  const writes = [];
  await page.route('**/api/v1/settings/runtime', async route => {
    if (route.request().method() === 'GET') {
      runtimeReads += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: runtime }) });
      return;
    }
    const patch = route.request().postDataJSON();
    writes.push(patch);
    runtime = {
      ai: {
        configured: false,
        baseUrl: null,
        model: null,
        maxRetries: patch.aiMaxRetries,
        apiKeyConfigured: true,
        apiKeyMask: null,
      },
      overpassBaseUrl: patch.overpassBaseUrl,
      maxBodyBytes: patch.maxBodyBytes,
      idleHibernateAfterMs: patch.idleHibernateAfterMs,
      updatedAt: '2026-09-02T19:01:00.000Z',
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: runtime }) });
  });
  await installAuxiliaryRoutes(page, () => ({
    configured: false,
    status: 'missing',
    missing: ['URL de WebAPI', 'Modelo'],
    maxRetries: 1,
    loopbackWarning: false,
    requiresContainerRecreate: false,
    recommendedHostUrl: 'http://host.docker.internal:3001/v1/',
  }));

  await page.goto('/');
  await openRuntimeSettings(page);
  await expect(page.locator('#runtime-ai-base-url')).toHaveValue('');
  await expect(page.locator('#runtime-ai-model')).toHaveValue('');
  await expect(page.locator('#runtime-ai-max-retries')).toHaveValue('1');
  await expect(page.locator('#runtime-ai-token-help')).toContainText('No hay token guardado');

  await page.getByText('Red y recursos locales', { exact: true }).click();
  await expect(page.locator('#runtime-overpass-base-url')).toHaveValue('');
  await page.locator('#runtime-overpass-base-url').fill('https://overpass.kumi.systems/api/');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].aiBaseUrl).toBeNull();
  expect(writes[0].aiModel).toBeNull();
  await expect(page.locator('#runtime-ai-token-help')).toContainText('Token guardado');

  await page.locator('#runtime-ai-base-url').fill('http://draft.local:3001/v1/');
  const readsBeforeRefresh = runtimeReads;
  runtime = publicRuntime({ ai: { ...publicRuntime().ai, baseUrl: 'http://server-change.local:3001/v1/' } });
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => runtimeReads).toBeGreaterThan(readsBeforeRefresh);
  await expect(page.locator('#runtime-ai-base-url')).toHaveValue('http://draft.local:3001/v1/');
});

test('runtime save guards duplicate submissions, survives missing diagnostics controls and surfaces backend errors', async ({ page }) => {
  let runtime = publicRuntime();
  let writes = 0;
  let failSave = false;
  let releaseFirstSave;
  const firstSaveGate = new Promise(resolve => { releaseFirstSave = resolve; });

  await page.route('**/api/v1/settings/runtime', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: runtime }) });
      return;
    }
    writes += 1;
    if (writes === 1) await firstSaveGate;
    if (failSave) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'SAVE_FAILED', message: 'No se pudo guardar la configuración' } }),
      });
      return;
    }
    const patch = route.request().postDataJSON();
    runtime = nextRuntime(runtime, patch);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: runtime }) });
  });
  await installAuxiliaryRoutes(page, () => aiStatus(runtime));

  await page.goto('/');
  await openRuntimeSettings(page);
  await page.locator('#test-ai-provider').evaluate(element => element.remove());

  await page.locator('#runtime-settings-form').evaluate(form => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect.poll(() => writes).toBe(1);
  await expect(page.getByRole('button', { name: 'Guardar cambios', exact: true })).toBeDisabled();
  releaseFirstSave();
  await expect(page.locator('#runtime-settings-save-state')).toContainText('Configuración guardada en SQLite');
  await expect(page.getByRole('button', { name: 'Guardar cambios', exact: true })).toBeEnabled();

  failSave = true;
  await page.locator('#runtime-ai-model').fill('failure-model');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect.poll(() => writes).toBe(2);
  await expect(page.locator('#runtime-settings-save-state')).toContainText('No se pudo guardar la configuración');
  await expect(page.locator('#runtime-settings-save-state')).toHaveAttribute('data-state', 'error');
  await expect(page.getByRole('button', { name: 'Guardar cambios', exact: true })).toBeEnabled();
});

test('runtime editor remains usable without horizontal overflow on compact mobile', async ({ page }) => {
  const runtime = publicRuntime({
    ai: {
      configured: false,
      baseUrl: null,
      model: null,
      maxRetries: 1,
      apiKeyConfigured: false,
      apiKeyMask: null,
    },
  });
  await page.route('**/api/v1/settings/runtime', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ settings: runtime }),
  }));
  await installAuxiliaryRoutes(page, () => aiStatus(runtime));

  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/');
  await openRuntimeSettings(page);

  await expect(page.locator('#runtime-settings-form')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar cambios', exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
