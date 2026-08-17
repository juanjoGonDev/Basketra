import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

function item() {
  return {
    description: 'PAN',
    quantity: 1,
    unitPriceMinor: 150,
    lineTotalMinor: 150,
    confidence: 0.8,
    sourceLines: [1],
  };
}

function extraction() {
  const line = item();
  return {
    pages: [{
      position: 0,
      source: 'local-tesseract',
      text: 'PAN 1,50\nTOTAL 1,50',
      confidence: 0.8,
    }],
    originalText: 'PAN 1,50\nTOTAL 1,50',
    deterministic: {
      items: [line],
      declaredTotalMinor: 150,
    },
    final: {
      items: [line],
      declaredTotalMinor: 150,
      warnings: [],
      review: {
        lines: [{
          ...line,
          status: 'confirmed',
          expectedMinor: 150,
          differenceMinor: 0,
        }],
        total: {
          expectedMinor: 150,
          differenceMinor: 0,
          valid: true,
        },
      },
    },
  };
}

async function uploadReceipt(page, name) {
  await page.locator('#receipt-files').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: validPng,
  });
  await expect(page.locator('.capture-card')).toHaveCount(1);
}

async function enableAi(page) {
  const input = page.getByLabel('Verificar y normalizar con IA');
  await page.locator('label.switch-row').filter({ has: input }).click();
  await expect(input).toBeChecked();
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

function backgroundExtraction() {
  return extraction();
}

test('an AbortError marks the page cancelled without converting it into an AI or OCR failure', async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.__abortNextReceiptExtraction = false;
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (window.__abortNextReceiptExtraction && url.pathname === '/api/v1/receipts/extract') {
        window.__abortNextReceiptExtraction = false;
        return Promise.reject(new DOMException('cancelled by boundary test', 'AbortError'));
      }
      return originalFetch(input, init);
    };
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'abort-boundary.png');
  await page.evaluate(() => { window.__abortNextReceiptExtraction = true; });
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();

  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  await expect(page.locator('#receipt-state')).toContainText('0 imágenes con error y 1 canceladas');
  await expect(page.getByText('Revisar manualmente', { exact: true })).toHaveCount(0);
});

test('assembly failure preserves completed pages and defensive confirmation remains blocked', async ({ page }) => {
  await page.route('**/api/v1/receipts/extract', route => {
    const body = route.request().postDataJSON();
    const assembled = typeof body.captures?.[0]?.embeddedText === 'string';
    if (assembled) {
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'AI_PROVIDER_FAILED',
            message: 'No se pudo combinar el borrador',
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: extraction() }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#confirm-receipt').evaluate(element => element.click());
  await expect(page.locator('#receipt-state')).toHaveText('Completa, reintenta o retira todas las imágenes antes de confirmar el ticket.');

  await uploadReceipt(page, 'assembly-boundary.png');
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('#receipt-state')).toContainText('No se pudo combinar el borrador');
  await expect(page.locator('#receipt-state')).toContainText('Las páginas completadas se conservan');
  await expect(page.getByRole('button', { name: 'Leer con OCR local', exact: true })).toBeEnabled();

  await page.locator('#confirm-receipt').evaluate(element => element.click());
  await expect(page.locator('#receipt-state')).toHaveText('No hay líneas para importar.');
});

test('cancel all marks active work cancelled and keeps the uploaded capture', async ({ page }) => {
  let releaseRequest = () => {};
  const requestGate = new Promise(resolve => { releaseRequest = resolve; });
  await page.route('**/api/v1/receipts/extract', async route => {
    await requestGate;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: extraction() }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'cancel-all.png');
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('OCR local');
  await page.getByRole('button', { name: 'Cancelar todo', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  await expect(page.locator('#receipt-state')).toContainText('Análisis cancelado');
  await expect(page.locator('.capture-card')).toHaveCount(1);
  releaseRequest();
});

test('background jobs render running state and finish after their matching realtime invalidation', async ({ page }) => {
  let jobStatus = 'running';
  let failNextRefresh = false;
  await installControlledEventSource(page);
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
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
              ...(jobStatus === 'completed' ? { extraction: backgroundExtraction() } : {}),
            },
      }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'background-live.png');
  await enableAi(page);
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Verificando con IA');

  await page.evaluate(() => window.__emitReceiptInvalidation('not-json'));
  await page.evaluate(() => window.__emitReceiptInvalidation(JSON.stringify({
    entityType: 'shopping-list', entityId: 'other',
  })));
  failNextRefresh = true;
  await page.evaluate(() => window.__emitReceiptInvalidation(JSON.stringify({
    entityType: 'receipt-extraction-job', entityId: 'receiptextractionjob_live',
  })));
  await expect.poll(() => failNextRefresh).toBe(false);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Verificando con IA');
  jobStatus = 'completed';
  await page.evaluate(() => window.__emitReceiptInvalidation(JSON.stringify({
    entityType: 'receipt-extraction-job', entityId: 'receiptextractionjob_live',
  })));

  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('#receipt-state')).toHaveText('Ticket preparado. Revisa las líneas, cantidades y total antes de confirmar.');
});

test('background job cancellation clears the persisted job and marks the capture cancelled', async ({ page }) => {
  let deleteRequests = 0;
  await installControlledEventSource(page);
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    if (route.request().method() === 'DELETE') {
      deleteRequests += 1;
      return route.abort('failed');
    }
    return route.fulfill({
      status: route.request().method() === 'POST' ? 202 : 200,
      contentType: 'application/json',
      body: JSON.stringify({
        job: route.request().method() === 'POST'
          ? { id: 'receiptextractionjob_cancel' }
          : { id: 'receiptextractionjob_cancel', status: 'running' },
      }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'background-cancel.png');
  await enableAi(page);
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Verificando con IA');
  await page.getByRole('button', { name: 'Cancelar todo', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  await expect.poll(() => deleteRequests).toBe(1);
  await page.evaluate(() => window.__emitReceiptInvalidation(JSON.stringify({
    entityType: 'receipt-extraction-job', entityId: 'receiptextractionjob_cancel',
  })));
});

test('a provider-side background cancellation is reflected without issuing a second cancellation', async ({ page }) => {
  let deleteRequests = 0;
  await installControlledEventSource(page);
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
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
          ? { id: 'receiptextractionjob_provider_cancel' }
          : { id: 'receiptextractionjob_provider_cancel', status: 'cancelled' },
      }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'provider-cancel.png');
  await enableAi(page);
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  expect(deleteRequests).toBe(0);
});

test('background job submission failure preserves the capture for retry', async ({ page }) => {
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
  await enableAi(page);
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
  await expect(page.locator('#receipt-state')).toContainText('El análisis no terminó');
});

test('an interrupted persisted background job reports recovery failure without discarding the draft', async ({ page }) => {
  await installControlledEventSource(page);
  await page.addInitScript(() => {
    localStorage.setItem('basketra.receiptExtractionJobId', 'receiptextractionjob_restore1');
  });
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_restore1', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'AI_UNREACHABLE' } }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await expect(page.locator('#receipt-state')).toContainText('No se pudo recuperar el análisis en segundo plano');
});

test('a persisted running job restores local OCR status before an AI mode is selected', async ({ page }) => {
  await installControlledEventSource(page);
  await page.addInitScript(() => {
    const hash = 'a'.repeat(64);
    localStorage.setItem('basketra.captures', JSON.stringify([{
      name: 'restored.png', mimeType: 'image/png', bytes: 12,
      storageKey: `${hash}.png`, contentHash: hash,
    }]));
    localStorage.setItem('basketra.receiptExtractionJobId', 'receiptextractionjob_restore2');
  });
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_restore2', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'receiptextractionjob_restore2', status: 'running' } }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('OCR local');
});

test('a persisted completion tolerates absent per-page evidence and restores a reviewable receipt', async ({ page }) => {
  await installControlledEventSource(page);
  await page.addInitScript(() => {
    const hash = 'b'.repeat(64);
    localStorage.setItem('basketra.captures', JSON.stringify([{
      name: 'restored-completed.png', mimeType: 'image/png', bytes: 12,
      storageKey: `${hash}.png`, contentHash: hash,
    }]));
    localStorage.setItem('basketra.receiptExtractionJobId', 'receiptextractionjob_restore3');
  });
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_restore3', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: {
        id: 'receiptextractionjob_restore3',
        status: 'completed',
        extraction: { ...backgroundExtraction(), pages: null },
      },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('#receipt-state')).toHaveText('Ticket preparado. Revisa las líneas, cantidades y total antes de confirmar.');
});

test('a malformed background-job response fails safely before persisting an identifier', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs', route => route.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({ job: {} }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'missing-job-id.png');
  await enableAi(page);
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
  await expect(page.locator('#receipt-state')).toContainText('El análisis no terminó');
});

test('a stale job response with a different identifier is ignored', async ({ page }) => {
  await installControlledEventSource(page);
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs**', route => route.fulfill({
    status: route.request().method() === 'POST' ? 202 : 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: route.request().method() === 'POST'
        ? { id: 'receiptextractionjob_expected' }
        : { id: 'receiptextractionjob_other', status: 'completed', extraction: backgroundExtraction() },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'stale-job-response.png');
  await enableAi(page);
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Preparando imagen');
});
