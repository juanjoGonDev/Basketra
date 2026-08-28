import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BasketraDatabase, validateBackup } from '../infrastructure/database.ts';
import { FileStore, SUPPORTED_FILE_MIME_TYPES } from '../infrastructure/files.ts';
import type { AppConfig } from '../infrastructure/config.ts';
import { asArray, asBoolean, asEnum, asRecord, asSafeInteger, asString } from '../domain/validation.ts';
import { UNIT_VALUES } from '../domain/units.ts';
import { optimizeBasket, type ShoppingRequirement } from '../domain/optimization.ts';
import type { Offer } from '../domain/offers.ts';
import { validateReceiptLine, validateReceiptTotal, type ReceiptLineInput } from '../domain/receipt.ts';
import { ApiError, mapError } from './errors.ts';
import { OpenAiCompatibleProvider } from '../ai/provider.ts';
import { StructuredAiExecutor, type RuntimeSchema } from '../ai/structured-executor.ts';
import { ReceiptDurableJobStore } from '../receipts/durable-job-store.ts';
import { ReceiptDurableExtractionRunner } from '../receipts/durable-runner.ts';
import { ReceiptResponsesClient } from '../receipts/responses-client.ts';
import {
  RECEIPT_AI_VERIFICATION_BUDGET_MS,
  ReceiptExtractionService,
  uniqueReceiptCaptures,
} from '../receipts/service.ts';
import { parseReceiptConfirmation } from '../receipts/import.ts';
import { RealtimeHub, type RealtimeInvalidation } from '../realtime/hub.ts';
import { proposeProductFromPhoto } from '../products/photo-proposal.ts';
import { OverpassClient } from '../stores/overpass.ts';

const STOCK_VALUES = ['in-stock', 'out-of-stock', 'unknown'] as const;
const OSM_TYPES = ['node', 'way', 'relation'] as const;
const PRICE_EVIDENCE_TYPES = ['manual', 'product-photo'] as const;
const STATIC_ASSETS = new Set([
  'index.html',
  'app.js',
  'api.js',
  'operations.js',
  'operations.css',
  'state.js',
  'lists.js',
  'receipts.js',
  'receipt-state.js',
  'receipt-capture.js',
  'receipt-lifecycle.js',
  'receipt-processing.js',
  'receipt-review.js',
  'receipt-review.css',
  'receipt-ai-recovery.js',
  'ui.js',
  'styles.css',
  'modern.css',
  'manifest.webmanifest',
  'sw.js',
  'icon.svg',
]);
const RECEIPT_EXTRACTION_JOB_RETENTION_MS = 24 * 60 * 60 * 1000;

export type AppDiagnostics = Readonly<{
  ready: boolean;
  activeRequests: number;
  activeExpensiveOperations: number;
  realtimeClients: number;
  hibernated: boolean;
  startedAt: string;
  lastActivityAt: string;
  memory: NodeJS.MemoryUsage;
}>;

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ApiError(400, 'INVALID_PATH_PARAMETER', 'Path parameter is not valid URL encoding');
  }
}

export class BasketraServer {
  readonly config: AppConfig;
  readonly #server: Server;
  readonly #database: BasketraDatabase;
  readonly #fileStore: FileStore;
  readonly #receiptExtractionService: ReceiptExtractionService;
  readonly #receiptDurableStore: ReceiptDurableJobStore;
  readonly #receiptDurableRunner: ReceiptDurableExtractionRunner;
  readonly #realtime = new RealtimeHub(8);
  readonly #realtimeResponses = new Set<ServerResponse>();
  readonly #overpassClient: OverpassClient;
  readonly #startedAt = new Date().toISOString();
  readonly #publicDir: string;
  #ready = false;
  #activeRequests = 0;
  #activeExpensiveOperations = 0;
  #hibernated = false;
  #lastActivityAt = new Date().toISOString();
  #hibernateTimer?: NodeJS.Timeout;
  #aiProvider: OpenAiCompatibleProvider | undefined;
  #receiptResponsesClient: ReceiptResponsesClient | undefined;
  readonly #receiptExtractionJobControllers = new Map<string, AbortController>();
  readonly #receiptExtractionJobTasks = new Map<string, Promise<void>>();

  constructor(config: AppConfig) {
    this.config = config;
    this.#database = new BasketraDatabase(join(config.dataDir, 'basketra.db'));
    this.#fileStore = new FileStore(join(config.dataDir, 'files'), config.tempDir, config.maxBodyBytes);
    this.#receiptExtractionService = new ReceiptExtractionService(this.#fileStore, () => this.getAiProvider(), config.aiMaxRetries);
    this.#receiptDurableStore = new ReceiptDurableJobStore(this.#database.path);
    this.#receiptDurableRunner = new ReceiptDurableExtractionRunner({
      durableStore: this.#receiptDurableStore,
      extractionService: this.#receiptExtractionService,
      fileStore: this.#fileStore,
      responses: {
        create: async (input) => await this.getReceiptResponsesClient().create(input),
        get: async (responseId, options) => await this.getReceiptResponsesClient().get(responseId, options),
        cancel: async (responseId, signal) => await this.getReceiptResponsesClient().cancel(responseId, signal),
      },
    });
    this.#overpassClient = new OverpassClient(new URL(config.overpassBaseUrl));
    this.#publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
    this.#server = createServer((request, response) => void this.handle(request, response));
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error) => reject(error);
      this.#server.once('error', onError);
      this.#server.listen(this.config.port, this.config.host, () => {
        this.#server.off('error', onError);
        resolvePromise();
      });
    });
    this.#receiptDurableStore.recoverNonDurableActiveJobs();
    this.pruneReceiptExtractionJobs();
    this.#ready = true;
    for (const id of this.#receiptDurableStore.listRecoverableJobIds()) {
      this.startReceiptExtractionJob(id);
    }
    this.scheduleHibernation();
  }

  address(): Readonly<{ host: string; port: number }> {
    const address = this.#server.address();
    if (!address || typeof address === 'string') return { host: this.config.host, port: this.config.port };
    return { host: address.address, port: address.port };
  }

  diagnostics(): AppDiagnostics {
    return {
      ready: this.#ready,
      activeRequests: this.#activeRequests,
      activeExpensiveOperations: this.#activeExpensiveOperations,
      realtimeClients: this.#realtime.clientCount,
      hibernated: this.#hibernated,
      startedAt: this.#startedAt,
      lastActivityAt: this.#lastActivityAt,
      memory: process.memoryUsage(),
    };
  }

  async close(): Promise<void> {
    this.#ready = false;
    if (this.#hibernateTimer) clearTimeout(this.#hibernateTimer);
    for (const response of [...this.#realtimeResponses]) response.end();
    for (const controller of this.#receiptExtractionJobControllers.values()) {
      controller.abort(new Error('SERVER_CLOSING'));
    }
    await Promise.allSettled(this.#receiptExtractionJobTasks.values());
    this.#realtimeResponses.clear();
    await new Promise<void>((resolvePromise, reject) => this.#server.close((error) => error ? reject(error) : resolvePromise()));
    this.#fileStore.cleanupTemporary();
    this.#receiptExtractionService.dispose();
    this.#aiProvider?.dispose();
    this.#aiProvider = undefined;
    this.#receiptResponsesClient = undefined;
    this.#receiptDurableStore.close();
    this.#database.close();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    let countedRequest = false;
    try {
      this.applySecurityHeaders(response, requestId);
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      this.markActivity();
      if (request.method === 'GET' && url.pathname === '/api/v1/realtime') {
        this.openRealtime(request, response);
        return;
      }

      this.#activeRequests += 1;
      countedRequest = true;
      if (request.method === 'GET' && url.pathname === '/health') return this.json(response, 200, { status: 'ok' });
      if (request.method === 'GET' && url.pathname === '/readiness') return this.json(response, this.#ready ? 200 : 503, { ready: this.#ready });
      if (request.method === 'GET' && url.pathname === '/api/v1/diagnostics') return this.json(response, 200, this.diagnostics());
      if (request.method === 'GET' && url.pathname === '/api/v1/meta') return this.json(response, 200, this.applicationMetadata());
      if (request.method === 'GET' && url.pathname === '/api/v1/settings/ai-provider') return this.json(response, 200, this.aiProviderSettings());
      if (request.method === 'POST' && url.pathname === '/api/v1/settings/ai-provider/test') return await this.testAiProvider(request, response);
      if (request.method === 'POST' && url.pathname === '/api/v1/ai/shopping-list-analysis') return await this.analyzeShoppingList(request, response);
      if (request.method === 'GET' && url.pathname === '/api/v1/shopping-lists') return this.json(response, 200, { lists: this.#database.listShoppingLists() });
      if (request.method === 'POST' && url.pathname === '/api/v1/shopping-lists') return await this.createShoppingList(request, response);

      const itemOrderMatch = /^\/api\/v1\/shopping-lists\/([^/]+)\/items\/order$/.exec(url.pathname);
      if (request.method === 'PUT' && itemOrderMatch?.[1]) {
        return await this.reorderShoppingListItems(request, response, decodePathSegment(itemOrderMatch[1]));
      }

      const itemMemberMatch = /^\/api\/v1\/shopping-lists\/([^/]+)\/items\/([^/]+)$/.exec(url.pathname);
      if (itemMemberMatch?.[1] && itemMemberMatch[2]) {
        const listId = decodePathSegment(itemMemberMatch[1]);
        const itemId = decodePathSegment(itemMemberMatch[2]);
        if (request.method === 'PATCH') return await this.updateShoppingListItem(request, response, listId, itemId);
        if (request.method === 'DELETE') return await this.deleteShoppingListItem(request, response, listId, itemId);
      }

      const itemCollectionMatch = /^\/api\/v1\/shopping-lists\/([^/]+)\/items$/.exec(url.pathname);
      if (request.method === 'POST' && itemCollectionMatch?.[1]) {
        return await this.addShoppingListItem(request, response, decodePathSegment(itemCollectionMatch[1]));
      }

      const listMatch = /^\/api\/v1\/shopping-lists\/([^/]+)$/.exec(url.pathname);
      if (listMatch?.[1]) {
        const listId = decodePathSegment(listMatch[1]);
        if (request.method === 'GET') return this.getShoppingList(response, listId);
        if (request.method === 'PATCH') return await this.updateShoppingList(request, response, listId);
        if (request.method === 'DELETE') return await this.deleteShoppingList(request, response, listId);
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/products/suggestions') return this.suggestProducts(response, url.searchParams);
      if (request.method === 'POST' && url.pathname === '/api/v1/products/photo-proposal') return await this.proposeProductPhoto(request, response);
      if (request.method === 'POST' && url.pathname === '/api/v1/products') return await this.createProduct(request, response);
      const productPriceMatch = /^\/api\/v1\/products\/([^/]+)\/prices$/.exec(url.pathname);
      if (request.method === 'POST' && productPriceMatch?.[1]) {
        return await this.confirmProductPrice(request, response, decodePathSegment(productPriceMatch[1]));
      }
      const productMatch = /^\/api\/v1\/products\/([^/]+)$/.exec(url.pathname);
      if (productMatch?.[1]) {
        const variantId = decodePathSegment(productMatch[1]);
        if (request.method === 'GET') return this.getProduct(response, variantId);
        if (request.method === 'PATCH') return await this.updateProduct(request, response, variantId);
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/categories') return this.json(response, 200, { categories: this.#database.listCategories() });
      if (request.method === 'POST' && url.pathname === '/api/v1/categories') return await this.createCategory(request, response);
      const categoryMatch = /^\/api\/v1\/categories\/([^/]+)$/.exec(url.pathname);
      if (request.method === 'PATCH' && categoryMatch?.[1]) return await this.updateCategory(request, response, decodePathSegment(categoryMatch[1]));

      if (request.method === 'GET' && url.pathname === '/api/v1/stores/suggestions') return this.suggestStores(response, url.searchParams);
      if (request.method === 'POST' && url.pathname === '/api/v1/stores') return await this.saveStore(request, response);
      if (request.method === 'POST' && url.pathname === '/api/v1/stores/nearby') return await this.findNearbyStores(request, response);
      if (request.method === 'GET' && url.pathname === '/api/v1/retailers/suggestions') return this.suggestRetailers(response, url.searchParams);

      if (request.method === 'POST' && url.pathname === '/api/v1/files') return await this.storeFile(request, response);
      const fileMatch = /^\/api\/v1\/files\/([^/]+)$/.exec(url.pathname);
      if (request.method === 'GET' && fileMatch?.[1]) return this.serveStoredFile(response, decodePathSegment(fileMatch[1]));
      if (request.method === 'POST' && url.pathname === '/api/v1/receipts/extract') return await this.extractReceipt(request, response);
      if (request.method === 'POST' && url.pathname === '/api/v1/receipts/extraction-jobs') return await this.createReceiptExtractionJob(request, response);
      const receiptExtractionJobMatch = /^\/api\/v1\/receipts\/extraction-jobs\/([^/]+)$/.exec(url.pathname);
      if (receiptExtractionJobMatch?.[1]) {
        const id = decodePathSegment(receiptExtractionJobMatch[1]);
        if (request.method === 'GET') return this.getReceiptExtractionJob(response, id);
        if (request.method === 'DELETE') return await this.cancelReceiptExtractionJob(response, id);
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/receipts/validate') return await this.validateReceipt(request, response);
      if (request.method === 'POST' && url.pathname === '/api/v1/receipts/confirm') return await this.confirmReceipt(request, response);
      if (request.method === 'POST' && url.pathname === '/api/v1/optimization-runs') return await this.runOptimization(request, response);
      if (request.method === 'POST' && url.pathname === '/api/v1/backup') return await this.createBackup(request, response);
      if (request.method === 'POST' && url.pathname === '/api/v1/restore/validate') return await this.validateRestore(request, response);
      if (request.method === 'GET') return this.serveStatic(response, url.pathname);
      throw new ApiError(404, 'NOT_FOUND', 'Endpoint was not found');
    } catch (error) {
      const mapped = mapError(error);
      this.json(response, mapped.status, {
        error: {
          code: mapped.code,
          message: mapped.message,
          requestId,
          ...(mapped.details === undefined ? {} : { details: mapped.details }),
        },
      });
    } finally {
      if (countedRequest) this.#activeRequests -= 1;
    }
  }

  private markActivity(): void {
    this.#lastActivityAt = new Date().toISOString();
    this.#hibernated = false;
    this.scheduleHibernation();
  }

  private openRealtime(request: IncomingMessage, response: ServerResponse): void {
    let unsubscribe = () => {};
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      this.#realtimeResponses.delete(response);
      response.off('close', cleanup);
      request.off('aborted', cleanup);
    };
    unsubscribe = this.#realtime.subscribe((event) => {
      if (response.destroyed || response.writableEnded) {
        cleanup();
        return;
      }
      const accepted = response.write(`event: invalidate\ndata: ${JSON.stringify(event)}\n\n`);
      if (!accepted) {
        response.end();
        cleanup();
      }
    });
    this.#realtimeResponses.add(response);
    response.once('close', cleanup);
    request.once('aborted', cleanup);
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write('retry: 1500\n: connected\n\n');
  }

  private publishRealtime(event: Omit<RealtimeInvalidation, 'updatedAt'> & Readonly<{ updatedAt?: string }>): void {
    this.#realtime.publish({ ...event, updatedAt: event.updatedAt ?? new Date().toISOString() });
  }

  private applicationMetadata(): Readonly<{
    units: typeof UNIT_VALUES;
    files: Readonly<{ mimeTypes: typeof SUPPORTED_FILE_MIME_TYPES; maxBytes: number }>;
    location: Readonly<{ secureContextRequired: true; osmAttribution: string }>;
  }> {
    return {
      units: UNIT_VALUES,
      files: {
        mimeTypes: SUPPORTED_FILE_MIME_TYPES,
        maxBytes: this.#fileStore.maxBytes,
      },
      location: {
        secureContextRequired: true,
        osmAttribution: '© OpenStreetMap contributors',
      },
    };
  }

  private aiProviderSettings(): Readonly<{ configured: boolean; baseUrl?: string; model?: string; apiKeyMask?: string }> {
    if (!this.config.aiBaseUrl || !this.config.aiModel) return { configured: false };
    return {
      configured: true,
      baseUrl: this.config.aiBaseUrl,
      model: this.config.aiModel,
      ...(this.config.aiApiKey ? { apiKeyMask: `***${this.config.aiApiKey.slice(-4)}` } : {}),
    };
  }

  private async testAiProvider(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.#activeExpensiveOperations += 1;
    const controller = new AbortController();
    const onAborted = () => controller.abort(new Error('REQUEST_ABORTED'));
    request.once('aborted', onAborted);
    try {
      const result = await this.getAiProvider().testConnection(controller.signal);
      this.json(response, result.ok ? 200 : 502, { connection: result });
    } finally {
      request.off('aborted', onAborted);
      this.#activeExpensiveOperations -= 1;
    }
  }

  private async analyzeShoppingList(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.#activeExpensiveOperations += 1;
    const controller = new AbortController();
    const onAborted = () => controller.abort(new Error('REQUEST_ABORTED'));
    request.once('aborted', onAborted);
    try {
      const body = asRecord(await this.readJson(request));
      const text = asString(body['text'], '$.text', { min: 1, max: 2_000 });
      const schema: RuntimeSchema<Readonly<{ items: readonly Readonly<{ text: string; quantityMinor: number; unit: typeof UNIT_VALUES[number]; ambiguity?: string }>[] }>> = {
        jsonSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['text', 'quantityMinor', 'unit'],
                properties: {
                  text: { type: 'string', minLength: 1, maxLength: 240 },
                  quantityMinor: { type: 'integer', minimum: 1, maximum: 100_000 },
                  unit: { type: 'string', enum: UNIT_VALUES },
                  ambiguity: { type: 'string', maxLength: 240 },
                },
              },
            },
          },
        },
        parse(value: unknown) {
          const root = asRecord(value);
          return {
            items: asArray(root['items'], '$.items', 50).map((entry, index) => {
              const item = asRecord(entry, `$.items[${index}]`);
              const ambiguity = typeof item['ambiguity'] === 'string' ? asString(item['ambiguity'], `$.items[${index}].ambiguity`, { max: 240 }) : undefined;
              return {
                text: asString(item['text'], `$.items[${index}].text`, { min: 1, max: 240 }),
                quantityMinor: asSafeInteger(item['quantityMinor'], `$.items[${index}].quantityMinor`, { min: 1, max: 100_000 }),
                unit: asEnum(item['unit'], `$.items[${index}].unit`, UNIT_VALUES),
                ...(ambiguity ? { ambiguity } : {}),
              };
            }),
          };
        },
      };
      const executor = new StructuredAiExecutor(this.getAiProvider(), this.config.aiMaxRetries);
      const result = await executor.execute({
        operation: 'shopping-list-analysis',
        schemaName: 'shopping_list_analysis',
        systemPrompt: 'Split the user request into grocery items. Return JSON only. Do not invent products or quantities.',
        content: text,
        schema,
        signal: controller.signal,
      });
      this.json(response, 200, { proposal: result.value, attempts: result.attempts });
    } finally {
      request.off('aborted', onAborted);
      this.#activeExpensiveOperations -= 1;
    }
  }

  private getAiProvider(): OpenAiCompatibleProvider {
    if (!this.config.aiBaseUrl || !this.config.aiModel) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'AI provider is not configured');
    if (!this.#aiProvider) {
      this.#aiProvider = new OpenAiCompatibleProvider({
        baseUrl: new URL(this.config.aiBaseUrl),
        ...(this.config.aiApiKey ? { apiKey: this.config.aiApiKey } : {}),
        model: this.config.aiModel,
        capabilities: {
          image: this.config.aiImageCapability,
          pdf: this.config.aiPdfCapability,
        },
      });
    }
    return this.#aiProvider;
  }

  private getReceiptResponsesClient(): ReceiptResponsesClient {
    if (!this.config.aiBaseUrl || !this.config.aiModel) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'AI provider is not configured');
    this.#receiptResponsesClient ??= new ReceiptResponsesClient({
      baseUrl: new URL(this.config.aiBaseUrl),
      ...(this.config.aiApiKey ? { apiKey: this.config.aiApiKey } : {}),
      model: this.config.aiModel,
    });
    return this.#receiptResponsesClient;
  }

  private async createShoppingList(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const list = this.#database.createShoppingList(asString(body['name'], '$.name', { min: 1, max: 80 }));
    this.publishRealtime({ entityType: 'shopping-list', mutation: 'created', listId: list.id, entityId: list.id, version: list.version, updatedAt: list.updatedAt });
    this.json(response, 201, { list });
  }

  private getShoppingList(response: ServerResponse, id: string): void {
    const result = this.#database.getShoppingList(id);
    if (!result) throw new ApiError(404, 'SHOPPING_LIST_NOT_FOUND', 'Shopping list was not found');
    this.json(response, 200, result);
  }

  private async updateShoppingList(request: IncomingMessage, response: ServerResponse, id: string): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const list = this.#database.updateShoppingList(
      id,
      asString(body['name'], '$.name', { min: 1, max: 80 }),
      asSafeInteger(body['version'], '$.version', { min: 1 }),
    );
    if (!list) throw new ApiError(404, 'SHOPPING_LIST_NOT_FOUND', 'Shopping list was not found');
    this.publishRealtime({ entityType: 'shopping-list', mutation: 'updated', listId: id, entityId: id, version: list.version, updatedAt: list.updatedAt });
    this.json(response, 200, { list });
  }

  private async deleteShoppingList(request: IncomingMessage, response: ServerResponse, id: string): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const version = asSafeInteger(body['version'], '$.version', { min: 1 });
    if (!this.#database.deleteShoppingList(id, version)) throw new ApiError(404, 'SHOPPING_LIST_NOT_FOUND', 'Shopping list was not found');
    this.publishRealtime({ entityType: 'shopping-list', mutation: 'deleted', listId: id, entityId: id, version: version + 1 });
    this.empty(response);
  }

  private async addShoppingListItem(request: IncomingMessage, response: ServerResponse, listId: string): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const productVariantId = body['productVariantId'] === undefined
      ? undefined
      : asString(body['productVariantId'], '$.productVariantId', { min: 1, max: 128 });
    const item = this.#database.addShoppingListItem({
      listId,
      text: asString(body['text'], '$.text', { min: 1, max: 240 }),
      quantityMinor: asSafeInteger(body['quantityMinor'] ?? 1, '$.quantityMinor', { min: 1, max: 100_000 }),
      unit: asEnum(body['unit'] ?? 'unit', '$.unit', UNIT_VALUES),
      exactRequired: body['exactRequired'] === undefined ? false : asBoolean(body['exactRequired'], '$.exactRequired'),
      substitutionAllowed: body['substitutionAllowed'] === undefined ? true : asBoolean(body['substitutionAllowed'], '$.substitutionAllowed'),
      ...(productVariantId ? { productVariantId } : {}),
    });
    this.publishRealtime({ entityType: 'shopping-list-item', mutation: 'created', listId, entityId: item.id, version: item.version, updatedAt: item.updatedAt });
    this.json(response, 201, { item, listVersion: this.#database.getShoppingListVersion(listId) });
  }

  private async updateShoppingListItem(request: IncomingMessage, response: ServerResponse, listId: string, itemId: string): Promise<void> {
    const body = asRecord(await this.readJson(request));
    if (body['quantityMinor'] !== undefined && body['quantityDelta'] !== undefined) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'quantityMinor and quantityDelta cannot be combined');
    }
    const hasMutableField = ['text', 'quantityMinor', 'quantityDelta', 'unit', 'exactRequired', 'substitutionAllowed', 'completed', 'productVariantId']
      .some((field) => body[field] !== undefined);
    if (!hasMutableField) throw new ApiError(400, 'VALIDATION_ERROR', 'At least one item field must be provided');
    const update = {
      listId,
      itemId,
      expectedVersion: asSafeInteger(body['version'], '$.version', { min: 1 }),
      ...(body['text'] === undefined ? {} : { text: asString(body['text'], '$.text', { min: 1, max: 240 }) }),
      ...(body['quantityMinor'] === undefined ? {} : { quantityMinor: asSafeInteger(body['quantityMinor'], '$.quantityMinor', { min: 1, max: 100_000 }) }),
      ...(body['quantityDelta'] === undefined ? {} : { quantityDelta: asSafeInteger(body['quantityDelta'], '$.quantityDelta', { min: -99_999, max: 99_999 }) }),
      ...(body['unit'] === undefined ? {} : { unit: asEnum(body['unit'], '$.unit', UNIT_VALUES) }),
      ...(body['exactRequired'] === undefined ? {} : { exactRequired: asBoolean(body['exactRequired'], '$.exactRequired') }),
      ...(body['substitutionAllowed'] === undefined ? {} : { substitutionAllowed: asBoolean(body['substitutionAllowed'], '$.substitutionAllowed') }),
      ...(body['completed'] === undefined ? {} : { completed: asBoolean(body['completed'], '$.completed') }),
      ...(body['productVariantId'] === undefined
        ? {}
        : { productVariantId: body['productVariantId'] === null ? null : asString(body['productVariantId'], '$.productVariantId', { min: 1, max: 128 }) }),
    };
    const item = this.#database.updateShoppingListItem(update);
    this.publishRealtime({ entityType: 'shopping-list-item', mutation: 'updated', listId, entityId: item.id, version: item.version, updatedAt: item.updatedAt });
    this.json(response, 200, { item, listVersion: this.#database.getShoppingListVersion(listId) });
  }

  private async deleteShoppingListItem(request: IncomingMessage, response: ServerResponse, listId: string, itemId: string): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const version = asSafeInteger(body['version'], '$.version', { min: 1 });
    this.#database.deleteShoppingListItem(listId, itemId, version);
    this.publishRealtime({ entityType: 'shopping-list-item', mutation: 'deleted', listId, entityId: itemId, version: version + 1 });
    this.empty(response);
  }

  private async reorderShoppingListItems(request: IncomingMessage, response: ServerResponse, listId: string): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const itemIds = asArray(body['itemIds'], '$.itemIds', 500).map((itemId, index) => asString(itemId, `$.itemIds[${index}]`, { min: 1, max: 128 }));
    const listVersion = asSafeInteger(body['listVersion'], '$.listVersion', { min: 1 });
    const result = this.#database.reorderShoppingListItems(listId, itemIds, listVersion);
    this.publishRealtime({ entityType: 'shopping-list', mutation: 'reordered', listId, entityId: listId, version: result.list.version, updatedAt: result.list.updatedAt });
    this.json(response, 200, result);
  }

  private suggestProducts(response: ServerResponse, params: URLSearchParams): void {
    const query = asString(params.get('q') ?? '', '$.q', { min: 1, max: 100 });
    const limit = Math.min(20, Number(params.get('limit') ?? 8));
    if (!Number.isSafeInteger(limit) || limit < 1) throw new ApiError(400, 'VALIDATION_ERROR', 'Suggestion limit is invalid');
    this.json(response, 200, { suggestions: this.#database.searchProducts(query, limit) });
  }

  private async createCategory(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const category = this.#database.getOrCreateCategory(
      asString(body['name'], '$.name', { min: 1, max: 120 }),
      body['description'] === undefined ? undefined : asString(body['description'], '$.description', { max: 500 }),
    );
    this.publishRealtime({ entityType: 'category', mutation: 'created', entityId: category.id, updatedAt: category.updatedAt });
    this.json(response, 201, { category });
  }

  private async updateCategory(request: IncomingMessage, response: ServerResponse, categoryId: string): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const category = this.#database.updateCategory(categoryId, {
      name: asString(body['name'], '$.name', { min: 1, max: 120 }),
      ...(body['description'] === undefined
        ? {}
        : { description: body['description'] === null ? null : asString(body['description'], '$.description', { max: 500 }) }),
    });
    if (!category) throw new ApiError(404, 'PRODUCT_CATEGORY_NOT_FOUND', 'Product category was not found');
    this.publishRealtime({ entityType: 'category', mutation: 'updated', entityId: category.id, updatedAt: category.updatedAt });
    this.json(response, 200, { category });
  }

  private async createProduct(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const product = this.#database.createProduct({
      canonicalName: asString(body['canonicalName'], '$.canonicalName', { min: 1, max: 160 }),
      ...(body['variantName'] === undefined ? {} : { variantName: asString(body['variantName'], '$.variantName', { min: 1, max: 160 }) }),
      ...(body['categoryId'] === undefined ? {} : { categoryId: asString(body['categoryId'], '$.categoryId', { min: 1, max: 128 }) }),
      ...(body['description'] === undefined ? {} : { description: asString(body['description'], '$.description', { max: 500 }) }),
      ...(body['brand'] === undefined ? {} : { brand: asString(body['brand'], '$.brand', { max: 120 }) }),
      ...(body['ean'] === undefined ? {} : { ean: this.parseEan(body['ean'], '$.ean') }),
      ...(body['packageMinor'] === undefined ? {} : { packageMinor: asSafeInteger(body['packageMinor'], '$.packageMinor', { min: 1, max: 100_000_000 }) }),
      ...(body['packageUnit'] === undefined ? {} : { packageUnit: asEnum(body['packageUnit'], '$.packageUnit', UNIT_VALUES) }),
      ...(body['aliases'] === undefined ? {} : { aliases: this.parseStringArray(body['aliases'], '$.aliases', 30, 160) }),
    });
    this.publishRealtime({ entityType: 'product', mutation: 'created', entityId: product.id, updatedAt: product.updatedAt });
    this.json(response, 201, { product });
  }

  private getProduct(response: ServerResponse, variantId: string): void {
    const product = this.#database.getProductVariant(variantId);
    if (!product) throw new ApiError(404, 'PRODUCT_VARIANT_NOT_FOUND', 'Product variant was not found');
    this.json(response, 200, { product, priceHistory: this.#database.listPriceObservations(variantId) });
  }

  private async updateProduct(request: IncomingMessage, response: ServerResponse, variantId: string): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const product = this.#database.updateProduct({
      variantId,
      canonicalName: asString(body['canonicalName'], '$.canonicalName', { min: 1, max: 160 }),
      variantName: asString(body['variantName'], '$.variantName', { min: 1, max: 160 }),
      ...(body['categoryId'] === undefined ? {} : { categoryId: body['categoryId'] === null ? null : asString(body['categoryId'], '$.categoryId', { min: 1, max: 128 }) }),
      ...(body['description'] === undefined ? {} : { description: body['description'] === null ? null : asString(body['description'], '$.description', { max: 500 }) }),
      ...(body['brand'] === undefined ? {} : { brand: body['brand'] === null ? null : asString(body['brand'], '$.brand', { max: 120 }) }),
      ...(body['ean'] === undefined ? {} : { ean: body['ean'] === null ? null : this.parseEan(body['ean'], '$.ean') }),
      ...(body['packageMinor'] === undefined ? {} : { packageMinor: body['packageMinor'] === null ? null : asSafeInteger(body['packageMinor'], '$.packageMinor', { min: 1, max: 100_000_000 }) }),
      ...(body['packageUnit'] === undefined ? {} : { packageUnit: body['packageUnit'] === null ? null : asEnum(body['packageUnit'], '$.packageUnit', UNIT_VALUES) }),
      ...(body['aliases'] === undefined ? {} : { aliases: this.parseStringArray(body['aliases'], '$.aliases', 30, 160) }),
    });
    if (!product) throw new ApiError(404, 'PRODUCT_VARIANT_NOT_FOUND', 'Product variant was not found');
    this.publishRealtime({ entityType: 'product', mutation: 'updated', entityId: product.id, updatedAt: product.updatedAt });
    this.json(response, 200, { product });
  }

  private async proposeProductPhoto(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.#activeExpensiveOperations += 1;
    const controller = new AbortController();
    const onAborted = () => controller.abort(new Error('REQUEST_ABORTED'));
    request.once('aborted', onAborted);
    try {
      const body = asRecord(await this.readJson(request));
      const result = await proposeProductFromPhoto({
        fileStore: this.#fileStore,
        provider: this.getAiProvider(),
        maxRetries: this.config.aiMaxRetries,
        storageKey: asString(body['storageKey'], '$.storageKey', { min: 8, max: 160 }),
        ...(body['contextText'] === undefined ? {} : { contextText: asString(body['contextText'], '$.contextText', { max: 500 }) }),
        signal: controller.signal,
      });
      this.json(response, 200, result);
    } finally {
      request.off('aborted', onAborted);
      this.#activeExpensiveOperations -= 1;
    }
  }

  private async confirmProductPrice(request: IncomingMessage, response: ServerResponse, variantId: string): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const product = this.#database.getProductVariant(variantId);
    if (!product) throw new ApiError(404, 'PRODUCT_VARIANT_NOT_FOUND', 'Product variant was not found');
    const evidenceType = asEnum(body['evidenceType'] ?? 'manual', '$.evidenceType', PRICE_EVIDENCE_TYPES);
    let sourceReference = `manual:${randomUUID()}`;
    let contentHash: string | undefined;
    if (evidenceType === 'product-photo') {
      const storageKey = asString(body['storageKey'], '$.storageKey', { min: 8, max: 160 });
      const stored = this.#fileStore.read(storageKey);
      if (stored.mimeType !== 'image/jpeg' && stored.mimeType !== 'image/png') throw new ApiError(415, 'PRICE_EVIDENCE_UNSUPPORTED', 'Price photo evidence must be JPEG or PNG');
      sourceReference = storageKey;
      contentHash = storageKey.split('.')[0];
    }
    const packageNumerator = asSafeInteger(body['packageNumerator'] ?? product.packageMinor ?? 1, '$.packageNumerator', { min: 1, max: 100_000_000 });
    const packageDenominator = asSafeInteger(body['packageDenominator'] ?? 1, '$.packageDenominator', { min: 1, max: 100_000_000 });
    const packageUnit = asEnum(body['packageUnit'] ?? product.packageUnit ?? 'unit', '$.packageUnit', UNIT_VALUES);
    const observation = this.#database.confirmPriceObservation({
      productVariantId: variantId,
      retailerName: asString(body['retailerName'], '$.retailerName', { min: 1, max: 160 }),
      ...(body['storeId'] === undefined ? {} : { storeId: asString(body['storeId'], '$.storeId', { min: 1, max: 128 }) }),
      priceMinor: asSafeInteger(body['priceMinor'], '$.priceMinor', { min: 0, max: 100_000_000 }),
      packageNumerator,
      packageDenominator,
      packageUnit,
      observedAt: body['observedAt'] === undefined ? new Date().toISOString() : asString(body['observedAt'], '$.observedAt', { min: 20, max: 40 }),
      confidence: this.parseConfidence(body['confidence'] ?? 1, '$.confidence'),
      evidence: {
        sourceType: evidenceType,
        sourceReference,
        ...(contentHash ? { contentHash } : {}),
      },
    });
    this.publishRealtime({ entityType: 'price-observation', mutation: 'created', entityId: observation.id, updatedAt: observation.observedAt });
    this.json(response, 201, { observation });
  }

  private suggestStores(response: ServerResponse, params: URLSearchParams): void {
    const latitudeRaw = params.get('latitudeMicrodegrees');
    const longitudeRaw = params.get('longitudeMicrodegrees');
    if ((latitudeRaw === null) !== (longitudeRaw === null)) throw new ApiError(400, 'VALIDATION_ERROR', 'Both store coordinates are required');
    const limit = Number(params.get('limit') ?? 8);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new ApiError(400, 'VALIDATION_ERROR', 'Store limit is invalid');
    if (latitudeRaw === null || longitudeRaw === null) {
      return this.json(response, 200, { stores: this.#database.listStores(undefined, undefined, limit) });
    }
    const latitudeMicrodegrees = Number(latitudeRaw);
    const longitudeMicrodegrees = Number(longitudeRaw);
    const maximumDistanceMeters = Number(params.get('maximumDistanceMeters') ?? 2_000);
    if (!Number.isSafeInteger(latitudeMicrodegrees) || !Number.isSafeInteger(longitudeMicrodegrees) || !Number.isSafeInteger(maximumDistanceMeters) || maximumDistanceMeters < 100 || maximumDistanceMeters > 20_000) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Store location filter is invalid');
    }
    this.json(response, 200, {
      stores: this.#database.listStores({ latitudeMicrodegrees, longitudeMicrodegrees }, maximumDistanceMeters, limit),
    });
  }

  private async saveStore(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const hasLatitude = body['latitudeMicrodegrees'] !== undefined;
    const hasLongitude = body['longitudeMicrodegrees'] !== undefined;
    if (hasLatitude !== hasLongitude) throw new ApiError(400, 'VALIDATION_ERROR', 'Both store coordinates are required');
    const hasOsmType = body['osmType'] !== undefined;
    const hasOsmId = body['osmId'] !== undefined;
    if (hasOsmType !== hasOsmId) throw new ApiError(400, 'VALIDATION_ERROR', 'Both OSM identity fields are required');
    const store = this.#database.saveStore({
      retailerName: asString(body['retailerName'], '$.retailerName', { min: 1, max: 160 }),
      name: asString(body['name'], '$.name', { min: 1, max: 160 }),
      ...(body['region'] === undefined ? {} : { region: asString(body['region'], '$.region', { max: 160 }) }),
      ...(body['address'] === undefined ? {} : { address: asString(body['address'], '$.address', { max: 240 }) }),
      ...(hasLatitude ? { latitudeMicrodegrees: asSafeInteger(body['latitudeMicrodegrees'], '$.latitudeMicrodegrees', { min: -90_000_000, max: 90_000_000 }) } : {}),
      ...(hasLongitude ? { longitudeMicrodegrees: asSafeInteger(body['longitudeMicrodegrees'], '$.longitudeMicrodegrees', { min: -180_000_000, max: 180_000_000 }) } : {}),
      ...(hasOsmType ? { osmType: asEnum(body['osmType'], '$.osmType', OSM_TYPES) } : {}),
      ...(hasOsmId ? { osmId: asString(body['osmId'], '$.osmId', { min: 1, max: 40 }) } : {}),
    });
    this.publishRealtime({ entityType: 'store', mutation: 'created', entityId: store.id });
    this.json(response, 201, { store });
  }

  private async findNearbyStores(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.#activeExpensiveOperations += 1;
    const controller = new AbortController();
    const onAborted = () => controller.abort(new Error('REQUEST_ABORTED'));
    request.once('aborted', onAborted);
    try {
      const body = asRecord(await this.readJson(request));
      const candidates = await this.#overpassClient.findNearbyStores({
        latitudeMicrodegrees: asSafeInteger(body['latitudeMicrodegrees'], '$.latitudeMicrodegrees', { min: -90_000_000, max: 90_000_000 }),
        longitudeMicrodegrees: asSafeInteger(body['longitudeMicrodegrees'], '$.longitudeMicrodegrees', { min: -180_000_000, max: 180_000_000 }),
        radiusMeters: asSafeInteger(body['radiusMeters'] ?? 1_500, '$.radiusMeters', { min: 100, max: 5_000 }),
        limit: asSafeInteger(body['limit'] ?? 8, '$.limit', { min: 1, max: 20 }),
        signal: controller.signal,
      });
      this.json(response, 200, { candidates, attribution: '© OpenStreetMap contributors' });
    } finally {
      request.off('aborted', onAborted);
      this.#activeExpensiveOperations -= 1;
    }
  }

  private suggestRetailers(response: ServerResponse, params: URLSearchParams): void {
    const query = asString(params.get('q') ?? '', '$.q', { min: 2, max: 120 });
    const limit = Math.min(12, Number(params.get('limit') ?? 8));
    if (!Number.isSafeInteger(limit) || limit < 1) throw new ApiError(400, 'VALIDATION_ERROR', 'Suggestion limit is invalid');
    this.json(response, 200, { suggestions: this.#database.searchRetailers(query, limit) });
  }

  private async storeFile(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const file = this.#fileStore.storeBase64({
      base64: asString(body['base64'], '$.base64', { min: 4, max: Math.ceil(this.config.maxBodyBytes * 1.4) }),
      mimeType: asEnum(body['mimeType'], '$.mimeType', SUPPORTED_FILE_MIME_TYPES),
      ...(body['originalName'] === undefined ? {} : { originalName: asString(body['originalName'], '$.originalName', { min: 1, max: 240 }) }),
    });
    this.json(response, 201, { file });
  }

  private serveStoredFile(response: ServerResponse, storageKey: string): void {
    if (!/^[a-f0-9]{64}\.(?:jpg|png)$/.test(storageKey)) {
      throw new ApiError(400, 'INVALID_STORAGE_KEY', 'Stored image key is invalid');
    }
    let file;
    try {
      file = this.#fileStore.read(storageKey);
    } catch (error) {
      if (error instanceof Error && error.message === 'Stored file does not exist') {
        throw new ApiError(404, 'FILE_NOT_FOUND', 'Stored file was not found');
      }
      throw error;
    }
    if (!file.mimeType.startsWith('image/')) throw new ApiError(415, 'FILE_PREVIEW_UNSUPPORTED', 'Only stored images can be previewed');
    response.writeHead(200, {
      'content-type': file.mimeType,
      'content-length': String(file.bytes.byteLength),
      'cache-control': 'private, no-store, max-age=0',
      'content-disposition': 'inline',
    });
    response.end(file.bytes);
  }

  private async extractReceipt(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.#activeExpensiveOperations += 1;
    const controller = new AbortController();
    const onAborted = () => controller.abort(new Error('REQUEST_ABORTED'));
    request.once('aborted', onAborted);
    try {
      const input = this.#receiptExtractionService.parseRequest(await this.readJson(request));
      const extraction = await this.#receiptExtractionService.extract(input, controller.signal);
      this.json(response, 200, { extraction });
    } finally {
      request.off('aborted', onAborted);
      this.#activeExpensiveOperations -= 1;
    }
  }

  private async createReceiptExtractionJob(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = this.#receiptExtractionService.parseRequest(await this.readJson(request));
    this.pruneReceiptExtractionJobs();
    const job = this.#database.createReceiptExtractionJob(input);
    if (input.verifyWithAi) {
      const captures = uniqueReceiptCaptures(input.captures);
      this.#receiptDurableStore.initialize(job.id, {
        deadlineAt: new Date(Date.parse(job.createdAt) + RECEIPT_AI_VERIFICATION_BUDGET_MS).toISOString(),
        generation: 1,
        pageCount: captures.length,
      });
    }
    this.startReceiptExtractionJob(job.id);
    this.json(response, 202, { job: this.receiptExtractionJobResponse(job) });
  }

  private getReceiptExtractionJob(response: ServerResponse, id: string): void {
    this.pruneReceiptExtractionJobs();
    const job = this.#database.getReceiptExtractionJob(id);
    if (!job) throw new ApiError(404, 'RECEIPT_EXTRACTION_JOB_NOT_FOUND', 'Receipt extraction job was not found');
    this.json(response, 200, { job: this.receiptExtractionJobResponse(job) });
  }

  private async cancelReceiptExtractionJob(response: ServerResponse, id: string): Promise<void> {
    const job = this.#database.cancelReceiptExtractionJob(id);
    if (!job) throw new ApiError(404, 'RECEIPT_EXTRACTION_JOB_NOT_FOUND', 'Receipt extraction job was not found');
    this.#receiptExtractionJobControllers.get(id)?.abort(new Error('RECEIPT_EXTRACTION_CANCELLED'));
    await this.#receiptDurableRunner.cancel(id);
    this.publishRealtime({ entityType: 'receipt-extraction-job', mutation: 'updated', entityId: id, updatedAt: job.updatedAt });
    this.empty(response);
  }

  private startReceiptExtractionJob(id: string): void {
    if (this.#receiptExtractionJobTasks.has(id)) return;
    const controller = new AbortController();
    this.#receiptExtractionJobControllers.set(id, controller);
    const task = this.runReceiptExtractionJob(id, controller)
      .finally(() => {
        this.#receiptExtractionJobControllers.delete(id);
        this.#receiptExtractionJobTasks.delete(id);
      });
    this.#receiptExtractionJobTasks.set(id, task);
  }

  private async runReceiptExtractionJob(id: string, controller: AbortController): Promise<void> {
    const current = this.#database.getReceiptExtractionJob(id);
    const job = current?.status === 'queued'
      ? this.#database.startReceiptExtractionJob(id)
      : current?.status === 'running'
        ? current
        : undefined;
    if (!job) return;
    this.#activeExpensiveOperations += 1;
    this.publishRealtime({ entityType: 'receipt-extraction-job', mutation: 'updated', entityId: id, updatedAt: job.updatedAt });
    try {
      const extraction = await this.#receiptDurableRunner.run(job, controller.signal);
      const completed = this.#database.completeReceiptExtractionJob(id, extraction);
      if (completed) {
        this.publishRealtime({ entityType: 'receipt-extraction-job', mutation: 'updated', entityId: id, updatedAt: completed.updatedAt });
      }
    } catch (error) {
      const active = this.#database.getReceiptExtractionJob(id);
      if (active?.status === 'running' && this.#ready) {
        const failed = this.#database.failReceiptExtractionJob(id, mapError(error).code);
        if (failed) {
          this.publishRealtime({ entityType: 'receipt-extraction-job', mutation: 'updated', entityId: id, updatedAt: failed.updatedAt });
        }
      }
    } finally {
      this.#activeExpensiveOperations -= 1;
      this.scheduleHibernation();
    }
  }

  private receiptExtractionJobResponse(job: Readonly<{
    id: string;
    status: string;
    result?: unknown;
    errorCode?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
  }>): Readonly<Record<string, unknown>> {
    return {
      id: job.id,
      status: job.status,
      ...(job.result === undefined ? {} : { extraction: job.result }),
      ...(job.errorCode === undefined ? {} : { errorCode: job.errorCode }),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(job.completedAt === undefined ? {} : { completedAt: job.completedAt }),
    };
  }

  private pruneReceiptExtractionJobs(): void {
    this.#database.pruneReceiptExtractionJobs(new Date(Date.now() - RECEIPT_EXTRACTION_JOB_RETENTION_MS).toISOString());
  }

  private async validateReceipt(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const lines = this.parseReceiptLines(body['items']);
    const declaredTotalMinor = asSafeInteger(body['declaredTotalMinor'], '$.declaredTotalMinor', { min: 0 });
    this.json(response, 200, {
      lines: lines.map((line) => ({ ...line, validation: validateReceiptLine(line) })),
      total: validateReceiptTotal(lines, declaredTotalMinor),
    });
  }

  private async confirmReceipt(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const { input, total } = parseReceiptConfirmation(await this.readJson(request));
    if (!total.valid) throw new ApiError(409, 'RECEIPT_TOTAL_MISMATCH', 'Receipt total must be reviewed before confirmation');
    const receiptId = this.#database.importReceipt(input);
    this.json(response, 201, { receiptId });
  }

  private async runOptimization(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.#activeExpensiveOperations += 1;
    try {
      const body = asRecord(await this.readJson(request));
      const requirements = asArray(body['requirements'], '$.requirements', 100).map((entry, index): ShoppingRequirement => {
        const record = asRecord(entry, `$.requirements[${index}]`);
        return {
          itemId: asString(record['itemId'], `$.requirements[${index}].itemId`, { min: 1, max: 128 }),
          label: asString(record['label'], `$.requirements[${index}].label`, { min: 1, max: 240 }),
          exactRequired: asBoolean(record['exactRequired'], `$.requirements[${index}].exactRequired`),
          substitutionAllowed: asBoolean(record['substitutionAllowed'], `$.requirements[${index}].substitutionAllowed`),
        };
      });
      const offers = asArray(body['offers'], '$.offers', 500).map((entry, index) => this.parseOffer(entry, index));
      const plans = optimizeBasket({
        requirements,
        offers,
        retailerPenaltyMinor: asSafeInteger(body['retailerPenaltyMinor'] ?? 0, '$.retailerPenaltyMinor', { min: 0 }),
        ...(body['maxRetailers'] === undefined ? {} : { maxRetailers: asSafeInteger(body['maxRetailers'], '$.maxRetailers', { min: 1, max: 12 }) }),
      });
      this.json(response, 200, { plans });
    } finally {
      this.#activeExpensiveOperations -= 1;
    }
  }

  private async createBackup(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const name = asString(body['name'] ?? `basketra-${Date.now()}.db`, '$.name', { min: 1, max: 120 });
    if (!/^[a-zA-Z0-9._-]+\.db$/.test(name)) throw new ApiError(400, 'VALIDATION_ERROR', 'Backup name is invalid');
    const result = this.#database.backup(join(this.config.dataDir, 'backups', name));
    this.json(response, 201, { backup: { name, bytes: result.bytes } });
  }

  private async validateRestore(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const name = asString(body['name'], '$.name', { min: 1, max: 120 });
    if (!/^[a-zA-Z0-9._-]+\.db$/.test(name)) throw new ApiError(400, 'VALIDATION_ERROR', 'Backup name is invalid');
    this.json(response, 200, { validation: validateBackup(join(this.config.dataDir, 'backups', name)) });
  }

  private parseReceiptLines(value: unknown): ReceiptLineInput[] {
    return asArray(value, '$.items', 500).map((entry, index) => {
      const record = asRecord(entry, `$.items[${index}]`);
      return {
        description: asString(record['description'], `$.items[${index}].description`, { max: 240 }),
        quantity: asSafeInteger(record['quantity'], `$.items[${index}].quantity`, { min: 0, max: 100_000 }),
        unitPriceMinor: asSafeInteger(record['unitPriceMinor'], `$.items[${index}].unitPriceMinor`, { min: 0 }),
        lineTotalMinor: asSafeInteger(record['lineTotalMinor'], `$.items[${index}].lineTotalMinor`, { min: 0 }),
        ...(record['discountMinor'] === undefined ? {} : { discountMinor: asSafeInteger(record['discountMinor'], `$.items[${index}].discountMinor`, { min: 0 }) }),
      };
    });
  }

  private parseOffer(value: unknown, index: number): Offer {
    const record = asRecord(value, `$.offers[${index}]`);
    const quantity = asRecord(record['quantity'], `$.offers[${index}].quantity`);
    const amount = asRecord(quantity['amount'], `$.offers[${index}].quantity.amount`);
    return {
      id: asString(record['id'], `$.offers[${index}].id`, { min: 1, max: 128 }),
      itemId: asString(record['itemId'], `$.offers[${index}].itemId`, { min: 1, max: 128 }),
      retailerId: asString(record['retailerId'], `$.offers[${index}].retailerId`, { min: 1, max: 128 }),
      title: asString(record['title'], `$.offers[${index}].title`, { min: 1, max: 240 }),
      priceMinor: asSafeInteger(record['priceMinor'], `$.offers[${index}].priceMinor`, { min: 0 }),
      shippingMinor: asSafeInteger(record['shippingMinor'] ?? 0, `$.offers[${index}].shippingMinor`, { min: 0 }),
      quantity: {
        amount: {
          numerator: asSafeInteger(amount['numerator'], `$.offers[${index}].quantity.amount.numerator`, { min: 0 }),
          denominator: asSafeInteger(amount['denominator'], `$.offers[${index}].quantity.amount.denominator`, { min: 1 }),
        },
        unit: asEnum(quantity['unit'], `$.offers[${index}].quantity.unit`, UNIT_VALUES),
      },
      stock: asEnum(record['stock'], `$.offers[${index}].stock`, STOCK_VALUES),
      observedAt: asString(record['observedAt'], `$.offers[${index}].observedAt`, { min: 20, max: 40 }),
      confidence: Number(record['confidence']),
      evidence: asString(record['evidence'], `$.offers[${index}].evidence`, { min: 1, max: 2048 }),
      exact: asBoolean(record['exact'], `$.offers[${index}].exact`),
      substitutionQuality: Number(record['substitutionQuality']),
      ...(record['primeEligible'] === undefined ? {} : { primeEligible: asBoolean(record['primeEligible'], `$.offers[${index}].primeEligible`) }),
      ...(record['primeFreeDeliveryEvidence'] === undefined ? {} : { primeFreeDeliveryEvidence: asBoolean(record['primeFreeDeliveryEvidence'], `$.offers[${index}].primeFreeDeliveryEvidence`) }),
      ...(record['promotionMinor'] === undefined ? {} : { promotionMinor: asSafeInteger(record['promotionMinor'], `$.offers[${index}].promotionMinor`, { min: 0 }) }),
    };
  }

  private parseStringArray(value: unknown, path: string, maximumEntries: number, maximumLength: number): string[] {
    return asArray(value, path, maximumEntries).map((entry, index) => asString(entry, `${path}[${index}]`, { min: 1, max: maximumLength }));
  }

  private parseEan(value: unknown, path: string): string {
    const ean = asString(value, path, { min: 8, max: 14 });
    if (!/^\d{8,14}$/u.test(ean)) throw new ApiError(400, 'VALIDATION_ERROR', 'EAN/GTIN must contain 8 to 14 digits');
    return ean;
  }

  private parseConfidence(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new ApiError(400, 'VALIDATION_ERROR', `${path} must be between 0 and 1`);
    }
    return value;
  }

  private async readJson(request: IncomingMessage): Promise<unknown> {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bytes += buffer.byteLength;
      if (bytes > this.config.maxBodyBytes) throw new ApiError(413, 'BODY_TOO_LARGE', 'Request body exceeds the configured limit');
      chunks.push(buffer);
    }
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }

  private serveStatic(response: ServerResponse, pathname: string): void {
    const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!STATIC_ASSETS.has(requested)) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found');
    const file = join(this.#publicDir, requested);
    if (!existsSync(file)) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found');
    const mime = extname(file) === '.html' ? 'text/html; charset=utf-8' : extname(file) === '.js' ? 'text/javascript; charset=utf-8' : extname(file) === '.css' ? 'text/css; charset=utf-8' : extname(file) === '.svg' ? 'image/svg+xml' : extname(file) === '.webmanifest' ? 'application/manifest+json; charset=utf-8' : 'application/octet-stream';
    response.writeHead(200, { 'content-type': mime, 'cache-control': requested === 'index.html' ? 'no-cache' : 'public, max-age=3600' });
    response.end(readFileSync(file));
  }

  private empty(response: ServerResponse, status = 204): void {
    if (response.headersSent) return;
    response.writeHead(status, { 'cache-control': 'no-store' });
    response.end();
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    if (response.headersSent) return;
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
  }

  private applySecurityHeaders(response: ServerResponse, requestId: string): void {
    response.setHeader('x-request-id', requestId);
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('permissions-policy', 'camera=(self), microphone=(), geolocation=(self)');
    response.setHeader('content-security-policy', "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  }

  private scheduleHibernation(): void {
    if (this.#hibernateTimer) clearTimeout(this.#hibernateTimer);
    if (this.config.idleHibernateAfterMs === 0) return;
    const timer = setTimeout(() => {
      if (this.#activeRequests === 0 && this.#activeExpensiveOperations === 0) {
        this.#fileStore.cleanupTemporary();
        this.#receiptExtractionService.dispose();
        this.#aiProvider?.dispose();
        this.#aiProvider = undefined;
        this.#receiptResponsesClient = undefined;
        this.#hibernated = true;
      }
    }, this.config.idleHibernateAfterMs);
    timer.unref();
    this.#hibernateTimer = timer;
  }
}
