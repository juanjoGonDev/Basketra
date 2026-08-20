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
  });
}

function storedCapture(name, character = 'a') {
  const hash = character.repeat(64);
  return {
    name,
    mimeType: 'image/png',
    bytes: 12,
    storageKey: `${hash}.png`,
    contentHash: hash,
  };
}

test('an AbortError marks automatic OCR cancelled without converting it into an AI or OCR failure', async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.__abortNextReceiptExtraction = true;
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (window.__abortNextReceiptExtraction && url.pathname === '/api/v1/receipts/extract') {
        window.__abortNextReceiptExtraction = false;
        return Promise.reject(new DOMException('cancelled by boundary test', 'AbortError'));
      }
      return originalFetch(input, init);
    };
  });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'abort-boundary.png');

  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  await expect(page.locator('#receipt-state')).toContainText('0 imágenes con error y 1 canceladas');
  await expect(page.getByText('Revisar manualmente', { exact: true })).toHaveCount(0);
});

test('assembly failure preserves completed OCR pages and defensive confirmation remains blocked', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));
  await page.route('**/api/v1/receipts/extract', route => {
    const body = route.request().postDataJSON();
    const assembled = typeof body.captures?.[0]?.embeddedText === 'string';
    if (assembled) {
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'RECEIPT_ASSEMBLY_FAILED',
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
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('#receipt-state')).toContainText('No se pudo combinar el borrador');
  await expect(page.locator('#receipt-state')).toContainText('Las páginas completadas se conservan');
  await expect(page.getByRole('button', { name: 'Leer con OCR local', exact: true })).toHaveCount(0);

  await page.locator('#confirm-receipt').evaluate(element => element.click());
  await expect(page.locator('#receipt-state')).toHaveText('No hay líneas para importar.');
});

test('cancel processing marks active automatic work cancelled and keeps the uploaded capture', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));
  let releaseRequest = () => {};
  const requestGate = new Promise(resolve => { releaseRequest = resolve; });
  await page.route('**/api/v1/receipts/extract', async route => {
    await requestGate;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: extraction() }),
    }).catch(() => {});
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'cancel-all.png');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('OCR local');
  await page.getByRole('button', { name: 'Cancelar procesamiento', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  await expect(page.locator('#receipt-state')).toContainText('Análisis cancelado');
  await expect(page.locator('.capture-card')).toHaveCount(1);
  releaseRequest();
});

test('a persisted legacy AI failure falls forward to current automatic OCR instead of blocking review', async ({ page }) => {
  await installControlledEventSource(page);
  await page.addInitScript(capture => {
    localStorage.setItem('basketra.captures', JSON.stringify([capture]));
    localStorage.setItem('basketra.receiptExtractionJobId', 'receiptextractionjob_ai_failed');
  }, storedCapture('legacy-ai-failure.png'));
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_ai_failed', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: { id: 'receiptextractionjob_ai_failed', status: 'failed', errorCode: 'AI_UNREACHABLE' },
    }),
  }));
  await page.route('**/api/v1/receipts/extract', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ extraction: extraction() }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('.receipt-item')).toHaveCount(1);
  await expect(page.locator('#receipt-review-panel')).toHaveAttribute('open', '');
});

test('an interrupted persisted background job reports recovery failure without discarding the draft', async ({ page }) => {
  await installControlledEventSource(page);
  await page.addInitScript(capture => {
    localStorage.setItem('basketra.captures', JSON.stringify([capture]));
    localStorage.setItem('basketra.receiptExtractionJobId', 'receiptextractionjob_restore1');
  }, storedCapture('restore-error.png', 'c'));
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_restore1', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'AI_UNREACHABLE' } }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await expect(page.locator('#receipt-state')).toContainText('No se pudo recuperar el análisis anterior');
  await expect(page.locator('.capture-card')).toHaveCount(1);
});

test('a persisted running job restores local OCR status before an AI mode is selected', async ({ page }) => {
  await installControlledEventSource(page);
  await page.addInitScript(capture => {
    localStorage.setItem('basketra.captures', JSON.stringify([capture]));
    localStorage.setItem('basketra.receiptExtractionJobId', 'receiptextractionjob_restore2');
  }, storedCapture('restored.png'));
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
  await page.addInitScript(capture => {
    localStorage.setItem('basketra.captures', JSON.stringify([capture]));
    localStorage.setItem('basketra.receiptExtractionJobId', 'receiptextractionjob_restore3');
  }, storedCapture('restored-completed.png', 'b'));
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_restore3', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: {
        id: 'receiptextractionjob_restore3',
        status: 'completed',
        extraction: { ...extraction(), pages: null },
      },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('#receipt-state')).toHaveText('Ticket preparado. Revisa las líneas, cantidades y total antes de confirmar.');
  await expect(page.locator('#receipt-review-panel')).toHaveAttribute('open', '');
});

test('a stale persisted job response with a different identifier is ignored', async ({ page }) => {
  await installControlledEventSource(page);
  await page.addInitScript(capture => {
    localStorage.setItem('basketra.captures', JSON.stringify([capture]));
    localStorage.setItem('basketra.receiptExtractionJobId', 'receiptextractionjob_expected');
  }, storedCapture('stale-job-response.png', 'd'));
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_expected', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: { id: 'receiptextractionjob_other', status: 'completed', extraction: extraction() },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Lista');
  await expect(page.locator('#receipt-review-panel')).toBeHidden();
});
