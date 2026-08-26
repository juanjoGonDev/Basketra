import { randomUUID } from 'node:crypto';
import { AiProviderError, type AiProvider, type AiStructuredInput } from './provider.ts';

export type RuntimeSchema<T> = Readonly<{
  jsonSchema: Readonly<Record<string, unknown>>;
  parse(value: unknown): T;
}>;

export class StructuredAiExecutor {
  readonly provider: AiProvider;
  readonly maxRetries: number;
  constructor(provider: AiProvider, maxRetries: number) {
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) throw new RangeError('AI retries must be between zero and three');
    this.provider = provider;
    this.maxRetries = maxRetries;
  }

  async execute<T>(input: Omit<AiStructuredInput, 'jsonSchema'> & Readonly<{ schema: RuntimeSchema<T> }>): Promise<Readonly<{ value: T; attempts: number }>> {
    let lastError: unknown;
    const correlationId = input.correlationId ?? randomUUID();
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt += 1) {
      try {
        const raw = await this.provider.executeStructured({
          ...input,
          correlationId,
          jsonSchema: input.schema.jsonSchema,
        });
        return { value: input.schema.parse(raw), attempts: attempt };
      } catch (error) {
        lastError = error;
        if (!isOriginalRequestRetryAllowed(error) || attempt > this.maxRetries) break;
      }
    }
    throw lastError;
  }
}

function isOriginalRequestRetryAllowed(error: unknown): boolean {
  if (error instanceof AiProviderError) {
    if (error.originalRequestReplaySafe === false) return false;
    return error.retryable;
  }
  if (!(error instanceof Error)) return false;
  return !['AI_AUTHENTICATION_FAILED', 'AI_UNSUPPORTED_CAPABILITY', 'AI_INVALID_CONFIGURATION'].includes(error.message);
}
