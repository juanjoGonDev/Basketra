from pathlib import Path

path = Path('src/api/server.ts')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match, found {count}: {old[:80]!r}')
    text = text.replace(old, new, 1)


replace_once(
    "import { StructuredAiExecutor, type RuntimeSchema } from '../ai/structured-executor.ts';\n",
    "import { StructuredAiExecutor, type RuntimeSchema } from '../ai/structured-executor.ts';\nimport { ReceiptExtractionService } from '../receipts/service.ts';\n",
)
replace_once(
    "  readonly #fileStore: FileStore;\n",
    "  readonly #fileStore: FileStore;\n  readonly #receiptExtractionService: ReceiptExtractionService;\n",
)
replace_once(
    "    this.#fileStore = new FileStore(join(config.dataDir, 'files'), config.tempDir, config.maxBodyBytes);\n",
    "    this.#fileStore = new FileStore(join(config.dataDir, 'files'), config.tempDir, config.maxBodyBytes);\n    this.#receiptExtractionService = new ReceiptExtractionService(this.#fileStore, () => this.getAiProvider(), config.aiMaxRetries);\n",
)
replace_once(
    "    this.#fileStore.cleanupTemporary();\n    this.#aiProvider?.dispose();\n",
    "    this.#fileStore.cleanupTemporary();\n    this.#receiptExtractionService.dispose();\n    this.#aiProvider?.dispose();\n",
)
replace_once(
    "      if (request.method === 'POST' && url.pathname === '/api/v1/files') return await this.storeFile(request, response);\n",
    "      if (request.method === 'POST' && url.pathname === '/api/v1/files') return await this.storeFile(request, response);\n      if (request.method === 'POST' && url.pathname === '/api/v1/receipts/extract') return await this.extractReceipt(request, response);\n",
)
replace_once(
    "        model: this.config.aiModel,\n        timeoutMs: this.config.aiTimeoutMs,\n",
    "        model: this.config.aiModel,\n        timeoutMs: this.config.aiTimeoutMs,\n        capabilities: {\n          image: this.config.aiImageCapability,\n          pdf: this.config.aiPdfCapability,\n        },\n",
)
replace_once(
    "  private async validateReceipt(request: IncomingMessage, response: ServerResponse): Promise<void> {\n",
    "  private async extractReceipt(request: IncomingMessage, response: ServerResponse): Promise<void> {\n    this.#activeExpensiveOperations += 1;\n    const controller = new AbortController();\n    const onAborted = () => controller.abort(new Error('REQUEST_ABORTED'));\n    request.once('aborted', onAborted);\n    try {\n      const input = this.#receiptExtractionService.parseRequest(await this.readJson(request));\n      const extraction = await this.#receiptExtractionService.extract(input, controller.signal);\n      this.json(response, 200, { extraction });\n    } finally {\n      request.off('aborted', onAborted);\n      this.#activeExpensiveOperations -= 1;\n    }\n  }\n\n  private async validateReceipt(request: IncomingMessage, response: ServerResponse): Promise<void> {\n",
)
replace_once(
    "        this.#fileStore.cleanupTemporary();\n        this.#aiProvider?.dispose();\n",
    "        this.#fileStore.cleanupTemporary();\n        this.#receiptExtractionService.dispose();\n        this.#aiProvider?.dispose();\n",
)

path.write_text(text, encoding='utf-8')
