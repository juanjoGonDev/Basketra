import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AiProviderError,
  OpenAiCompatibleProvider,
} from '../../src/ai/provider.ts';

test('provider OCR probe rejects non-object nested image payloads', async () => {
  for (const image of ['not-an-object', null, []]) {
    const provider = new OpenAiCompatibleProvider(
      {
        baseUrl: new URL('http://provider.test/v1/'),
        model: 'test-model',
      },
      (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ image }) } }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )) as typeof fetch,
    );

    await assert.rejects(
      () => provider.testConnection(),
      (error: unknown) =>
        error instanceof AiProviderError && error.code === 'AI_INVALID_RESPONSE',
    );
  }
});
