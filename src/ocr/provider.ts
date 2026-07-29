export type OcrInput = Readonly<{ mimeType: string; bytes: Uint8Array; embeddedText?: string }>;
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
