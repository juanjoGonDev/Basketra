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
    taxCategory: 'B',
    confidence: 0.7,
    sourceLines: [1],
  };
}

function review() {
  return {
    lines: [{
      ...item(),
      status: 'confirmed',
      expectedMinor: 150,
      differenceMinor: 0,
    }],
    total: {
      expectedMinor: 150,
      differenceMinor: 0,
      valid: true,
    },
  };
}

function extraction({ assembled = false } = {}) {
  const rawText = 'PAN 1,50 B\nTOTAL 1,50';
  return {
    pages: assembled ? [] : [{
      position: 0,
      source: 'local-tesseract',
      text: rawText,
      confidence: 0.7,
    }],
    originalText: rawText,
    deterministic: {
      items: [item()],
      declaredTotalMinor: 150,
    },
    final: {
      items: [item()],
      declaredTotalMinor: 150,
      warnings: [],
      review: review(),
    },
  };
}

test('AI failure preserves OCR but requires explicit manual validation before import', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));

  await page.route('**/api/v1/receipts/extract', route => {
    const body = route.request().postDataJSON();
    const capture = body.captures?.[0];
    if (body.verifyWithAi === true) {
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'AI_UNREACHABLE',
            message: 'raw upstream detail must not be shown',
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        extraction: extraction({ assembled: typeof capture?.embeddedText === 'string' }),
      }),
    });
  });

  await page.route('**/api/v1/receipts/validate', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      lines: [{ validation: review().lines[0] }],
      total: review().total,
    }),
  }));

  await page.route('**/api/v1/receipts/confirm', route => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({ receiptId: 'manual-recovery-receipt' }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles({
    name: 'manual-recovery.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  const aiInput = page.getByLabel('Verificar y normalizar con IA');
  await page.locator('label.switch-row').filter({ has: aiInput }).click();
  await expect(aiInput).toBeChecked();
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();

  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
  await expect(page.getByText('El OCR de esta imagen se conserva localmente')).toBeVisible();
  await expect(page.getByText('no se considera un ticket estructurado válido')).toBeVisible();
  await expect(page.getByText('raw upstream detail must not be shown')).toHaveCount(0);
  await expect(page.getByText('desactiva IA')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reintentar imagen', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Revisar manualmente', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Revisión manual');
  await expect(page.locator('.receipt-item')).toHaveCount(1);
  await expect(page.locator('#receipt-total')).toHaveValue('1.50');

  await page.getByRole('button', { name: 'Confirmar e importar', exact: true }).click();
  await expect(page.locator('#receipt-state')).toContainText('Pulsa “Validar líneas”');

  const validateButton = page.locator('#review-receipt');
  await expect(validateButton).toHaveAccessibleName('Validar líneas e importes');
  await validateButton.click();
  await expect(page.locator('#receipt-state')).toHaveText('Líneas y total validados.');

  await page.getByRole('button', { name: 'Confirmar e importar', exact: true }).click();
  await expect(page.locator('#receipt-state')).toHaveText('Ticket importado: manual-recovery-receipt');
});
