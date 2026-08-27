import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReceiptAiDiagnostic,
  buildReceiptAiRecovery,
} from '../../src/web/receipt-ai-recovery.js';

const expectedGuidance = new Map([
  ['AI_AUTHENTICATION_FAILED', 'token gestionado'],
  ['AI_UNREACHABLE', 'conectividad'],
  ['AI_TIMEOUT', 'webApi o el proveedor'],
  ['AI_RECEIPT_TIMEOUT', 'límite total de cinco minutos'],
  ['AI_RATE_LIMITED', 'límite de solicitudes'],
  ['AI_ATTACHMENT_TOO_LARGE', 'tamaño'],
  ['AI_ATTACHMENT_UPLOAD_FAILED', 'sesión de navegador'],
  ['AI_IMAGE_CAPABILITY_UNAVAILABLE', 'capacidad de imagen'],
  ['AI_PDF_CAPABILITY_UNAVAILABLE', 'capacidad PDF'],
  ['AI_REQUEST_REJECTED', 'modelo y el contrato'],
  ['AI_INVALID_RESPONSE', 'JSON Schema estricto'],
  ['AI_EMPTY_RESPONSE', 'respuesta estructurada'],
  ['AI_RESPONSE_TOO_LARGE', 'límite de respuesta'],
  ['AI_PROVIDER_FAILED', 'proveedor'],
]);

test('maps every stable AI failure to redacted actionable recovery', () => {
  for (const [code, guidance] of expectedGuidance) {
    const recovery = buildReceiptAiRecovery(
      { code, message: 'secret provider body must not leak' },
      { mimeType: 'image/png', hasOcrDraft: true },
    );

    assert.equal(recovery.retryLabel, 'Reintentar imagen');
    assert.equal(recovery.manualLabel, 'Revisar manualmente');
    assert.equal(recovery.allowManualReview, true);
    assert.match(recovery.message, new RegExp(guidance, 'u'));
    assert.match(recovery.message, /OCR de esta imagen se conserva localmente/u);
    assert.match(recovery.message, /no se considera un ticket estructurado válido/u);
    assert.doesNotMatch(recovery.message, /secret provider body/u);
    assert.doesNotMatch(recovery.message, /desactiva IA/u);
  }
});

test('builds diagnostics only from bounded correlation metadata', () => {
  const diagnostic = buildReceiptAiDiagnostic({
    code: 'AI_PROVIDER_FAILED',
    jobId: 'receiptextractionjob_diag123',
    requestId: '9712f274-bc37-4a8f-a383-a24162fc4e1e',
    status: 503,
    message: 'SECRET OCR PAN 1,50',
    details: { filename: 'private-ticket.jpeg', storageKey: 'secret-storage-key' },
  });

  assert.match(diagnostic, /code=AI_PROVIDER_FAILED/u);
  assert.match(diagnostic, /jobId=receiptextractionjob_diag123/u);
  assert.match(diagnostic, /requestId=9712f274-bc37-4a8f-a383-a24162fc4e1e/u);
  assert.match(diagnostic, /status=503/u);
  assert.doesNotMatch(diagnostic, /SECRET OCR/u);
  assert.doesNotMatch(diagnostic, /private-ticket/u);
  assert.doesNotMatch(diagnostic, /secret-storage-key/u);
});

test('drops malformed diagnostic identifiers instead of serializing arbitrary values', () => {
  const diagnostic = buildReceiptAiDiagnostic({
    code: 'AI_TIMEOUT',
    jobId: 'safe-id\nreceipt=secret',
    requestId: 'request id with spaces',
    status: 200,
  });

  assert.equal(diagnostic, 'Basketra receipt AI diagnostic\ncode=AI_TIMEOUT');
  assert.equal(buildReceiptAiDiagnostic({ code: 'OCR_TIMEOUT', jobId: 'safe-id' }), '');
});

test('supports blank manual review when no OCR draft exists', () => {
  const recovery = buildReceiptAiRecovery(
    { code: 'AI_NOT_CONFIGURED', message: 'raw configuration detail' },
    { mimeType: 'application/pdf', hasOcrDraft: false },
  );

  assert.equal(recovery.retryLabel, 'Reintentar imagen');
  assert.equal(recovery.allowManualReview, true);
  assert.match(recovery.message, /PDF/u);
  assert.match(recovery.message, /entrada manual desde cero/u);
  assert.doesNotMatch(recovery.message, /raw configuration detail/u);
});

test('uses generic redacted guidance for future AI codes', () => {
  const recovery = buildReceiptAiRecovery(
    { code: 'AI_FUTURE_FAILURE', message: 'upstream secret' },
    { mimeType: 'image/jpeg', hasOcrDraft: false },
  );

  assert.equal(recovery.allowManualReview, true);
  assert.match(recovery.message, /proveedor de IA/u);
  assert.match(recovery.message, /entrada manual desde cero/u);
  assert.doesNotMatch(recovery.message, /upstream secret/u);
});

test('keeps non-AI failures on the normal image retry path', () => {
  const recovery = buildReceiptAiRecovery(
    { code: 'OCR_TIMEOUT', message: 'El OCR local agotó el tiempo' },
    { mimeType: 'image/png', hasOcrDraft: false },
  );

  assert.equal(recovery.retryLabel, 'Reintentar imagen');
  assert.equal(recovery.manualLabel, 'Revisar manualmente');
  assert.equal(recovery.allowManualReview, false);
  assert.equal(recovery.message, 'El OCR local agotó el tiempo. Reintenta esta imagen o retírala del borrador.');
});

test('handles malformed errors and omitted options without exposing arbitrary values', () => {
  const malformed = buildReceiptAiRecovery(null, {
    mimeType: 'image/png',
    hasOcrDraft: false,
  });
  const omittedOptions = buildReceiptAiRecovery({ code: 42, message: 99 });

  assert.equal(malformed.allowManualReview, false);
  assert.equal(malformed.message, 'No se pudo procesar esta imagen. Reintenta esta imagen o retírala del borrador.');
  assert.equal(omittedOptions.allowManualReview, false);
  assert.equal(omittedOptions.message, 'No se pudo procesar esta imagen. Reintenta esta imagen o retírala del borrador.');
});
