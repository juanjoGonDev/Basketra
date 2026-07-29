import { ValidationError } from '../domain/validation.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ValidationError || error instanceof RangeError) return new ApiError(400, 'VALIDATION_ERROR', error.message);
  if (error instanceof SyntaxError) return new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  if (error instanceof Error && error.message === 'SHOPPING_LIST_NOT_FOUND') return new ApiError(404, 'SHOPPING_LIST_NOT_FOUND', 'Shopping list was not found');
  return new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}
