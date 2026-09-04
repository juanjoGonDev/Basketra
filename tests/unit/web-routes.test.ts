import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applicationPathForRoute,
  applicationRouteForPath,
  applicationUrl,
  isApplicationPath,
  legacyHashRoute,
  primaryNavigationForView,
  readApplicationLocation,
  readRouteEnum,
  readRoutePage,
  readRouteText,
  resolveApplicationRoute,
} from '../../src/web/routes.js';

const views = new Set(['home', 'scan', 'inventory', 'catalog', 'categories', 'stores', 'inventory-statistics', 'ticket-history']);

test('clean application paths round-trip base and entity routes without hash fragments', () => {
  const routes = new Map([
    ['home', '/'],
    ['lists', '/lists'],
    ['lists:list_1', '/lists/list_1'],
    ['scan', '/tickets'],
    ['ticket-history', '/tickets/history'],
    ['ticket-history:ticket_1', '/tickets/history/ticket_1'],
    ['inventory', '/inventory'],
    ['catalog', '/inventory/products'],
    ['catalog:new', '/inventory/products/new'],
    ['catalog:product 1', '/inventory/products/product%201'],
    ['categories:category_1', '/inventory/categories/category_1'],
    ['stores:store_1', '/inventory/stores/store_1'],
    ['inventory-statistics', '/inventory/statistics'],
    ['settings', '/settings'],
  ]);
  for (const [route, path] of routes) {
    assert.equal(applicationPathForRoute(route), path);
    assert.equal(applicationRouteForPath(path), route);
    assert.equal(applicationUrl(route).includes('#'), false);
    assert.equal(isApplicationPath(path), true);
  }
});

test('unknown and malformed GET paths are not application shell paths', () => {
  assert.equal(applicationRouteForPath('/missing'), null);
  assert.equal(applicationRouteForPath('/inventory/products/a/b'), null);
  assert.equal(applicationRouteForPath('/inventory/products/%E0%A4%A'), null);
  assert.equal(isApplicationPath('/styles.css'), false);
  assert.equal(isApplicationPath('/api/v1/meta'), false);
});

test('legacy hash routes are accepted only as compatibility input and canonicalize to clean paths', () => {
  assert.equal(legacyHashRoute('#catalog:product%201'), 'catalog:product 1');
  assert.equal(legacyHashRoute('#ticket-history:ticket_1'), 'ticket-history:ticket_1');
  assert.equal(legacyHashRoute('#missing:anything'), null);
  const location = readApplicationLocation({
    pathname: '/',
    search: '?page=2',
    hash: '#catalog:product_1',
  });
  assert.equal(location.route, 'catalog:product_1');
  assert.equal(location.legacy, true);
  assert.equal(location.searchParams.get('page'), '2');
  assert.equal(applicationUrl(location.route, location.searchParams), '/inventory/products/product_1?page=2');
});

test('bounded route query helpers reject invalid state and preserve valid state', () => {
  const params = new URLSearchParams('page=3&q=leche&sort=recent&oversized=123456');
  assert.equal(readRoutePage(params), 3);
  assert.equal(readRouteText(params, 'q', { maxLength: 20 }), 'leche');
  assert.equal(readRouteText(params, 'oversized', { maxLength: 4 }), '');
  assert.equal(readRouteEnum(params, 'sort', ['name', 'recent'], 'name'), 'recent');
  params.set('page', '-4');
  params.set('sort', 'invalid');
  assert.equal(readRoutePage(params), 1);
  assert.equal(readRouteEnum(params, 'sort', ['name', 'recent'], 'name'), 'name');
});

test('known composite routes activate their view even before dynamically installed views exist', () => {
  assert.deepEqual(resolveApplicationRoute('catalog:product_1', views), { view: 'catalog', route: 'catalog:product_1' });
  assert.deepEqual(resolveApplicationRoute('categories:category_1', new Set()), { view: 'categories', route: 'categories:category_1' });
  assert.deepEqual(resolveApplicationRoute('stores:store_1', views), { view: 'stores', route: 'stores:store_1' });
  assert.deepEqual(resolveApplicationRoute('ticket-history:ticket_1', views), { view: 'ticket-history', route: 'ticket-history:ticket_1' });
});

test('unknown routes fall back to home and secondary views map to their primary navigation owner', () => {
  assert.deepEqual(resolveApplicationRoute('missing:anything', views), { view: 'home', route: 'home' });
  assert.equal(primaryNavigationForView('catalog'), 'inventory');
  assert.equal(primaryNavigationForView('categories'), 'inventory');
  assert.equal(primaryNavigationForView('stores'), 'inventory');
  assert.equal(primaryNavigationForView('inventory-statistics'), 'inventory');
  assert.equal(primaryNavigationForView('ticket-history'), 'scan');
  assert.equal(primaryNavigationForView('lists'), 'lists');
});
