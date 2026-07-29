export class ValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';
  readonly path: string;
  constructor(message: string, path: string = '$') {
    super(message);
    this.name = 'ValidationError';
    this.path = path;
  }
}

export function asRecord(value: unknown, path = '$'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('Expected object', path);
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown, path: string, options: Readonly<{ min?: number; max?: number }> = {}): string {
  if (typeof value !== 'string') throw new ValidationError('Expected string', path);
  const trimmed = value.trim();
  if (options.min !== undefined && trimmed.length < options.min) throw new ValidationError(`Expected at least ${options.min} characters`, path);
  if (options.max !== undefined && trimmed.length > options.max) throw new ValidationError(`Expected at most ${options.max} characters`, path);
  return trimmed;
}

export function asOptionalString(value: unknown, path: string, options: Readonly<{ max?: number }> = {}): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : asString(value, path, options);
}

export function asSafeInteger(value: unknown, path: string, options: Readonly<{ min?: number; max?: number }> = {}): number {
  if (!Number.isSafeInteger(value)) throw new ValidationError('Expected safe integer', path);
  const numberValue = value as number;
  if (numberValue < (options.min ?? Number.MIN_SAFE_INTEGER)) throw new ValidationError(`Expected value >= ${options.min}`, path);
  if (numberValue > (options.max ?? Number.MAX_SAFE_INTEGER)) throw new ValidationError(`Expected value <= ${options.max}`, path);
  return numberValue;
}

export function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ValidationError('Expected boolean', path);
  return value;
}

export function asArray(value: unknown, path: string, max = 100): unknown[] {
  if (!Array.isArray(value)) throw new ValidationError('Expected array', path);
  if (value.length > max) throw new ValidationError(`Expected at most ${max} entries`, path);
  return value;
}

export function asEnum<const T extends readonly string[]>(value: unknown, path: string, allowed: T): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new ValidationError(`Expected one of: ${allowed.join(', ')}`, path);
  return value as T[number];
}
