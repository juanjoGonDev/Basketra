import assert from 'node:assert/strict';
import test from 'node:test';
import { shoppingListItem } from '../../src/web/ui.js';

test('completed shopping-list rows expose both persistent recovery controls', () => {
  const html = shoppingListItem({
    id: 'item_1',
    text: 'Leche',
    quantityMinor: 1,
    unit: 'unit',
    exactRequired: false,
    substitutionAllowed: true,
    completed: true,
  }, 0, 1);
  assert.match(html, /aria-label="Devolver Leche a pendientes"/);
  assert.match(html, /completed-return-action/);
  assert.match(html, /aria-label="Volver a pendientes"/);
});
