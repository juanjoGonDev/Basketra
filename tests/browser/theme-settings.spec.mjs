import { test, expect } from '@playwright/test';

async function openSettings(page) {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Ajustes', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tema', exact: true })).toBeVisible();
}

async function palette(page) {
  return await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    return {
      bodyBackground: body.backgroundColor,
      bodyColor: body.color,
      legacyBackground: root.getPropertyValue('--bg').trim(),
      legacyText: root.getPropertyValue('--text').trim(),
      semanticBackground: root.getPropertyValue('--color-bg').trim(),
      semanticText: root.getPropertyValue('--color-on-surface').trim(),
      colorScheme: root.colorScheme,
    };
  });
}

test('explicit light theme overrides a dark device preference and survives reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openSettings(page);

  await page.getByRole('radio', { name: /^Claro/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.theme'))).toBe('light');
  const light = await palette(page);
  expect(light.bodyBackground).toBe('rgb(244, 247, 245)');
  expect(light.bodyColor).toBe('rgb(19, 35, 29)');
  expect(light.legacyBackground).toBe('#f4f7f5');
  expect(light.legacyText).toBe('#13231d');
  expect(light.semanticBackground).toBe('#f3fcf5');
  expect(light.semanticText).toBe('#151d19');
  expect(light.colorScheme).toContain('light');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('settings-explicit-light-320.png'), fullPage: true });

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('radio', { name: /^Claro/ })).toBeChecked();
  expect((await palette(page)).bodyBackground).toBe('rgb(244, 247, 245)');
});

test('explicit dark theme overrides a light device preference and system mode follows media changes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await openSettings(page);

  await page.getByRole('radio', { name: /^Oscuro/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.theme'))).toBe('dark');
  const dark = await palette(page);
  expect(dark.bodyBackground).toBe('rgb(12, 21, 18)');
  expect(dark.bodyColor).toBe('rgb(240, 250, 245)');
  expect(dark.legacyBackground).toBe('#0c1512');
  expect(dark.legacyText).toBe('#f0faf5');
  expect(dark.semanticBackground).toBe('#0f1713');
  expect(dark.semanticText).toBe('#e7f0e9');
  expect(dark.colorScheme).toContain('dark');
  await page.screenshot({ path: testInfo.outputPath('settings-explicit-dark-390.png'), fullPage: true });

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: /^Oscuro/ })).toBeChecked();

  await page.getByRole('radio', { name: /^Sistema/ }).check();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.theme'))).toBe('system');
  expect((await palette(page)).bodyBackground).toBe('rgb(244, 247, 245)');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await palette(page)).bodyBackground).toBe('rgb(12, 21, 18)');
  await expect(page.getByRole('radio', { name: /^Sistema/ })).toBeChecked();
});
