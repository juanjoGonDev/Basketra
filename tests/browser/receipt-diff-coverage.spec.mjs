import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);
const distinctPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);
const minimalPdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

function item(description = 'PAN', storageKey = '', overrides = {}) {
  return {
    description,
    quantity: 1,
    unitPriceMinor: 120,
    lineTotalMinor: 120,
    confidence: 0.9,
    sourceLines: [1],
    ...(storageKey ? { captureStorageKey: storageKey } : {}),
    ...overrides,
  };
}

function review(items, total = 120) {
  return {
    lines: items.map(entry => ({
      ...entry,
      status: 'confirmed',
      expectedMinor: entry.lineTotalMinor,
      differenceMinor: 0,
    })),
    total: { expectedMinor: total, differenceMinor: 0, valid: true },
  };
}

function pageEvidence(storageKey, {
  items = [item('PAN', storageKey)],
  lines = [{ index: 1, text: 'PAN 1,20', confidence: 0.9 }],
  metadata = { declaredTotalMinor: 120 },
  aiFailure = false,
  ai,
  mimeType = 'image/png',
  text = 'PAN 1,20\nTOTAL 1,20',
} = {}) {
  return {
    position: 0,
    storageKey,
    mimeType,
    text,
    confidence: 0.9,
    source: 'local-tesseract',
    lines,
    deterministic: { items, metadata },
    ...(aiFailure ? { aiFailure: { code: 'AI_UNREACHABLE' } } : {}),
    ...(ai ? { ai } : {}),
  };
}

function extractionFromEvidence(evidence, {
  finalItems = evidence?.deterministic?.items ?? [],
  total = evidence?.deterministic?.metadata?.declaredTotalMinor ?? 120,
  pages = evidence ? [evidence] : [],
  originalText = evidence?.text ?? 'PAN 1,20\nTOTAL 1,20',
} = {}) {
  return {
    pages,
    originalText,
    deterministic: {
      items: finalItems,
      ...(Number.isSafeInteger(total) ? { declaredTotalMinor: total } : {}),
    },
    final: {
      items: finalItems,
      ...(Number.isSafeInteger(total) ? { declaredTotalMinor: total } : {}),
      warnings: evidence?.aiFailure ? ['AI unavailable'] : [],
      review: review(finalItems, Number.isSafeInteger(total) ? total : 0),
    },
  };
}

async function upload(page, name, buffer = validPng, mimeType = 'image/png') {
  await page.locator('#receipt-files').setInputFiles({ name, mimeType, buffer });
}

async function installAssembly(page, getStorageKey, description = 'PAN') {
  await page.route('**/api/v1/receipts/extract', route => {
    const storageKey = getStorageKey();
    const assembledItem = item(description, storageKey);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: extractionFromEvidence(pageEvidence(storageKey), { finalItems: [assembledItem] }) }),
    });
  });
}

async function installInitialAiWarning(page, state, { empty = false } = {}) {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    if (method === 'POST' && url.pathname === '/api/v1/receipts/extraction-jobs') {
      state.posts += 1;
      const body = route.request().postDataJSON();
      state.storageKey ||= body.captures[0].storageKey;
      const id = state.posts === 1 ? 'receiptextractionjob_warningbase' : 'receiptextractionjob_warningretry';
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ job: { id, status: 'queued' } }),
      });
    }
    if (method === 'GET' && url.pathname.endsWith('receiptextractionjob_warningbase')) {
      const deterministicItems = empty ? [] : [item('PAN', state.storageKey)];
      const evidence = pageEvidence(state.storageKey, { items: deterministicItems, aiFailure: true });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job: {
            id: 'receiptextractionjob_warningbase',
            status: 'completed',
            extraction: extractionFromEvidence(evidence, { finalItems: deterministicItems }),
          },
        }),
      });
    }
    return route.fallback();
  });
  if (empty) {
    await page.route('**/api/v1/receipts/extract', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: extractionFromEvidence(pageEvidence(state.storageKey, { items: [] }), { finalItems: [] }) }),
    }));
  } else {
    await installAssembly(page, () => state.storageKey);
  }
}

test('idle capture controls reorder, preview and remove failed drafts without losing the remaining capture', async ({ page }) => {
  let jobs = 0;
  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    const method = route.request().method();
    if (method === 'POST') {
      jobs += 1;
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ job: { id: `receiptextractionjob_idle${jobs}` } }),
      });
    }
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id, status: 'failed', errorCode: 'OCR_LOCAL_PROCESS_FAILED' } }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await upload(page, 'first.png', validPng);
  await expect(page.locator('.capture-card').filter({ hasText: 'first.png' }).locator('.status-pill')).toHaveText('Error');
  await upload(page, 'second.png', distinctPng);
  await expect(page.locator('.capture-card').filter({ hasText: 'second.png' }).locator('.status-pill')).toHaveText('Error');

  await page.getByRole('button', { name: 'Subir second.png', exact: true }).click();
  await expect(page.locator('.capture-card').first()).toContainText('second.png');
  await page.getByRole('button', { name: 'Bajar second.png', exact: true }).click();
  await expect(page.locator('.capture-card').first()).toContainText('first.png');

  await page.getByRole('button', { name: 'Ampliar first.png', exact: true }).click();
  await expect(page.locator('#capture-preview-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar vista previa', exact: true }).click();

  await page.getByRole('button', { name: 'Retirar first.png del borrador', exact: true }).click();
  await expect(page.locator('.capture-card')).toHaveCount(1);
  await expect(page.locator('.capture-card')).toContainText('second.png');

  await page.locator('#capture-list').evaluate(list => {
    for (const action of ['up', 'down', 'delete']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.captureAction = action;
      button.dataset.captureIndex = '99';
      button.textContent = `stale-${action}`;
      list.append(button);
    }
  });
  for (const action of ['up', 'down', 'delete']) {
    await page.getByRole('button', { name: `stale-${action}`, exact: true }).click();
  }
  await expect(page.locator('.capture-card')).toHaveCount(1);
});

test('an invalid edited review row blocks automatic refresh without throwing when another capture arrives', async ({ page }) => {
  let storageKey = '';
  let counter = 0;
  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    const method = route.request().method();
    if (method === 'POST') {
      counter += 1;
      const body = route.request().postDataJSON();
      storageKey = body.captures[0].storageKey;
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ job: { id: `receiptextractionjob_invalid${counter}` } }),
      });
    }
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    const current = item(counter === 1 ? 'PAN' : 'LECHE', storageKey);
    const evidence = pageEvidence(storageKey, { items: [current] });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id, status: 'completed', extraction: extractionFromEvidence(evidence, { finalItems: [current] }) } }),
    });
  });
  await installAssembly(page, () => storageKey);

  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/');
  await navigate(page, 'Tickets');
  await upload(page, 'review-one.png', validPng);
  await expect(page.locator('.receipt-item')).toHaveCount(1);
  await page.locator('.receipt-item').first().locator('[data-field="unitPriceEuro"]').evaluate(input => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await upload(page, 'review-two.png', distinctPng);
  await expect(page.locator('.capture-card')).toHaveCount(2);
  expect(pageErrors).toEqual([]);
});

test('an active AI-only retry can be cancelled even when the cancellation response is lost', async ({ page }) => {
  const state = { posts: 0, storageKey: '' };
  await installInitialAiWarning(page, state);
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_warningretry', route => {
    if (route.request().method() === 'DELETE') {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEMPORARY' } }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: 'receiptextractionjob_warningretry', status: 'running' } }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await upload(page, 'retry-cancel.png');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('OCR listo · IA pendiente');
  await page.getByRole('tab', { name: 'Capturas', exact: true }).click();
  await page.getByRole('button', { name: 'Reintentar IA', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancelar reintento de IA', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar reintento de IA', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('OCR listo · IA pendiente');
  await expect(page.locator('#receipt-state')).toContainText('OCR se conserva');
});

test('a failed AI-only retry preserves OCR rows and exposes another retry', async ({ page }) => {
  const state = { posts: 0, storageKey: '' };
  await installInitialAiWarning(page, state);
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_warningretry', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'receiptextractionjob_warningretry', status: 'failed', errorCode: 'AI_UNREACHABLE' } }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await upload(page, 'retry-failure.png');
  await page.getByRole('tab', { name: 'Capturas', exact: true }).click();
  await page.getByRole('button', { name: 'Reintentar IA', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('OCR listo · IA pendiente');
  await expect(page.getByRole('button', { name: 'Reintentar IA', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Revisión', exact: true }).click();
  await expect(page.locator('.receipt-line-compact')).toContainText('PAN');
});

test('a provider-cancelled AI-only retry returns to the OCR warning state', async ({ page }) => {
  const state = { posts: 0, storageKey: '' };
  await installInitialAiWarning(page, state);
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_warningretry', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'receiptextractionjob_warningretry', status: 'cancelled' } }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await upload(page, 'retry-provider-cancel.png');
  await page.getByRole('tab', { name: 'Capturas', exact: true }).click();
  await page.getByRole('button', { name: 'Reintentar IA', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('OCR listo · IA pendiente');
  await expect(page.getByRole('button', { name: 'Reintentar IA', exact: true })).toBeVisible();
});

test('manual review from an OCR warning creates an evidence-linked blank row when no item was detected', async ({ page }) => {
  const state = { posts: 0, storageKey: '' };
  await installInitialAiWarning(page, state, { empty: true });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await upload(page, 'blank-review.png');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('OCR listo · IA pendiente');
  await page.getByRole('tab', { name: 'Capturas', exact: true }).click();
  await page.getByRole('button', { name: 'Revisar manualmente', exact: true }).click();
  const compactRow = page.locator('.receipt-line-compact').first();
  await expect(compactRow).toBeVisible();
  await compactRow.click();
  const dialog = page.locator('#receipt-line-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-field="description"]')).toHaveValue('');
  await expect(dialog.locator('.receipt-line-evidence')).toBeVisible();
  await expect(dialog.locator('.receipt-line-evidence img')).toHaveAttribute('src', new RegExp(`/api/v1/files/${state.storageKey}`));
});

test('receipt evidence derives a source region when possible and degrades without inventing one', async ({ page }) => {
  let storageKey = '';
  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    if (route.request().method() === 'POST') {
      storageKey = route.request().postDataJSON().captures[0].storageKey;
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ job: { id: 'receiptextractionjob_regions' } }),
      });
    }
    const items = [
      item('PAN', storageKey, { sourceLines: [1, 2] }),
      item('LECHE', storageKey, { sourceLines: [99], unitPriceMinor: 80, lineTotalMinor: 80 }),
    ];
    const evidence = pageEvidence(storageKey, {
      items,
      metadata: { declaredTotalMinor: 200 },
      lines: [
        { index: 1, text: 'PAN', confidence: 0.8, region: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 } },
        { index: 2, text: '1,20', confidence: 0.9, region: { x: 0.6, y: 0.2, width: 0.2, height: 0.05 } },
      ],
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: 'receiptextractionjob_regions', status: 'completed', extraction: extractionFromEvidence(evidence, { finalItems: items, total: 200 }) } }),
    });
  });
  await page.route('**/api/v1/receipts/extract', route => {
    const items = [
      item('PAN', storageKey, {
        sourceLines: [1, 2],
        sourceRegion: { x: 0.1, y: 0.2, width: 0.7, height: 0.05 },
      }),
      item('LECHE', storageKey, { sourceLines: [99], unitPriceMinor: 80, lineTotalMinor: 80 }),
    ];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: extractionFromEvidence(pageEvidence(storageKey, { items, metadata: { declaredTotalMinor: 200 } }), { finalItems: items, total: 200 }) }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await upload(page, 'regions.png');
  await expect(page.locator('.receipt-item')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Revisión', exact: true }).click();
  const rows = page.locator('.receipt-line-compact');
  await rows.first().click();
  const dialog = page.locator('#receipt-line-dialog');
  await expect(dialog.locator('.receipt-line-evidence__region')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await rows.nth(1).click();
  await expect(dialog.locator('.receipt-line-evidence__region')).toHaveCount(0);
});

test('PDF review keeps the original document as textual evidence without an image region', async ({ page }) => {
  const storageKey = `${'b'.repeat(64)}.pdf`;
  await page.route('**/api/v1/files', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ file: { mimeType: 'application/pdf', bytes: minimalPdf.length, storageKey, hash: 'b'.repeat(64) } }),
    });
  });
  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ job: { id: 'receiptextractionjob_pdfcoverage' } }) });
    }
    const pdfItem = item('PAN', storageKey, { sourceLines: undefined });
    const evidence = pageEvidence(storageKey, { items: [pdfItem], mimeType: 'application/pdf', lines: undefined });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: 'receiptextractionjob_pdfcoverage', status: 'completed', extraction: extractionFromEvidence(evidence, { finalItems: [pdfItem] }) } }),
    });
  });
  await page.route('**/api/v1/receipts/extract', route => {
    const pdfItem = item('PAN', storageKey, { sourceLines: undefined });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: extractionFromEvidence(pageEvidence(storageKey, { items: [pdfItem], mimeType: 'application/pdf' }), { finalItems: [pdfItem] }) }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await upload(page, 'evidence.pdf', minimalPdf, 'application/pdf');
  await expect(page.locator('.receipt-item')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Revisión', exact: true }).click();
  await page.locator('.receipt-line-compact').first().click();
  const dialog = page.locator('#receipt-line-dialog');
  await expect(dialog.getByText('El PDF original se conserva como evidencia de esta línea.')).toBeVisible();
  await expect(dialog.locator('.receipt-line-evidence__region')).toHaveCount(0);
});

test('a legacy persisted job is migrated to the multi-job model and refreshed', async ({ page }) => {
  const hash = 'c'.repeat(64);
  const storageKey = `${hash}.png`;
  let reads = 0;
  await page.addInitScript(({ hash, storageKey }) => {
    localStorage.setItem('basketra.captures', JSON.stringify([{
      name: 'legacy.png', mimeType: 'image/png', bytes: 12, storageKey, contentHash: hash,
    }]));
    localStorage.setItem('basketra.receiptExtractionJobId', 'receiptextractionjob_legacycoverage');
    localStorage.removeItem('basketra.receiptExtractionJobs');
  }, { hash, storageKey });
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_legacycoverage', route => {
    reads += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: 'receiptextractionjob_legacycoverage', status: 'running' } }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Procesando');
  const stored = await page.evaluate(() => ({
    legacy: localStorage.getItem('basketra.receiptExtractionJobId'),
    jobs: localStorage.getItem('basketra.receiptExtractionJobs'),
  }));
  expect(stored.legacy).toBeNull();
  expect(stored.jobs).toContain('receiptextractionjob_legacycoverage');
});

test('an untracked persisted capture starts a fresh automatic job during restore', async ({ page }) => {
  const hash = 'd'.repeat(64);
  const storageKey = `${hash}.png`;
  let submission;
  await page.addInitScript(({ hash, storageKey }) => {
    localStorage.setItem('basketra.captures', JSON.stringify([{
      name: 'untracked.png', mimeType: 'image/png', bytes: 12, storageKey, contentHash: hash,
    }]));
    localStorage.removeItem('basketra.receiptExtractionJobId');
    localStorage.removeItem('basketra.receiptExtractionJobs');
  }, { hash, storageKey });
  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    if (route.request().method() === 'POST') {
      submission = route.request().postDataJSON();
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ job: { id: 'receiptextractionjob_untracked' } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: { id: 'receiptextractionjob_untracked', status: 'queued' } }) });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await expect.poll(() => submission?.captures?.[0]?.storageKey).toBe(storageKey);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('En cola');
});

test('a multi-capture completion tolerates one missing page evidence and assembles from the available OCR', async ({ page }) => {
  const firstHash = 'e'.repeat(64);
  const secondHash = 'f'.repeat(64);
  const firstKey = `${firstHash}.png`;
  const secondKey = `${secondHash}.png`;
  await page.addInitScript(({ firstHash, secondHash, firstKey, secondKey }) => {
    localStorage.setItem('basketra.captures', JSON.stringify([
      { name: 'first-restored.png', mimeType: 'image/png', bytes: 12, storageKey: firstKey, contentHash: firstHash },
      { name: 'second-restored.png', mimeType: 'image/png', bytes: 12, storageKey: secondKey, contentHash: secondHash },
    ]));
    localStorage.setItem('basketra.receiptExtractionJobs', JSON.stringify([{
      id: 'receiptextractionjob_missingpage',
      captureKeys: [firstKey, secondKey],
      status: 'running',
      mode: 'full',
    }]));
  }, { firstHash, secondHash, firstKey, secondKey });

  const firstItem = item('PAN', firstKey);
  const evidence = pageEvidence(firstKey, { items: [firstItem] });
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_missingpage', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: {
        id: 'receiptextractionjob_missingpage',
        status: 'completed',
        extraction: extractionFromEvidence(evidence, { finalItems: [firstItem], pages: [evidence] }),
      },
    }),
  }));
  await page.route('**/api/v1/receipts/extract', route => {
    const body = route.request().postDataJSON();
    expect(body.captures).toHaveLength(2);
    expect(body.captures[1].embeddedText).toBe('Sin texto legible');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: extractionFromEvidence(evidence, { finalItems: [firstItem] }) }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await expect(page.locator('.capture-card .status-pill')).toHaveCount(2);
  await expect(page.locator('.capture-card .status-pill').first()).toHaveText('Completada');
  await expect(page.locator('.capture-card .status-pill').nth(1)).toHaveText('Completada');
  await expect(page.locator('.receipt-item')).toHaveCount(1);
});
