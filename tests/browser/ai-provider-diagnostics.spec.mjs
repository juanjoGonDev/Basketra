import { test, expect } from '@playwright/test';

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

function settings(overrides = {}) {
  return {
    configured: true,
    status: 'configured',
    missing: [],
    baseUrl: 'http://192.168.1.20:3001/v1',
    model: 'gpt-5',
    image: true,
    pdf: false,
    loopbackWarning: false,
    requiresContainerRecreate: true,
    recommendedHostUrl: 'http://host.docker.internal:3001/v1/',
    ...overrides,
  };
}

test('settings render remote, invalid, host, loopback and missing provider states', async ({ page }) => {
  let current = settings();
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(current),
  }));

  await page.goto('/');
  await navigate(page, 'Ajustes');
  await expect(page.locator('#ai-provider-request')).toHaveText('POST http://192.168.1.20:3001/v1/chat/completions');
  await expect(page.locator('#ai-provider-authorization')).toHaveText('Sin cabecera Authorization');
  await expect(page.locator('#ai-configuration-status')).toHaveText('Configuración cargada');

  current = settings({ baseUrl: 'not a valid absolute URL', apiKeyMask: '***safe' });
  await page.reload();
  await navigate(page, 'Ajustes');
  await expect(page.locator('#ai-provider-request')).toHaveText('POST not a valid absolute URL/chat/completions');
  await expect(page.locator('#ai-provider-authorization')).toHaveText('Bearer con token gestionado');

  current = settings({ baseUrl: 'http://host.docker.internal:3001/v1/' });
  await page.reload();
  await navigate(page, 'Ajustes');
  await expect(page.locator('#ai-configuration-detail')).toContainText('host.docker.internal');

  current = settings({ baseUrl: 'http://127.0.0.1:3001/v1/', loopbackWarning: true });
  await page.reload();
  await navigate(page, 'Ajustes');
  await expect(page.locator('#ai-configuration-status')).toHaveText('Configurado con dirección incorrecta para Docker');
  await expect(page.locator('#ai-configuration-status')).toHaveAttribute('data-state', 'warning');
  await expect(page.locator('#ai-configuration-detail')).not.toContainText('token');

  current = settings({
    baseUrl: 'http://127.0.0.1:3001/v1/',
    apiKeyMask: '***safe',
    loopbackWarning: true,
  });
  await page.reload();
  await navigate(page, 'Ajustes');
  await expect(page.locator('#ai-configuration-detail')).toContainText('token ***safe');

  current = settings({ configured: false, status: 'missing', missing: ['BASKETRA_AI_BASE_URL', 'BASKETRA_AI_MODEL'], baseUrl: undefined, model: undefined });
  await page.reload();
  await navigate(page, 'Ajustes');
  await expect(page.locator('#ai-configuration-status')).toHaveText('Configuración no cargada');
  await expect(page.locator('#ai-configuration-detail')).toContainText('BASKETRA_AI_BASE_URL, BASKETRA_AI_MODEL');
  await expect(page.getByRole('button', { name: 'Verificar imagen y JSON estricto', exact: true })).toBeDisabled();
});

test('provider diagnostic renders every stable recovery message and 200-level negative capability', async ({ page }) => {
  let providerCode = 'AI_LOOPBACK_CONTAINER';
  let successfulHttp = false;
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(settings()),
  }));
  await page.route('**/api/v1/settings/ai-provider/test', route => route.fulfill({
    status: successfulHttp ? 200 : 502,
    contentType: 'application/json',
    body: JSON.stringify({
      connection: {
        ok: false,
        imageStructuredOutput: false,
        code: providerCode,
        message: providerCode === 'AI_UNKNOWN'
          ? 'Fallo controlado del diagnóstico'
          : 'El detalle privado del proveedor no debe mostrarse',
      },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Ajustes');
  const button = page.getByRole('button', { name: 'Verificar imagen y JSON estricto', exact: true });
  const state = page.locator('#ai-test-state');
  const cases = [
    ['AI_LOOPBACK_CONTAINER', 'La prueba sale desde el contenedor Basketra'],
    ['AI_UNREACHABLE', 'No se pudo abrir una conexión'],
    ['AI_AUTHENTICATION_FAILED', 'token gestionado'],
    ['AI_TIMEOUT', 'no terminó dentro del tiempo configurado'],
    ['AI_ATTACHMENT_TOO_LARGE', 'imagen sintética mínima por tamaño'],
    ['AI_ATTACHMENT_UPLOAD_FAILED', 'preparar la imagen sintética en el compositor'],
    ['AI_REQUEST_REJECTED', 'rechazó la imagen o el esquema estricto'],
    ['AI_RATE_LIMITED', 'limitando solicitudes'],
    ['AI_INVALID_RESPONSE', 'no respetó el esquema estricto'],
    ['AI_EMPTY_RESPONSE', 'sin devolver contenido estructurado'],
    ['AI_RESPONSE_TOO_LARGE', 'superó el límite configurado'],
    ['AI_PROVIDER_FAILED', 'falló al procesar la imagen sintética'],
    ['AI_UNKNOWN', 'Fallo controlado del diagnóstico'],
  ];

  for (const [code, expected] of cases) {
    providerCode = code;
    await button.click();
    await expect(state).toContainText(expected);
    await expect(button).toBeEnabled();
    await expect(state).not.toContainText('detalle privado');
  }

  successfulHttp = true;
  providerCode = 'AI_INVALID_RESPONSE';
  await button.click();
  await expect(state).toHaveText('El proveedor respondió sin confirmar la capacidad multimodal estructurada.');
  await expect(button).toBeEnabled();
  await expect(state).not.toContainText('detalle privado');
});
