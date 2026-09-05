import assert from 'node:assert/strict';
import test from 'node:test';
import { shoppingListItem } from '../../src/web/ui.js';

test('completed shopping-list rows expose a visible return-to-pending action', () => {
  const html = shoppingListItem({
    id: 'item_1',
    text: 'Leche',
    quantityMinor: 1,
    unit: 'unit',
    exactRequired: false,
    substitutionAllowed: true,
    completed: true,
  }, 0, 1);
  assert.match(html, /completed-return-action/);
  assert.match(html, /aria-label="Volver a pendientes"/);
  assert.match(html, />Volver a pendientes<\/span>/);
});
