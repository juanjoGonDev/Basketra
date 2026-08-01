import { randomUUID } from 'node:crypto';
import { AiProviderError } from '../ai/provider.ts';
import { ValidationError } from '../domain/validation.ts';
import { OcrError } from '../ocr/provider.ts';

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

type SystemErrorFields = Readonly<{
  name?: unknown;
  code?: unknown;
  syscall?: unknown;
}>;

export type UnexpectedErrorLog = Readonly<{
  timestamp: string;
  level: 'error';
  event: 'http.unexpected_error';
  incidentId: string;
  errorName: string;
  systemCode?: string;
  syscall?: string;
}>;

function readSafeStringField(error: unknown, field: keyof SystemErrorFields): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as SystemErrorFields)[field];
  return typeof value === 'string' && value.length <= 80 ? value : undefined;
}

export function buildUnexpectedErrorLog(error: unknown, incidentId: string, timestamp: string): UnexpectedErrorLog {
  const errorName = error instanceof Error ? error.name : typeof error;
  const systemCode = readSafeStringField(error, 'code');
  const syscall = readSafeStringField(error, 'syscall');
  return {
    timestamp,
    level: 'error',
    event: 'http.unexpected_error',
    incidentId,
    errorName,
    ...(systemCode ? { systemCode } : {}),
    ...(syscall ? { syscall } : {}),
  };
}

function reportUnexpectedError(error: unknown): string {
  const incidentId = randomUUID();
  const event = buildUnexpectedErrorLog(error, incidentId, new Date().toISOString());
  try {
    process.stderr.write(`${JSON.stringify(event)}\n`);
  } catch {
    // The HTTP response must remain available even when stderr is unavailable.
  }
  return incidentId;
}

function mapOcrError(error: OcrError): ApiError {
  switch (error.code) {
    case 'OCR_LOCAL_UNAVAILABLE':
      return new ApiError(503, error.code, 'El OCR local no está disponible en esta instalación');
    case 'OCR_LOCAL_TIMEOUT':
      return new ApiError(504, error.code, 'El OCR local tardó demasiado; prueba con una foto más recortada y nítida');
    case 'OCR_NO_TEXT_DETECTED':
      return new ApiError(422, error.code, 'No se detectó texto legible; mejora la luz o añade las líneas manualmente');
    case 'OCR_LOCAL_PDF_UNSUPPORTED':
      return new ApiError(415, error.code, 'El OCR local admite imágenes; para PDF usa un proveedor compatible o revisión manual');
    case 'OCR_INPUT_UNSUPPORTED':
      return new ApiError(415, error.code, 'El OCR local sólo admite imágenes JPEG o PNG');
    case 'OCR_LOCAL_OUTPUT_LIMIT':
    case 'OCR_LOCAL_PROCESS_FAILED':
      return new ApiError(502, error.code, 'El OCR local no pudo leer la imagen; el borrador se conserva');
  }
}

function mapAiProviderError(error: AiProviderError): ApiError {
  switch (error.code) {
    case 'AI_ATTACHMENT_TOO_LARGE':
      return new ApiError(413, error.code, 'El proveedor rechazó la imagen por tamaño; el OCR local se conserva');
    case 'AI_AUTHENTICATION_FAILED':
      return new ApiError(502, error.code, 'El proveedor de IA rechazó sus credenciales');
    case 'AI_IMAGE_CAPABILITY_UNAVAILABLE':
      return new ApiError(422, error.code, 'El proveedor no tiene habilitada la verificación de imágenes');
    case 'AI_PDF_CAPABILITY_UNAVAILABLE':
      return new ApiError(422, error.code, 'El proveedor no tiene habilitada la verificación de PDF');
    case 'AI_RATE_LIMITED':
      return new ApiError(503, error.code, 'El proveedor de IA está limitando temporalmente las solicitudes');
    case 'AI_REQUEST_REJECTED':
      return new ApiError(422, error.code, 'El proveedor rechazó la solicitud multimodal o su formato estructurado');
    case 'AI_TIMEOUT':
      return new ApiError(504, error.code, 'El proveedor de IA tardó demasiado en responder');
    case 'AI_UNREACHABLE':
      return new ApiError(502, error.code, 'No se pudo conectar con el proveedor de IA');
    case 'AI_EMPTY_RESPONSE':
    case 'AI_INVALID_RESPONSE':
      return new ApiError(502, error.code, 'El proveedor devolvió una respuesta vacía o no válida');
    case 'AI_RESPONSE_TOO_LARGE':
      return new ApiError(502, error.code, 'La respuesta del proveedor superó el límite permitido');
    case 'AI_PROVIDER_FAILED':
      return new ApiError(502, error.code, 'El proveedor de IA falló al procesar la imagen');
  }
}

export function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof AiProviderError) return mapAiProviderError(error);
  if (error instanceof OcrError) return mapOcrError(error);
  if (error instanceof ValidationError || error instanceof RangeError) return new ApiError(400, 'VALIDATION_ERROR', error.message);
  if (error instanceof SyntaxError) return new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  if (error instanceof Error && error.message === 'SHOPPING_LIST_NOT_FOUND') {
    return new ApiError(404, 'SHOPPING_LIST_NOT_FOUND', 'Shopping list was not found');
  }
  if (error instanceof Error && error.message === 'SHOPPING_LIST_ITEM_NOT_FOUND') {
    return new ApiError(404, 'SHOPPING_LIST_ITEM_NOT_FOUND', 'Shopping list item was not found');
  }
  const incidentId = reportUnexpectedError(error);
  return new ApiError(500, 'INTERNAL_ERROR', `An unexpected error occurred. Reference: ${incidentId}`);
}
