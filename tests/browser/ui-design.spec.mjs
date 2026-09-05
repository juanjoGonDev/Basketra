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

async function expectSettingsTabsInsideViewport(page) {
  const geometry = await page.getByRole('tablist', { name: 'Secciones de ajustes' }).evaluate(tablist => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: tablist.scrollWidth,
    clientWidth: tablist.clientWidth,
    tabs: [...tablist.querySelectorAll('[role="tab"]')].map(tab => {
      const rect = tab.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }),
  }));
  expect(geometry.tabs).toHaveLength(5);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.tabs.every(tab => tab.left >= -1 && tab.right <= geometry.viewportWidth + 1)).toBeTruthy();
}

async function expectCategoryRowActionsDoNotOverlap(page) {
  const geometry = await page.locator('.entity-selection-row .category-row').evaluateAll(rows => rows.map(row => {
    const name = row.querySelector('.category-name-cell')?.getBoundingClientRect();
    const action = row.querySelector('.inventory-row-action')?.getBoundingClientRect();
    return name && action ? {
      nameBottom: name.bottom,
      actionTop: action.top,
      nameRight: name.right,
      actionLeft: action.left,
    } : undefined;
  }).filter(Boolean));
  expect(geometry.length).toBeGreaterThan(0);
  expect(geometry.every(({ nameBottom, actionTop, nameRight, actionLeft }) => (
    actionTop >= nameBottom || actionLeft >= nameRight
  ))).toBeTruthy();
}

test('adaptive Android scaffold uses a navigation bar on compact screens and a rail on expanded screens', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
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
  expect(desktopGeometry.navigationWidth).toBeGreaterThanOrEqual(180);
  expect(desktopGeometry.navigationWidth).toBeLessThanOrEqual(200);
  expect(desktopGeometry.mainLeft).toBeGreaterThanOrEqual(desktopGeometry.navigationWidth);
  await screenshotView(page, testInfo, 'home-desktop-1280');
});

test('all primary destinations share touch-safe controls, reflow and the same visual language', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const destinations = [
    ['Inicio', 'home'],
    ['Listas', 'lists'],
    ['Tickets', 'tickets'],
    ['Inventario', 'inventory'],
    ['Ajustes', 'settings'],
  ];

  for (const [destination, screenshotName] of destinations) {
    await navigate(page, destination);
    if (destination === 'Ajustes') {
      await expect(page.getByRole('heading', { name: 'Servidor y versión' })).toBeVisible();
      await expectSettingsTabsInsideViewport(page);
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
  await navigate(page, 'Ajustes');
  await expectSettingsTabsInsideViewport(page);
  await screenshotView(page, testInfo, 'settings-mobile-320');
});

test('settings tabs persist in the clean URL across refresh and browser history', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');

  const aiTab = page.getByRole('tab', { name: 'IA', exact: true });
  await aiTab.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/settings');
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('ai');

  await page.reload();
  await expect(aiTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#ai-config-title')).toHaveText('Conexiones y límites locales');

  await page.getByRole('tab', { name: 'Diagnóstico', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('diagnostics');
  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('ai');
  await expect(aiTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#ai-config-title')).toHaveText('Conexiones y límites locales');
});

test('keyboard focus stays visibly exposed on primary and visually hidden controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
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

  await navigate(page, 'Tickets');
  for (let step = 0; step < 12; step += 1) {
    const focusedId = await page.evaluate(() => document.activeElement?.id || '');
    if (focusedId === 'receipt-camera') break;
    await page.keyboard.press('Tab');
  }
  await expect.poll(() => page.evaluate(() => document.activeElement?.id || '')).toBe('receipt-camera');
  const cameraAction = page.locator('label.capture-action').filter({ has: page.locator('#receipt-camera') }).first();
  const hiddenControlFocus = await cameraAction.evaluate(label => {
    const styles = getComputedStyle(label);
    return {
      outlineStyle: styles.outlineStyle,
      outlineWidth: Number.parseFloat(styles.outlineWidth),
    };
  });
  expect(hiddenControlFocus.outlineStyle).not.toBe('none');
  expect(hiddenControlFocus.outlineWidth).toBeGreaterThanOrEqual(2);
});

test('home keeps its title in one deliberate desktop line when the content column has room', async ({ page }) => {
  for (const width of [1440, 1672]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/');
    const title = await page.getByRole('heading', { name: 'Organiza la compra sin perder tiempo.' }).evaluate(element => {
      const style = getComputedStyle(element);
      const lineHeight = Number.parseFloat(style.lineHeight);
      return { height: element.getBoundingClientRect().height, lineHeight };
    });
    expect(title.height).toBeLessThanOrEqual(title.lineHeight + 1);
  }
});

test('category rows keep their detail action separate from their name at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/inventory/categories');
  await expect(page.locator('.entity-selection-row .category-row').first()).toBeVisible();
  await expectCategoryRowActionsDoNotOverlap(page);
  await expectNoHorizontalOverflow(page);
});

test('settings tabs use a deliberate compact grid and retain roving-tab keyboard semantics at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/settings');
  await expectSettingsTabsInsideViewport(page);

  const layout = await page.getByRole('tablist', { name: 'Secciones de ajustes' }).evaluate(tablist => {
    const tabs = [...tablist.querySelectorAll('[role="tab"]')].map(tab => {
      const rect = tab.getBoundingClientRect();
      return { label: tab.textContent, left: rect.left, right: rect.right, top: rect.top, width: rect.width };
    });
    return { width: tablist.getBoundingClientRect().width, tabs };
  });
  const advanced = layout.tabs.at(-1);
  expect(advanced.left).toBeCloseTo(layout.tabs[0].left, 0);
  expect(advanced.right).toBeCloseTo(layout.tabs[1].right, 0);
  expect(advanced.width).toBeGreaterThan(layout.width * .8);

  const general = page.getByRole('tab', { name: 'General', exact: true });
  await general.focus();
  await page.keyboard.press('End');
  const advancedTab = page.getByRole('tab', { name: 'Avanzado', exact: true });
  await expect(advancedTab).toBeFocused();
  await expect(advancedTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(general).toBeFocused();
  await expect(general).toHaveAttribute('aria-selected', 'true');
});
