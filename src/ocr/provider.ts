import { spawn } from 'node:child_process';
import {
  buildAiAttachmentContentPart,
  type AiMessageContent,
  type AiProvider,
} from '../ai/provider.ts';
import { StructuredAiExecutor, type RuntimeSchema } from '../ai/structured-executor.ts';
import { asRecord, asString } from '../domain/validation.ts';

export type OcrInput = Readonly<{ mimeType: string; bytes: Uint8Array; embeddedText?: string; fileName?: string }>;
export type OcrSource = 'embedded-text' | 'local-tesseract' | 'provider';
export type OcrRegion = Readonly<{ x: number; y: number; width: number; height: number }>;
export type OcrLine = Readonly<{
  index: number;
  text: string;
  confidence: number;
  region?: OcrRegion;
}>;
export type OcrResult = Readonly<{
  text: string;
  confidence: number;
  source: OcrSource;
  lines?: readonly OcrLine[];
}>;

export interface OcrProvider {
  readonly name: string;
  recognize(input: OcrInput, signal?: AbortSignal): Promise<OcrResult>;
  dispose(): void;
}

export type OcrErrorCode =
  | 'OCR_LOCAL_UNAVAILABLE'
  | 'OCR_LOCAL_TIMEOUT'
  | 'OCR_LOCAL_OUTPUT_LIMIT'
  | 'OCR_LOCAL_PROCESS_FAILED'
  | 'OCR_NO_TEXT_DETECTED'
  | 'OCR_LOCAL_PDF_UNSUPPORTED'
  | 'OCR_INPUT_UNSUPPORTED';

export class OcrError extends Error {
  readonly code: OcrErrorCode;

  constructor(code: OcrErrorCode, message: string) {
    super(message);
    this.name = 'OcrError';
    this.code = code;
  }
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

export type OcrProcessRequest = Readonly<{
  command: string;
  args: readonly string[];
  input: Uint8Array;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}>;

export type OcrProcessResult = Readonly<{ stdout: string; stderr: string }>;
export type OcrProcessRunner = (request: OcrProcessRequest) => Promise<OcrProcessResult>;

type TesseractWord = Readonly<{
  text: string;
  confidence?: number;
  left: number;
  top: number;
  width: number;
  height: number;
}>;

function decodeChunks(chunks: readonly Uint8Array[]): string {
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function finiteNonNegative(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function averageConfidence(values: readonly number[], fallback = 0): number {
  if (values.length === 0) return fallback;
  return Math.max(0, Math.min(1, values.reduce((sum, value) => sum + value, 0) / values.length / 100));
}

function unionWordRegion(
  words: readonly TesseractWord[],
  pageWidth: number,
  pageHeight: number,
): OcrRegion | undefined {
  if (words.length === 0 || pageWidth <= 0 || pageHeight <= 0) return undefined;
  const left = Math.min(...words.map((word) => word.left));
  const top = Math.min(...words.map((word) => word.top));
  const right = Math.max(...words.map((word) => word.left + word.width));
  const bottom = Math.max(...words.map((word) => word.top + word.height));
  return {
    x: Math.max(0, Math.min(1, left / pageWidth)),
    y: Math.max(0, Math.min(1, top / pageHeight)),
    width: Math.max(0, Math.min(1, (right - left) / pageWidth)),
    height: Math.max(0, Math.min(1, (bottom - top) / pageHeight)),
  };
}

export async function runTesseractProcess(request: OcrProcessRequest): Promise<OcrProcessResult> {
  request.signal?.throwIfAborted();
  return await new Promise<OcrProcessResult>((resolvePromise, reject) => {
    const child = spawn(request.command, request.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OMP_THREAD_LIMIT: '1',
        OMP_NUM_THREADS: '1',
      },
    });
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const abort = () => {
      child.kill('SIGKILL');
      finish(new DOMException('The OCR operation was aborted', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new OcrError('OCR_LOCAL_TIMEOUT', 'Local OCR exceeded its time limit'));
    }, request.timeoutMs);

    function finish(error?: Error, result?: OcrProcessResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else if (result) resolvePromise(result);
    }

    function appendOutput(chunks: Uint8Array[], chunk: Uint8Array, currentBytes: number, maximumBytes: number): number {
      const nextBytes = currentBytes + chunk.byteLength;
      if (nextBytes > maximumBytes) {
        child.kill('SIGKILL');
        finish(new OcrError('OCR_LOCAL_OUTPUT_LIMIT', 'Local OCR produced too much output'));
        return currentBytes;
      }
      chunks.push(chunk);
      return nextBytes;
    }

    request.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      stdoutBytes = appendOutput(stdoutChunks, chunk, stdoutBytes, request.maxOutputBytes);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes = appendOutput(stderrChunks, chunk, stderrBytes, 8_192);
    });
    child.once('error', (error) => {
      const code = typeof error.code === 'string' ? error.code : undefined;
      finish(new OcrError(
        code === 'ENOENT' ? 'OCR_LOCAL_UNAVAILABLE' : 'OCR_LOCAL_PROCESS_FAILED',
        code === 'ENOENT' ? 'Local OCR executable is unavailable' : 'Local OCR could not start',
      ));
    });
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(new OcrError('OCR_LOCAL_PROCESS_FAILED', 'Local OCR failed to recognize the image'));
        return;
      }
      finish(undefined, {
        stdout: decodeChunks(stdoutChunks),
        stderr: decodeChunks(stderrChunks),
      });
    });
    child.stdin.end(request.input);
  });
}

export function parseTesseractTsv(tsv: string): Readonly<{
  text: string;
  confidence: number;
  lines: readonly OcrLine[];
}> {
  const wordsByLine = new Map<string, TesseractWord[]>();
  const lineOrder: string[] = [];
  const confidences: number[] = [];
  let pageWidth = 0;
  let pageHeight = 0;
  let observedRight = 0;
  let observedBottom = 0;

  for (const row of tsv.split(/\r?\n/u).slice(1)) {
    if (!row) continue;
    const columns = row.split('\t');
    if (columns.length < 12) continue;
    const left = finiteNonNegative(columns[6]);
    const top = finiteNonNegative(columns[7]);
    const width = finiteNonNegative(columns[8]);
    const height = finiteNonNegative(columns[9]);
    if (columns[0] === '1' && width !== undefined && height !== undefined) {
      pageWidth = Math.max(pageWidth, width);
      pageHeight = Math.max(pageHeight, height);
    }
    if (columns[0] !== '5') continue;
    const text = columns.slice(11).join('\t').trim();
    if (!text) continue;
    const lineKey = columns.slice(1, 5).join(':');
    let words = wordsByLine.get(lineKey);
    if (!words) {
      words = [];
      wordsByLine.set(lineKey, words);
      lineOrder.push(lineKey);
    }
    const confidence = Number(columns[10]);
    const word: TesseractWord = {
      text,
      ...(Number.isFinite(confidence) && confidence >= 0 ? { confidence } : {}),
      left: left ?? 0,
      top: top ?? 0,
      width: width ?? 0,
      height: height ?? 0,
    };
    words.push(word);
    observedRight = Math.max(observedRight, word.left + word.width);
    observedBottom = Math.max(observedBottom, word.top + word.height);
    if (word.confidence !== undefined) confidences.push(word.confidence);
  }

  const effectivePageWidth = pageWidth || observedRight;
  const effectivePageHeight = pageHeight || observedBottom;
  const lines = lineOrder.map((lineKey, index): OcrLine => {
    const words = wordsByLine.get(lineKey) ?? [];
    const lineConfidenceValues = words.flatMap((word) => word.confidence === undefined ? [] : [word.confidence]);
    const region = unionWordRegion(words, effectivePageWidth, effectivePageHeight);
    return {
      index: index + 1,
      text: words.map((word) => word.text).join(' ').trim(),
      confidence: averageConfidence(lineConfidenceValues),
      ...(region ? { region } : {}),
    };
  }).filter((line) => line.text.length > 0);

  const text = lines.map((line) => line.text).join('\n').trim();
  if (!text) throw new OcrError('OCR_NO_TEXT_DETECTED', 'No readable text was detected in the image');
  return {
    text,
    confidence: averageConfidence(confidences),
    lines,
  };
}

export type TesseractCliOcrOptions = Readonly<{
  command?: string;
  language?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  runner?: OcrProcessRunner;
}>;

export class TesseractCliOcrProvider implements OcrProvider {
  readonly name = 'local-tesseract';
  readonly #command: string;
  readonly #language: string;
  readonly #timeoutMs: number;
  readonly #maxOutputBytes: number;
  readonly #runner: OcrProcessRunner;
  #queue: Promise<void> = Promise.resolve();

  constructor(options: TesseractCliOcrOptions = {}) {
    this.#command = options.command ?? 'tesseract';
    this.#language = options.language ?? 'spa';
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#maxOutputBytes = options.maxOutputBytes ?? 500_000;
    this.#runner = options.runner ?? runTesseractProcess;
  }

  async recognize(input: OcrInput, signal?: AbortSignal): Promise<OcrResult> {
    signal?.throwIfAborted();
    if (input.mimeType === 'application/pdf') {
      throw new OcrError('OCR_LOCAL_PDF_UNSUPPORTED', 'Local OCR supports receipt images; use manual text or a configured PDF-capable provider');
    }
    if (input.mimeType !== 'image/jpeg' && input.mimeType !== 'image/png') {
      throw new OcrError('OCR_INPUT_UNSUPPORTED', 'Local OCR supports JPEG and PNG images');
    }

    const recognition = this.#queue.then(async () => {
      signal?.throwIfAborted();
      const result = await this.#runner({
        command: this.#command,
        args: [
          'stdin',
          'stdout',
          '--oem',
          '1',
          '--psm',
          '6',
          '--dpi',
          '300',
          '-l',
          this.#language,
          '-c',
          'preserve_interword_spaces=1',
          'tsv',
        ],
        input: input.bytes,
        timeoutMs: this.#timeoutMs,
        maxOutputBytes: this.#maxOutputBytes,
        ...(signal ? { signal } : {}),
      });
      const parsed = parseTesseractTsv(result.stdout);
      return { ...parsed, source: 'local-tesseract' as const };
    });
    this.#queue = recognition.then(() => undefined, () => undefined);
    return await recognition;
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
    if (input.mimeType !== 'image/jpeg'
      && input.mimeType !== 'image/png'
      && input.mimeType !== 'application/pdf') {
      throw new RangeError('Unsupported OCR input type');
    }
    const instruction = { type: 'text' as const, text: 'Transcribe this receipt capture. Return all visible receipt text and nothing from outside the receipt.' };
    try {
      return [
        instruction,
        buildAiAttachmentContentPart({
          mimeType: input.mimeType,
          bytes: input.bytes,
          ...(input.fileName ? { fileName: input.fileName } : {}),
        }, capabilities),
      ];
    } catch (error) {
      if (error instanceof Error && error.message === 'AI_IMAGE_CAPABILITY_UNAVAILABLE') {
        throw new Error('OCR_IMAGE_CAPABILITY_UNAVAILABLE');
      }
      if (error instanceof Error && error.message === 'AI_PDF_CAPABILITY_UNAVAILABLE') {
        throw new Error('OCR_PDF_CAPABILITY_UNAVAILABLE');
      }
      throw error;
    }
  }
}
