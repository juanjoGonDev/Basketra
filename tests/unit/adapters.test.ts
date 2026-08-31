import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, validateProviderBaseUrl } from '../../src/infrastructure/config.ts';
import { FileStore, SUPPORTED_FILE_MIME_TYPES } from '../../src/infrastructure/files.ts';
import { EmbeddedTextOcrProvider } from '../../src/ocr/provider.ts';
import { ManualOfferProvider } from '../../src/offers/provider.ts';
import { OpenAiCompatibleProvider, type AiProvider } from '../../src/ai/provider.ts';
import { StructuredAiExecutor } from '../../src/ai/structured-executor.ts';
import { rational, UNIT_VALUES } from '../../src/domain/units.ts';
import { readJpegDimensions } from '../helpers/jpeg.ts';

const pngBase64 = Buffer.from(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00])).toString('base64');
const PROVIDER_PROBE_VISIBLE_TEXT = 'BASKETRA OCR 4821';

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

async function readProviderRequestBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.startsWith('multipart/form-data;') === true) {
    const form = await request.clone().formData();
    const metadata = form.get('request');
    assert.equal(typeof metadata, 'string');
    return asRecord(JSON.parse(metadata));
  }
  return asRecord(JSON.parse(await request.clone().text()));
}

test('configuration uses private defaults and ignores removed token and AI timeout configuration', () => {
  const config = loadConfig({ BASKETRA_AUTH_TOKEN: 'legacy-token', BASKETRA_AI_TIMEOUT_MS: 'not-an-integer' });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
  assert.equal('authToken' in config, false);
  assert.equal('aiTimeoutMs' in config, false);
  assert.equal(validateProviderBaseUrl('http://10.0.0.2:8080/v1/').hostname, '10.0.0.2');
  assert.throws(() => validateProviderBaseUrl('ftp://example.com'), /HTTP/);
  assert.throws(() => validateProviderBaseUrl('https://user:pass@example.com'), /credentials/);
  assert.throws(() => validateProviderBaseUrl('https://example.com/path?q=1'), /query/);
  assert.throws(() => loadConfig({ BASKETRA_PORT: '0' }), />= 1/);
  assert.throws(() => loadConfig({ BASKETRA_PORT: 'abc' }), />= 1/);

  const configured = loadConfig({
    BASKETRA_HOST: ' 0.0.0.0 ',
    BASKETRA_PORT: '4000',
    BASKETRA_AI_BASE_URL: 'http://localhost:8080/v1',
    BASKETRA_AI_API_KEY: ' key ',
    BASKETRA_AI_MODEL: ' model ',
    BASKETRA_AI_TIMEOUT_MS: '5000',
    BASKETRA_AI_MAX_RETRIES: '2',
    BASKETRA_IDLE_HIBERNATE_AFTER_MS: '0',
    IDLE_EXIT_AFTER_MS: '1000',
    BASKETRA_DATA_DIR: './x',
    BASKETRA_TEMP_DIR: './y',
  });
  assert.equal(configured.host, '0.0.0.0');
  assert.equal(configured.port, 4000);
  assert.equal(configured.aiApiKey, 'key');
  assert.equal(configured.aiModel, 'model');
  assert.equal('aiTimeoutMs' in configured, false);
  assert.deepEqual(UNIT_VALUES, ['g', 'kg', 'ml', 'l', 'unit', 'pack', 'roll', 'sheet', 'capsule', 'dose', 'wash', 'm']);
  assert.deepEqual(SUPPORTED_FILE_MIME_TYPES, ['image/jpeg', 'image/png', 'application/pdf']);
});

test('file storage validates signatures, deduplicates and prevents traversal', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-files-'));
  const store = new FileStore(join(root, 'files'), join(root, 'tmp'), 16);
  try {
    const first = store.storeBase64({ base64: pngBase64, mimeType: 'image/png', originalName: 'receipt.png' });
    const second = store.storeBase64({ base64: pngBase64, mimeType: 'image/png' });
    assert.equal(first.storageKey, second.storageKey);
    assert.equal(readFileSync(store.resolveKey(first.storageKey)).byteLength, 5);
    assert.throws(() => store.resolveKey('../secret.png'), /Invalid storage key/);
    assert.throws(() => store.resolveKey('missingextension'), /Invalid storage key/);
    assert.throws(() => store.storeBase64({ base64: pngBase64, mimeType: 'text/plain' }), /Unsupported/);
    assert.throws(() => store.storeBase64({ base64: Buffer.from('bad').toString('base64'), mimeType: 'image/png' }), /signature/);
    assert.throws(() => store.storeBase64({ base64: '', mimeType: 'image/png' }), /empty/);
    const largerThanTransportBound = Buffer.from(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...Array(20).fill(0)])).toString('base64');
    assert.equal(store.storeBase64({ base64: largerThanTransportBound, mimeType: 'image/png' }).bytes, 24);
    store.cleanupTemporary();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('OCR and manual offer providers are cancellable and disposable', async () => {
  const ocr = new EmbeddedTextOcrProvider();
  assert.deepEqual(await ocr.recognize({ mimeType: 'application/pdf', bytes: new Uint8Array(), embeddedText: '  Milk  ' }), { text: 'Milk', confidence: 1, source: 'embedded-text' });
  await assert.rejects(() => ocr.recognize({ mimeType: 'image/png', bytes: new Uint8Array() }), /OCR_REQUIRED/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => ocr.recognize({ mimeType: 'text/plain', bytes: new Uint8Array(), embeddedText: 'x' }, controller.signal));
  ocr.dispose();

  const offer = { id: '1', itemId: 'milk', retailerId: 'a', title: 'Milk', priceMinor: 100, shippingMinor: 0, quantity: { amount: rational(1), unit: 'l' }, stock: 'in-stock', observedAt: new Date().toISOString(), confidence: 1, evidence: 'manual', exact: true, substitutionQuality: 1 } as const;
  const provider = new ManualOfferProvider([offer]);
  assert.deepEqual(await provider.search({ itemId: 'milk', query: 'milk' }), [offer]);
  assert.deepEqual(await provider.search({ itemId: 'rice', query: 'rice' }), []);
  await assert.rejects(() => provider.search({ itemId: 'milk', query: 'milk', signal: controller.signal }));
  provider.dispose();
});

test('structured AI execution validates locally and bounds retries', async () => {
  let calls = 0;
  const provider: AiProvider = {
    async getCapabilities() { return { structuredOutput: true, jsonObject: true, image: false, pdf: false, internetSearch: false }; },
    async testConnection() { return { ok: true }; },
    async executeStructured() { calls += 1; return calls === 1 ? { value: 'bad' } : { value: 2 }; },
    dispose() {},
  };
  const executor = new StructuredAiExecutor(provider, 1);
  const result = await executor.execute({ operation: 'test', schemaName: 'test', systemPrompt: 'Return JSON', content: 'x', schema: { jsonSchema: { type: 'object' }, parse(value) { if (typeof value !== 'object' || value === null || typeof value.value !== 'number') throw new Error('INVALID_SCHEMA'); return value.value; } } });
  assert.deepEqual(result, { value: 2, attempts: 2 });
  assert.throws(() => new StructuredAiExecutor(provider, -1), RangeError);
  assert.throws(() => new StructuredAiExecutor(provider, 4), RangeError);
  let authCalls = 0;
  const authProvider = { ...provider, async executeStructured() { authCalls += 1; throw new Error('AI_AUTHENTICATION_FAILED'); } };
  await assert.rejects(() => new StructuredAiExecutor(authProvider, 3).execute({ operation: 'test', schemaName: 'test', systemPrompt: 'x', content: 'x', schema: { jsonSchema: {}, parse() { return 1; } } }), /AUTHENTICATION/);
  assert.equal(authCalls, 1);
  const unknownProvider = { ...provider, async executeStructured() { throw 'unknown'; } };
  await assert.rejects(() => new StructuredAiExecutor(unknownProvider, 1).execute({ operation: 'test', schemaName: 'test', systemPrompt: 'x', content: 'x', schema: { jsonSchema: {}, parse() { return 1; } } }));
});

test('OpenAI-compatible provider proves image OCR plus strict structured output', async () => {
  const requests: Request[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.method === 'GET') return new Response('{}', { status: 404 });
    const body = await readProviderRequestBody(request) as { response_format?: { json_schema?: { name?: string } } };
    const content = body.response_format?.json_schema?.name === 'basketra_provider_capability'
      ? JSON.stringify({ image: { format: 'jpg', text: PROVIDER_PROBE_VISIBLE_TEXT } })
      : '{"ok":true}';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const provider = new OpenAiCompatibleProvider({ baseUrl: new URL('http://localhost:8080/v1'), apiKey: 'secret', model: 'test-model' }, mockFetch);
  assert.equal((await provider.getCapabilities()).structuredOutput, true);
  assert.deepEqual(await provider.testConnection(), {
    ok: true,
    model: 'test-model',
    imageStructuredOutput: true,
  });
  const value = await provider.executeStructured({ operation: 'test', schemaName: 'result', systemPrompt: 'x', content: 'y', jsonSchema: { type: 'object' } });
  assert.deepEqual(value, { ok: true });
  const modelRequests = requests.filter((request) => request.method === 'POST');
  assert.equal(modelRequests.length, 2);
  assert.equal(modelRequests[0]?.url, 'http://localhost:8080/v1/chat/completions');
  assert.equal(modelRequests[1]?.url, 'http://localhost:8080/v1/chat/completions');
  assert.equal(requests[0]?.headers.get('authorization'), 'Bearer secret');

  const probe = await readProviderRequestBody(modelRequests[0]!) as {
    messages: Array<{ content: string | Array<Record<string, unknown>> }>;
    response_format: {
      json_schema: {
        strict: boolean;
        schema: Record<string, unknown>;
      };
    };
  };
  const systemPrompt = probe.messages[0]?.content;
  assert.equal(typeof systemPrompt, 'string');
  assert.equal(String(systemPrompt).includes(PROVIDER_PROBE_VISIBLE_TEXT), false);
  const userContent = probe.messages[1]?.content;
  assert.ok(Array.isArray(userContent));
  assert.equal(String(userContent[0]?.['text'] ?? '').includes(PROVIDER_PROBE_VISIBLE_TEXT), false);
  assert.equal(userContent.length, 1);
  assert.equal(JSON.stringify(probe).includes(';base64,'), false);
  const probeForm = await modelRequests[0]!.clone().formData();
  const probeFile = probeForm.get('files');
  assert.notEqual(probeFile, null);
  assert.notEqual(typeof probeFile, 'string');
  if (probeFile === null || typeof probeFile === 'string') throw new Error('missing provider probe attachment');
  assert.equal(probeFile.name, 'test.jpg');
  assert.equal(probeFile.type, 'image/jpeg');
  const imageBytes = Buffer.from(await probeFile.arrayBuffer());
  assert.deepEqual([...imageBytes.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...imageBytes.subarray(-2)], [0xff, 0xd9]);
  const { height, width } = readJpegDimensions(imageBytes);
  assert.ok(width >= 600);
  assert.ok(height >= 120);
  assert.ok(width / height >= 2 && width / height <= 4);
  assert.ok(imageBytes.byteLength > 500);

  const schema = probe.response_format.json_schema.schema as {
    required?: string[];
    properties?: {
      image?: {
        required?: string[];
        properties?: { format?: { enum?: string[] }; text?: { type?: string } };
      };
    };
  };
  assert.equal(probe.response_format.json_schema.strict, true);
  assert.deepEqual(schema.required, ['image']);
  assert.deepEqual(schema.properties?.image?.required, ['format', 'text']);
  assert.deepEqual(schema.properties?.image?.properties?.format?.enum, ['jpg']);
  assert.equal(schema.properties?.image?.properties?.text?.type, 'string');
  provider.dispose();

  for (const invalid of [
    { image: { format: 'jpg', text: 'WRONG TEXT' } },
    { image: { format: 'png', text: PROVIDER_PROBE_VISIBLE_TEXT } },
    { image: { format: 'jpg' } },
  ]) {
    const invalidProvider = new OpenAiCompatibleProvider(
      { baseUrl: new URL('http://localhost/v1/'), model: 'x' },
      async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalid) } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await assert.rejects(() => invalidProvider.testConnection(), /AI_(?:PROBE_TEXT_MISMATCH|INVALID_STRUCTURED_OUTPUT)/);
  }

  const failed = new OpenAiCompatibleProvider({ baseUrl: new URL('http://localhost/v1/'), model: 'x' }, async () => new Response('', { status: 503 }));
  await assert.rejects(() => failed.testConnection(), /AI_PROVIDER_FAILED/);
  await assert.rejects(() => failed.executeStructured({ operation: 'x', schemaName: 'x', systemPrompt: 'x', content: 'x', jsonSchema: {} }), /AI_PROVIDER_FAILED/);
  const auth = new OpenAiCompatibleProvider({ baseUrl: new URL('http://localhost/v1/'), model: 'x' }, async () => new Response('', { status: 401 }));
  await assert.rejects(() => auth.testConnection(), /AUTHENTICATION/);
  await assert.rejects(() => auth.executeStructured({ operation: 'x', schemaName: 'x', systemPrompt: 'x', content: 'x', jsonSchema: {} }), /AUTHENTICATION/);
  const empty = new OpenAiCompatibleProvider({ baseUrl: new URL('http://localhost/v1/'), model: 'x' }, async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(() => empty.executeStructured({ operation: 'x', schemaName: 'x', systemPrompt: 'x', content: 'x', jsonSchema: {} }), /EMPTY/);
});
