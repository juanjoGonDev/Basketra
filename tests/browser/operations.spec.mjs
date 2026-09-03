import { test, expect } from '@playwright/test';

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

function selectSettingsTab(page, name) {
  return page.getByRole('tab', { name, exact: true }).click();
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

function configuredAiSettings() {
  return {
    configured: true,
    status: 'configured',
    missing: [],
    baseUrl: 'http://host.docker.internal:3001/v1/',
    model: 'gpt-5',
    apiKeyMask: '••••test',
    maxRetries: 1,
    loopbackWarning: false,
    requiresContainerRecreate: false,
    recommendedHostUrl: 'http://host.docker.internal:3001/v1/',
  };
}

test.afterEach(async ({ page }, testInfo) => {
  if (page.isClosed()) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('operations-viewport.png'), fullPage: true });
});

test('settings show live runtime, redacted copyable logs and downloadable importable backups', async ({ page, request }, testInfo) => {
  const failures = [];
  await page.addInitScript(() => {
    window.__basketraCopiedLogs = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: command => {
        if (command !== 'copy') return false;
        window.__basketraCopiedLogs = document.activeElement?.value || '';
        return true;
      },
    });
  });
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });

  await page.goto('/');
  await navigate(page, 'Ajustes');
  await expect(page.getByRole('heading', { name: 'Servidor y versión' })).toBeVisible();
  await expect(page.locator('#runtime-version')).toHaveText('1.4.2-test');
  await expect(page.locator('#runtime-revision')).toContainText('abcdef123456');
  await expect(page.locator('#server-started-at')).not.toHaveText('Cargando…');

  const firstUptime = await page.locator('#server-uptime').textContent();
  await expect.poll(async () => page.locator('#server-uptime').textContent(), { timeout: 3500 })
    .not.toBe(firstUptime);

  await selectSettingsTab(page, 'IA');
  await expect(page.locator('#ai-configuration-status')).toHaveText('Falta configuración');
  await expect(page.locator('#ai-configuration-detail')).toContainText('URL de WebAPI');
  await expect(page.locator('#ai-configuration-detail')).toContainText('Modelo');
  await expect(page.locator('#ai-provider-request')).toHaveText('Pendiente de configuración');
  await expect(page.locator('#test-ai-provider')).toBeDisabled();

  await selectSettingsTab(page, 'Datos');
  await page.getByRole('button', { name: 'Crear copia', exact: true }).click();
  const downloadLink = page.locator('#backup-download-link');
  await expect(downloadLink).toBeVisible();
  await expect(page.locator('#backup-state')).toContainText('Decide si quieres descargarla');
  const downloadPath = await downloadLink.getAttribute('href');
  expect(downloadPath).toMatch(/^\/api\/v1\/backups\//);

  const backupResponse = await request.get(downloadPath);
  expect(backupResponse.ok()).toBeTruthy();
  expect(backupResponse.headers()['content-type']).toBe('application/vnd.sqlite3');
  expect(backupResponse.headers()['content-disposition']).toContain('attachment');
  const backupBytes = await backupResponse.body();
  expect(backupBytes.byteLength).toBeGreaterThan(0);

  await page.locator('#backup-import-file').setInputFiles({
    name: 'basketra-import.db',
    mimeType: 'application/vnd.sqlite3',
    buffer: backupBytes,
  });
  await page.getByRole('button', { name: 'Importar y validar', exact: true }).click();
  await expect(page.locator('#restore-state')).toContainText('Copia validada');
  await expect(page.locator('#restore-backup-select')).toBeEnabled();
  await expect(page.locator('#stage-restore')).toBeEnabled();

  await page.locator('#restore-confirmation').fill('NO');
  await page.getByRole('button', { name: 'Restaurar tras reinicio', exact: true }).click();
  await expect(page.locator('#restore-state')).toContainText('escribe RESTAURAR exactamente');

  await selectSettingsTab(page, 'Diagnóstico');
  await expect(page.getByRole('button', { name: 'Copiar logs', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Actualizar logs', exact: true }).click();
  await expect(page.locator('#application-logs')).toContainText('server.started');
  await expect(page.locator('#application-logs')).toContainText('backup.imported');
  await expect(page.locator('#application-logs')).not.toContainText('basketra-import.db');

  const copyButton = page.getByRole('button', { name: 'Copiar logs', exact: true });
  await expect(copyButton).toBeEnabled();
  await copyButton.click();
  await expect(page.locator('#copy-logs-state')).toContainText('eventos copiados como JSON');
  const copiedLogs = await page.evaluate(() => window.__basketraCopiedLogs);
  expect(copiedLogs).toContain('"event":"server.started"');
  expect(copiedLogs).toContain('"event":"backup.imported"');
  expect(copiedLogs).not.toContain('basketra-import.db');
  const copiedLines = copiedLogs.trim().split('\n');
  expect(copiedLines.length).toBeGreaterThan(1);
  for (const line of copiedLines) {
    expect(line).toBe(JSON.stringify(JSON.parse(line)));
  }

  await page.screenshot({ path: testInfo.outputPath('runtime-backups-logs.png'), fullPage: true });
  await expectNoHorizontalOverflow(page);
  expect(failures).toEqual([]);
});

test('settings verify the managed-token image and strict JSON capability', async ({ page }) => {
  let probeRequests = 0;
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(configuredAiSettings()),
  }));
  await page.route('**/api/v1/settings/ai-provider/test', route => {
    probeRequests += 1;
    expect(route.request().method()).toBe('POST');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        connection: {
          ok: true,
          model: 'gpt-5',
          imageStructuredOutput: true,
        },
      }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Ajustes');
  await selectSettingsTab(page, 'IA');
  await expect(page.locator('#ai-provider-request')).toHaveText('POST http://host.docker.internal:3001/v1/chat/completions');
  await expect(page.locator('#ai-provider-authorization')).toHaveText('Token guardado ••••test');
  await page.getByText('Detalles técnicos de la conexión', { exact: true }).click();
  await expect(page.getByText('imagen sintética sin datos personales')).toBeVisible();

  await page.getByRole('button', { name: 'Verificar imagen y JSON estricto', exact: true }).click();
  await expect(page.locator('#ai-test-state')).toContainText('Capacidad verificada');
  await expect(page.locator('#ai-test-state')).toContainText('adjunto de imagen');
  await expect(page.locator('#ai-test-state')).toContainText('salida estructurada estricta');
  expect(probeRequests).toBe(1);
  await expectNoHorizontalOverflow(page);
});

test('desktop settings explain the webApi probe and keep the adaptive rail beside content', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1664, height: 900 });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(configuredAiSettings()),
  }));
  await page.route('**/api/v1/settings/ai-provider/test', route => route.fulfill({
    status: 502,
    contentType: 'application/json',
    body: JSON.stringify({
      connection: {
        ok: false,
        code: 'AI_UNREACHABLE',
        message: 'Provider unavailable',
      },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Ajustes');
  await selectSettingsTab(page, 'IA');
  await page.getByText('Detalles técnicos de la conexión', { exact: true }).click();
  await expect(page.locator('#ai-provider-request')).toHaveText('POST http://host.docker.internal:3001/v1/chat/completions');
  await expect(page.locator('#ai-provider-authorization')).toHaveText('Token guardado ••••test');
  await expect(page.locator('#ai-provider-network-note')).toContainText('apunta al host Docker de Basketra');
  await expect(page.locator('#ai-provider-network-note')).toContainText('LAN o VPN');

  await page.getByRole('button', { name: 'Verificar imagen y JSON estricto', exact: true }).click();
  await expect(page.locator('#ai-test-state')).toContainText('No se pudo abrir una conexión');
  await expect(page.locator('#ai-test-state')).toContainText('IP privada');
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.documentElement.style.overflowAnchor = 'none';
    document.body.style.overflowAnchor = 'none';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  });
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);

  const geometry = await page.evaluate(() => {
    const header = document.querySelector('.app-header').getBoundingClientRect();
    const navigation = document.querySelector('.bottom-nav').getBoundingClientRect();
    const main = document.querySelector('main').getBoundingClientRect();
    const firstCard = document.querySelector('.settings-tab-panel:not([hidden]) .operations-card').getBoundingClientRect();
    const stack = document.querySelector('.operations-stack').getBoundingClientRect();
    return {
      headerBottom: header.bottom,
      navigationRight: navigation.right,
      navigationTop: navigation.top,
      navigationBottom: navigation.bottom,
      firstCardLeft: firstCard.left,
      firstCardTop: firstCard.top,
      mainLeft: main.left,
      stackWidth: stack.width,
    };
  });
  expect(geometry.navigationTop).toBeGreaterThanOrEqual(geometry.headerBottom - 1);
  expect(geometry.navigationBottom).toBeGreaterThanOrEqual(899);
  expect(geometry.mainLeft).toBeGreaterThanOrEqual(geometry.navigationRight - 1);
  expect(geometry.firstCardLeft).toBeGreaterThanOrEqual(geometry.navigationRight - 1);
  expect(geometry.firstCardTop).toBeGreaterThanOrEqual(geometry.headerBottom - 1);
  expect(geometry.stackWidth).toBeGreaterThan(900);

  await page.screenshot({ path: testInfo.outputPath('desktop-provider-diagnostics.png'), fullPage: true });
  await expectNoHorizontalOverflow(page);
});

test.describe('network heartbeat', () => {
  test.use({ serviceWorkers: 'block' });

  test('private-route heartbeat recovers after VPN connectivity returns without a reload', async ({ page }, testInfo) => {
    let failHeartbeat = true;
    const unexpectedFailures = [];
    await page.route('**/health?heartbeat=*', route => {
      if (failHeartbeat) return route.abort('failed');
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
    });
    page.on('requestfailed', request => {
      if (request.url().includes('/health?heartbeat=')) return;
      const failure = request.failure()?.errorText ?? '';
      if (!failure.includes('net::ERR_ABORTED')) unexpectedFailures.push(`${request.method()} ${request.url()} ${failure}`);
    });
    page.on('pageerror', error => unexpectedFailures.push(error.message));

    await page.goto('/');
    await expect(page.locator('#connection-state')).toContainText('Desconectado', { timeout: 6000 });
    failHeartbeat = false;
    await expect(page.locator('#connection-state')).toContainText('Conectado', { timeout: 6000 });
    await expect(page.locator('#connection-state')).toHaveAttribute('data-ok', 'true');
    await page.waitForTimeout(1700);
    await navigate(page, 'Ajustes');
    await selectSettingsTab(page, 'Diagnóstico');
    await page.getByRole('button', { name: 'Actualizar logs', exact: true }).click();
    await expect(page.locator('#application-logs')).toContainText('client.connection_lost');
    await expect(page.locator('#application-logs')).toContainText('client.connection_restored');
    await page.screenshot({ path: testInfo.outputPath('vpn-reconnected.png'), fullPage: true });
    await expectNoHorizontalOverflow(page);
    expect(unexpectedFailures).toEqual([]);
  });
});
