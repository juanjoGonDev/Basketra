import { test, expect } from '@playwright/test';

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function product(id, overrides = {}) {
  return {
    id,
    canonicalProductId: 'parent_existing',
    canonicalName: 'Producto padre',
    variantName: id,
    brand: null,
    aliases: [],
    retailerNames: [],
    latestPrices: [],
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
    ...overrides,
  };
}

test('shell defensive branches keep receipt Store options and generic swipe fail-closed', async ({ page }) => {
  let releaseSlow;
  let slowStarted = false;
  const slowGate = new Promise(resolve => { releaseSlow = resolve; });

  await page.route('**/api/v1/inventory/stores?*', async route => {
    const retailer = new URL(route.request().url()).searchParams.get('retailer') || '';
    if (retailer === 'ERROR') return json(route, { error: { message: 'Store options failed' } }, 503);
    if (retailer === 'SLOW') {
      slowStarted = true;
      await slowGate;
      return json(route, { stores: [{ id: 'slow', name: 'SLOW STORE', retailerName: 'SLOW' }] });
    }
    if (retailer === 'FAST') return json(route, { stores: [{ id: 'fast', name: 'FAST STORE', retailerName: 'FAST' }] });
    if (retailer === 'EMPTY') return json(route, {});
    if (retailer === 'NORETAIL') return json(route, { stores: [{ id: 'missing-retailer', name: 'UNKNOWN STORE' }] });
    return json(route, { stores: [] });
  });

  await page.goto('/tickets');
  await page.evaluate(async () => {
    const { installReceiptEnhancements } = await import('/receipts.js');
    installReceiptEnhancements();
    const { applyExtraction } = await import('/receipt-review.js');
    applyExtraction({
      originalText: 'PAN 1,50',
      final: {
        items: [{ description: 'PAN', quantity: 1, unitPriceMinor: 150, lineTotalMinor: 150, confidence: 1, sourceLines: [1] }],
        declaredTotalMinor: 150,
        review: {
          lines: [{ status: 'confirmed', expectedMinor: 150, differenceMinor: 0 }],
          total: { expectedMinor: 150, differenceMinor: 0, valid: true },
        },
      },
    });
  });

  const retailer = page.locator('#receipt-retailer');
  await expect(retailer).toBeVisible();
  await page.locator('#receipt-store-options').evaluate(element => element.remove());
  await retailer.fill('MISSING');
  await page.evaluate(() => {
    const datalist = document.createElement('datalist');
    datalist.id = 'receipt-store-options';
    document.body.append(datalist);
  });

  await retailer.fill('');
  await expect(page.locator('#receipt-store-options option')).toHaveCount(0);

  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).searchParams.get('retailer') === 'EMPTY'),
    retailer.fill('EMPTY'),
  ]);
  await expect(page.locator('#receipt-store-options option')).toHaveCount(0);

  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).searchParams.get('retailer') === 'NORETAIL'),
    retailer.fill('NORETAIL'),
  ]);
  await expect(page.locator('#receipt-store-options option')).toHaveCount(0);

  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).searchParams.get('retailer') === 'ERROR'),
    retailer.fill('ERROR'),
  ]);
  await expect(page.locator('#receipt-store-options option')).toHaveCount(0);

  await retailer.fill('SLOW');
  await expect.poll(() => slowStarted).toBe(true);
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).searchParams.get('retailer') === 'FAST'),
    retailer.fill('FAST'),
  ]);
  releaseSlow();
  await expect(page.locator('#receipt-store-options option')).toHaveAttribute('value', 'FAST STORE');

  await page.goto('/settings');
  const firstTab = page.getByRole('tab').first();
  await firstTab.evaluate(element => { element.dataset.tabValue = ''; });
  await firstTab.click();

  const defensiveResults = await page.evaluate(async () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    const originalDialog = window.HTMLDialogElement;
    Object.defineProperty(window, 'HTMLDialogElement', { configurable: true, value: class FakeDialog {} });
    document.dispatchEvent(new CustomEvent('basketra:navigate', { detail: { route: 'settings', replace: true } }));
    const dialogClosed = !dialog.hasAttribute('open');
    Object.defineProperty(window, 'HTMLDialogElement', { configurable: true, value: originalDialog });
    dialog.remove();

    const { bindSwipeActions } = await import('/ui.js');
    const root = document.createElement('div');
    root.innerHTML = '<div class="inventory-entity-swipe" data-swipe-row><span id="inventory-owned">owned</span></div>';
    document.body.append(root);
    bindSwipeActions(root);
    root.querySelector('#inventory-owned').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root.remove();
    return { dialogClosed };
  });
  expect(defensiveResults.dialogClosed).toBe(true);
});

test('catalog residual branches cover rich history, nested categories and destructive outcomes', async ({ page }) => {
  test.setTimeout(60_000);
  let products = [
    product('Producto rico', {
      id: 'variant_rich',
      packageMinor: 1,
      packageUnit: '',
      retailerNames: [{ retailerId: 'retailer_old', retailerName: 'Mercado', title: 'Nombre antiguo' }],
      latestPrices: [
        { retailerName: 'Mercado', storeName: 'Centro', observedAt: 'fecha-invalida', priceMinor: 125 },
        { retailerName: 'Mercado', observedAt: '2026-09-01T10:00:00.000Z', priceMinor: 130 },
      ],
    }),
    product('Producto segundo', { id: 'variant_second', canonicalName: 'Segundo' }),
  ];
  const categories = [
    { id: 'root', name: 'Raíz', color: '#118844', productCount: 1, childCount: 1 },
    { id: 'child', name: 'Hija', parentId: 'root', parentName: 'Raíz', color: '#118844', productCount: 1, childCount: 1 },
    { id: 'grandchild', name: 'Nieta', parentId: 'child', parentName: 'Hija', color: '#118844', productCount: 0, childCount: 0 },
    { id: 'orphan', name: 'Huérfana', parentId: 'missing', productCount: 0, childCount: 0 },
    { id: 'cycle_a', name: 'Ciclo A', parentId: 'cycle_b', productCount: 0, childCount: 1 },
    { id: 'cycle_b', name: 'Ciclo B', parentId: 'cycle_a', productCount: 0, childCount: 1 },
    { id: 'category_unknown', name: 'desconocido', productCount: 0, childCount: 0 },
  ];
  let productImpactMode = 'allowed';
  let productDeleteMode = 'success';
  let categoryImpactMode = 'allowed';
  let categoryDeleteMode = 'success';

  await page.route('**/api/v1/meta', route => json(route, { units: ['unit', 'kg'] }));
  await page.route(/\/api\/v1\/categories(?:\?.*)?$/, route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('mode') === 'inventory') {
      if (url.searchParams.get('q') === 'noinventory') return json(route, {});
      return json(route, { inventory: { categories, total: categories.length, offset: 0, limit: 12, hasMore: false } });
    }
    return json(route, { categories });
  });
  await page.route('**/api/v1/catalog?*', route => {
    const q = new URL(route.request().url()).searchParams.get('q');
    if (q === 'nocatalog') return json(route, {});
    if (q === 'missing-products') return json(route, { catalog: { parents: [], total: 0, offset: 0, limit: 12, hasMore: false } });
    return json(route, { catalog: { products, parents: [{ id: 'parent_existing', name: 'Padre existente', variantCount: 2 }], total: products.length, offset: 0, limit: 12, hasMore: false } });
  });
  await page.route(/\/api\/v1\/products\/([^/]+)$/, route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    if (route.request().method() === 'DELETE') {
      if (productDeleteMode === 'error') return json(route, { error: { message: 'Product delete failed' } }, 500);
      products = products.filter(entry => entry.id !== id);
      return route.fulfill({ status: 204, body: '' });
    }
    if (id === 'variant_nulls') {
      return json(route, { product: product('Nulls', { id, retailerNames: null, latestPrices: null }), priceHistory: {}, ticketHistory: {} });
    }
    if (id === 'variant_error') return json(route, { error: { message: 'Product unavailable' } }, 503);
    const current = products.find(entry => entry.id === id) || product(id, { id });
    return json(route, {
      product: current,
      priceHistory: id === 'variant_rich' ? [
        { id: 'price_b', observedAt: '2026-09-01T10:00:00.000Z', retailerName: '', storeName: '', priceMinor: 125 },
        { id: 'price_a', observedAt: '2026-09-01T10:00:00.000Z', retailerName: 'Mercado', storeName: 'Centro', priceMinor: 130 },
      ] : [],
      ticketHistory: id === 'variant_rich' ? [
        { receiptId: 'receipt_1', purchasedAt: 'fecha-invalida', retailerName: 'Mercado', storeName: 'Centro', quantity: 1, unit: null, lineTotalMinor: 125 },
        { receiptId: 'receipt_2', purchasedAt: '2026-09-01T10:00:00.000Z', retailerName: '', storeName: 'Centro', quantity: 2, unit: 'kg', lineTotalMinor: 250 },
        { receiptId: 'receipt_3', purchasedAt: '2026-09-02T10:00:00.000Z', retailerName: 'Mercado', storeName: '', quantity: 1, unit: 'unit', lineTotalMinor: 130 },
        { receiptId: 'receipt_4', purchasedAt: '2026-09-03T10:00:00.000Z', retailerName: '', storeName: '', quantity: 1, unit: 'unit', lineTotalMinor: 140 },
      ] : [],
    });
  });
  await page.route('**/api/v1/catalog/products/*/parent', route => {
    const payload = route.request().postDataJSON();
    return json(route, { relation: { canonicalProductId: payload.canonicalProductId || 'parent_created' } });
  });
  await page.route('**/api/v1/catalog/products/*/retailer-name', route => {
    const payload = route.request().postDataJSON();
    return json(route, { retailerName: { retailerId: 'retailer_new', retailerName: payload.retailerName, title: payload.title } });
  });
  await page.route('**/api/v1/catalog/products/*/delete-impact', route => {
    if (productImpactMode === 'error') return json(route, { error: { message: 'Impact failed' } }, 500);
    return json(route, { impact: { receiptItems: 0, shoppingListItems: 0, priceObservations: 0, linkedStores: 0, canDelete: productImpactMode === 'allowed' } });
  });
  await page.route(/\/api\/v1\/catalog\/products\/([^/]+)$/, route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    if (productDeleteMode === 'error') return json(route, { error: { message: 'Product delete failed' } }, 500);
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    products = products.filter(entry => entry.id !== id);
    return route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api/v1/catalog/products/bulk-delete-impact', route => json(route, { impact: { canDelete: true, blocked: [] } }));
  await page.route('**/api/v1/catalog/products/bulk-delete', route => {
    const ids = route.request().postDataJSON().ids;
    products = products.filter(entry => !ids.includes(entry.id));
    return json(route, { deletedIds: null });
  });
  await page.route('**/api/v1/categories/*/delete-impact', route => {
    if (categoryImpactMode === 'error') return json(route, { error: { message: 'Category impact failed' } }, 500);
    if (categoryImpactMode === 'protected') return json(route, { impact: { productCount: 0, childCount: 0, descendantCategoryCount: 0, descendantProductCount: 0, protected: true, canDelete: false } });
    return json(route, { impact: { productCount: 1, childCount: 1, descendantCategoryCount: 1, descendantProductCount: 1, protected: false, canDelete: categoryImpactMode === 'allowed' } });
  });
  await page.route(/\/api\/v1\/categories\/([^/]+)$/, route => {
    if (route.request().method() === 'DELETE') {
      if (categoryDeleteMode === 'error') return json(route, { error: { message: 'Category delete failed' } }, 500);
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fallback();
  });

  await page.goto('/inventory/products/variant_rich?mode=edit');
  await expect(page.locator('#catalog-price-history-count')).toHaveText('2');
  await expect(page.locator('#catalog-ticket-history-count')).toHaveText('4');
  await expect(page.locator('#catalog-latest-prices .catalog-retailer-row')).toHaveCount(2);
  await page.locator('#catalog-retailer-names button').click();
  await page.locator('#catalog-parent-select').selectOption('parent_existing');
  await page.locator('#catalog-link-parent').click();
  await expect(page.locator('#catalog-detail-meta')).toHaveText('Padre existente');

  await page.locator('#catalog-parent-select').evaluate(select => select.append(new Option('Desconocido', 'missing_parent')));
  await page.locator('#catalog-parent-select').selectOption('missing_parent');
  await page.locator('#catalog-link-parent').click();
  await expect(page.locator('#catalog-parent-select')).toHaveValue('');

  productImpactMode = 'error';
  await page.locator('#catalog-delete-product').click();
  await expect(page.locator('#catalog-delete-state')).toContainText('Impact failed');
  await page.locator('#catalog-delete-cancel').click();

  productImpactMode = 'allowed';
  productDeleteMode = 'error';
  await page.locator('#catalog-delete-product').click();
  await page.locator('#catalog-delete-confirm').click();
  await expect(page.locator('#catalog-delete-state')).toContainText('Product delete failed');
  await page.locator('#catalog-delete-cancel').click();
  productDeleteMode = 'success';

  await page.goto('/inventory/products/variant_nulls');
  await expect(page.locator('#catalog-latest-prices')).toContainText('Todavía no hay precios');
  await expect(page.locator('#catalog-price-history-state')).toContainText('Todavía no hay');
  await page.goto('/inventory/products/variant_error');
  await expect(page.locator('#catalog-detail-title')).toHaveText('No se pudo abrir el producto');

  await page.goto('/inventory/products');
  await page.getByRole('checkbox', { name: 'Seleccionar Producto rico' }).check();
  await page.getByRole('checkbox', { name: 'Seleccionar Producto segundo' }).check();
  await page.locator('#catalog-selection-delete').click();
  await expect(page.locator('#catalog-delete-confirm')).toBeEnabled();
  await page.locator('#catalog-delete-confirm').click();
  await expect(page.locator('#catalog-state')).toContainText('2 productos eliminados');

  await page.locator('#catalog-search').fill('nocatalog');
  await expect(page.locator('#catalog-state')).toContainText('0 productos encontrados');
  await page.locator('#catalog-search').fill('missing-products');
  await expect(page.locator('#catalog-products')).toContainText('No hay productos');

  await page.goto('/inventory/products/new');
  await page.locator('#catalog-cancel-edit').click();
  await page.locator('#catalog-delete-confirm').dispatchEvent('click');

  await page.goto('/inventory/categories/root?mode=edit');
  await expect(page.locator('#category-parent option[value="child"]')).toHaveCount(0);
  await page.locator('#category-add-child').click();
  await expect(page).toHaveURL(/\/inventory\/categories\/new\?parent=root/u);
  await page.locator('#category-cancel-edit').click();

  await page.goto('/inventory/categories/category_unknown');
  await expect(page.locator('#category-delete')).toBeDisabled();
  await expect(page.locator('#category-detail-status')).toHaveText('Protegida');

  categoryImpactMode = 'protected';
  await page.goto('/inventory/categories/root');
  await page.locator('#category-delete').click();
  await expect(page.locator('#category-delete-state')).toContainText('protegida');
  await page.locator('#category-delete-cancel').click();

  categoryImpactMode = 'error';
  await page.goto('/inventory/categories/root');
  await page.locator('#category-delete').click();
  await expect(page.locator('#category-delete-state')).toContainText('Category impact failed');
  await page.locator('#category-delete-cancel').click();

  categoryImpactMode = 'allowed';
  categoryDeleteMode = 'error';
  await page.locator('#category-delete').click();
  await page.locator('#category-delete-confirm').click();
  await expect(page.locator('#category-delete-state')).toContainText('Category delete failed');
  await page.locator('#category-delete-cancel').click();
  await page.locator('#categories-back-list').click();
  await expect(page.locator('#category-list-screen')).toBeVisible();

  await page.locator('#category-search').fill('noinventory');
  await expect(page.locator('#category-state')).toContainText('0 categorías encontradas');

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: 'catalog', route: 'catalog', searchParams: 'ignored=true' } }));
    document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: 'categories', route: 'categories', searchParams: 'ignored=true' } }));
  });

  await page.goto('/inventory/products');
  const nav = page.locator('[data-catalog-nav="inventory"]').first();
  if (await nav.count()) {
    await nav.dispatchEvent('click');
    await expect(page).toHaveURL(/\/inventory$/u);
  }
});

test('inventory residual branches cover overview routing, Store guards and non-empty statistics', async ({ page }) => {
  test.setTimeout(45_000);
  let overviewMode = 'empty';
  let storeMode = 'normal';
  let storeSaveMode = 'success';
  let statsMode = 'rich';
  const store = {
    id: 'store_one',
    retailerName: 'Mercado',
    name: 'Centro',
    region: '',
    address: '',
    productCount: 0,
    ticketCount: 0,
    priceObservationCount: 0,
    createdAt: null,
    lastActivityAt: null,
  };

  await page.route('**/api/v1/inventory/overview', route => {
    if (overviewMode === 'error') return json(route, { error: { message: 'Overview failed' } }, 503);
    if (overviewMode === 'rich') return json(route, { overview: { productCount: 2, categoryCount: 3, storeCount: 1, latestCatalogValueMinor: -50 } });
    return json(route, { overview: {} });
  });
  await page.route('**/api/v1/inventory/stores?*', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'null-result') return json(route, null);
    if (url.searchParams.get('q') === 'missing-stores') return json(route, { total: 0, offset: 0, limit: 12, hasMore: false });
    if (storeMode === 'error') return json(route, { error: { message: 'Store list failed' } }, 503);
    return json(route, { stores: [store], total: 1, offset: 0, limit: 12, hasMore: false });
  });
  await page.route(/\/api\/v1\/inventory\/stores\/([^/]+)$/, route => {
    if (route.request().method() === 'PATCH') {
      if (storeSaveMode === 'error') return json(route, { error: { message: 'Store save failed' } }, 500);
      return json(route, { store: { ...store, ...route.request().postDataJSON() } });
    }
    return json(route, { store });
  });
  await page.route(/\/api\/v1\/inventory\/stores$/, route => {
    if (route.request().method() !== 'POST') return route.fallback();
    if (storeSaveMode === 'error') return json(route, { error: { message: 'Store create failed' } }, 500);
    return json(route, { store: { ...store, id: 'store_created', ...route.request().postDataJSON() } }, 201);
  });
  await page.route('**/api/v1/inventory/stores/*/delete-impact', route => json(route, { impact: { linkedProducts: 0, priceObservations: 0, historicalTickets: 0, canDelete: true } }));
  await page.route('**/api/v1/inventory/statistics?*', route => {
    if (statsMode === 'non-arrays') return json(route, { statistics: { summary: {}, categoryStats: {}, storeStats: {}, ticketTrend: {} } });
    return json(route, { statistics: {
      summary: { latestCatalogValueMinor: -10, activeProducts: 0, ticketsProcessed: 0, entriesValueMinor: 0, lowStockUnavailableReason: '' },
      categoryStats: [
        { name: 'Cero', color: 'invalid', productCount: 0, ticketCount: 0, spentMinor: 0 },
        { name: 'Negativa', color: '#118844', productCount: 1, ticketCount: 1, spentMinor: -100 },
      ],
      storeStats: [{ retailerName: 'Mercado', name: 'Centro', productCount: 0, ticketCount: 0, spentMinor: 0 }],
      ticketTrend: [{ date: null, ticketCount: 0, spentMinor: 0 }, { date: 'fecha-invalida', ticketCount: 1, spentMinor: 10 }],
    } });
  });

  await page.goto('/inventory');
  await page.locator('#inventory-overview-scope').evaluate(select => {
    select.value = 'categories';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#inventory-overview-sort')).toBeDisabled();
  await page.locator('#inventory-overview-scope').evaluate(select => {
    select.value = 'stores';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#inventory-overview-sort').evaluate(select => {
    select.value = 'recent';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#inventory-overview-search').fill('leche');
  await page.locator('#inventory-overview-search-form').dispatchEvent('submit');
  await expect(page).toHaveURL(/\/inventory\/stores\?q=leche&sort=recent|\/inventory\/stores\?sort=recent&q=leche/u);

  await page.goto('/inventory');
  await page.locator('[data-inventory-scope="categories"]').click();
  await page.locator('#inventory-overview-search').fill('pan');
  await page.locator('#inventory-overview-open-filters').click();
  await expect(page).toHaveURL(/\/inventory\/categories\?q=pan/u);

  overviewMode = 'error';
  await page.goto('/inventory');
  await expect(page.locator('#inventory-overview-state')).toContainText('Overview failed');
  overviewMode = 'rich';
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: 'inventory', route: 'inventory', searchParams: '' } })));
  await expect(page.locator('#inventory-overview-products')).toHaveText('2');
  await expect(page.locator('#inventory-overview-value')).toContainText('0,00');

  await page.goto('/inventory/stores/new');
  await page.locator('#store-form').dispatchEvent('submit');
  await expect(page.locator('#store-form-state')).toContainText('obligatorios');
  await page.locator('#store-retailer').fill('Mercado');
  await page.locator('#store-name').fill('Nueva');
  await page.locator('#store-editor details > summary').click();
  await page.locator('#store-latitude').evaluate(input => {
    input.type = 'text';
    input.value = 'abc';
  });
  await page.locator('#store-form').dispatchEvent('submit');
  await expect(page.locator('#store-form-state')).toContainText('latitud');
  await page.locator('#store-latitude').evaluate(input => {
    input.type = 'number';
    input.value = '91';
  });
  await page.locator('#store-form').dispatchEvent('submit');
  await expect(page.locator('#store-form-state')).toContainText('latitud');

  storeSaveMode = 'error';
  await page.locator('#store-latitude').fill('');
  await page.locator('#store-longitude').fill('');
  await page.locator('#store-form').dispatchEvent('submit');
  await expect(page.locator('#store-form-state')).toContainText('Store create failed');
  storeSaveMode = 'success';
  await page.locator('#store-cancel-edit').click();
  await expect(page).toHaveURL(/\/inventory\/stores$/u);
  await page.locator('#store-edit').dispatchEvent('click');
  await page.locator('#store-delete-confirm').dispatchEvent('click');

  await page.locator('#store-search').fill('missing-stores');
  await expect(page.locator('#store-state')).toContainText('0 tiendas encontradas');
  await page.locator('#store-search').fill('null-result');
  await expect(page.locator('#store-state')).toContainText('0 tiendas encontradas');

  await page.goto('/inventory/statistics');
  await expect(page.locator('#statistics-trend-table')).toContainText('fecha-invalida');
  await expect(page.locator('#statistics-trend-table')).toContainText('—');
  statsMode = 'non-arrays';
  await page.locator('#statistics-period').selectOption('90d');
  await expect(page.locator('#statistics-categories-table')).toContainText('Sin actividad');

  await page.goto('/inventory/stores');
  await page.locator('#stores-back-inventory').click();
  await expect(page).toHaveURL(/\/inventory$/u);
  await page.goto('/inventory/statistics');
  await page.locator('#statistics-back-inventory').click();
  await expect(page).toHaveURL(/\/inventory$/u);

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: 'settings', route: 'settings', searchParams: '' } }));
  });
});

test('catalog and inventory defensive residuals cover partial payloads and alternate route state', async ({ page }) => {
  test.setTimeout(60_000);
  let catalogMode = 'single';
  let categoryMode = 'normal';
  let categoryMetadataMode = 'normal';
  let retailerNames = null;
  let overviewRequest = 0;
  let releaseOverview;
  let storesRequest = 0;
  let releaseStores;
  let statisticsRequest = 0;
  let releaseStatistics;

  const categories = [
    { id: 'root', name: 'Raíz', color: '#118844', productCount: 1, childCount: 1 },
    { id: 'child', name: 'Hija', parentId: 'root', parentName: 'Raíz', color: '#118844', productCount: 1, childCount: 0 },
    { id: 'orphan', name: 'Huérfana', parentId: 'missing', color: '#118844', productCount: 0, childCount: 0 },
  ];

  await page.route('**/api/v1/meta', route => json(route, { units: {} }));
  await page.route(/\/api\/v1\/categories(?:\?.*)?$/, async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('mode') !== 'inventory') return json(route, { categories: categoryMetadataMode === 'normal' ? categories : {} });
    if (categoryMode === 'missing-list') return json(route, { inventory: { total: 0, offset: 0, limit: 12, hasMore: false } });
    return json(route, { inventory: { categories, total: categories.length, offset: 0, limit: 12, hasMore: false } });
  });
  await page.route('**/api/v1/catalog?*', route => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('q') || '';
    if (q === 'missing-products') return json(route, { catalog: { total: 0, offset: 0, limit: 12, hasMore: false } });
    if (q === 'null-products') return json(route, { catalog: { products: null, parents: null, total: 0, offset: 0, limit: 12, hasMore: false } });
    const products = catalogMode === 'single'
      ? [product('Único', { id: 'single', retailerNames, latestPrices: null })]
      : [];
    return json(route, { catalog: { products, total: products.length, offset: 0, limit: 12, hasMore: false } });
  });
  await page.route(/\/api\/v1\/products\/([^/]+)$/, route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    return json(route, {
      product: product('Único', { id, canonicalProductId: '', retailerNames, latestPrices: null }),
      priceHistory: [{ id: 'price_single', observedAt: 'fecha-invalida', retailerName: '', storeName: '', priceMinor: 199 }],
      ticketHistory: [{ receiptId: 'receipt_single', purchasedAt: 'fecha-invalida', retailerName: '', storeName: '', quantity: 1, unit: null, lineTotalMinor: 199 }],
    });
  });
  await page.route('**/api/v1/catalog/products/*/retailer-name', route => {
    retailerNames = [{ retailerId: 'retailer_new', retailerName: 'Mercado', title: 'Nombre local' }];
    return json(route, { retailerName: retailerNames[0] });
  });
  await page.route('**/api/v1/categories/*/delete-impact', route => json(route, {
    impact: { productCount: 0, childCount: 0, descendantCategoryCount: 0, descendantProductCount: 0, protected: false, canDelete: true },
  }));

  await page.route('**/api/v1/inventory/overview', async route => {
    overviewRequest += 1;
    if (overviewRequest === 1) {
      await new Promise(resolve => { releaseOverview = resolve; });
    }
    return json(route, overviewRequest === 1 ? { overview: { productCount: 99 } } : { overview: null });
  });
  await page.route('**/api/v1/inventory/stores?*', async route => {
    storesRequest += 1;
    if (storesRequest === 1) {
      await new Promise(resolve => { releaseStores = resolve; });
    }
    return json(route, storesRequest === 1
      ? { stores: [{ id: 'stale', retailerName: 'Vieja', name: 'Vieja', productCount: 0, ticketCount: 0, priceObservationCount: 0 }], total: 1, offset: 0, limit: 12, hasMore: false }
      : null);
  });
  await page.route('**/api/v1/inventory/statistics?*', async route => {
    statisticsRequest += 1;
    if (statisticsRequest === 1) {
      await new Promise(resolve => { releaseStatistics = resolve; });
    }
    return json(route, statisticsRequest === 1 ? { statistics: { summary: { activeProducts: 99 } } } : { statistics: null });
  });

  await page.goto('/inventory/products/single?mode=edit');
  await expect(page.locator('#catalog-price-history-count')).toHaveText('1');
  await expect(page.locator('#catalog-ticket-history-count')).toHaveText('1');
  await expect(page.locator('#catalog-price-history-body')).toContainText('fecha-invalida');
  await expect(page.locator('#catalog-ticket-history-state')).toContainText('1 ticket confirmado');
  await page.locator('#catalog-retailer-name').fill('Mercado');
  await page.locator('#catalog-retailer-title').fill('Nombre local');
  await page.locator('#catalog-save-retailer-name').click();
  await expect(page.locator('#catalog-retailer-names')).toContainText('Nombre local');
  await page.locator('#catalog-cancel-edit').click();

  await page.goto('/inventory/products');
  await page.locator('#catalog-search').fill('missing-products');
  await expect(page.locator('#catalog-products')).toContainText('No hay productos');
  await page.locator('#catalog-search').fill('null-products');
  await expect(page.locator('#catalog-products')).toContainText('No hay productos');
  await page.locator('#catalog-selection-delete').dispatchEvent('click');

  await page.goto('/inventory/categories/child');
  await expect(page.locator('#category-detail-parent')).toHaveText('Raíz');
  await page.getByRole('button', { name: 'Editar', exact: true }).dispatchEvent('click');
  await page.locator('#category-cancel-edit').dispatchEvent('click');

  await page.goto('/inventory/categories/orphan');
  await expect(page.locator('#category-detail-parent')).toHaveText('Categoría no disponible');
  await expect(page.locator('#category-detail-hierarchy')).toContainText('Raíz');

  await page.goto('/inventory/categories/missing');
  await expect(page.locator('#category-list-screen')).toBeVisible();
  await page.locator('#category-delete').dispatchEvent('click');
  await page.locator('#category-delete-confirm').dispatchEvent('click');
  await page.locator('#category-edit').dispatchEvent('click');
  await page.locator('#category-add-child').dispatchEvent('click');
  await page.locator('#category-cancel-edit').dispatchEvent('click');

  categoryMode = 'missing-list';
  categoryMetadataMode = 'non-array';
  await page.goto('/inventory/categories');
  await page.reload();
  await expect(page.locator('#category-tree')).toContainText('No hay categorías');

  await page.goto('/inventory');
  await expect.poll(() => overviewRequest).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'inventory', route: 'inventory', searchParams: new URLSearchParams() },
  })));
  await expect.poll(() => overviewRequest).toBeGreaterThanOrEqual(2);
  releaseOverview();
  await expect(page.locator('#inventory-overview-products')).toHaveText('0');

  await page.goto('/inventory/stores');
  await expect.poll(() => storesRequest).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'stores', route: 'stores', searchParams: new URLSearchParams() },
  })));
  await expect.poll(() => storesRequest).toBeGreaterThanOrEqual(2);
  releaseStores();
  await expect(page.locator('#store-state')).toContainText('0 tiendas encontradas');
  await page.locator('#store-select-page').evaluate(element => {
    element.checked = true;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#store-selection-clear').dispatchEvent('click');
  await page.locator('#store-prev').dispatchEvent('click');
  await page.locator('#store-next').dispatchEvent('click');
  await page.locator('#store-edit').dispatchEvent('click');
  await page.locator('#store-cancel-edit').dispatchEvent('click');
  await page.locator('#store-delete-confirm').dispatchEvent('click');

  await page.goto('/inventory/statistics');
  await expect.poll(() => statisticsRequest).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'inventory-statistics', route: 'inventory-statistics', searchParams: new URLSearchParams() },
  })));
  await expect.poll(() => statisticsRequest).toBeGreaterThanOrEqual(2);
  releaseStatistics();
  await expect(page.locator('#statistics-categories-table')).toContainText('Sin actividad');

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('basketra:view-changed'));
    document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: 'catalog' } }));
    document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: 'categories' } }));
    document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: 'stores' } }));
    document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: 'inventory-statistics' } }));
  });
});

test('catalog final changed-code branches cover DOM guards, stale loads and bounded validation', async ({ page }) => {
  test.setTimeout(60_000);
  const categories = [
    { id: 'root', name: 'Raíz', color: '#118844', productCount: 1, childCount: 1 },
    { id: 'child', name: 'Hija', parentId: 'root', parentName: 'Raíz', color: '#118844', productCount: 0, childCount: 0 },
    { id: 'cycle_a', name: 'Ciclo A', parentId: 'cycle_b', color: '#118844', productCount: 0, childCount: 1 },
    { id: 'cycle_b', name: 'Ciclo B', parentId: 'cycle_a', color: '#118844', productCount: 0, childCount: 1 },
  ];
  const catalogProduct = product('Producto ramas', { id: 'branch_product', canonicalName: 'Producto ramas' });
  let categoryMode = 'normal';
  let categoryInventoryRequests = 0;
  let catalogRequests = 0;
  let holdNextCategoryInventory = false;
  let releaseCategoryInventory;
  let holdRootImpact = false;
  let rootImpactStarted = false;
  let releaseRootImpact;
  let bulkImpactBlocked = false;

  await page.route('**/api/v1/meta', route => json(route, { units: ['unit'] }));
  await page.route(/\/api\/v1\/categories(?:\?.*)?$/, async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('mode') !== 'inventory') return json(route, { categories });
    categoryInventoryRequests += 1;
    if (holdNextCategoryInventory) {
      holdNextCategoryInventory = false;
      await new Promise(resolve => { releaseCategoryInventory = resolve; });
    }
    if (categoryMode === 'missing-list') {
      return json(route, { inventory: { total: 0, offset: 0, limit: 12, hasMore: false } });
    }
    return json(route, { inventory: { categories, total: categories.length, offset: 0, limit: 12, hasMore: false } });
  });
  await page.route('**/api/v1/catalog?*', route => {
    catalogRequests += 1;
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    if (q === 'missing-products') {
      return json(route, { catalog: { total: 0, offset: 0, limit: 12, hasMore: false } });
    }
    return json(route, {
      catalog: {
        products: [catalogProduct],
        parents: [],
        total: 1,
        offset: 0,
        limit: 12,
        hasMore: false,
      },
    });
  });
  await page.route(/\/api\/v1\/products\/([^/]+)$/, route => json(route, {
    product: catalogProduct,
    priceHistory: [],
    ticketHistory: [],
  }));
  await page.route(/\/api\/v1\/products$/, route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const payload = route.request().postDataJSON();
    return json(route, {
      product: product('branch_saved', {
        id: 'branch_saved',
        canonicalProductId: 'branch_saved_parent',
        canonicalName: payload.canonicalName,
        variantName: payload.variantName,
        categoryId: payload.categoryId,
        categoryName: payload.categoryId ? 'Raíz' : null,
        packageMinor: payload.packageMinor,
        packageUnit: payload.packageUnit,
      }),
    }, 201);
  });
  await page.route('**/api/v1/catalog/products/branch_product/delete-impact', route => json(route, {
    impact: { receiptItems: 0, shoppingListItems: 0, priceObservations: 0, linkedStores: 0, canDelete: true },
  }));
  await page.route('**/api/v1/catalog/products/branch_product', route => {
    if (route.request().method() === 'DELETE') return route.fulfill({ status: 204, body: '' });
    return route.fallback();
  });
  await page.route('**/api/v1/catalog/products/bulk-delete-impact', route => json(route, {
    impact: bulkImpactBlocked ? { canDelete: false } : { canDelete: true, blocked: [] },
  }));
  await page.route('**/api/v1/categories/*/delete-impact', async route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2);
    if (id === 'root' && holdRootImpact) {
      holdRootImpact = false;
      rootImpactStarted = true;
      await new Promise(resolve => { releaseRootImpact = resolve; });
    }
    return json(route, {
      impact: { productCount: 0, childCount: 0, descendantCategoryCount: 0, descendantProductCount: 0, protected: false, canDelete: true },
    });
  });

  await page.goto('/inventory/products');
  await page.evaluate(() => {
    document.querySelector('#catalog-latest-prices')?.remove();
    document.querySelector('#catalog-parent-select')?.remove();
    document.dispatchEvent(new CustomEvent('basketra:navigate', {
      detail: { route: 'catalog:branch_product' },
    }));
  });
  await expect(page.locator('#catalog-detail-title')).toHaveText('Producto ramas');

  const catalogBaseline = catalogRequests;
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:navigate', {
    detail: { route: 'catalog:' },
  })));
  await expect.poll(() => catalogRequests).toBeGreaterThan(catalogBaseline);
  await expect(page.locator('#catalog-state')).toContainText('productos encontrados');
  await expect(page.locator('#catalog-list-screen')).toBeVisible();

  await page.goto('/inventory/products/new');
  await page.locator('#catalog-canonical-name').fill('Producto validado');
  await page.locator('#catalog-variant-name').fill('Variante validada');
  await page.locator('#catalog-package-minor').fill('1.5');
  await page.locator('#catalog-product-form').dispatchEvent('submit');
  await expect(page.locator('#catalog-product-form-state')).toContainText('Revisa los campos');

  await page.locator('#catalog-package-minor').fill('');
  await page.locator('#catalog-package-unit').selectOption('unit');
  await page.locator('#catalog-product-form').dispatchEvent('submit');
  await expect(page.locator('#catalog-product-form-state')).toContainText('Revisa los campos');

  await page.locator('#catalog-package-unit').selectOption('');
  await page.locator('#catalog-category').selectOption('root');
  await page.locator('#catalog-product-form').dispatchEvent('submit');
  await expect(page).toHaveURL(/\/inventory\/products\/branch_saved$/u);

  await page.goto('/inventory/products/branch_product');
  await page.locator('#catalog-delete-product').click();
  await expect(page.locator('#catalog-delete-confirm')).toBeEnabled();
  await page.locator('#catalog-delete-confirm').click();
  await expect(page.locator('#catalog-state')).toContainText('Producto eliminado.');

  await page.goto('/inventory/products');
  await page.locator('#catalog-delete-product').dispatchEvent('click');
  bulkImpactBlocked = true;
  await page.getByRole('checkbox', { name: 'Seleccionar Producto ramas' }).check();
  await page.locator('#catalog-selection-delete').click();
  await expect(page.locator('#catalog-delete-impact')).toContainText('0 de 1 productos');
  await page.locator('#catalog-delete-cancel').click();

  await page.locator('#catalog-search').fill('missing-products');
  await expect(page.locator('#catalog-state')).toContainText('0 productos encontrados');
  await page.locator('#catalog-select-page').evaluate(element => {
    element.checked = true;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });

  categoryMode = 'normal';
  await page.goto('/inventory/categories');
  const categoryBaseline = categoryInventoryRequests;
  await page.evaluate(() => {
    const NativeAbortController = window.AbortController;
    window.__basketraNativeAbortController = NativeAbortController;
    window.AbortController = class NoopAbortController {
      constructor() {
        this.controller = new NativeAbortController();
        this.signal = this.controller.signal;
      }
      abort() {}
    };
  });
  holdNextCategoryInventory = true;
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'categories', route: 'categories', searchParams: new URLSearchParams() },
  })));
  await expect.poll(() => categoryInventoryRequests).toBeGreaterThanOrEqual(categoryBaseline + 1);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'categories', route: 'categories', searchParams: new URLSearchParams() },
  })));
  await expect.poll(() => categoryInventoryRequests).toBeGreaterThanOrEqual(categoryBaseline + 2);
  releaseCategoryInventory();
  await expect(page.locator('#category-tree')).toContainText('Raíz');
  await page.evaluate(() => {
    window.AbortController = window.__basketraNativeAbortController;
    delete window.__basketraNativeAbortController;
  });

  await page.goto('/inventory/categories/cycle_a?mode=edit');
  await expect(page.locator('#category-editor')).toBeVisible();

  holdRootImpact = true;
  rootImpactStarted = false;
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:navigate', {
    detail: { route: 'categories:root' },
  })));
  await expect.poll(() => rootImpactStarted).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:navigate', {
    detail: { route: 'categories:child' },
  })));
  await expect(page.locator('#category-detail-name')).toHaveText('Hija');
  releaseRootImpact();
  await expect(page.locator('#category-detail-name')).toHaveText('Hija');

  categoryMode = 'missing-list';
  await page.goto('/inventory/categories');
  await expect(page.locator('#category-tree')).toContainText('No hay categorías');
  await page.locator('#category-select-page').evaluate(element => {
    element.checked = true;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#category-prev').dispatchEvent('click');
  await page.locator('#category-next').dispatchEvent('click');

  await page.evaluate(() => {
    document.querySelector('.view[data-view="catalog"]')?.remove();
    document.dispatchEvent(new CustomEvent('basketra:view-changed', {
      detail: { view: 'catalog', route: 'catalog', searchParams: new URLSearchParams() },
    }));
    document.querySelector('.view[data-view="categories"]')?.remove();
    document.dispatchEvent(new CustomEvent('basketra:view-changed', {
      detail: { view: 'categories', route: 'categories', searchParams: new URLSearchParams() },
    }));
  });
});

test('inventory final changed-code branches cover missing controls, stale loads and Store actions', async ({ page }) => {
  test.setTimeout(60_000);
  let overviewRequests = 0;
  let storeRequests = 0;
  let statisticsRequests = 0;
  let holdNextOverview = false;
  let holdNextStores = false;
  let holdNextStatistics = false;
  let releaseOverview;
  let releaseStores;
  let releaseStatistics;
  const store = {
    id: 'store_one',
    retailerName: 'Mercado',
    name: 'Centro',
    region: '',
    address: '',
    productCount: 1,
    ticketCount: 1,
    priceObservationCount: 1,
    createdAt: '2026-09-01T10:00:00.000Z',
    lastActivityAt: '2026-09-02T10:00:00.000Z',
  };

  await page.route('**/api/v1/inventory/overview', async route => {
    overviewRequests += 1;
    const stale = holdNextOverview;
    if (holdNextOverview) {
      holdNextOverview = false;
      await new Promise(resolve => { releaseOverview = resolve; });
    }
    try {
      return await json(route, { overview: { productCount: stale ? 99 : 2, categoryCount: 1, storeCount: 1, latestCatalogValueMinor: 100 } });
    } catch {
      return undefined;
    }
  });
  await page.route('**/api/v1/inventory/stores?*', async route => {
    storeRequests += 1;
    const url = new URL(route.request().url());
    const stale = holdNextStores;
    if (holdNextStores) {
      holdNextStores = false;
      await new Promise(resolve => { releaseStores = resolve; });
    }
    try {
      if (url.searchParams.get('q') === 'missing-stores') {
        return await json(route, { total: 0, offset: 0, limit: 12, hasMore: false });
      }
      return await json(route, { stores: [store], total: 1, offset: 0, limit: 12, hasMore: false, stale });
    } catch {
      return undefined;
    }
  });
  await page.route(/\/api\/v1\/inventory\/stores\/store_one$/, route => json(route, { store }));
  await page.route('**/api/v1/inventory/stores/*/delete-impact', route => json(route, {
    impact: { linkedProducts: 1, priceObservations: 1, historicalTickets: 1, canDelete: true },
  }));
  await page.route('**/api/v1/inventory/statistics?*', async route => {
    statisticsRequests += 1;
    const stale = holdNextStatistics;
    if (holdNextStatistics) {
      holdNextStatistics = false;
      await new Promise(resolve => { releaseStatistics = resolve; });
    }
    try {
      return await json(route, {
        statistics: {
          summary: { latestCatalogValueMinor: stale ? 9900 : 100, activeProducts: stale ? 99 : 2, ticketsProcessed: 1, entriesValueMinor: 100 },
          categoryStats: [{ name: 'Raíz', color: '#118844', productCount: 1, ticketCount: 1, spentMinor: 100 }],
          storeStats: [{ retailerName: 'Mercado', name: 'Centro', productCount: 1, ticketCount: 1, spentMinor: 100 }],
          ticketTrend: [{ date: '2026-09-01', ticketCount: 1, spentMinor: 100 }],
        },
      });
    } catch {
      return undefined;
    }
  });

  await page.goto('/inventory');
  await page.locator('#inventory-overview-sort').evaluate(element => element.remove());
  await page.locator('#inventory-overview-search').fill('branch');
  await expect(page).toHaveURL(/\/inventory\?q=branch$/u);

  await page.goto('/inventory');
  await page.locator('#inventory-overview-search').evaluate(element => element.remove());
  await page.locator('#inventory-overview-open-filters').click();
  await expect(page).toHaveURL(/\/inventory\/products\?sort=recent$/u);

  await page.goto('/inventory');
  const destination = page.locator('[data-inventory-destination]').first();
  await destination.evaluate(element => { element.dataset.inventoryDestination = ''; });
  await destination.dispatchEvent('click');
  await expect(page).toHaveURL(/\/inventory$/u);

  await page.goto('/inventory');
  const overviewBaseline = overviewRequests;
  await page.evaluate(() => {
    const NativeAbortController = window.AbortController;
    window.__basketraNativeAbortController = NativeAbortController;
    window.AbortController = class NoopAbortController {
      constructor() {
        this.controller = new NativeAbortController();
        this.signal = this.controller.signal;
      }
      abort() {}
    };
  });
  holdNextOverview = true;
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'inventory', route: 'inventory', searchParams: new URLSearchParams() },
  })));
  await expect.poll(() => overviewRequests).toBeGreaterThanOrEqual(overviewBaseline + 1);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'inventory', route: 'inventory', searchParams: new URLSearchParams() },
  })));
  await expect.poll(() => overviewRequests).toBeGreaterThanOrEqual(overviewBaseline + 2);
  releaseOverview();
  await expect(page.locator('#inventory-overview-products')).toHaveText('2');
  await page.evaluate(() => {
    window.AbortController = window.__basketraNativeAbortController;
    delete window.__basketraNativeAbortController;
  });

  await page.goto('/inventory/stores');
  const storeBaseline = storeRequests;
  await page.evaluate(() => {
    const NativeAbortController = window.AbortController;
    window.__basketraNativeAbortController = NativeAbortController;
    window.AbortController = class NoopAbortController {
      constructor() {
        this.controller = new NativeAbortController();
        this.signal = this.controller.signal;
      }
      abort() {}
    };
  });
  holdNextStores = true;
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'stores', route: 'stores', searchParams: new URLSearchParams() },
  })));
  await expect.poll(() => storeRequests).toBeGreaterThanOrEqual(storeBaseline + 1);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'stores', route: 'stores', searchParams: new URLSearchParams() },
  })));
  await expect.poll(() => storeRequests).toBeGreaterThanOrEqual(storeBaseline + 2);
  releaseStores();
  await expect(page.locator('#store-state')).toContainText('1 tiendas encontradas');
  await page.evaluate(() => {
    window.AbortController = window.__basketraNativeAbortController;
    delete window.__basketraNativeAbortController;
  });

  const beforeMissingContainer = storeRequests;
  await page.locator('#store-list').evaluate(element => element.remove());
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'stores', route: 'stores', searchParams: new URLSearchParams() },
  })));
  await expect.poll(() => storeRequests).toBeGreaterThan(beforeMissingContainer);

  await page.goto('/inventory/stores');
  await page.locator('#store-delete').dispatchEvent('click');

  await page.goto('/inventory/stores/store_one?mode=edit');
  await expect(page.locator('#store-editor')).toBeVisible();
  await page.locator('#store-cancel-edit').click();
  await expect(page).toHaveURL(/\/inventory\/stores\/store_one$/u);

  await page.goto('/inventory/stores/store_one');
  await page.locator('#store-delete').click();
  await expect(page.locator('#store-delete-dialog')).toBeVisible();
  await page.locator('#store-delete-cancel').click();

  await page.goto('/inventory/stores');
  await page.locator('#store-retailer-filter').fill('Mercado');
  await expect(page).toHaveURL(/retailer=Mercado/u);
  await page.locator('#store-search').fill('missing-stores');
  await expect(page.locator('#store-state')).toContainText('0 tiendas encontradas');
  await page.locator('#store-select-page').evaluate(element => {
    element.checked = true;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await page.goto('/inventory/statistics');
  const statisticsBaseline = statisticsRequests;
  await page.evaluate(() => {
    const NativeAbortController = window.AbortController;
    window.__basketraNativeAbortController = NativeAbortController;
    window.AbortController = class NoopAbortController {
      constructor() {
        this.controller = new NativeAbortController();
        this.signal = this.controller.signal;
      }
      abort() {}
    };
  });
  holdNextStatistics = true;
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'inventory-statistics', route: 'inventory-statistics', searchParams: new URLSearchParams() },
  })));
  await expect.poll(() => statisticsRequests).toBeGreaterThanOrEqual(statisticsBaseline + 1);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'inventory-statistics', route: 'inventory-statistics', searchParams: new URLSearchParams() },
  })));
  await expect.poll(() => statisticsRequests).toBeGreaterThanOrEqual(statisticsBaseline + 2);
  releaseStatistics();
  await expect(page.locator('#statistics-kpis')).toContainText('2');
  await page.evaluate(() => {
    window.AbortController = window.__basketraNativeAbortController;
    delete window.__basketraNativeAbortController;
  });

  await page.locator('#statistics-categories-bars').evaluate(element => element.remove());
  const beforeMissingBars = statisticsRequests;
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'inventory-statistics', route: 'inventory-statistics', searchParams: new URLSearchParams() },
  })));
  await expect.poll(() => statisticsRequests).toBeGreaterThan(beforeMissingBars);

  holdNextStatistics = true;
  const beforeAbort = statisticsRequests;
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'inventory-statistics', route: 'inventory-statistics', searchParams: new URLSearchParams() },
  })));
  await expect.poll(() => statisticsRequests).toBeGreaterThan(beforeAbort);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:view-changed', {
    detail: { view: 'settings', route: 'settings', searchParams: new URLSearchParams() },
  })));
  releaseStatistics();

  await page.evaluate(() => {
    document.querySelector('.view[data-view="stores"]')?.remove();
    document.dispatchEvent(new CustomEvent('basketra:view-changed', {
      detail: { view: 'stores', route: 'stores', searchParams: new URLSearchParams() },
    }));
  });
});

test('generic swipe initialization closes supported rows while Inventory-owned rows remain untouched', async ({ page }) => {
  await page.goto('/settings');
  const result = await page.evaluate(async () => {
    const { bindSwipeActions } = await import('/ui.js');
    const root = document.createElement('div');
    root.innerHTML = [
      '<div data-swipe-row data-swipe-id="generic" data-swipe-kind="generic" data-swipe-open="true"><div data-swipe-content></div><div data-swipe-actions><button type="button">Action</button></div></div>',
      '<div class="inventory-entity-swipe" data-swipe-row data-swipe-id="owned" data-swipe-kind="owned" data-swipe-open="true"></div>',
    ].join('');
    document.body.append(root);
    bindSwipeActions(root);
    const generic = root.querySelector('[data-swipe-id="generic"]');
    const owned = root.querySelector('[data-swipe-id="owned"]');
    const snapshot = { genericOpen: generic.dataset.swipeOpen, ownedOpen: owned.dataset.swipeOpen };
    root.remove();
    return snapshot;
  });
  expect(result).toEqual({ genericOpen: 'false', ownedOpen: 'true' });
});



test('inventory product AI category suggestion sends bounded optional payloads', async ({ page }) => {
  const payloads = [];
  const categories = [{ id: 'root', name: 'Alimentos', color: '#118844', productCount: 0, childCount: 0 }];

  await page.route('**/api/v1/meta', route => json(route, { units: ['unit', 'kg'] }));
  await page.route(/\/api\/v1\/categories(?:\?.*)?$/, route => json(route, { categories }));
  await page.route('**/api/v1/catalog?*', route => json(route, {
    catalog: { products: [], parents: [], total: 0, offset: 0, limit: 12, hasMore: false },
  }));
  await page.route('**/api/v1/categories/suggest', route => {
    payloads.push(route.request().postDataJSON());
    return json(route, { categoryId: 'root' });
  });

  await page.goto('/inventory/products/new');
  await page.locator('#catalog-canonical-name').fill('Arroz');
  await page.locator('#catalog-variant-name').fill('Arroz largo');
  await page.locator('#catalog-brand').fill('Marca');
  await page.locator('#catalog-description').fill('Grano largo');
  await page.locator('#catalog-package-minor').fill('2');
  await page.locator('#catalog-package-unit').selectOption('kg');
  await page.locator('#catalog-suggest-category').click();
  await expect.poll(() => payloads.length).toBe(1);
  await expect(page.locator('#catalog-category')).toHaveValue('root');

  await page.locator('#catalog-brand').fill('');
  await page.locator('#catalog-description').fill('');
  await page.locator('#catalog-package-minor').fill('');
  await page.locator('#catalog-package-unit').selectOption('');
  await page.locator('#catalog-suggest-category').click();
  await expect.poll(() => payloads.length).toBe(2);

  expect(payloads).toEqual([
    {
      surface: 'inventory-product',
      canonicalName: 'Arroz',
      variantName: 'Arroz largo',
      brand: 'Marca',
      description: 'Grano largo',
      packageMinor: 2,
      packageUnit: 'kg',
    },
    {
      surface: 'inventory-product',
      canonicalName: 'Arroz',
      variantName: 'Arroz largo',
    },
  ]);
});

test('operations restores its stylesheet when the shell omits it', async ({ page }) => {
  await page.route('**/settings', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      '  <link rel="stylesheet" href="/operations.css">\n',
      '',
    );
    await route.fulfill({ response, body });
  });

  await page.goto('/settings');
  await expect(page.locator('link[href="/operations.css"]')).toHaveCount(1);
});

test('generic swipe residual state machine fails closed across lifecycle races', async ({ page }) => {
  await page.goto('/settings');
  const result = await page.evaluate(async () => {
    const { bindSwipeActions, shoppingListItem } = await import('/ui.js');
    const root = document.createElement('div');
    document.body.append(root);
    bindSwipeActions(root);

    const makeRow = (id, { start = 'complete', end = 'delete' } = {}) => {
      const row = document.createElement('div');
      row.dataset.swipeRow = '';
      row.dataset.swipeId = id;
      row.dataset.swipeKind = 'generic';
      row.dataset.swipeOpen = 'false';
      if (start) row.dataset.swipeStartAction = start;
      if (end) row.dataset.swipeEndAction = end;
      row.innerHTML = '<div data-swipe-actions><button type="button">Action</button></div><div data-swipe-content><span class="gesture-target">Row</span></div>';
      Object.defineProperty(row, 'clientWidth', { configurable: true, value: 240 });
      root.append(row);
      return { row, target: row.querySelector('.gesture-target') };
    };
    const pointer = (target, type, pointerId, clientX, clientY = 100) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId,
      clientX,
      clientY,
    }));

    const active = makeRow('active');
    pointer(active.target, 'pointerdown', 1, 100);
    const mouseDownPrevented = !active.target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const mouseUpPrevented = !active.target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    const selectPrevented = !active.target.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true }));
    pointer(active.target, 'pointermove', 1, 105, 130);
    active.row.remove();

    const disconnected = makeRow('disconnected');
    pointer(disconnected.target, 'pointerdown', 2, 100);
    disconnected.row.remove();
    pointer(root, 'pointermove', 2, 140);
    pointer(root, 'pointerup', 2, 180);

    const replaced = makeRow('replaced');
    pointer(replaced.target, 'pointerdown', 3, 100);
    pointer(replaced.target, 'pointermove', 3, 130);
    replaced.row.remove();
    const replacement = makeRow('replaced');
    pointer(replacement.target, 'pointerup', 3, 220);

    const first = makeRow('raf-old', { start: '', end: '' });
    pointer(first.target, 'pointerdown', 4, 100);
    pointer(first.target, 'pointerup', 4, 100);
    const second = makeRow('raf-new', { start: '', end: '' });
    pointer(second.target, 'pointerdown', 5, 100);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    pointer(second.target, 'pointercancel', 5, 100);
    await new Promise(resolve => requestAnimationFrame(resolve));

    let resolvePending;
    const pendingGate = new Promise(resolve => { resolvePending = resolve; });
    const waitListener = event => {
      if (event.detail?.action === 'complete') event.detail.waitUntil(pendingGate);
    };
    root.addEventListener('basketra:swipe-action', waitListener);
    const pending = makeRow('pending');
    pointer(pending.target, 'pointerdown', 6, 100);
    pointer(pending.target, 'pointermove', 6, 220);
    pointer(pending.target, 'pointerup', 6, 220);
    const newer = makeRow('newer', { start: '', end: '' });
    pointer(newer.target, 'pointerdown', 7, 100);
    resolvePending();
    await Promise.resolve();
    await Promise.resolve();
    pointer(newer.target, 'pointercancel', 7, 100);
    root.removeEventListener('basketra:swipe-action', waitListener);
    await new Promise(resolve => requestAnimationFrame(resolve));

    const short = makeRow('short');
    pointer(short.target, 'pointerdown', 8, 100);
    pointer(short.target, 'pointermove', 8, 120);
    pointer(short.target, 'pointerup', 8, 120);
    await new Promise(resolve => requestAnimationFrame(resolve));

    const pendingHtml = shoppingListItem({
      id: 'pending-item',
      text: 'Pendiente',
      completed: false,
      quantityMinor: 2,
      unit: 'unit',
      exactRequired: false,
      substitutionAllowed: true,
    }, 0, 2);
    const lastPendingHtml = shoppingListItem({
      id: 'last-pending-item',
      text: 'Pendiente final',
      completed: false,
      quantityMinor: 1,
      unit: 'unit',
      exactRequired: true,
      substitutionAllowed: false,
    }, 1, 2);
    const completedHtml = shoppingListItem({
      id: 'completed-item',
      text: 'Completado',
      completed: true,
      quantityMinor: 1,
      unit: 'unit',
      exactRequired: true,
      substitutionAllowed: false,
    }, 1, 2);

    root.remove();
    return {
      mouseDownPrevented,
      mouseUpPrevented,
      selectPrevented,
      pendingHasStepper: pendingHtml.includes('quantity-chip'),
      lastPendingDisablesDecrease: lastPendingHtml.includes('data-delta="-1" disabled'),
      lastPendingCanMoveUp: !lastPendingHtml.includes('data-direction="-1" disabled'),
      lastPendingCannotMoveDown: lastPendingHtml.includes('data-direction="1" disabled'),
      completedHasReturn: completedHtml.includes('Volver a pendientes'),
    };
  });

  expect(result).toEqual({
    mouseDownPrevented: true,
    mouseUpPrevented: true,
    selectPrevented: true,
    pendingHasStepper: true,
    lastPendingDisablesDecrease: true,
    lastPendingCanMoveUp: true,
    lastPendingCannotMoveDown: true,
    completedHasReturn: true,
  });
});
