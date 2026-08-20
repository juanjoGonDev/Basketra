import { test, expect } from '@playwright/test';

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

test('settings runtime metrics and operational actions expose canonical icons', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await navigate(page, 'Ajustes');

  const metrics = page.locator('.operations-metrics > .operations-metric');
  await expect(metrics).toHaveCount(4);
  for (const metric of await metrics.all()) {
    await expect(metric.locator('.operations-metric__icon .icon')).toBeVisible();
    await expect(metric.locator('small')).not.toBeEmpty();
    await expect(metric.locator('strong')).not.toBeEmpty();
  }

  for (const selector of [
    '#test-ai-provider',
    '#refresh-logs',
    '#copy-logs',
    '#create-operational-backup',
    '#backup-download-link',
    '#import-backup',
    '#stage-restore',
  ]) {
    await expect(page.locator(`${selector} .icon`)).toHaveCount(1);
  }

  const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(bodyWidth).toBeLessThanOrEqual(390);
});

test('remaining primary destination CTA keeps text and gains a canonical icon', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await navigate(page, 'Planes');

  const generate = page.getByRole('button', { name: 'Generar ejemplo verificable', exact: true });
  await expect(generate).toBeVisible();
  await expect(generate).toContainText('Generar ejemplo verificable');
  await expect(generate.locator('.icon')).toBeVisible();
});

test('desktop settings keeps icon metrics readable without changing the two-column runtime grid', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await navigate(page, 'Ajustes');

  const metrics = page.locator('.operations-metrics');
  await expect(metrics).toBeVisible();
  const geometry = await metrics.evaluate(element => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
    width: element.getBoundingClientRect().width,
    viewport: document.documentElement.clientWidth,
  }));
  expect(geometry.columns).toBe(2);
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
  await expect(page.locator('.operations-metric__icon .icon')).toHaveCount(4);
});
