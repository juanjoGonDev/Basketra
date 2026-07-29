import type { AiProvider } from '../ai/provider.ts';
import { asArray, asBoolean, asRecord, asString } from '../domain/validation.ts';
import type { FileStore } from '../infrastructure/files.ts';
import { EmbeddedTextOcrProvider, MultimodalAiOcrProvider, type OcrResult } from '../ocr/provider.ts';
import {
  buildReceiptReview,
  extractDeclaredTotalMinor,
  parseDeterministicReceiptText,
  verifyReceiptWithAi,
  type AiReceiptInterpretation,
} from './extraction.ts';

export type ReceiptCaptureRequest = Readonly<{
  storageKey: string;
  originalName?: string;
  embeddedText?: string;
}>;

export type ReceiptExtractionRequest = Readonly<{
  captures: readonly ReceiptCaptureRequest[];
  verifyWithAi: boolean;
}>;

export type ReceiptPageEvidence = Readonly<{
  position: number;
  storageKey: string;
  mimeType: string;
  text: string;
  confidence: number;
  source: OcrResult['source'];
}>;

export class ReceiptExtractionService {
  readonly #fileStore: FileStore;
  readonly #getAiProvider: () => AiProvider;
  readonly #maxRetries: number;
  #ocrProvider: MultimodalAiOcrProvider | undefined;

  constructor(fileStore: FileStore, getAiProvider: () => AiProvider, maxRetries: number) {
    this.#fileStore = fileStore;
    this.#getAiProvider = getAiProvider;
    this.#maxRetries = maxRetries;
  }

  parseRequest(value: unknown): ReceiptExtractionRequest {
    const root = asRecord(value);
    const captures = asArray(root['captures'], '$.captures', 20).map((entry, index): ReceiptCaptureRequest => {
      const capture = asRecord(entry, `$.captures[${index}]`);
      const originalName = typeof capture['originalName'] === 'string'
        ? asString(capture['originalName'], `$.captures[${index}].originalName`, { min: 1, max: 240 })
        : undefined;
      const embeddedText = typeof capture['embeddedText'] === 'string'
        ? asString(capture['embeddedText'], `$.captures[${index}].embeddedText`, { min: 1, max: 500_000 })
        : undefined;
      return {
        storageKey: asString(capture['storageKey'], `$.captures[${index}].storageKey`, { min: 8, max: 160 }),
        ...(originalName ? { originalName } : {}),
        ...(embeddedText ? { embeddedText } : {}),
      };
    });
    if (captures.length === 0) throw new RangeError('At least one receipt capture is required');
    return {
      captures,
      verifyWithAi: root['verifyWithAi'] === undefined ? true : asBoolean(root['verifyWithAi'], '$.verifyWithAi'),
    };
  }

  async extract(request: ReceiptExtractionRequest, signal?: AbortSignal): Promise<Readonly<{
    pages: readonly ReceiptPageEvidence[];
    originalText: string;
    deterministic: Readonly<{ items: ReturnType<typeof parseDeterministicReceiptText>; declaredTotalMinor?: number }>;
    ai?: Readonly<{ interpretation: AiReceiptInterpretation; attempts: number }>;
    final: Readonly<{ items: AiReceiptInterpretation['items']; declaredTotalMinor?: number; review: ReturnType<typeof buildReceiptReview> }>;
  }>> {
    const pages: ReceiptPageEvidence[] = [];
    for (const [position, capture] of request.captures.entries()) {
      signal?.throwIfAborted();
      const stored = this.#fileStore.read(capture.storageKey);
      const result = capture.embeddedText
        ? await new EmbeddedTextOcrProvider().recognize({
            mimeType: stored.mimeType,
            bytes: stored.bytes,
            embeddedText: capture.embeddedText,
            ...(capture.originalName ? { fileName: capture.originalName } : {}),
          }, signal)
        : await this.getOcrProvider().recognize({
            mimeType: stored.mimeType,
            bytes: stored.bytes,
            ...(capture.originalName ? { fileName: capture.originalName } : {}),
          }, signal);
      pages.push({ position, storageKey: capture.storageKey, mimeType: stored.mimeType, ...result });
    }

    const originalText = pages.map((page) => page.text).join('\n').trim();
    const deterministicItems = parseDeterministicReceiptText(originalText);
    const deterministicTotal = extractDeclaredTotalMinor(originalText);
    const deterministic = {
      items: deterministicItems,
      ...(deterministicTotal === undefined ? {} : { declaredTotalMinor: deterministicTotal }),
    };

    let ai: Readonly<{ interpretation: AiReceiptInterpretation; attempts: number }> | undefined;
    if (request.verifyWithAi) {
      const result = await verifyReceiptWithAi(this.#getAiProvider(), this.#maxRetries, originalText, signal);
      ai = { interpretation: result.value, attempts: result.attempts };
    }

    const finalItems = ai?.interpretation.items.length ? ai.interpretation.items : deterministicItems;
    const finalTotal = ai?.interpretation.declaredTotalMinor ?? deterministicTotal;
    return {
      pages,
      originalText,
      deterministic,
      ...(ai ? { ai } : {}),
      final: {
        items: finalItems,
        ...(finalTotal === undefined ? {} : { declaredTotalMinor: finalTotal }),
        review: buildReceiptReview(finalItems, finalTotal),
      },
    };
  }

  dispose(): void {
    this.#ocrProvider?.dispose();
    this.#ocrProvider = undefined;
  }

  private getOcrProvider(): MultimodalAiOcrProvider {
    this.#ocrProvider ??= new MultimodalAiOcrProvider(this.#getAiProvider(), this.#maxRetries);
    return this.#ocrProvider;
  }
}
