import { test, expect } from '@playwright/test';
import { installControlledEventSource } from './helpers/controlled-event-source.mjs';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

function localExtraction(text = 'PAN 1,50\nTOTAL 1,50') {
  const item = {
    description: 'PAN',
    quantity: 1,
    unitPriceMinor: 150,
    lineTotalMinor: 150,
    confidence: 0.8,
    categoryId: 'category_bakery',
    sourceLines: [1],
  };
  return {
    pages: [{ position: 0, source: 'local-tesseract', text, confidence: 0.8 }],
    originalText: text,
    deterministic: {
      items: [item],
      declaredTotalMinor: 150,
    },
    final: {
      items: [item],
      categories: [{ id: 'category_bakery', name: 'Panadería', color: '#A5662B' }],
      declaredTotalMinor: 150,
      warnings: [],
      review: {
        lines: [{
          ...item,
          status: 'confirmed',
          expectedMinor: 150,
          differenceMinor: 0,
        }],
        total: { expectedMinor: 150, differenceMinor: 0, valid: true },
      },
    },
  };
}

async function prepareReceipt(page, name = 'receipt.png', mimeType = 'image/png', buffer = validPng) {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await page.locator('#receipt-files').setInputFiles({ name, mimeType, buffer });
  await expect(page.locator('.capture-card')).toHaveCount(1);
}

test('completed PDF progress renders structured category lines without any OCR UI', async ({ page }) => {
  await installControlledEventSource(page);
  const pdf = Buffer.from('%PDF-1.4\nfixture');
  const interpretation = {
    currency: 'EUR',
    correctedText: 'BANANA 1,37',
    items: [{
      description: 'BANANA',
      quantity: 1,
      unitPriceMinor: 137,
      lineTotalMinor: 137,
      confidence: 0.98,
      categoryId: 'category_fruit',
      sourceLines: [1],
    }],
    newCategories: [],
    warnings: [],
  };

  await page.route('**/api/v1/receipts/extraction-jobs', route => route.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'receiptextractionjob_pdfprogress', status: 'queued' } }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_pdfprogress', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: {
        id: 'receiptextractionjob_pdfprogress',
        status: 'running',
        progress: {
          phase: 'ai_running',
          pages: [{
            position: 0,
            stage: 'completed',
            ocr: { text: '', confidence: 0, source: 'provider', deterministic: { items: [], metadata: {} } },
            interpretation,
          }],
        },
      },
    }),
  }));

  await prepareReceipt(page, 'receipt.pdf', 'application/pdf', pdf);
  await page.evaluate(async () => {
    const [{ state }, { renderProgressiveDetectedItems }] = await Promise.all([
      import('/receipt-state.js'),
      import('/receipt-capture.js'),
    ]);
    state.receiptCategories = [{ id: 'category_fruit', name: 'Fruta', color: '#32A852' }];
    renderProgressiveDetectedItems();
  });

  await expect(page.locator('#receipt-detected-list')).toContainText('BANANA');
  await expect(page.locator('#receipt-detected-list .receipt-detected-item__category')).toHaveText('Fruta');
  await expect(page.locator('#receipt-detected-list .receipt-detected-item__category-swatch')).toBeVisible();
  await expect(page.locator('#receipt-state')).not.toContainText('OCR');

  const queue = page.locator('#receipt-source-queue');
  await queue.locator(':scope > summary').click();
  const card = queue.locator('.capture-card');
  await expect(card).not.toContainText('OCR');
  await expect(card.locator('.capture-card__ocr-preview')).toHaveCount(0);
  await expect(card.locator('.capture-card__details')).not.toHaveAttribute('open', '');
});

test('focused ticket validation keeps review in the list and opens the original PDF evidence', async ({ page }) => {
  await installControlledEventSource(page);
  const pdf = Buffer.from('%PDF-1.4\nfixture');
  let lineValidationRequests = 0;

  await page.route('**/api/v1/receipts/extraction-jobs', route => route.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'receiptextractionjob_focused', status: 'queued' } }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_focused', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'receiptextractionjob_focused', status: 'completed', extraction: localExtraction() } }),
  }));
  await page.route('**/api/v1/receipts/validate', route => {
    lineValidationRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        lines: [{ validation: { status: 'confirmed', expectedMinor: 150, differenceMinor: 0 } }],
        total: { expectedMinor: 150, differenceMinor: 0, valid: true },
      }),
    });
  });
  await page.route('**/api/v1/files/**/document', route => route.fulfill({
    status: 200,
    contentType: 'application/pdf',
    body: pdf,
    headers: { 'cache-control': 'private, no-store, max-age=0', 'content-disposition': 'inline' },
  }));

  await prepareReceipt(page, 'focused.pdf', 'application/pdf', pdf);

  await expect(page.locator('#receipt-review-panel')).toBeHidden();
  await expect(page.locator('#receipt-detected-list')).toContainText('PAN');
  const lineLayout = await page.locator('#receipt-detected-list .receipt-detected-item').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const copy = element.querySelector('.receipt-detected-item__copy').getBoundingClientRect();
    const amount = element.querySelector('.receipt-detected-item__amount').getBoundingClientRect();
    return { height: rect.height, copyTop: copy.top, amountTop: amount.top };
  });
  expect(lineLayout.height).toBeLessThanOrEqual(48);
  expect(Math.abs(lineLayout.copyTop - lineLayout.amountTop)).toBeLessThanOrEqual(8);
  await expect(page.locator('#receipt-detected-list .receipt-detected-item .icon')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Validar ticket', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver comprobante', exact: true })).toBeVisible();
  await expect(page.locator('#confirm-receipt')).toBeVisible();

  await page.getByRole('button', { name: /Editar producto 1/u }).click();
  await expect(page.locator('#receipt-line-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Validar línea', exact: true }).click();
  await expect(page.locator('#receipt-line-dialog dialog')).toBeHidden();
  await expect.poll(() => lineValidationRequests).toBe(1);

  await page.getByRole('button', { name: 'Ver comprobante', exact: true }).click();
  await expect(page.locator('#receipt-evidence-dialog')).toBeVisible();
  await expect(page.locator('#receipt-evidence-content iframe')).toHaveAttribute('src', /\/api\/v1\/files\/.+\/document$/);
});

test('AI-enabled automatic analysis uses one whole-ticket durable job and no browser OCR request', async ({ page }) => {
  await installControlledEventSource(page);
  let directExtractionRequests = 0;
  let jobCreates = 0;

  await page.route('**/api/v1/receipts/extract', route => {
    directExtractionRequests += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'LEGACY_EXTRACTION_MUST_NOT_RUN' } }) });
  });
  await page.route('**/api/v1/receipts/extraction-jobs', route => {
    jobCreates += 1;
    const body = route.request().postDataJSON();
    expect(body.verifyWithAi).toBe(true);
    expect(body.captures).toHaveLength(1);
    expect(body.captures[0]).not.toHaveProperty('embeddedText');
    return route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: 'receiptextractionjob_async1', status: 'queued' } }),
    });
  });
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_async1', route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: 'receiptextractionjob_async1', status: 'completed', extraction: localExtraction() } }),
    });
  });

  await prepareReceipt(page);

  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('#receipt-detected-list .receipt-detected-item__category')).toHaveText('Panadería');
  expect(jobCreates).toBe(1);
  expect(directExtractionRequests).toBe(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.receiptExtractionJobId'))).toBeNull();
});

test('AI job state is recovered on realtime reconnect without interval polling', async ({ page }) => {
  await installControlledEventSource(page);
  let jobStatus = 'running';
  let statusReads = 0;

  await page.route('**/api/v1/receipts/extract', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'LEGACY_EXTRACTION_MUST_NOT_RUN' } }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs', route => route.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'receiptextractionjob_reconnect', status: 'queued' } }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_reconnect', route => {
    statusReads += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        job: jobStatus === 'completed'
          ? { id: 'receiptextractionjob_reconnect', status: 'completed', extraction: localExtraction() }
          : { id: 'receiptextractionjob_reconnect', status: 'running' },
      }),
    });
  });

  await prepareReceipt(page, 'reconnect.png');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Verificando con IA');
  expect(statusReads).toBe(1);

  jobStatus = 'completed';
  await page.evaluate(() => window.__receiptEventSources.at(-1).emit('open'));
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  expect(statusReads).toBe(2);
});

test('cancelling during durable job creation deletes the late-created job without replaying work', async ({ page }) => {
  await installControlledEventSource(page);
  let jobCreates = 0;
  let jobDeletes = 0;
  let releaseCreation = () => {};
  const creationResponseGate = new Promise(resolve => { releaseCreation = resolve; });

  await page.route('**/api/v1/receipts/extract', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'LEGACY_EXTRACTION_MUST_NOT_RUN' } }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs', async route => {
    jobCreates += 1;
    await creationResponseGate;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: 'receiptextractionjob_cancel', status: 'queued' } }),
    }).catch(() => {});
  });
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_cancel', route => {
    if (route.request().method() === 'DELETE') {
      jobDeletes += 1;
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: 'receiptextractionjob_cancel', status: 'running' } }),
    });
  });

  await prepareReceipt(page, 'cancel-during-create.png');
  await expect.poll(() => jobCreates).toBe(1);
  await page.locator('#receipt-source-queue > summary').click();
  await page.getByRole('button', { name: 'Cancelar todo el análisis', exact: true }).click();
  releaseCreation();

  await expect.poll(() => jobDeletes).toBe(1);
  expect(jobCreates).toBe(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.receiptExtractionJobId'))).toBeNull();
});

test('failed durable AI job exposes a copyable redacted diagnostic', async ({ page }) => {
  await installControlledEventSource(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => { window.__copiedReceiptDiagnostic = text; } },
    });
  });
  const secretOcr = 'PRIVATE OCR CONTENT 998877';
  const secretFilename = 'private-household-receipt.png';

  await page.route('**/api/v1/receipts/extract', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: secretOcr } }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs', route => route.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'receiptextractionjob_diag123', status: 'queued' } }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_diag123', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'receiptextractionjob_diag123', status: 'failed', errorCode: 'AI_PROVIDER_FAILED' } }),
  }));

  await prepareReceipt(page, secretFilename);

  const queue = page.locator('#receipt-source-queue');
  if (!(await queue.evaluate(element => element.open))) {
    await queue.locator(':scope > summary').click();
  }
  const details = page.locator('.capture-card__details').first();
  if (!(await details.evaluate(element => element.open))) {
    await details.locator(':scope > summary').click();
  }
  await expect(details.getByRole('button', { name: 'Copiar diagnóstico', exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Copiar diagnóstico', exact: true }).click();
  const diagnostic = await page.evaluate(() => window.__copiedReceiptDiagnostic);
  expect(diagnostic).toContain('AI_PROVIDER_FAILED');
  expect(diagnostic).toContain('receiptextractionjob_diag123');
  expect(diagnostic).not.toContain(secretOcr);
  expect(diagnostic).not.toContain(secretFilename);
});

test('durable PDF queue labels distinguish submitted, queued and provider-running work', async ({ page }) => {
  await installControlledEventSource(page);
  const pdf = Buffer.from('%PDF-1.4\nfixture');
  const jobId = 'receiptextractionjob_labelsync';
  let releaseCreate = () => {};
  let releaseRead = () => {};
  const createGate = new Promise(resolve => { releaseCreate = resolve; });
  const readGate = new Promise(resolve => { releaseRead = resolve; });
  let jobReads = 0;

  await page.route('**/api/v1/receipts/extraction-jobs', async route => {
    await createGate;
    return route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: jobId, status: 'queued' } }),
    });
  });
  await page.route(`**/api/v1/receipts/extraction-jobs/${jobId}`, async route => {
    jobReads += 1;
    await readGate;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: jobId, status: 'running' } }),
    });
  });

  await prepareReceipt(page, 'label-sync.pdf', 'application/pdf', pdf);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Enviando a IA');
  releaseCreate();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('En cola IA');
  await expect.poll(() => jobReads).toBe(1);
  releaseRead();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Analizando con IA');
});

test('a new upload during durable job submission restarts the current batch and retires the stale job', async ({ page }) => {
  await installControlledEventSource(page);
  const submittedJobs = [];
  const jobDeletes = [];
  let releaseFirstCreate = () => {};
  let releaseSecondCreate = () => {};
  const firstCreateGate = new Promise(resolve => { releaseFirstCreate = resolve; });
  const secondCreateGate = new Promise(resolve => { releaseSecondCreate = resolve; });

  await page.route('**/api/v1/receipts/extraction-jobs', async route => {
    const index = submittedJobs.length + 1;
    submittedJobs.push(route.request().postDataJSON());
    await (index === 1 ? firstCreateGate : secondCreateGate);
    return route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: `receiptextractionjob_restart_${index}`, status: 'running' } }),
    });
  });
  await page.route(/\/api\/v1\/receipts\/extraction-jobs\/receiptextractionjob_restart_\d+$/, route => {
    const jobId = route.request().url().split('/').at(-1);
    if (route.request().method() === 'DELETE') {
      jobDeletes.push(jobId);
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: jobId, status: 'running' } }),
    });
  });

  await prepareReceipt(page, 'first-pending.png');
  await expect.poll(() => submittedJobs.length).toBe(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Enviando a IA');

  await page.locator('#receipt-files').setInputFiles({
    name: 'second-current.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([validPng, Buffer.from([2])]),
  });
  await expect.poll(() => submittedJobs.length).toBe(2);
  expect(submittedJobs[1].captures.map(capture => capture.originalName)).toEqual(['first-pending.png', 'second-current.png']);

  releaseSecondCreate();
  await expect(page.locator('.capture-card .status-pill')).toHaveText(['Verificando con IA', 'Verificando con IA']);
  releaseFirstCreate();
  await expect.poll(() => jobDeletes).toEqual(['receiptextractionjob_restart_1']);
  await expect(page.locator('.capture-card .status-pill')).toHaveText(['Verificando con IA', 'Verificando con IA']);
});

test('a cancelled durable submission cannot revive old captures after a later upload', async ({ page }) => {
  await installControlledEventSource(page);
  const submittedJobs = [];
  const jobDeletes = [];
  let releaseFirstCreate = () => {};
  let releaseSecondCreate = () => {};
  const firstCreateGate = new Promise(resolve => { releaseFirstCreate = resolve; });
  const secondCreateGate = new Promise(resolve => { releaseSecondCreate = resolve; });

  await page.route('**/api/v1/receipts/extraction-jobs', async route => {
    const index = submittedJobs.length + 1;
    submittedJobs.push(route.request().postDataJSON());
    await (index === 1 ? firstCreateGate : secondCreateGate);
    return route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: `receiptextractionjob_cancel_restart_${index}`, status: 'running' } }),
    });
  });
  await page.route(/\/api\/v1\/receipts\/extraction-jobs\/receiptextractionjob_cancel_restart_\d+$/, route => {
    const jobId = route.request().url().split('/').at(-1);
    if (route.request().method() === 'DELETE') {
      jobDeletes.push(jobId);
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: jobId, status: 'running' } }),
    });
  });

  await prepareReceipt(page, 'cancelled-before-id.png');
  await expect.poll(() => submittedJobs.length).toBe(1);
  const queue = page.locator('#receipt-source-queue');
  if (!(await queue.evaluate(element => element.open))) await queue.locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Cancelar todo el análisis', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');

  await page.locator('#receipt-files').setInputFiles({
    name: 'after-cancel.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([validPng, Buffer.from([3])]),
  });
  await expect.poll(() => submittedJobs.length).toBe(2);
  expect(submittedJobs[1].captures.map(capture => capture.originalName)).toEqual(['after-cancel.png']);

  releaseSecondCreate();
  await expect(page.locator('.capture-card .status-pill')).toHaveText(['Cancelada', 'Verificando con IA']);
  releaseFirstCreate();
  await expect.poll(() => jobDeletes).toEqual(['receiptextractionjob_cancel_restart_1']);
  await expect(page.locator('.capture-card .status-pill')).toHaveText(['Cancelada', 'Verificando con IA']);
});

function completedExtraction(description, lineTotalMinor) {
  const result = localExtraction(`${description} ${lineTotalMinor / 100}\nTOTAL ${lineTotalMinor / 100}`);
  const item = {
    ...result.final.items[0],
    description,
    unitPriceMinor: lineTotalMinor,
    lineTotalMinor,
  };
  result.deterministic.items = [item];
  result.deterministic.declaredTotalMinor = lineTotalMinor;
  result.final.items = [item];
  result.final.declaredTotalMinor = lineTotalMinor;
  result.final.review = {
    lines: [{ ...item, status: 'confirmed', expectedMinor: lineTotalMinor, differenceMinor: 0 }],
    total: { expectedMinor: lineTotalMinor, differenceMinor: 0, valid: true },
  };
  return result;
}

test('a later upload keeps the completed receipt visible and queues only the new capture', async ({ page }) => {
  await installControlledEventSource(page);
  const submittedJobs = [];
  await page.route('**/api/v1/receipts/extraction-jobs', async route => {
    submittedJobs.push(route.request().postDataJSON());
    const index = submittedJobs.length;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: `receiptextractionjob_sequential_${index}`, status: 'queued' } }),
    });
  });
  await page.route(/\/api\/v1\/receipts\/extraction-jobs\/receiptextractionjob_sequential_\d+$/, route => {
    const jobId = route.request().url().split('/').at(-1);
    const first = jobId === 'receiptextractionjob_sequential_1';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: first
        ? { id: jobId, status: 'completed', extraction: completedExtraction('PRIMER TICKET', 150) }
        : { id: jobId, status: 'queued' },
      }),
    });
  });

  await prepareReceipt(page, 'first-completed.png');
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/receipt-state.js');
    return state.activeJobId;
  })).toBe('');
  await expect(page.locator('#receipt-detected-list')).toContainText('PRIMER TICKET');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect.poll(() => submittedJobs.length).toBe(1);

  await page.locator('#receipt-files').setInputFiles({
    name: 'second-queued.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([validPng, Buffer.from([2])]),
  });

  await expect.poll(() => submittedJobs.length).toBe(2);
  expect(submittedJobs[1].captures.map(capture => capture.originalName)).toEqual(['second-queued.png']);
  await expect(page.locator('.capture-card')).toHaveCount(2);
  await expect(page.locator('.capture-card').first().locator('.status-pill')).toHaveText('Completada');
  await expect(page.locator('.capture-card').nth(1).locator('.status-pill')).toHaveText(/Preparando imagen|Pendiente|En cola IA/u);
  await expect(page.locator('#receipt-detected-list')).toContainText('PRIMER TICKET');
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/receipt-state.js');
    return state.receiptDrafts.map(draft => ({ key: draft.key, items: draft.items.map(item => item.description) }));
  })).toEqual([{ key: expect.any(String), items: ['PRIMER TICKET'] }]);
});

test('retrying a cancelled PDF starts another durable AI job without local OCR', async ({ page }) => {
  await installControlledEventSource(page);
  const submittedJobs = [];
  let localOcrRequests = 0;
  await page.route('**/api/v1/receipts/extract', route => {
    localOcrRequests += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'OCR_MUST_NOT_RUN_FOR_PDF' } }) });
  });
  await page.route('**/api/v1/receipts/extraction-jobs', route => {
    submittedJobs.push(route.request().postDataJSON());
    const jobId = `receiptextractionjob_retry_pdf_${submittedJobs.length}`;
    return route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: jobId, status: 'queued' } }),
    });
  });
  await page.route(/\/api\/v1\/receipts\/extraction-jobs\/receiptextractionjob_retry_pdf_\d+$/, route => {
    const jobId = route.request().url().split('/').at(-1);
    const completed = jobId.endsWith('_2');
    if (route.request().method() === 'DELETE') return route.fulfill({ status: 204, body: '' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: completed
        ? { id: jobId, status: 'completed', extraction: completedExtraction('PDF REINTENTADO', 150) }
        : { id: jobId, status: 'running' },
      }),
    });
  });

  await prepareReceipt(page, 'cancelled.pdf', 'application/pdf', Buffer.from('%PDF-1.4\nfixture'));
  await expect(page.locator('.capture-card .status-pill')).toHaveText(/En cola IA|Analizando con IA/u);
  const queue = page.locator('#receipt-source-queue');
  if (!(await queue.evaluate(element => element.open))) await queue.locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Cancelar todo el análisis', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  const cancelledDetails = page.locator('.capture-card__details').first();
  if (!(await cancelledDetails.evaluate(element => element.open))) {
    await cancelledDetails.locator(':scope > summary').click();
  }

  await page.getByRole('button', { name: 'Reintentar PDF', exact: true }).click();
  await expect.poll(() => submittedJobs.length).toBe(2);
  expect(submittedJobs[1].captures.map(capture => capture.originalName)).toEqual(['cancelled.pdf']);
  expect(localOcrRequests).toBe(0);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('#receipt-detected-list')).toContainText('PDF REINTENTADO');
  await expect(page.locator('#receipt-source-queue')).not.toContainText('OCR');
});
