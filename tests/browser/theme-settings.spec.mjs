import { test, expect } from '@playwright/test';

async function openSettings(page) {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Ajustes', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tema', exact: true })).toBeVisible();
}

async function palette(page) {
  return await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const header = getComputedStyle(document.querySelector('.app-header'));
    const heading = getComputedStyle(document.querySelector('.view.active h1'));
    return {
      bodyBackground: body.backgroundColor,
      headerBackground: header.backgroundColor,
      headingColor: heading.color,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
    };
  });
}

test('explicit light theme overrides a dark device preference and survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openSettings(page);

  await page.getByRole('radio', { name: /^Claro/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.theme'))).toBe('light');
  const light = await palette(page);
  expect(light.bodyBackground).toBe('rgb(243, 252, 245)');
  expect(light.headerBackground).toBe('rgb(255, 255, 255)');
  expect(light.headingColor).toBe('rgb(21, 29, 25)');
  expect(light.colorScheme).toContain('light');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('radio', { name: /^Claro/ })).toBeChecked();
  expect((await palette(page)).bodyBackground).toBe('rgb(243, 252, 245)');
});

test('explicit dark theme overrides a light device preference and system mode follows media changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await openSettings(page);

  await page.getByRole('radio', { name: /^Oscuro/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.theme'))).toBe('dark');
  const dark = await palette(page);
  expect(dark.bodyBackground).toBe('rgb(15, 23, 19)');
  expect(dark.headerBackground).toBe('rgb(21, 29, 25)');
  expect(dark.headingColor).toBe('rgb(231, 240, 233)');
  expect(dark.colorScheme).toContain('dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: /^Oscuro/ })).toBeChecked();

  await page.getByRole('radio', { name: /^Sistema/ }).check();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.theme'))).toBe('system');
  expect((await palette(page)).bodyBackground).toBe('rgb(243, 252, 245)');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await palette(page)).bodyBackground).toBe('rgb(15, 23, 19)');
  await expect(page.getByRole('radio', { name: /^Sistema/ })).toBeChecked();
});
