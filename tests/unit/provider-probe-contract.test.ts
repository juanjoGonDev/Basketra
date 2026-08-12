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

test('provider OCR probe sends the checked-in JPEG as binary multipart', async () => {
  let requestBody: unknown;
  let transmittedJpeg: Buffer | undefined;
  let transmittedFileName: string | undefined;
  let transmittedMime: string | undefined;
  const provider = new OpenAiCompatibleProvider(
    {
      baseUrl: new URL('http://provider.test/v1/'),
      model: 'test-model',
    },
    (async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'GET') return new Response('{}', { status: 404 });

      assert.match(request.headers.get('content-type') ?? '', /^multipart\/form-data; boundary=/u);
      const form = await request.formData();
      const requestField = form.get('request');
      assert.equal(typeof requestField, 'string');
      requestBody = JSON.parse(String(requestField)) as unknown;
      const file = form.get('files');
      assert.notEqual(file, null);
      assert.notEqual(typeof file, 'string');
      if (file === null || typeof file === 'string') throw new Error('probe file missing');
      transmittedJpeg = Buffer.from(await file.arrayBuffer());
      transmittedFileName = file.name;
      transmittedMime = file.type;

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
  assert.equal(content.length, 1);
  assert.equal(JSON.stringify(body).includes(';base64,'), false);

  const fixtureJpeg = readFileSync(PROBE_FIXTURE_URL);
  assert.equal(transmittedFileName, 'test.jpg');
  assert.equal(transmittedMime, 'image/jpeg');
  assert.deepEqual(transmittedJpeg, fixtureJpeg);
  assert.ok(fixtureJpeg.byteLength <= MAX_PROBE_BYTES);
  assert.deepEqual([...fixtureJpeg.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...fixtureJpeg.subarray(-2)], [0xff, 0xd9]);

  const { height, width } = readJpegDimensions(fixtureJpeg);
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
        error instanceof AiProviderError && error.code === 'AI_INVALID_STRUCTURED_OUTPUT',
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
