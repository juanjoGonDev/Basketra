import { test, expect } from '@playwright/test';

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function catalogProduct(id = 'variant_one', overrides = {}) {
  return {
    id,
    canonicalProductId: `parent_${id}`,
    canonicalName: 'Producto',
    variantName: `Producto ${id}`,
    brand: null,
    aliases: [],
    retailerNames: [],
    latestPrices: [],
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: 'fecha-no-valida',
    ...overrides,
  };
}

test('shell, breadcrumb and receipt Store adapters cover defensive browser boundaries', async ({ page }) => {
  await page.route('**/api/v1/retailers/suggestions?*', route => json(route, {
    suggestions: [{ name: 'ALCAMPO', receiptCount: 2 }],
  }));
  await page.route('**/api/v1/inventory/stores?*', route => {
    const retailer = new URL(route.request().url()).searchParams.get('retailer');
    if (retailer === 'FAIL') return json(route, { error: { message: 'Stores unavailable' } }, 503);
    return json(route, {
      stores: [
        { id: 'store_ok', name: 'ALCAMPO ALMERIA', retailerName: retailer || 'ALCAMPO' },
        { id: 'store_other', name: 'Otra', retailerName: 'OTRO' },
      ],
      total: 2,
      offset: 0,
      limit: 100,
      hasMore: false,
    });
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
  await expect(page.locator('#receipt-store')).toBeVisible();

  await page.locator('#receipt-retailer').fill('A');
  await expect(page.locator('#retailer-suggestions')).toBeHidden();
  await page.locator('#receipt-retailer').fill('AL');
  await expect(page.getByRole('option', { name: /ALCAMPO/ })).toBeVisible();
  await page.getByRole('option', { name: /ALCAMPO/ }).click();
  await expect(page.locator('#receipt-retailer')).toHaveValue('ALCAMPO');
  await expect(page.locator('#receipt-store-options option')).toHaveCount(1);
  await expect(page.locator('#receipt-store-options option')).toHaveAttribute('value', 'ALCAMPO ALMERIA');

  await page.locator('#receipt-retailer').fill('FAIL');
  await expect.poll(() => page.locator('#receipt-store-options option').count()).toBe(0);

  const breadcrumbCases = await page.evaluate(async () => {
    const { breadcrumb } = await import('/ui.js');
    return {
      nullItems: breadcrumb(null),
      emptyItems: breadcrumb([]),
      emptyLabel: breadcrumb([{ label: '' }]),
      pageOnly: breadcrumb([{ label: 'Ficha' }]),
    };
  });
  expect(breadcrumbCases.nullItems).toBe('');
  expect(breadcrumbCases.emptyItems).toBe('');
  expect(breadcrumbCases.emptyLabel).toBe('');
  expect(breadcrumbCases.pageOnly).toContain('aria-current="page"');

  await page.goto('/settings');
  const firstTab = page.getByRole('tab').first();
  await firstTab.evaluate(element => { delete element.dataset.tabValue; });
  await firstTab.click();
  await expect(firstTab).toHaveAttribute('aria-selected', 'true');

  const before = page.url();
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('basketra:navigate', { detail: {} }));
  });
  expect(page.url()).toBe(before);

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('basketra:navigate', {
      detail: { route: 'inventory', replace: true, searchParams: 'q=boundary' },
    }));
  });
  await expect(page).toHaveURL(/\/inventory\?q=boundary$/);

  const skip = page.locator('[data-skip-to-main]');
  await expect(skip).toHaveCount(1);
  await skip.evaluate(element => element.click());
  await expect(page.locator('#main')).toBeFocused();
});

test('catalog covers filters, validation, relations, allowed deletes and error states', async ({ page }) => {
  let products = [
    catalogProduct('variant_one', { variantName: 'Producto Uno' }),
    catalogProduct('variant_two', { variantName: 'Producto Dos', updatedAt: '2026-09-02T10:00:00.000Z' }),
  ];
  let categories = [
    { id: 'category_root', name: 'Raíz', color: '#118844', productCount: 1, childCount: 1, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
    { id: 'category_child', name: 'Hija', parentId: 'category_root', parentName: 'Raíz', color: '#118844', productCount: 0, childCount: 0, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
  ];
  let productSaveMode = 'success';
  let parentMode = 'success';
  let retailerMode = 'success';
  let bulkImpactMode = 'blocked';
  let categoryImpactMode = 'allowed';

  await page.route('**/api/v1/meta', route => json(route, { units: ['unit', 'kg'] }));
  await page.route(/\/api\/v1\/categories(?:\?.*)?$/, route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      const created = { id: 'category_created', color: '#64748B', productCount: 0, childCount: 0, createdAt: '2026-09-03T10:00:00.000Z', updatedAt: '2026-09-03T10:00:00.000Z', ...payload };
      categories = [...categories, created];
      return json(route, { category: created }, 201);
    }
    if (url.searchParams.get('mode') === 'inventory') {
      const q = url.searchParams.get('q');
      if (q === 'fallo') return json(route, { error: { message: 'Category load failed' } }, 503);
      const offset = Number(url.searchParams.get('offset') || 0);
      const result = q === 'vacío' ? [] : (offset >= 12 ? [categories.at(-1)] : categories.slice(0, 2));
      return json(route, { inventory: { categories: result, total: q === 'vacío' ? 0 : 13, offset, limit: 12, hasMore: offset < 12 && q !== 'vacío' } });
    }
    return json(route, { categories });
  });
  await page.route('**/api/v1/catalog?*', route => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('q');
    if (q === 'fallo') return json(route, { error: { message: 'Catalog load failed' } }, 503);
    const offset = Number(url.searchParams.get('offset') || 0);
    const result = q === 'vacío' ? [] : (offset >= 12 ? [products.at(-1)] : products);
    return json(route, { catalog: { products: result, parents: [{ id: 'parent_existing', name: 'Padre existente', variantCount: 2 }], total: q === 'vacío' ? 0 : 13, offset, limit: 12, hasMore: offset < 12 && q !== 'vacío' } });
  });
  await page.route(/\/api\/v1\/products\/([^/]+)$/, route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    if (route.request().method() === 'DELETE') {
      products = products.filter(product => product.id !== id);
      return route.fulfill({ status: 204, body: '' });
    }
    if (route.request().method() === 'PATCH') {
      if (productSaveMode === 'generic-error') return json(route, { error: { message: 'Save failed' } }, 500);
      if (productSaveMode === 'nested-field-error') {
        return json(route, { error: { message: 'EAN rejected', details: { errors: [{ path: '$.ean' }] } } }, 400);
      }
      const payload = route.request().postDataJSON();
      const current = products.find(product => product.id === id) || catalogProduct(id);
      const saved = { ...current, ...payload, updatedAt: '2026-09-04T10:00:00.000Z' };
      products = products.map(product => product.id === id ? saved : product);
      return json(route, { product: saved });
    }
    const current = products.find(product => product.id === id) || catalogProduct(id);
    return json(route, { product: { ...current, retailerNames: current.retailerNames }, priceHistory: [], ticketHistory: [] });
  });
  await page.route(/\/api\/v1\/products$/, route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const payload = route.request().postDataJSON();
    const saved = catalogProduct('variant_created', { ...payload, updatedAt: '2026-09-04T10:00:00.000Z' });
    products = [...products, saved];
    return json(route, { product: saved }, 201);
  });
  await page.route('**/api/v1/catalog/products/*/parent', route => {
    if (parentMode === 'error') return json(route, { error: { message: 'Parent failed' } }, 500);
    const payload = route.request().postDataJSON();
    return json(route, { relation: { canonicalProductId: payload.canonicalProductId || 'parent_created' } });
  });
  await page.route('**/api/v1/catalog/products/*/retailer-name', route => {
    if (retailerMode === 'error') return json(route, { error: { message: 'Retailer failed' } }, 500);
    const payload = route.request().postDataJSON();
    return json(route, { retailerName: { listingId: 'listing_new', retailerId: 'retailer_new', ...payload } });
  });
  await page.route('**/api/v1/catalog/products/*/delete-impact', route => json(route, {
    impact: { receiptItems: 0, shoppingListItems: 0, priceObservations: 0, linkedStores: 0, canDelete: true },
  }));
  await page.route('**/api/v1/catalog/products/bulk-delete-impact', route => {
    if (bulkImpactMode === 'error') return json(route, { error: { message: 'Bulk impact failed' } }, 500);
    if (bulkImpactMode === 'blocked') return json(route, { impact: { canDelete: false, blocked: [{ id: 'variant_one' }] } });
    return json(route, { impact: { canDelete: true, blocked: [] } });
  });
  await page.route('**/api/v1/catalog/products/bulk-delete', route => json(route, { deletedIds: route.request().postDataJSON().ids }));
  await page.route('**/api/v1/categories/*/delete-impact', route => {
    if (categoryImpactMode === 'error') return json(route, { error: { message: 'Category impact failed' } }, 500);
    return json(route, { impact: { productCount: 0, childCount: 0, descendantCategoryCount: 0, descendantProductCount: 0, protected: false, canDelete: true } });
  });
  await page.route(/\/api\/v1\/categories\/([^/]+)$/, route => {
    if (route.request().method() === 'DELETE') {
      const id = new URL(route.request().url()).pathname.split('/').at(-1);
      categories = categories.filter(category => category.id !== id);
      return route.fulfill({ status: 204, body: '' });
    }
    if (route.request().method() === 'PATCH') return json(route, { category: { id: 'category_root', ...route.request().postDataJSON() } });
    return route.fallback();
  });

  await page.goto('/inventory/products');
  const one = page.getByRole('checkbox', { name: 'Seleccionar Producto Uno' });
  await one.check();
  await one.uncheck();

  await page.locator('#catalog-filter-price').selectOption('without-price');
  await page.locator('#catalog-sort').selectOption('recent');
  await page.locator('#catalog-filter-category').selectOption('category_root');
  await page.locator('#catalog-clear-filters').click();
  await page.locator('#catalog-next').click();
  await expect(page.locator('#catalog-page')).toHaveText('2 / 2');
  await page.locator('#catalog-next').evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.locator('#catalog-prev').click();
  await expect(page.locator('#catalog-page')).toHaveText('1 / 2');
  await page.locator('#catalog-prev').evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));

  await page.locator('#catalog-search').fill('vacío');
  await expect(page.locator('#catalog-products')).toContainText('No hay productos');
  await page.locator('#catalog-search').fill('fallo');
  await expect(page.locator('#catalog-state')).toContainText('Catalog load failed');
  await page.locator('#catalog-search').fill('');
  await expect(page.locator('#catalog-products')).toContainText('Producto Uno');

  await page.getByRole('button', { name: 'Nuevo producto', exact: true }).click();
  const form = page.locator('#catalog-product-form');
  await form.getByRole('button', { name: 'Guardar ficha' }).click();
  await page.locator('#catalog-canonical-name').fill('Creado');
  await page.locator('#catalog-variant-name').fill('Creado 1 kg');
  await page.locator('#catalog-ean').fill('abc');
  await form.getByRole('button', { name: 'Guardar ficha' }).click();
  await expect(page.locator('#catalog-ean-error')).not.toHaveText('');
  await page.locator('#catalog-ean').fill('8412345678901');
  await page.locator('#catalog-package-minor').fill('2');
  await form.getByRole('button', { name: 'Guardar ficha' }).click();
  await expect(page.locator('#catalog-package-unit-error')).not.toHaveText('');
  await page.locator('#catalog-package-unit').selectOption('kg');
  await page.locator('#catalog-brand').fill('Marca');
  await page.locator('#catalog-description').fill('Descripción');
  await page.locator('#catalog-aliases').fill('uno\ndos');
  await form.getByRole('button', { name: 'Guardar ficha' }).click();
  await expect(page.locator('#catalog-detail-name')).toHaveText('Creado 1 kg');

  await page.getByRole('button', { name: 'Editar', exact: true }).first().click();
  await page.getByRole('button', { name: 'Crear padre y relacionar' }).click();
  await expect(page.locator('#catalog-parent-state')).toContainText('Escribe el nombre');
  await page.locator('#catalog-new-parent-name').fill('Padre nuevo');
  await page.getByRole('button', { name: 'Crear padre y relacionar' }).click();
  await expect(page.locator('#catalog-detail-meta')).toHaveText('Padre nuevo');
  parentMode = 'error';
  await page.locator('#catalog-new-parent-name').fill('Otro padre');
  await page.getByRole('button', { name: 'Crear padre y relacionar' }).click();
  await expect(page.locator('#catalog-parent-state')).toContainText('Parent failed');

  await page.locator('#catalog-retailer-name').fill('');
  await page.locator('#catalog-retailer-title').fill('');
  await page.getByRole('button', { name: 'Guardar nombre del comercio' }).click();
  await expect(page.locator('#catalog-retailer-state')).toContainText('Indica el comercio');
  await page.locator('#catalog-retailer-name').fill('ALCAMPO');
  await page.locator('#catalog-retailer-title').fill('Creado Alcampo');
  await page.getByRole('button', { name: 'Guardar nombre del comercio' }).click();
  await expect(page.locator('#catalog-retailer-state')).toContainText('guardado');
  retailerMode = 'error';
  await page.getByRole('button', { name: 'Guardar nombre del comercio' }).click();
  await expect(page.locator('#catalog-retailer-state')).toContainText('Retailer failed');

  productSaveMode = 'nested-field-error';
  await form.getByRole('button', { name: 'Guardar ficha' }).click();
  await expect(page.locator('#catalog-ean-error')).toHaveText('EAN rejected');
  productSaveMode = 'generic-error';
  await page.locator('#catalog-ean').fill('8412345678902');
  await form.getByRole('button', { name: 'Guardar ficha' }).click();
  await expect(page.locator('#catalog-product-form-state')).toContainText('No se pudo guardar');

  await page.goto('/inventory/products/variant_one');
  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  const deleteDialog = page.locator('#catalog-delete-dialog');
  await expect(deleteDialog.getByRole('button', { name: 'Eliminar producto' })).toBeEnabled();
  await deleteDialog.getByRole('button', { name: 'Eliminar producto' }).click();
  await expect(page.locator('#catalog-state')).toHaveText('Producto eliminado.');

  await page.getByRole('checkbox', { name: 'Seleccionar Producto Dos' }).check();
  await page.getByRole('button', { name: 'Eliminar seleccionados' }).click();
  await expect(deleteDialog.locator('#catalog-delete-state')).toContainText('Bloqueados');
  await deleteDialog.getByRole('button', { name: 'Cancelar' }).click();
  bulkImpactMode = 'error';
  await page.getByRole('button', { name: 'Eliminar seleccionados' }).click();
  await expect(deleteDialog.locator('#catalog-delete-state')).toContainText('Bulk impact failed');
  await deleteDialog.getByRole('button', { name: 'Cancelar' }).click();

  await page.goto('/inventory/categories');
  const categoryCheckbox = page.getByRole('checkbox', { name: 'Seleccionar categoría Raíz' });
  await categoryCheckbox.check();
  await categoryCheckbox.uncheck();
  await page.locator('#category-filter').selectOption('roots');
  await page.locator('#category-clear-filters').click();
  await page.locator('#category-next').click();
  await page.locator('#category-prev').click();
  await page.locator('#category-search').fill('vacío');
  await expect(page.locator('#category-tree')).toContainText('No hay categorías');
  await page.locator('#category-search').fill('fallo');
  await expect(page.locator('#category-state')).toContainText('Category load failed');
  await page.locator('#category-search').fill('');
  await expect(page.locator('#category-tree')).toContainText('Raíz');

  await page.getByRole('button', { name: 'Nueva categoría', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar categoría' }).click();
  await expect(page.locator('#category-form-state')).toContainText('obligatorio');
  await page.locator('#category-name').fill('Creada');
  await page.getByRole('button', { name: 'Guardar categoría' }).click();
  await expect(page.locator('#category-form-state')).toContainText('creada');

  await page.goto('/inventory/categories/category_child');
  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  const categoryDialog = page.locator('#category-delete-dialog');
  await expect(categoryDialog.getByRole('button', { name: 'Eliminar categoría' })).toBeEnabled();
  await categoryDialog.getByRole('button', { name: 'Eliminar categoría' }).click();
  await expect(page.locator('#category-state')).toHaveText('Categoría eliminada.');

  categoryImpactMode = 'error';
  await page.goto('/inventory/categories/category_root');
  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(categoryDialog.locator('#category-delete-state')).toContainText('Category impact failed');
});

test('inventory Store CRUD, filters, validation and statistics exercise alternate states', async ({ page }) => {
  let stores = [{
    id: 'store_one',
    retailerName: 'Mercado',
    name: 'Centro',
    productCount: 0,
    ticketCount: 0,
    priceObservationCount: 0,
    createdAt: 'fecha-no-valida',
    lastActivityAt: 'fecha-no-valida',
  }];
  let storeSaveMode = 'success';
  let storeImpactMode = 'allowed';
  let statisticsMode = 'empty';

  await page.route('**/api/v1/inventory/overview', route => json(route, { overview: {} }));
  await page.route('**/api/v1/inventory/stores?*', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'fallo') return json(route, { error: { message: 'Store load failed' } }, 503);
    const offset = Number(url.searchParams.get('offset') || 0);
    const result = url.searchParams.get('q') === 'vacío' ? [] : stores;
    return json(route, { stores: result, total: result.length ? 13 : 0, offset, limit: 12, hasMore: result.length > 0 && offset < 12 });
  });
  await page.route(/\/api\/v1\/inventory\/stores\/([^/]+)$/, route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    const current = stores.find(store => store.id === id);
    if (route.request().method() === 'DELETE') {
      if (storeSaveMode === 'delete-error') return json(route, { error: { message: 'Delete failed' } }, 500);
      stores = stores.filter(store => store.id !== id);
      return route.fulfill({ status: 204, body: '' });
    }
    if (route.request().method() === 'PATCH') {
      if (storeSaveMode === 'patch-error') return json(route, { error: { message: 'Patch failed' } }, 500);
      const saved = { ...current, ...route.request().postDataJSON() };
      stores = stores.map(store => store.id === id ? saved : store);
      return json(route, { store: saved });
    }
    if (!current) return json(route, { error: { message: 'Store missing' } }, 404);
    return json(route, { store: current });
  });
  await page.route(/\/api\/v1\/inventory\/stores$/, route => {
    if (route.request().method() !== 'POST') return route.fallback();
    if (storeSaveMode === 'create-error') return json(route, { error: { message: 'Create failed' } }, 500);
    const created = { id: 'store_created', productCount: 0, ticketCount: 0, priceObservationCount: 0, createdAt: '2026-09-04T10:00:00.000Z', lastActivityAt: null, ...route.request().postDataJSON() };
    stores = [...stores, created];
    return json(route, { store: created }, 201);
  });
  await page.route('**/api/v1/inventory/stores/*/delete-impact', route => {
    if (storeImpactMode === 'error') return json(route, { error: { message: 'Impact failed' } }, 500);
    return json(route, { impact: { linkedProducts: 0, priceObservations: 0, historicalTickets: 0, canDelete: true } });
  });
  await page.route('**/api/v1/inventory/statistics?*', route => {
    if (statisticsMode === 'error') return json(route, { error: { message: 'Statistics failed' } }, 503);
    return json(route, { statistics: statisticsMode === 'empty' ? {} : {
      summary: { latestCatalogValueMinor: 0, activeProducts: 0, ticketsProcessed: 0, entriesValueMinor: 0 },
      categoryStats: [],
      storeStats: [],
      ticketTrend: [],
    } });
  });

  await page.goto('/inventory/stores');
  const storeCheckbox = page.getByRole('checkbox', { name: 'Seleccionar tienda Centro' });
  await storeCheckbox.check();
  await storeCheckbox.uncheck();
  await page.locator('#store-sort').selectOption('recent');
  await page.locator('#store-retailer-filter').fill('Mercado');
  await page.locator('#store-search').fill('vacío');
  await expect(page.locator('#store-list')).toContainText('No hay tiendas');
  await page.locator('#store-search').fill('fallo');
  await expect(page.locator('#store-state')).toContainText('Store load failed');
  await page.locator('#store-clear-filters').click();
  await expect(page.locator('#store-list')).toContainText('Centro');
  await page.locator('#store-next').click();
  await expect(page.locator('#store-page')).toHaveText('2 / 2');
  await page.locator('#store-next').evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.locator('#store-prev').click();
  await expect(page.locator('#store-page')).toHaveText('1 / 2');
  await page.locator('#store-prev').evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));

  await page.getByRole('button', { name: 'Nueva tienda', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/stores\/new/);
  await page.locator('#store-retailer').fill('Mercado');
  await page.locator('#store-name').fill('Nueva');
  await page.locator('#store-editor details > summary').click();
  await page.locator('#store-latitude').fill('37.1');
  await page.getByRole('button', { name: 'Guardar tienda' }).click();
  await expect(page.locator('#store-form-state')).toContainText('latitud y longitud juntas');
  await page.locator('#store-longitude').fill('-5.9');
  await page.locator('#store-osm-type').selectOption('node');
  await page.getByRole('button', { name: 'Guardar tienda' }).click();
  await expect(page.locator('#store-form-state')).toContainText('tipo e ID');
  await page.locator('#store-osm-id').fill('123');
  await page.getByRole('button', { name: 'Guardar tienda' }).click();
  await expect(page.locator('#store-detail-name')).toHaveText('Nueva');

  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  storeSaveMode = 'patch-error';
  await page.locator('#store-name').fill('Nueva editada');
  await page.getByRole('button', { name: 'Guardar tienda' }).click();
  await expect(page.locator('#store-form-state')).toContainText('Patch failed');
  storeSaveMode = 'success';
  await page.getByRole('button', { name: 'Guardar tienda' }).click();
  await expect(page.locator('#store-detail-name')).toHaveText('Nueva editada');

  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  const deleteDialog = page.locator('#store-delete-dialog');
  await expect(deleteDialog.getByRole('button', { name: 'Eliminar tienda' })).toBeEnabled();
  storeSaveMode = 'delete-error';
  await deleteDialog.getByRole('button', { name: 'Eliminar tienda' }).click();
  await expect(deleteDialog.locator('#store-delete-state')).toContainText('Delete failed');
  storeSaveMode = 'success';
  await deleteDialog.getByRole('button', { name: 'Eliminar tienda' }).click();
  await expect(page.locator('#store-state')).toHaveText('Tienda eliminada.');

  storeImpactMode = 'error';
  await page.goto('/inventory/stores/store_one');
  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(deleteDialog.locator('#store-delete-state')).toContainText('Impact failed');

  await page.goto('/inventory/stores/store_missing');
  await expect(page.locator('#store-state')).toContainText('Store missing');

  await page.goto('/inventory/statistics');
  await expect(page.locator('#statistics-categories-table')).toContainText('Sin actividad');
  statisticsMode = 'error';
  await page.locator('#statistics-period').selectOption('90d');
  await expect(page.locator('#statistics-state')).toContainText('Statistics failed');
});
