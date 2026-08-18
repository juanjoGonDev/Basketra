import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

function item(description = 'PAN', total = 150) {
  return {
    description,
    quantity: 1,
    unitPriceMinor: total,
    lineTotalMinor: total,
    confidence: 0.8,
    sourceLines: [1],
  };
}

function extraction(description = 'PAN', total = 150) {
  const line = item(description, total);
  const text = `${description} ${(total / 100).toFixed(2)}\nTOTAL ${(total / 100).toFixed(2)}`;
  return {
    pages: [{
      position: 0,
      source: 'local-tesseract',
      text,
      confidence: 0.8,
      deterministic: {
        items: [line],
        metadata: { declaredTotalMinor: total },
      },
    }],
    originalText: text,
    deterministic: {
      items: [line],
      declaredTotalMinor: total,
    },
    final: {
      items: [line],
      declaredTotalMinor: total,
      warnings: [],
      review: {
        lines: [{
          ...line,
          status: 'confirmed',
          expectedMinor: total,
          differenceMinor: 0,
        }],
        total: {
          expectedMinor: total,
          differenceMinor: 0,
          valid: true,
        },
      },
    },
  };
}

async function uploadReceipt(page, name, buffer = validPng) {
  await page.locator('#receipt-files').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer,
  });
  await expect(page.locator('.capture-card')).toHaveCount(1);
}

async function installControlledEventSource(page) {
  await page.addInitScript(() => {
    class ControlledEventSource {
      constructor() {
        this.listeners = new Map();
        window.__receiptEventSources ??= [];
        window.__receiptEventSources.push(this);
      }

      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }

      close() {}
    }
    window.EventSource = ControlledEventSource;
    window.__emitReceiptInvalidation = data => {
      for (const source of window.__receiptEventSources ?? []) {
        for (const listener of source.listeners.get('invalidate') ?? []) listener({ data });
      }
    };
  });
}

async function stubFinalAssembly(page, result = extraction()) {
  await page.route('**/api/v1/receipts/extract', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ extraction: result }),
  }));
}

test('upload starts an OCR-only persisted job automatically when AI is not configured', async ({ page }) => {
  let submission;
  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    if (route.request().method() === 'POST') submission = route.request().postDataJSON();
    return route.fulfill({
      status: route.request().method() === 'POST' ? 202 : 200,
      contentType: 'application/json',
      body: JSON.stringify({
        job: route.request().method() === 'POST'
          ? { id: 'receiptextractionjob_autoocr' }
          : { id: 'receiptextractionjob_autoocr', status: 'queued' },
      }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'automatic.png');

  await expect.poll(() => submission?.verifyWithAi).toBe(false);
  expect(submission.captures).toHaveLength(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('En cola');
  await expect(page.getByRole('button', { name: 'Leer con OCR local', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Progreso', exact: true })).toHaveCount(0);
});

test('a new upload joins automatic capacity without cancelling an active job', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  let jobCounter = 0;
  let deleteRequests = 0;
  const submissions = [];
  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    const method = route.request().method();
    if (method === 'DELETE') {
      deleteRequests += 1;
      return route.fulfill({ status: 204 });
    }
    if (method === 'POST') {
      jobCounter += 1;
      submissions.push(route.request().postDataJSON());
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ job: { id: `receiptextractionjob_parallel${jobCounter}` } }),
      });
    }
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id, status: 'running' } }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles({
    name: 'first.png',
    mimeType: 'image/png',
    buffer: validPng,
  });
  await expect.poll(() => submissions.length).toBe(1);

  await page.locator('#receipt-files').setInputFiles({
    name: 'second.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([validPng, Buffer.from([1])]),
  });
  await expect.poll(() => submissions.length).toBe(2);

  expect(submissions.every(body => body.verifyWithAi === true)).toBeTruthy();
  expect(submissions.every(body => body.captures.length === 1)).toBeTruthy();
  expect(deleteRequests).toBe(0);
  await expect(page.locator('.capture-card')).toHaveCount(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Procesando' })).toHaveCount(2);
});

test('assembly failure preserves completed page evidence and blocks final confirmation', async ({ page }) => {
  await page.route('**/api/v1/receipts/extraction-jobs**', route => route.fulfill({
    status: route.request().method() === 'POST' ? 202 : 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: route.request().method() === 'POST'
        ? { id: 'receiptextractionjob_assembly' }
        : { id: 'receiptextractionjob_assembly', status: 'completed', extraction: extraction() },
    }),
  }));
  await page.route('**/api/v1/receipts/extract', route => route.fulfill({
    status: 502,
    contentType: 'application/json',
    body: JSON.stringify({
      error: { code: 'AI_PROVIDER_FAILED', message: 'No se pudo combinar el borrador' },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#confirm-receipt').evaluate(element => element.click());
  await expect(page.locator('#receipt-state')).toHaveText('Completa, reintenta o retira todas las imágenes antes de confirmar el ticket.');

  await uploadReceipt(page, 'assembly-boundary.png');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('#receipt-state')).toContainText('No se pudo combinar el borrador');
  await expect(page.locator('#receipt-state')).toContainText('páginas completadas se conservan');
  await expect(page.locator('.capture-card')).toHaveCount(1);

  await page.locator('#confirm-receipt').evaluate(element => element.click());
  await expect(page.locator('#receipt-state')).toHaveText('No hay líneas para importar.');
});

test('cancel all cancels every active persisted job and keeps uploaded captures', async ({ page }) => {
  let deleteRequests = 0;
  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    if (route.request().method() === 'DELETE') {
      deleteRequests += 1;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      status: route.request().method() === 'POST' ? 202 : 200,
      contentType: 'application/json',
      body: JSON.stringify({
        job: route.request().method() === 'POST'
          ? { id: 'receiptextractionjob_cancelall' }
          : { id: 'receiptextractionjob_cancelall', status: 'running' },
      }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'cancel-all.png');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Procesando');
  await page.getByRole('button', { name: 'Cancelar todo', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  await expect(page.locator('#receipt-state')).toContainText('Procesamiento cancelado');
  await expect(page.locator('.capture-card')).toHaveCount(1);
  await expect.poll(() => deleteRequests).toBe(1);
});

test('realtime completion refreshes only the matching active job and opens review after assembly', async ({ page }) => {
  let jobStatus = 'running';
  let failNextRefresh = false;
  await installControlledEventSource(page);
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await stubFinalAssembly(page);
  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    if (route.request().method() === 'GET' && failNextRefresh) {
      failNextRefresh = false;
      return route.abort('failed');
    }
    return route.fulfill({
      status: route.request().method() === 'POST' ? 202 : 200,
      contentType: 'application/json',
      body: JSON.stringify({
        job: route.request().method() === 'POST'
          ? { id: 'receiptextractionjob_live' }
          : {
              id: 'receiptextractionjob_live',
              status: jobStatus,
              ...(jobStatus === 'completed' ? { extraction: extraction() } : {}),
            },
      }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'background-live.png');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Procesando');

  await page.evaluate(() => window.__emitReceiptInvalidation('not-json'));
  await page.evaluate(() => window.__emitReceiptInvalidation(JSON.stringify({
    entityType: 'shopping-list', entityId: 'other',
  })));
  failNextRefresh = true;
  await page.evaluate(() => window.__emitReceiptInvalidation(JSON.stringify({
    entityType: 'receipt-extraction-job', entityId: 'receiptextractionjob_live',
  })));
  await expect.poll(() => failNextRefresh).toBe(false);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Procesando');

  jobStatus = 'completed';
  await page.evaluate(() => window.__emitReceiptInvalidation(JSON.stringify({
    entityType: 'receipt-extraction-job', entityId: 'receiptextractionjob_live',
  })));
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('.receipt-item')).toHaveCount(1);
  await expect(page.locator('[data-tab-group="tickets"] [role="tab"][aria-selected="true"]')).toHaveText('Revisión');
});

test('provider-side job cancellation is reflected without issuing a second cancellation', async ({ page }) => {
  let deleteRequests = 0;
  await installControlledEventSource(page);
  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    if (route.request().method() === 'DELETE') {
      deleteRequests += 1;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      status: route.request().method() === 'POST' ? 202 : 200,
      contentType: 'application/json',
      body: JSON.stringify({
        job: route.request().method() === 'POST'
          ? { id: 'receiptextractionjob_providercancel' }
          : { id: 'receiptextractionjob_providercancel', status: 'cancelled' },
      }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'provider-cancel.png');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  expect(deleteRequests).toBe(0);
});

test('automatic job submission failure preserves the capture for retry', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs', route => route.fulfill({
    status: 502,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'AI_UNREACHABLE', message: 'private detail' } }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'submit-failure.png');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
  await expect(page.locator('#receipt-state')).toContainText('procesamiento automático no terminó');
  await expect(page.getByRole('button', { name: 'Reintentar imagen', exact: true })).toBeVisible();
});

test('an interrupted persisted job reports recovery failure without discarding the draft', async ({ page }) => {
  const hash = 'a'.repeat(64);
  await installControlledEventSource(page);
  await page.addInitScript(({ hash }) => {
    localStorage.setItem('basketra.captures', JSON.stringify([{
      name: 'restore-failure.png', mimeType: 'image/png', bytes: 12,
      storageKey: `${hash}.png`, contentHash: hash,
    }]));
    localStorage.setItem('basketra.receiptExtractionJobs', JSON.stringify([{
      id: 'receiptextractionjob_restorefailure',
      captureKeys: [`${hash}.png`],
      status: 'running',
    }]));
  }, { hash });
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_restorefailure', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'AI_UNREACHABLE' } }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await expect(page.locator('#receipt-state')).toContainText('No se pudo recuperar todo el procesamiento en segundo plano');
  await expect(page.locator('.capture-card')).toHaveCount(1);
});

test('a persisted running job restores its capture as processing', async ({ page }) => {
  const hash = 'b'.repeat(64);
  await installControlledEventSource(page);
  await page.addInitScript(({ hash }) => {
    localStorage.setItem('basketra.captures', JSON.stringify([{
      name: 'restored.png', mimeType: 'image/png', bytes: 12,
      storageKey: `${hash}.png`, contentHash: hash,
    }]));
    localStorage.setItem('basketra.receiptExtractionJobs', JSON.stringify([{
      id: 'receiptextractionjob_restoreactive',
      captureKeys: [`${hash}.png`],
      status: 'running',
    }]));
  }, { hash });
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_restoreactive', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'receiptextractionjob_restoreactive', status: 'running' } }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Procesando');
});

test('a persisted completion with no page array restores a reviewable single capture', async ({ page }) => {
  const hash = 'c'.repeat(64);
  await installControlledEventSource(page);
  await stubFinalAssembly(page);
  await page.addInitScript(({ hash }) => {
    localStorage.setItem('basketra.captures', JSON.stringify([{
      name: 'restored-completed.png', mimeType: 'image/png', bytes: 12,
      storageKey: `${hash}.png`, contentHash: hash,
    }]));
    localStorage.setItem('basketra.receiptExtractionJobs', JSON.stringify([{
      id: 'receiptextractionjob_restorecomplete',
      captureKeys: [`${hash}.png`],
      status: 'running',
    }]));
  }, { hash });
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_restorecomplete', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: {
        id: 'receiptextractionjob_restorecomplete',
        status: 'completed',
        extraction: { ...extraction(), pages: null },
      },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('.receipt-item')).toHaveCount(1);
});

test('a malformed automatic-job response fails safely before persisting an identifier', async ({ page }) => {
  await page.route('**/api/v1/receipts/extraction-jobs', route => route.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({ job: {} }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'missing-job-id.png');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
  await expect(page.locator('#receipt-state')).toContainText('procesamiento automático no terminó');
});

test('a stale job response with a different identifier is ignored', async ({ page }) => {
  await installControlledEventSource(page);
  await page.route('**/api/v1/receipts/extraction-jobs**', route => route.fulfill({
    status: route.request().method() === 'POST' ? 202 : 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: route.request().method() === 'POST'
        ? { id: 'receiptextractionjob_expected' }
        : { id: 'receiptextractionjob_other', status: 'completed', extraction: extraction() },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'stale-job-response.png');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('En cola');
  await expect(page.locator('.receipt-item')).toHaveCount(0);
});
