import test from 'node:test';
import assert from 'node:assert/strict';
import { primaryNavigationForView, resolveApplicationRoute } from '../../src/web/routes.js';

const views = new Set(['home', 'scan', 'inventory', 'catalog', 'categories', 'stores', 'inventory-statistics', 'ticket-history']);

test('composite entity routes activate their base view without losing the deep link', () => {
  assert.deepEqual(resolveApplicationRoute('catalog:product_1', views), { view: 'catalog', route: 'catalog:product_1' });
  assert.deepEqual(resolveApplicationRoute('categories:category_1', views), { view: 'categories', route: 'categories:category_1' });
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
