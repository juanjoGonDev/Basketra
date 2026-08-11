import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AiProviderError,
  OpenAiCompatibleProvider,
} from '../../src/ai/provider.ts';
import { readJpegDimensions } from '../helpers/jpeg.ts';

const EXPECTED_PROBE_TEXT = 'BASKETRA OCR 4821';
const PROBE_FIXTURE_URL = new URL('../../src/ai/fixtures/provider-probe.jpg', import.meta.url);
const MAX_PROBE_BYTES = 256 * 1024;

test('provider OCR probe sends the checked-in readable JPEG fixture', async () => {
  let requestBody: unknown;
  const provider = new OpenAiCompatibleProvider(
    {
      baseUrl: new URL('http://provider.test/v1/'),
      model: 'test-model',
    },
    (async (input, init) => {
      requestBody = await new Request(input, init).json();
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  image: { format: 'jpg', text: EXPECTED_PROBE_TEXT },
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch,
  );

  await provider.testConnection();

  const body = asRecord(requestBody);
  const messages = asArray(body['messages']);
  const systemMessage = asRecord(messages[0]);
  const userMessage = asRecord(messages[1]);
  const content = asArray(userMessage['content']);
  assert.equal(String(systemMessage['content']).includes(EXPECTED_PROBE_TEXT), false);
  assert.equal(String(asRecord(content[0])['text']).includes(EXPECTED_PROBE_TEXT), false);

  const imagePart = asRecord(content[1]);
  assert.equal(imagePart['filename'], 'test.jpg');
  const image = asRecord(imagePart['image_url']);
  assert.equal(image['detail'], 'high');
  const dataUrl = String(image['url']);
  assert.match(dataUrl, /^data:image\/jpeg;base64,/u);

  const transmittedJpeg = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  const fixtureJpeg = readFileSync(PROBE_FIXTURE_URL);
  assert.deepEqual(transmittedJpeg, fixtureJpeg);
  assert.ok(fixtureJpeg.byteLength <= MAX_PROBE_BYTES);
  assert.deepEqual([...transmittedJpeg.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...transmittedJpeg.subarray(-2)], [0xff, 0xd9]);

  const { height, width } = readJpegDimensions(transmittedJpeg);
  assert.ok(width >= 600);
  assert.ok(height >= 120);
  assert.ok(width / height >= 2 && width / height <= 4);
});

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

function asArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}
