import { test, expect } from '@playwright/test';

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
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
  await expect(page.locator('#ai-configuration-status')).toHaveText('Configuración no cargada');
  await expect(page.locator('#ai-configuration-detail')).toContainText('BASKETRA_AI_BASE_URL');
  await expect(page.locator('#test-ai-provider')).toBeDisabled();

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
  await page.getByRole('button', { name: 'Actualizar logs', exact: true }).click();
  await expect(page.locator('#application-logs')).toContainText('client.connection_lost');
  await expect(page.locator('#application-logs')).toContainText('client.connection_restored');
  await page.screenshot({ path: testInfo.outputPath('vpn-reconnected.png'), fullPage: true });
  await expectNoHorizontalOverflow(page);
  expect(unexpectedFailures).toEqual([]);
});
