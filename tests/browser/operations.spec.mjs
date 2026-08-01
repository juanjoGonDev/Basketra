import { test, expect } from '@playwright/test';
import { navigate, expectNoHorizontalOverflow, mockApplicationShell } from './support.mjs';

test.beforeEach(async ({ page }) => {
  await mockApplicationShell(page);
});

test('settings show live runtime, redacted copyable logs and downloadable importable backups', async ({ page }, testInfo) => {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(message.text());
  });
  await page.addInitScript(() => {
    window.__copiedLogs = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value) {
          window.__copiedLogs = value;
          return Promise.resolve();
        },
      },
    });
  });

  const runtime = {
    version: '1.0.0',
    revision: 'abcdef123456',
    startedAt: new Date(Date.now() - 65_000).toISOString(),
    memory: { rssBytes: 64 * 1024 * 1024 },
  };
  await page.route('**/api/v1/runtime', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(runtime),
  }));
  await page.route('**/api/v1/logs**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      events: [
        { timestamp: '2026-08-01T10:00:00.000Z', source: 'server', level: 'info', event: 'server.started', requestId: 'req-1' },
        { timestamp: '2026-08-01T10:01:00.000Z', source: 'client', level: 'warn', event: 'client.connection_lost', code: 'NETWORK' },
      ],
    }),
  }));
  await page.route('**/api/v1/backups', async route => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ backup: { name: 'basketra-2026-08-01.db', createdAt: '2026-08-01T10:00:00.000Z', sizeBytes: 4096 } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ backups: [] }) });
  });
  await page.route('**/api/v1/backups/basketra-2026-08-01.db', route => route.fulfill({
    status: 200,
    contentType: 'application/octet-stream',
    headers: { 'content-disposition': 'attachment; filename="basketra-2026-08-01.db"' },
    body: Buffer.from('SQLite format 3\0'),
  }));
  await page.route('**/api/v1/backup/import', route => route.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({ pending: { name: 'imported.db', requiresRestart: true } }),
  }));

  await page.goto('/');
  await navigate(page, 'Ajustes');
  await expect(page.locator('#runtime-version')).toHaveText('1.0.0');
  await expect(page.locator('#runtime-uptime')).toContainText('01:');
  await expect(page.locator('#runtime-memory')).toHaveText('64 MB RSS');

  await page.getByRole('button', { name: 'Actualizar logs' }).click();
  await expect(page.locator('#application-logs')).toContainText('server.started');
  await expect(page.locator('#application-logs')).toContainText('client.connection_lost');
  await page.getByRole('button', { name: 'Copiar logs' }).click();
  await expect(page.locator('#copy-logs-state')).toContainText('copiados');
  const copied = await page.evaluate(() => window.__copiedLogs);
  const lines = copied.trim().split('\n');
  expect(lines).toHaveLength(2);
  for (const line of lines) {
    expect(line).toBe(JSON.stringify(JSON.parse(line)));
  }

  await page.screenshot({ path: testInfo.outputPath('runtime-backups-logs.png'), fullPage: true });
  await expectNoHorizontalOverflow(page);
  expect(failures).toEqual([]);
});

test('desktop settings explain the webApi probe and keep navigation above content', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1664, height: 900 });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      configured: true,
      status: 'configured',
      missing: [],
      baseUrl: 'http://host.docker.internal:3001/v1/',
      model: 'gpt-5',
      apiKeyMask: '***test',
      image: true,
      pdf: false,
      loopbackWarning: false,
      requiresContainerRecreate: true,
      recommendedHostUrl: 'http://host.docker.internal:3001/v1/',
    }),
  }));
  await page.route('**/api/v1/settings/ai-provider/test', route => route.fulfill({
    status: 502,
    contentType: 'application/json',
    body: JSON.stringify({ connection: { ok: false, code: 'AI_UNREACHABLE' } }),
  }));

  await page.goto('/');
  await navigate(page, 'Ajustes');
  await expect(page.locator('#ai-provider-request')).toHaveText('GET http://host.docker.internal:3001/v1/models');
  await expect(page.locator('#ai-provider-authorization')).toHaveText('Bearer configurado');
  await expect(page.locator('#ai-provider-network-note')).toContainText('apunta al host Docker de Basketra');
  await expect(page.locator('#ai-provider-network-note')).toContainText('HOST=0.0.0.0');

  await page.getByRole('button', { name: 'Probar desde Basketra', exact: true }).click();
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
    const firstCard = document.querySelector('.operations-card').getBoundingClientRect();
    const stack = document.querySelector('.operations-stack').getBoundingClientRect();
    const metrics = [...document.querySelectorAll('.operations-metrics > div')].map(element => element.getBoundingClientRect());
    return {
      headerBottom: header.bottom,
      navigationTop: navigation.top,
      navigationBottom: navigation.bottom,
      firstCardTop: firstCard.top,
      stackWidth: stack.width,
      metricColumns: [metrics[0]?.x, metrics[1]?.x, metrics[2]?.x, metrics[3]?.x],
    };
  });
  expect(geometry.navigationTop).toBeGreaterThanOrEqual(geometry.headerBottom - 1);
  expect(geometry.firstCardTop).toBeGreaterThanOrEqual(geometry.navigationBottom - 1);
  expect(geometry.stackWidth).toBeGreaterThan(700);
  expect(new Set(geometry.metricColumns).size).toBe(2);
  await page.screenshot({ path: testInfo.outputPath('desktop-provider-diagnostics.png'), fullPage: true });
  await expectNoHorizontalOverflow(page);
});

test('private-route heartbeat recovers after VPN connectivity returns without a reload', async ({ page }, testInfo) => {
  let available = true;
  let healthCalls = 0;
  await page.route('**/health', async route => {
    healthCalls += 1;
    if (!available) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
  });

  await page.goto('/');
  await expect(page.locator('#connection-status')).toHaveAttribute('data-ok', 'true');
  available = false;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('#connection-status')).toHaveAttribute('data-ok', 'false');
  available = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => healthCalls).toBeGreaterThan(1);
  await expect(page.locator('#connection-status')).toHaveAttribute('data-ok', 'true');
  await page.screenshot({ path: testInfo.outputPath('vpn-recovery.png'), fullPage: true });
});
