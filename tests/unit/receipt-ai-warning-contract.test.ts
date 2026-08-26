import assert from 'node:assert/strict';
import test from 'node:test';

import type { AiProvider, AiStructuredInput } from '../../src/ai/provider.ts';
import { verifyReceiptWithAi } from '../../src/receipts/extraction.ts';

test('receipt verification states the canonical warning length bound', async () => {
  let captured: AiStructuredInput | undefined;
  const provider: AiProvider = {
    async getCapabilities() {
      return {
        structuredOutput: true,
        jsonObject: true,
        image: true,
        pdf: false,
        internetSearch: false,
      };
    },
    async testConnection() {
      return { ok: true };
    },
    async executeStructured(input) {
      captured = input;
      return {
        currency: 'EUR',
        correctedText: 'TEST ITEM 1,00 B',
        items: [],
        warnings: [],
      };
    },
    dispose() {},
  };

  await verifyReceiptWithAi(
    provider,
    0,
    'TEST ITEM 1,00 B',
    { mimeType: 'image/jpeg', bytes: Uint8Array.from([1]) },
  );

  assert.ok(captured);
  assert.match(
    captured.systemPrompt,
    /Keep each warning within 240 characters/u,
  );
});
