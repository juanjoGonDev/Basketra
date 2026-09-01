import { euroInputToMinor, formatEuroMinor, hydrateIcons } from './ui.js';

const DIALOG_ID = 'receipt-line-dialog';
const EDITOR_FIELD_SELECTOR = '[data-field="description"], [data-field="quantity"], [data-field="unitPriceEuro"], [data-field="discountType"], [data-field="discountValue"], [data-field="discountQuantity"]';

function editorItem(dialog) {
  return dialog?.querySelector('.receipt-item--editing, #receipt-line-editor-slot .receipt-item') || null;
}

function sectionHeading(step, title, iconName) {
  const heading = document.createElement('div');
  heading.className = 'receipt-editor-section-heading';
  heading.dataset.editorSection = title.toLocaleLowerCase('es-ES').replaceAll(' ', '-');

  const icon = document.createElement('span');
  icon.className = 'receipt-editor-section-heading__icon';
  icon.dataset.icon = iconName;
  icon.setAttribute('aria-hidden', 'true');

  const titleElement = document.createElement('h3');
  titleElement.textContent = `${step}. ${title}`;
  heading.append(icon, titleElement);
  hydrateIcons(heading);
  return heading;
}

function summaryRow(label, dataAttribute, extraClass = '') {
  const row = document.createElement('div');
  row.className = `receipt-editor-summary__row ${extraClass}`.trim();
  const term = document.createElement('dt');
  term.textContent = label;
  const value = document.createElement('dd');
  value.dataset[dataAttribute] = 'true';
  value.textContent = '—';
  row.append(term, value);
  return row;
}

function createSummary() {
  const summary = document.createElement('aside');
  summary.className = 'receipt-line-editor-summary';
  summary.setAttribute('aria-labelledby', 'receipt-line-editor-summary-title');

  const heading = document.createElement('h3');
  heading.id = 'receipt-line-editor-summary-title';
  heading.textContent = 'Resumen';

  const values = document.createElement('dl');
  values.className = 'receipt-editor-summary__values';
  values.append(
    summaryRow('Subtotal', 'editorSummaryBase'),
    summaryRow('Descuento aplicado', 'editorSummaryDiscount', 'receipt-editor-summary__discount'),
    summaryRow('Total calculado', 'editorSummaryTotal', 'receipt-editor-summary__total'),
  );

  const state = document.createElement('div');
  state.className = 'receipt-editor-summary__state status-pill';
  state.dataset.editorSummaryValidation = 'true';
  state.setAttribute('role', 'status');
  summary.append(heading, values, state);
  return summary;
}

function editorHeaderValidation(dialog) {
  const header = dialog.querySelector('.dialog-header');
  if (!header) return null;
  let status = header.querySelector('[data-editor-validation]');
  if (status) return status;
  status = document.createElement('span');
  status.className = 'status-pill receipt-line-dialog__validation';
  status.dataset.editorValidation = 'true';
  status.setAttribute('role', 'status');
  const closeButton = header.querySelector('#close-receipt-line-editor');
  if (closeButton) header.insertBefore(status, closeButton);
  else header.append(status);
  return status;
}

function copyValidationState(item, target) {
  if (!target) return;
  const canonical = item.querySelector('.receipt-item__legend-actions .status-pill');
  const confirmed = canonical?.classList.contains('success') || canonical?.dataset.receiptValidation === 'confirmed';
  target.classList.toggle('success', confirmed);
  target.classList.toggle('warning', !confirmed);
  target.textContent = confirmed ? 'Validada' : 'Revisar';
}

function safeSummaryValues(item) {
  const quantityInput = item.querySelector('[data-field="quantity"]');
  const unitPriceInput = item.querySelector('[data-field="unitPriceEuro"]');
  const totalInput = item.querySelector('[data-field="lineTotalEuro"]');
  if (!(quantityInput instanceof HTMLInputElement)
    || !(unitPriceInput instanceof HTMLInputElement)
    || !(totalInput instanceof HTMLInputElement || totalInput instanceof HTMLOutputElement)) return null;

  const quantity = Number(quantityInput.value);
  if (!Number.isSafeInteger(quantity) || quantity < 0) return null;
  try {
    const unitPriceMinor = euroInputToMinor(unitPriceInput.value);
    const totalMinor = euroInputToMinor(totalInput.value);
    const subtotalMinor = quantity * unitPriceMinor;
    if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor < totalMinor) return null;
    return {
      subtotalMinor,
      discountMinor: subtotalMinor - totalMinor,
      totalMinor,
    };
  } catch {
    return null;
  }
}

function syncSummary(item) {
  const summary = item.querySelector('.receipt-line-editor-summary');
  if (!summary) return;
  const values = safeSummaryValues(item);
  const base = summary.querySelector('[data-editor-summary-base]');
  const discount = summary.querySelector('[data-editor-summary-discount]');
  const total = summary.querySelector('[data-editor-summary-total]');
  const validation = summary.querySelector('[data-editor-summary-validation]');
  const dialog = item.closest(`#${DIALOG_ID}`);
  copyValidationState(item, validation);
  copyValidationState(item, editorHeaderValidation(dialog));

  if (!values) {
    if (base) base.textContent = '—';
    if (discount) discount.textContent = '—';
    if (total) total.textContent = '—';
    summary.dataset.summaryState = 'invalid';
    return;
  }

  if (base) base.textContent = formatEuroMinor(values.subtotalMinor);
  if (discount) discount.textContent = values.discountMinor > 0
    ? `-${formatEuroMinor(values.discountMinor)}`
    : formatEuroMinor(0);
  if (total) total.textContent = formatEuroMinor(values.totalMinor);
  summary.dataset.summaryState = 'ready';
}

function markSummaryPending(item) {
  const summary = item.querySelector('.receipt-line-editor-summary');
  if (!summary) return;
  summary.dataset.summaryState = 'pending';
}

function ensureItemLayout(item) {
  if (!(item instanceof HTMLElement)) return;
  if (item.dataset.invoiceEditorLayout === 'true') {
    syncSummary(item);
    return;
  }

  const description = item.querySelector('[data-field="description"]');
  const quantityRow = item.querySelector('.quantity-row');
  const quantity = item.querySelector('[data-field="quantity"]');
  const unitPrice = item.querySelector('[data-field="unitPriceEuro"]');
  const discountType = item.querySelector('[data-field="discountType"]');
  if (!(description instanceof HTMLInputElement)
    || !(quantityRow instanceof HTMLElement)
    || !(quantity instanceof HTMLInputElement)
    || !(unitPrice instanceof HTMLInputElement)
    || !(discountType instanceof HTMLSelectElement)) return;

  const descriptionLabel = description.closest('label');
  const discountTypeLabel = discountType.closest('label');
  if (!descriptionLabel || !discountTypeLabel) return;

  descriptionLabel.before(sectionHeading(1, 'Producto', 'receipt'));
  quantityRow.insertBefore(sectionHeading(2, 'Detalle de compra', 'cart'), quantityRow.firstChild);
  quantityRow.insertBefore(sectionHeading(3, 'Descuento', 'savings'), discountTypeLabel);
  quantityRow.insertAdjacentElement('afterend', createSummary());
  item.dataset.invoiceEditorLayout = 'true';
  syncSummary(item);
}

function enhanceDialog(dialog) {
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (dialog.dataset.invoiceEditorUi === 'true') return;
  dialog.dataset.invoiceEditorUi = 'true';
  dialog.classList.add('receipt-invoice-dialog');
  dialog.querySelector('.dialog-content')?.classList.add('receipt-invoice-dialog__content');
  dialog.querySelector('.dialog-header')?.classList.add('receipt-invoice-dialog__header');
  dialog.querySelector('#receipt-line-editor-slot')?.classList.add('receipt-invoice-dialog__slot');
  dialog.querySelector('.receipt-line-editor-actions')?.classList.add('receipt-invoice-dialog__actions');
  editorHeaderValidation(dialog);

  const slot = dialog.querySelector('#receipt-line-editor-slot');
  if (slot) {
    new MutationObserver(() => {
      const item = editorItem(dialog);
      if (item) ensureItemLayout(item);
    }).observe(slot, { childList: true });
  }

  dialog.addEventListener('input', event => {
    const item = editorItem(dialog);
    if (!item) return;
    if (event.target?.dataset?.field === 'lineTotalEuro') {
      syncSummary(item);
      return;
    }
    if (event.target?.matches?.(EDITOR_FIELD_SELECTOR)) markSummaryPending(item);
  });

  dialog.addEventListener('change', event => {
    const item = editorItem(dialog);
    if (item && event.target?.matches?.(EDITOR_FIELD_SELECTOR)) markSummaryPending(item);
  });

  const item = editorItem(dialog);
  if (item) ensureItemLayout(item);
}

function installInvoiceEditor() {
  const current = document.getElementById(DIALOG_ID);
  if (current) enhanceDialog(current);
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.id === DIALOG_ID) enhanceDialog(node);
        node.querySelector?.(`#${DIALOG_ID}`) && enhanceDialog(node.querySelector(`#${DIALOG_ID}`));
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

installInvoiceEditor();
