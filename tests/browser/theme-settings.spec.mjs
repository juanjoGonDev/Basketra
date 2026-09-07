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
    const header = getComputedStyle(document.querySelector('.app-header'));
    const surface = getComputedStyle(document.querySelector('#theme-settings-card'));
    const navigation = getComputedStyle(document.querySelector('.bottom-nav'));
    const heading = getComputedStyle(document.querySelector('.view.active h1'));
    return {
      bodyBackground: body.backgroundColor,
      bodyColor: body.color,
      headerBackground: header.backgroundColor,
      surfaceBackground: surface.backgroundColor,
      navigationBackground: navigation.backgroundColor,
      headingColor: heading.color,
      semanticBackground: root.getPropertyValue('--color-bg').trim(),
      semanticText: root.getPropertyValue('--color-on-surface').trim(),
      colorScheme: root.colorScheme,
    };
  });
}

async function expectLightPalette(page) {
  const light = await palette(page);
  expect(light).toMatchObject({
    bodyBackground: 'rgb(243, 252, 245)',
    bodyColor: 'rgb(21, 29, 25)',
    headerBackground: 'rgb(255, 255, 255)',
    surfaceBackground: 'rgb(255, 255, 255)',
    navigationBackground: 'rgb(255, 255, 255)',
    headingColor: 'rgb(21, 29, 25)',
    semanticBackground: '#f3fcf5',
    semanticText: '#151d19',
  });
  expect(light.colorScheme).toContain('light');
}

async function expectDarkPalette(page) {
  const dark = await palette(page);
  expect(dark).toMatchObject({
    bodyBackground: 'rgb(15, 23, 19)',
    bodyColor: 'rgb(231, 240, 233)',
    headerBackground: 'rgb(21, 29, 25)',
    surfaceBackground: 'rgb(21, 29, 25)',
    navigationBackground: 'rgb(21, 29, 25)',
    headingColor: 'rgb(231, 240, 233)',
    semanticBackground: '#0f1713',
    semanticText: '#e7f0e9',
  });
  expect(dark.colorScheme).toContain('dark');
}

test('explicit light theme overrides a dark device preference and survives reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openSettings(page);

  await page.getByRole('radio', { name: /^Claro/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.theme'))).toBe('light');
  await expectLightPalette(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('settings-explicit-light-320.png'), fullPage: true });

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('radio', { name: /^Claro/ })).toBeChecked();
  await expectLightPalette(page);
});

test('explicit dark theme overrides a light device preference and system mode follows media changes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await openSettings(page);

  await page.getByRole('radio', { name: /^Oscuro/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.theme'))).toBe('dark');
  await expectDarkPalette(page);
  await page.screenshot({ path: testInfo.outputPath('settings-explicit-dark-390.png'), fullPage: true });

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: /^Oscuro/ })).toBeChecked();
  await expectDarkPalette(page);

  await page.getByRole('radio', { name: /^Sistema/ }).check();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.theme'))).toBe('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expectLightPalette(page);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectDarkPalette(page);
  await expect(page.getByRole('radio', { name: /^Sistema/ })).toBeChecked();

  await page.getByRole('button', { name: 'Inicio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Organiza la compra sin perder tiempo.' })).toBeVisible();
  await expect(page.locator('.dashboard-card').first()).toHaveCSS('background-color', 'rgb(21, 29, 25)');
  await page.screenshot({ path: testInfo.outputPath('home-system-dark-390.png'), fullPage: true });
});
