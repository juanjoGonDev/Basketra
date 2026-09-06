import { randomUUID } from 'node:crypto';
import { AiProviderError } from '../ai/provider.ts';
import { ValidationError } from '../domain/validation.ts';
import { ShoppingConflictError } from '../infrastructure/database.ts';
import { OcrError } from '../ocr/provider.ts';
import { ReceiptAiVerificationTimeoutError } from '../receipts/service.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

type SystemErrorFields = Readonly<{
  name?: unknown;
  code?: unknown;
  syscall?: unknown;
  errcode?: unknown;
  errstr?: unknown;
}>;

export type UnexpectedErrorLog = Readonly<{
  timestamp: string;
  level: 'error';
  event: 'http.unexpected_error';
  incidentId: string;
  errorName: string;
  systemCode?: string;
  syscall?: string;
  sqliteErrcode?: number;
  sqliteErrstr?: string;
}>;

function readSafeStringField(error: unknown, field: keyof SystemErrorFields): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as SystemErrorFields)[field];
  return typeof value === 'string' && value.length <= 80 ? value : undefined;
}

function readSafeSqliteErrcode(error: SystemErrorFields): number | undefined {
  const value = error.errcode;
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 0x7fffffff
    ? value
    : undefined;
}

export function buildUnexpectedErrorLog(error: unknown, incidentId: string, timestamp: string): UnexpectedErrorLog {
  const errorName = error instanceof Error ? error.name : typeof error;
  const systemCode = readSafeStringField(error, 'code');
  const syscall = readSafeStringField(error, 'syscall');
  const sqliteErrcode = systemCode === 'ERR_SQLITE_ERROR'
    ? readSafeSqliteErrcode(error as SystemErrorFields)
    : undefined;
  const sqliteErrstr = systemCode === 'ERR_SQLITE_ERROR' ? readSafeStringField(error, 'errstr') : undefined;
  return {
    timestamp,
    level: 'error',
    event: 'http.unexpected_error',
    incidentId,
    errorName,
    ...(systemCode ? { systemCode } : {}),
    ...(syscall ? { syscall } : {}),
    ...(sqliteErrcode === undefined ? {} : { sqliteErrcode }),
    ...(sqliteErrstr ? { sqliteErrstr } : {}),
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
      return new ApiError(413, error.code, 'El proveedor rechazó la imagen por tamaño; el archivo se conserva');
    case 'AI_ATTACHMENT_UPLOAD_FAILED':
      return new ApiError(504, error.code, 'El proveedor no pudo preparar la imagen; el archivo se conserva y puedes reintentar');
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
    case 'AI_MALFORMED_PROVIDER_RESPONSE':
      return new ApiError(502, error.code, 'El proveedor devolvió una respuesta de transporte no válida');
    case 'AI_INVALID_STRUCTURED_OUTPUT':
      return new ApiError(502, error.code, 'El proveedor devolvió JSON estructurado no válido');
    case 'AI_PROBE_TEXT_MISMATCH':
      return new ApiError(502, error.code, 'El proveedor no pudo leer correctamente la imagen de comprobación');
    case 'AI_RESPONSE_TOO_LARGE':
      return new ApiError(502, error.code, 'La respuesta del proveedor superó el límite permitido');
    case 'AI_PROVIDER_FAILED':
      return new ApiError(502, error.code, 'El proveedor de IA falló al procesar la imagen');
  }
}

export function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ReceiptAiVerificationTimeoutError) {
    return new ApiError(
      504,
      error.code,
      'La verificación de IA del ticket superó el límite total de cinco minutos; el borrador se conserva',
    );
  }
  if (error instanceof ShoppingConflictError) {
    return new ApiError(409, 'SHOPPING_CONFLICT', 'La lista cambió en otro dispositivo', {
      kind: error.kind,
      current: error.current,
    });
  }
  if (error instanceof AiProviderError) return mapAiProviderError(error);
  if (error instanceof OcrError) return mapOcrError(error);
  if (error instanceof ValidationError || error instanceof RangeError) return new ApiError(400, 'VALIDATION_ERROR', error.message);
  if (error instanceof SyntaxError) return new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  if (error instanceof Error) {
    switch (error.message) {
      case 'SHOPPING_LIST_NOT_FOUND': return new ApiError(404, 'SHOPPING_LIST_NOT_FOUND', 'Shopping list was not found');
      case 'SHOPPING_LIST_ITEM_NOT_FOUND': return new ApiError(404, 'SHOPPING_LIST_ITEM_NOT_FOUND', 'Shopping list item was not found');
      case 'PRODUCT_CATEGORY_NOT_FOUND': return new ApiError(404, 'PRODUCT_CATEGORY_NOT_FOUND', 'Product category was not found');
      case 'CANONICAL_PRODUCT_NOT_FOUND': return new ApiError(404, 'CANONICAL_PRODUCT_NOT_FOUND', 'Canonical product was not found');
      case 'PRODUCT_VARIANT_NOT_FOUND': return new ApiError(404, 'PRODUCT_VARIANT_NOT_FOUND', 'Product variant was not found');
      case 'STORE_NOT_FOUND': return new ApiError(404, 'STORE_NOT_FOUND', 'Store was not found');
      case 'RECEIPT_STORE_REQUIRED': return new ApiError(400, 'VALIDATION_ERROR', 'A Store is required to confirm the receipt');
      case 'RECEIPT_STORE_NOT_FOUND': return new ApiError(400, 'VALIDATION_ERROR', 'Selected receipt Store was not found');
      case 'RECEIPT_STORE_RETAILER_REQUIRED': return new ApiError(400, 'VALIDATION_ERROR', 'A retailer is required when confirming a Store by name');
      case 'RECEIPT_STORE_RETAILER_MISMATCH': return new ApiError(400, 'VALIDATION_ERROR', 'Selected receipt Store belongs to another retailer');
      case 'RECEIPT_STORE_NAME_MISMATCH': return new ApiError(400, 'VALIDATION_ERROR', 'Selected receipt Store name does not match the saved Store');
      case 'REALTIME_CLIENT_LIMIT_REACHED': return new ApiError(503, 'REALTIME_CLIENT_LIMIT_REACHED', 'Realtime connection limit is temporarily reached');
      case 'OVERPASS_UNAVAILABLE': return new ApiError(502, 'NEARBY_STORE_PROVIDER_UNAVAILABLE', 'No se pudo consultar OpenStreetMap en este momento');
      case 'OVERPASS_RESPONSE_TOO_LARGE': return new ApiError(502, 'NEARBY_STORE_PROVIDER_RESPONSE_TOO_LARGE', 'La respuesta de OpenStreetMap superó el límite permitido');
      case 'OVERPASS_INVALID_RESPONSE': return new ApiError(502, 'NEARBY_STORE_PROVIDER_INVALID_RESPONSE', 'OpenStreetMap devolvió una respuesta no válida');
    }
  }
  const incidentId = reportUnexpectedError(error);
  return new ApiError(500, 'INTERNAL_ERROR', `An unexpected error occurred. Reference: ${incidentId}`);
}
