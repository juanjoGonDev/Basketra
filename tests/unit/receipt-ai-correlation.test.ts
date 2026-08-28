import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReceiptAiDiagnostic } from '../../src/web/receipt-ai-recovery.js';

test('receipt AI diagnostic links Basketra and webApi durable identities', () => {
  const diagnostic = buildReceiptAiDiagnostic({
    code: 'AI_PROVIDER_FAILED',
    jobId: 'receiptextractionjob_diag123',
    webApiResponseId: 'resp_1234567',
    requestId: 'request_0f275854-0f51-4c63-9235-8976b0073c1a',
    status: 502,
    message: 'SECRET OCR MUST NOT LEAK',
  });

  assert.match(diagnostic, /jobId=receiptextractionjob_diag123/u);
  assert.match(diagnostic, /webApiResponseId=resp_1234567/u);
  assert.match(
    diagnostic,
    /requestId=request_0f275854-0f51-4c63-9235-8976b0073c1a/u,
  );
  assert.doesNotMatch(diagnostic, /SECRET OCR/u);
});

test('receipt AI diagnostic drops malformed webApi response identities', () => {
  const diagnostic = buildReceiptAiDiagnostic({
    code: 'AI_TIMEOUT',
    jobId: 'receiptextractionjob_diag123',
    webApiResponseId: 'resp_bad\nsecret=receipt',
  });

  assert.match(diagnostic, /jobId=receiptextractionjob_diag123/u);
  assert.doesNotMatch(diagnostic, /webApiResponseId/u);
  assert.doesNotMatch(diagnostic, /secret=receipt/u);
});
