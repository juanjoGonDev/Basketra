import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AiProvider, AiStructuredInput } from '../../src/ai/provider.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import { proposeProductFromPhoto } from '../../src/products/photo-proposal.ts';

function createProvider(result: unknown, observed: AiStructuredInput[]): AiProvider {
  return {
    async getCapabilities() {
      return { structuredOutput: true, jsonObject: true, image: true, pdf: false, internetSearch: false };
    },
    async testConnection() {
      return { ok: true };
    },
    async executeStructured(input) {
      observed.push(input);
      return result;
    },
    dispose() {},
  };
}

test('product photo proposal sends the stored image through the canonical AI attachment path and validates structured output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-product-photo-'));
  try {
    const fileStore = new FileStore(join(root, 'files'), join(root, 'tmp'), 1024 * 1024);
    const stored = fileStore.storeBase64({
      base64: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]).toString('base64'),
      mimeType: 'image/jpeg',
    });
    const observed: AiStructuredInput[] = [];
    const provider = createProvider({
      canonicalName: 'Leche entera',
      variantName: 'Leche entera 1 L',
      brand: 'Marca',
      ean: '8412345678901',
      category: 'Lácteos',
      packageAmountMinor: 1,
      packageUnit: 'l',
      quantityMinor: 1,
      unit: 'unit',
      priceMinor: 129,
      retailerName: 'Mercado',
      confidence: 0.91,
      warnings: ['Store branch is not visible'],
    }, observed);

    const result = await proposeProductFromPhoto({
      fileStore,
      provider,
      maxRetries: 1,
      storageKey: stored.storageKey,
      contextText: 'Estoy comprando leche',
    });

    assert.equal(result.attempts, 1);
    assert.equal(result.proposal.priceMinor, 129);
    assert.equal(result.proposal.category, 'Lácteos');
    assert.equal(observed.length, 1);
    assert.equal(observed[0]!.operation, 'product-photo-proposal');
    assert.ok(Array.isArray(observed[0]!.content));
    const content = observed[0]!.content as readonly unknown[];
    assert.equal((content[1] as { type: string }).type, 'image_url');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('product photo proposal rejects unsupported files and invalid AI facts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-product-photo-invalid-'));
  try {
    const fileStore = new FileStore(join(root, 'files'), join(root, 'tmp'), 1024 * 1024);
    const pdf = fileStore.storeBase64({
      base64: Buffer.from('%PDF-test').toString('base64'),
      mimeType: 'application/pdf',
    });
    await assert.rejects(() => proposeProductFromPhoto({
      fileStore,
      provider: createProvider({}, []),
      maxRetries: 0,
      storageKey: pdf.storageKey,
    }), /JPEG or PNG/);

    const image = fileStore.storeBase64({
      base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]).toString('base64'),
      mimeType: 'image/png',
    });
    await assert.rejects(() => proposeProductFromPhoto({
      fileStore,
      provider: createProvider({ ean: 'not-an-ean', confidence: 0.5, warnings: [] }, []),
      maxRetries: 0,
      storageKey: image.storageKey,
    }), /EAN\/GTIN/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
