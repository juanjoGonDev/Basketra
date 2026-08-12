import assert from 'node:assert/strict';
import test from 'node:test';

import { AiProviderError, type AiProviderErrorCode } from '../../src/ai/provider.ts';
import { mapError } from '../../src/api/errors.ts';

const cases: ReadonlyArray<readonly [AiProviderErrorCode, number, RegExp]> = [
  ['AI_ATTACHMENT_TOO_LARGE', 413, /tamaño/u],
  ['AI_ATTACHMENT_UPLOAD_FAILED', 504, /preparar la imagen/u],
  ['AI_AUTHENTICATION_FAILED', 502, /credenciales/u],
  ['AI_IMAGE_CAPABILITY_UNAVAILABLE', 422, /verificación de imágenes/u],
  ['AI_PDF_CAPABILITY_UNAVAILABLE', 422, /verificación de PDF/u],
  ['AI_RATE_LIMITED', 503, /limitando temporalmente/u],
  ['AI_REQUEST_REJECTED', 422, /solicitud multimodal/u],
  ['AI_TIMEOUT', 504, /tardó demasiado/u],
  ['AI_UNREACHABLE', 502, /conectar/u],
  ['AI_EMPTY_RESPONSE', 502, /vacía o no válida/u],
  ['AI_INVALID_RESPONSE', 502, /vacía o no válida/u],
  ['AI_MALFORMED_PROVIDER_RESPONSE', 502, /transporte no válida/u],
  ['AI_INVALID_STRUCTURED_OUTPUT', 502, /JSON estructurado no válido/u],
  ['AI_PROBE_TEXT_MISMATCH', 502, /leer correctamente/u],
  ['AI_RESPONSE_TOO_LARGE', 502, /límite permitido/u],
  ['AI_PROVIDER_FAILED', 502, /falló al procesar/u],
];

test('maps every stable AI provider code to an actionable redacted API error', () => {
  for (const [code, status, message] of cases) {
    const mapped = mapError(new AiProviderError(code, {
      status: 599,
      retryable: true,
    }));

    assert.equal(mapped.status, status);
    assert.equal(mapped.code, code);
    assert.match(mapped.message, message);
    assert.doesNotMatch(mapped.message, /599|private|provider body/u);
  }
});
