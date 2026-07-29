import type { AiMessageContent, AiProvider } from '../ai/provider.ts';
import { StructuredAiExecutor, type RuntimeSchema } from '../ai/structured-executor.ts';
import { asRecord, asString } from '../domain/validation.ts';

export type OcrInput = Readonly<{ mimeType: string; bytes: Uint8Array; embeddedText?: string; fileName?: string }>;
export type OcrResult = Readonly<{ text: string; confidence: number; source: 'embedded-text' | 'provider' }>;

export interface OcrProvider {
  readonly name: string;
  recognize(input: OcrInput, signal?: AbortSignal): Promise<OcrResult>;
  dispose(): void;
}

export class EmbeddedTextOcrProvider implements OcrProvider {
  readonly name = 'embedded-text';
  async recognize(input: OcrInput, signal?: AbortSignal): Promise<OcrResult> {
    signal?.throwIfAborted();
    const text = input.embeddedText?.trim();
    if (!text) throw new Error('OCR_REQUIRED');
    return { text, confidence: 1, source: 'embedded-text' };
  }
  dispose(): void {}
}

const OCR_RESULT_SCHEMA: RuntimeSchema<Readonly<{ text: string; confidence: number }>> = {
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'confidence'],
    properties: {
      text: { type: 'string', minLength: 1, maxLength: 500_000 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
  parse(value: unknown) {
    const root = asRecord(value);
    const confidence = Number(root['confidence']);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new RangeError('OCR confidence must be between 0 and 1');
    return {
      text: asString(root['text'], '$.text', { min: 1, max: 500_000 }),
      confidence,
    };
  },
};

export class MultimodalAiOcrProvider implements OcrProvider {
  readonly name = 'openai-compatible-multimodal';
  readonly #provider: AiProvider;
  readonly #executor: StructuredAiExecutor;

  constructor(provider: AiProvider, maxRetries: number) {
    this.#provider = provider;
    this.#executor = new StructuredAiExecutor(provider, maxRetries);
  }

  async recognize(input: OcrInput, signal?: AbortSignal): Promise<OcrResult> {
    signal?.throwIfAborted();
    const capabilities = await this.#provider.getCapabilities();
    const content = this.buildContent(input, capabilities);
    const result = await this.#executor.execute({
      operation: 'receipt-ocr',
      schemaName: 'receipt_ocr',
      systemPrompt: 'Transcribe the grocery receipt exactly in page order. Preserve line breaks, abbreviations, decimal separators, quantities, discounts and totals. Do not normalize, infer or invent unreadable text. Return JSON only.',
      content,
      schema: OCR_RESULT_SCHEMA,
      ...(signal ? { signal } : {}),
    });
    return { ...result.value, source: 'provider' };
  }

  dispose(): void {}

  private buildContent(input: OcrInput, capabilities: Awaited<ReturnType<AiProvider['getCapabilities']>>): AiMessageContent {
    const encoded = Buffer.from(input.bytes).toString('base64');
    const instruction = { type: 'text' as const, text: 'Transcribe this receipt capture. Return all visible receipt text and nothing from outside the receipt.' };
    if (input.mimeType === 'image/jpeg' || input.mimeType === 'image/png') {
      if (!capabilities.image) throw new Error('OCR_IMAGE_CAPABILITY_UNAVAILABLE');
      return [
        instruction,
        { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${encoded}`, detail: 'high' } },
      ];
    }
    if (input.mimeType === 'application/pdf') {
      if (!capabilities.pdf) throw new Error('OCR_PDF_CAPABILITY_UNAVAILABLE');
      return [
        instruction,
        {
          type: 'file',
          file: {
            filename: input.fileName?.trim() || 'receipt.pdf',
            file_data: `data:application/pdf;base64,${encoded}`,
          },
        },
      ];
    }
    throw new RangeError('Unsupported OCR input type');
  }
}
