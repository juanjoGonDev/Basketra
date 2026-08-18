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

async function screenshotView(page, testInfo, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false });
}

test('adaptive Android scaffold uses a navigation bar on compact screens and a rail on expanded screens', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#home');
  await expect(page.getByRole('heading', { name: 'Organiza la compra sin perder tiempo.' })).toBeVisible();

  const mobileGeometry = await page.evaluate(() => {
    const navigation = document.querySelector('.bottom-nav').getBoundingClientRect();
    const viewportHeight = document.documentElement.clientHeight;
    return {
      left: navigation.left,
      right: navigation.right,
      bottom: navigation.bottom,
      height: navigation.height,
      viewportHeight,
    };
  });
  expect(mobileGeometry.left).toBeLessThanOrEqual(1);
  expect(mobileGeometry.right).toBeGreaterThanOrEqual(389);
  expect(mobileGeometry.bottom).toBeGreaterThanOrEqual(mobileGeometry.viewportHeight - 1);
  expect(mobileGeometry.height).toBeLessThan(100);
  await screenshotView(page, testInfo, 'home-mobile-390');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  const desktopGeometry = await page.evaluate(() => {
    const header = document.querySelector('.app-header').getBoundingClientRect();
    const navigation = document.querySelector('.bottom-nav').getBoundingClientRect();
    const main = document.querySelector('main').getBoundingClientRect();
    return {
      headerBottom: header.bottom,
      navigationLeft: navigation.left,
      navigationTop: navigation.top,
      navigationBottom: navigation.bottom,
      navigationWidth: navigation.width,
      mainLeft: main.left,
    };
  });
  expect(desktopGeometry.navigationLeft).toBeLessThanOrEqual(1);
  expect(desktopGeometry.navigationTop).toBeGreaterThanOrEqual(desktopGeometry.headerBottom - 1);
  expect(desktopGeometry.navigationBottom).toBeGreaterThanOrEqual(899);
  expect(desktopGeometry.navigationWidth).toBeLessThanOrEqual(100);
  expect(desktopGeometry.mainLeft).toBeGreaterThanOrEqual(desktopGeometry.navigationWidth);
  await screenshotView(page, testInfo, 'home-desktop-1280');
});

test('all primary destinations share touch-safe controls, reflow and the same visual language', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#home');

  const destinations = [
    ['Inicio', 'home'],
    ['Listas', 'lists'],
    ['Tickets', 'tickets'],
    ['Planes', 'plans'],
    ['Ajustes', 'settings'],
  ];

  for (const [destination, screenshotName] of destinations) {
    await navigate(page, destination);
    if (destination === 'Ajustes') {
      await expect(page.getByRole('heading', { name: 'Servidor y versión' })).toBeVisible();
    }
    const controlHeights = await page.locator('button:visible').evaluateAll(elements => (
      elements.map(element => element.getBoundingClientRect().height)
    ));
    expect(controlHeights.every(height => height >= 44)).toBeTruthy();
    await screenshotView(page, testInfo, `${screenshotName}-mobile-390`);
  }

  await page.setViewportSize({ width: 320, height: 700 });
  await navigate(page, 'Tickets');
  await screenshotView(page, testInfo, 'tickets-mobile-320');
});

test('keyboard focus stays visibly exposed on primary navigation and actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#home');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');

  const focus = await page.evaluate(() => {
    const element = document.activeElement;
    const styles = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName,
      outlineStyle: styles.outlineStyle,
      outlineWidth: Number.parseFloat(styles.outlineWidth),
      visible: rect.bottom > 0 && rect.top < innerHeight,
    };
  });
  expect(['A', 'BUTTON']).toContain(focus.tag);
  expect(focus.outlineStyle).not.toBe('none');
  expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(focus.visible).toBeTruthy();
});
