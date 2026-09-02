import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { CategoryRepository } from '../../src/infrastructure/category-repository.ts';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';

function receiptInput(importKey: string, categoryId?: string) {
  return {
    importKey,
    declaredTotalMinor: 120,
    originalText: 'LECHE 1,20',
    provider: 'test',
    deterministic: {},
    items: [{
      description: 'LECHE',
      quantity: 1,
      unitPriceMinor: 120,
      lineTotalMinor: 120,
      status: 'confirmed',
      confidence: 1,
      ...(categoryId ? { categoryId } : {}),
    }],
  };
}

test('receipt import persists validated category ids and projects them into uncategorized products', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-category-'));
  const database = new BasketraDatabase(join(root, 'basketra.db'));
  const categories = new CategoryRepository(database.path);

  try {
    const dairy = categories.getOrCreate({ name: 'Lácteos', color: '#33AAFF' });
    const receiptId = database.importReceipt(receiptInput('category-receipt-1', dairy.id));
    const raw = new DatabaseSync(database.path, { readOnly: true });
    try {
      const row = raw.prepare(`
        SELECT receipt_items.category_id AS receiptCategoryId,
          canonical_products.category_id AS productCategoryId
        FROM receipt_items
        JOIN product_variants ON product_variants.id = receipt_items.product_variant_id
        JOIN canonical_products ON canonical_products.id = product_variants.canonical_product_id
        WHERE receipt_items.receipt_id = ?
      `).get(receiptId) as { receiptCategoryId: string; productCategoryId: string };
      assert.equal(row.receiptCategoryId, dairy.id);
      assert.equal(row.productCategoryId, dairy.id);
    } finally {
      raw.close();
    }
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('existing product category remains canonical and invalid or absent receipt categories fall back safely', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-category-ssot-'));
  const database = new BasketraDatabase(join(root, 'basketra.db'));
  const categories = new CategoryRepository(database.path);

  try {
    const dairy = categories.getOrCreate({ name: 'Lácteos', color: '#33AAFF' });
    const other = categories.getOrCreate({ name: 'Otros alimentos', color: '#AA7733' });
    database.importReceipt(receiptInput('category-receipt-seed', dairy.id));

    const secondReceiptId = database.importReceipt(receiptInput('category-receipt-existing', other.id));
    const manualReceiptId = database.importReceipt(receiptInput('category-receipt-manual'));
    const invalidReceiptId = database.importReceipt(receiptInput('category-receipt-invalid', 'category_missing'));

    const raw = new DatabaseSync(database.path, { readOnly: true });
    try {
      const categoryFor = (receiptId: string) => raw.prepare(`
        SELECT receipt_items.category_id AS receiptCategoryId,
          canonical_products.category_id AS productCategoryId,
          product_categories.name AS receiptCategoryName
        FROM receipt_items
        JOIN product_variants ON product_variants.id = receipt_items.product_variant_id
        JOIN canonical_products ON canonical_products.id = product_variants.canonical_product_id
        JOIN product_categories ON product_categories.id = receipt_items.category_id
        WHERE receipt_items.receipt_id = ?
      `).get(receiptId) as { receiptCategoryId: string; productCategoryId: string; receiptCategoryName: string };

      assert.deepEqual({ ...categoryFor(secondReceiptId) }, {
        receiptCategoryId: dairy.id,
        productCategoryId: dairy.id,
        receiptCategoryName: 'Lácteos',
      });
      assert.equal(categoryFor(manualReceiptId).receiptCategoryId, dairy.id);
      assert.equal(categoryFor(invalidReceiptId).receiptCategoryId, dairy.id);
    } finally {
      raw.close();
    }
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
