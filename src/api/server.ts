import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BasketraDatabase, validateBackup } from '../infrastructure/database.ts';
import { FileStore } from '../infrastructure/files.ts';
import type { AppConfig } from '../infrastructure/config.ts';
import { asArray, asBoolean, asEnum, asRecord, asSafeInteger, asString } from '../domain/validation.ts';
import { optimizeBasket, type ShoppingRequirement } from '../domain/optimization.ts';
import type { Offer } from '../domain/offers.ts';
import { validateReceiptLine, validateReceiptTotal, type ReceiptLineInput } from '../domain/receipt.ts';
import { ApiError, mapError } from './errors.ts';
import { OpenAiCompatibleProvider } from '../ai/provider.ts';
import { StructuredAiExecutor, type RuntimeSchema } from '../ai/structured-executor.ts';
import { ReceiptExtractionService } from '../receipts/service.ts';

const UNIT_VALUES = ['g', 'kg', 'ml', 'l', 'unit', 'pack', 'roll', 'sheet', 'capsule', 'dose', 'wash', 'm'] as const;
const STOCK_VALUES = ['in-stock', 'out-of-stock', 'unknown'] as const;
const PUBLIC_PATHS = new Set(['/health', '/readiness', '/', '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest', '/sw.js', '/icon.svg']);

export type AppDiagnostics = Readonly<{
  ready: boolean;
  activeRequests: number;
  activeExpensiveOperations: number;
  hibernated: boolean;
  startedAt: string;
  lastActivityAt: string;
  memory: NodeJS.MemoryUsage;
}>;

export class BasketraServer {
  readonly config: AppConfig;
  readonly #server: Server;
  readonly #database: BasketraDatabase;
  readonly #fileStore: FileStore;
  readonly #receiptExtractionService: ReceiptExtractionService;
  readonly #startedAt = new Date().toISOString();
  readonly #publicDir: string;
  #ready = false;
  #activeRequests = 0;
  #activeExpensiveOperations = 0;
  #hibernated = false;
  #lastActivityAt = new Date().toISOString();
  #hibernateTimer?: NodeJS.Timeout;
  #aiProvider: OpenAiCompatibleProvider | undefined;

  constructor(config: AppConfig) {
    this.config = config;
    this.#database = new BasketraDatabase(join(config.dataDir, 'basketra.db'));
    this.#fileStore = new FileStore(join(config.dataDir, 'files'), config.tempDir, config.maxBodyBytes);
    this.#receiptExtractionService = new ReceiptExtractionService(this.#fileStore, () => this.getAiProvider(), config.aiMaxRetries);
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
    this.#ready = true;
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
      hibernated: this.#hibernated,
      startedAt: this.#startedAt,
      lastActivityAt: this.#lastActivityAt,
      memory: process.memoryUsage(),
    };
  }

  async close(): Promise<void> {
    this.#ready = false;
    if (this.#hibernateTimer) clearTimeout(this.#hibernateTimer);
    await new Promise<void>((resolvePromise, reject) => this.#server.close((error) => error ? reject(error) : resolvePromise()));
    this.#fileStore.cleanupTemporary();
    this.#receiptExtractionService.dispose();
    this.#aiProvider?.dispose();
    this.#aiProvider = undefined;
    this.#database.close();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.#activeRequests += 1;
    this.#lastActivityAt = new Date().toISOString();
    this.#hibernated = false;
    this.scheduleHibernation();
    const requestId = randomUUID();
    try {
      this.applySecurityHeaders(response, requestId);
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (!PUBLIC_PATHS.has(url.pathname)) this.authorize(request);
      if (request.method === 'GET' && url.pathname === '/health') return this.json(response, 200, { status: 'ok' });
      if (request.method === 'GET' && url.pathname === '/readiness') return this.json(response, this.#ready ? 200 : 503, { ready: this.#ready });
      if (request.method === 'GET' && url.pathname === '/api/v1/diagnostics') return this.json(response, 200, this.diagnostics());
      if (request.method === 'GET' && url.pathname === '/api/v1/settings/ai-provider') return this.json(response, 200, this.aiProviderSettings());
      if (request.method === 'POST' && url.pathname === '/api/v1/settings/ai-provider/test') return await this.testAiProvider(response);
      if (request.method === 'POST' && url.pathname === '/api/v1/ai/shopping-list-analysis') return await this.analyzeShoppingList(request, response);
      if (request.method === 'GET' && url.pathname === '/api/v1/shopping-lists') return this.json(response, 200, { lists: this.#database.listShoppingLists() });
      if (request.method === 'POST' && url.pathname === '/api/v1/shopping-lists') return await this.createShoppingList(request, response);
      const listMatch = /^\/api\/v1\/shopping-lists\/([^/]+)$/.exec(url.pathname);
      if (request.method === 'GET' && listMatch?.[1]) return this.getShoppingList(response, listMatch[1]);
      const itemMatch = /^\/api\/v1\/shopping-lists\/([^/]+)\/items$/.exec(url.pathname);
      if (request.method === 'POST' && itemMatch?.[1]) return await this.addShoppingListItem(request, response, itemMatch[1]);
      if (request.method === 'GET' && url.pathname === '/api/v1/products/suggestions') return this.suggestProducts(response, url.searchParams);
      if (request.method === 'POST' && url.pathname === '/api/v1/files') return await this.storeFile(request, response);
      if (request.method === 'POST' && url.pathname === '/api/v1/receipts/extract') return await this.extractReceipt(request, response);
      if (request.method === 'POST' && url.pathname === '/api/v1/receipts/validate') return await this.validateReceipt(request, response);
      if (request.method === 'POST' && url.pathname === '/api/v1/receipts/confirm') return await this.confirmReceipt(request, response);
      if (request.method === 'POST' && url.pathname === '/api/v1/optimization-runs') return await this.runOptimization(request, response);
      if (request.method === 'POST' && url.pathname === '/api/v1/backup') return await this.createBackup(request, response);
      if (request.method === 'POST' && url.pathname === '/api/v1/restore/validate') return await this.validateRestore(request, response);
      if (request.method === 'GET') return this.serveStatic(response, url.pathname);
      throw new ApiError(404, 'NOT_FOUND', 'Endpoint was not found');
    } catch (error) {
      const mapped = mapError(error);
      this.json(response, mapped.status, { error: { code: mapped.code, message: mapped.message, requestId } });
    } finally {
      this.#activeRequests -= 1;
    }
  }

  private authorize(request: IncomingMessage): void {
    if (!this.config.authToken) return;
    const header = request.headers.authorization;
    const supplied = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const expectedBuffer = Buffer.from(this.config.authToken);
    const suppliedBuffer = Buffer.from(supplied);
    if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      throw new ApiError(401, 'UNAUTHORIZED', 'A valid local access token is required');
    }
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

  private async testAiProvider(response: ServerResponse): Promise<void> {
    this.#activeExpensiveOperations += 1;
    try {
      const result = await this.getAiProvider().testConnection();
      this.json(response, result.ok ? 200 : 502, { connection: result });
    } finally {
      this.#activeExpensiveOperations -= 1;
    }
  }

  private async analyzeShoppingList(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.#activeExpensiveOperations += 1;
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
      });
      this.json(response, 200, { proposal: result.value, attempts: result.attempts });
    } finally {
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
        timeoutMs: this.config.aiTimeoutMs,
        capabilities: {
          image: this.config.aiImageCapability,
          pdf: this.config.aiPdfCapability,
        },
      });
    }
    return this.#aiProvider;
  }

  private async createShoppingList(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const list = this.#database.createShoppingList(asString(body['name'], '$.name', { min: 1, max: 80 }));
    this.json(response, 201, { list });
  }

  private getShoppingList(response: ServerResponse, id: string): void {
    const result = this.#database.getShoppingList(id);
    if (!result) throw new ApiError(404, 'SHOPPING_LIST_NOT_FOUND', 'Shopping list was not found');
    this.json(response, 200, result);
  }

  private async addShoppingListItem(request: IncomingMessage, response: ServerResponse, listId: string): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const item = this.#database.addShoppingListItem({
      listId,
      text: asString(body['text'], '$.text', { min: 1, max: 240 }),
      quantityMinor: asSafeInteger(body['quantityMinor'] ?? 1, '$.quantityMinor', { min: 1, max: 100_000 }),
      unit: asEnum(body['unit'] ?? 'unit', '$.unit', UNIT_VALUES),
      exactRequired: body['exactRequired'] === undefined ? false : asBoolean(body['exactRequired'], '$.exactRequired'),
      substitutionAllowed: body['substitutionAllowed'] === undefined ? true : asBoolean(body['substitutionAllowed'], '$.substitutionAllowed'),
    });
    this.json(response, 201, { item });
  }

  private suggestProducts(response: ServerResponse, params: URLSearchParams): void {
    const query = asString(params.get('q') ?? '', '$.q', { min: 1, max: 100 });
    const limit = Math.min(20, Number(params.get('limit') ?? 8));
    if (!Number.isSafeInteger(limit) || limit < 1) throw new ApiError(400, 'VALIDATION_ERROR', 'Suggestion limit is invalid');
    this.json(response, 200, { suggestions: this.#database.searchProducts(query, limit) });
  }

  private async storeFile(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const file = this.#fileStore.storeBase64({
      base64: asString(body['base64'], '$.base64', { min: 4, max: Math.ceil(this.config.maxBodyBytes * 1.4) }),
      mimeType: asEnum(body['mimeType'], '$.mimeType', ['image/jpeg', 'image/png', 'application/pdf'] as const),
      ...(typeof body['originalName'] === 'string' ? { originalName: body['originalName'] } : {}),
    });
    this.json(response, 201, { file });
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
    const body = asRecord(await this.readJson(request));
    const lines = this.parseReceiptLines(body['items']);
    const declaredTotalMinor = asSafeInteger(body['declaredTotalMinor'], '$.declaredTotalMinor', { min: 0 });
    const originalText = asString(body['originalText'], '$.originalText', { min: 1, max: 500_000 });
    const importKey = asString(body['importKey'], '$.importKey', { min: 8, max: 128 });
    const total = validateReceiptTotal(lines, declaredTotalMinor);
    if (!total.valid) throw new ApiError(409, 'RECEIPT_TOTAL_MISMATCH', 'Receipt total must be reviewed before confirmation');
    const receiptId = this.#database.importReceipt({
      importKey,
      declaredTotalMinor,
      originalText,
      items: lines.map((line) => ({ ...line, status: validateReceiptLine(line).status, confidence: validateReceiptLine(line).status === 'confirmed' ? 1 : 0.5 })),
    });
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
    if (!['index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'sw.js', 'icon.svg'].includes(requested)) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found');
    const file = join(this.#publicDir, requested);
    if (!existsSync(file)) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found');
    const mime = extname(file) === '.html' ? 'text/html; charset=utf-8' : extname(file) === '.js' ? 'text/javascript; charset=utf-8' : extname(file) === '.css' ? 'text/css; charset=utf-8' : extname(file) === '.svg' ? 'image/svg+xml' : extname(file) === '.webmanifest' ? 'application/manifest+json; charset=utf-8' : 'text/javascript; charset=utf-8';
    response.writeHead(200, { 'content-type': mime, 'cache-control': requested === 'index.html' ? 'no-cache' : 'public, max-age=3600' });
    response.end(readFileSync(file));
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
    response.setHeader('permissions-policy', 'camera=(self), microphone=(), geolocation=()');
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
        this.#hibernated = true;
      }
    }, this.config.idleHibernateAfterMs);
    timer.unref();
    this.#hibernateTimer = timer;
  }
}
