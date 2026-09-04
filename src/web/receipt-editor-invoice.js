import { euroInputToMinor, formatEuroMinor, hydrateIcons } from './ui.js';

const DIALOG_ID = 'receipt-line-dialog';
const EDITOR_CALCULATION_FIELD_SELECTOR = '[data-field="quantity"], [data-field="unitPriceEuro"], [data-field="discountType"], [data-field="discountValue"], [data-field="discountQuantity"]';
const SUMMARY_AMOUNT_COMPACT_LENGTH = 16;
const SUMMARY_AMOUNT_DENSE_LENGTH = 22;
const LOCAL_SECTION_ICONS = {
  package: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4.2 7.5 7.8 4.4 7.8-4.4M12 12v9"/></svg>',
  tag: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13 13 20l-9-9V4h7Z"/><circle cx="8.5" cy="8.5" r="1"/></svg>',
};

function ensureInvoiceEditorStylesheet() {
  if (document.querySelector('link[data-receipt-invoice-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/receipt-editor-invoice.css';
  link.dataset.receiptInvoiceStyles = 'true';
  document.head.append(link);
}

export function createReceiptInvoiceLineDialog({
  id,
  titleId,
  title,
  closeId,
  slotId,
  stateId,
  contentId = '',
  contentTag = 'div',
  className = '',
  actions = [],
}) {
  const dialog = document.createElement('dialog');
  dialog.id = id;
  dialog.className = ['sheet-dialog', 'receipt-line-dialog', className].filter(Boolean).join(' ');
  dialog.setAttribute('aria-labelledby', titleId);

  const content = document.createElement(contentTag);
  content.className = 'dialog-content';
  if (contentId) content.id = contentId;

  const header = document.createElement('div');
  header.className = 'dialog-header';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Línea del ticket';
  const heading = document.createElement('h2');
  heading.id = titleId;
  heading.textContent = title;
  copy.append(eyebrow, heading);

  const close = document.createElement('button');
  close.id = closeId;
  close.className = 'icon-button';
  close.type = 'button';
  close.dataset.editorAction = 'close';
  close.setAttribute('aria-label', 'Cerrar editor');
  const closeIcon = document.createElement('span');
  closeIcon.dataset.icon = 'close';
  close.append(closeIcon);
  header.append(copy, close);

  const slot = document.createElement('div');
  slot.id = slotId;
  slot.dataset.editorSlot = 'true';

  const state = stateId ? document.createElement('p') : null;
  if (state) {
    state.id = stateId;
    state.className = 'inline-status';
    state.setAttribute('role', 'alert');
    state.setAttribute('aria-live', 'assertive');
  }

  const actionBar = document.createElement('div');
  actionBar.className = 'dialog-actions receipt-line-editor-actions';
  actionBar.dataset.editorActions = 'true';
  for (const action of actions) {
    const button = document.createElement('button');
    button.id = action.id;
    button.className = action.className;
    button.type = action.type ?? 'button';
    if (action.editorAction) button.dataset.editorAction = action.editorAction;
    if (action.icon) {
      const icon = document.createElement('span');
      icon.dataset.icon = action.icon;
      button.append(icon);
    }
    button.append(document.createTextNode(action.label));
    actionBar.append(button);
  }

  content.append(header, slot);
  if (state) content.append(state);
  content.append(actionBar);
  dialog.append(content);
  hydrateIcons(dialog);
  return dialog;
}

function editorItem(dialog) {
  return dialog?.querySelector('[data-receipt-line-editor], .receipt-item--editing, #receipt-line-editor-slot .receipt-item') || null;
}

function editorSlot(dialog) {
  return dialog?.querySelector('[data-editor-slot], #receipt-line-editor-slot') || null;
}

function editorAction(dialog, name) {
  return dialog?.querySelector(`[data-editor-action="${name}"], #${name}-receipt-line-editor`) || null;
}

function sectionHeading(step, title, iconName) {
  const heading = document.createElement('div');
  heading.className = 'receipt-editor-section-heading';
  heading.dataset.editorSection = title.toLocaleLowerCase('es-ES').replaceAll(' ', '-');

  const icon = document.createElement('span');
  icon.className = 'receipt-editor-section-heading__icon';
  icon.setAttribute('aria-hidden', 'true');
  const localIcon = LOCAL_SECTION_ICONS[iconName];
  if (localIcon) {
    icon.dataset.localIcon = iconName;
    icon.innerHTML = localIcon;
  } else {
    icon.dataset.icon = iconName;
  }

  const titleElement = document.createElement('h3');
  titleElement.textContent = `${step}. ${title}`;
  heading.append(icon, titleElement);
  if (!localIcon) hydrateIcons(heading);
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

function createSummaryStamp() {
  const stamp = document.createElement('div');
  stamp.className = 'receipt-editor-summary__stamp';
  stamp.setAttribute('aria-hidden', 'true');
  const mark = document.createElement('span');
  mark.className = 'receipt-editor-summary__stamp-mark';
  mark.dataset.icon = 'check';
  stamp.append(mark);
  hydrateIcons(stamp);
  return stamp;
}

function createSummaryStatus() {
  const slot = document.createElement('div');
  slot.className = 'receipt-editor-summary__status-slot';

  const validation = document.createElement('div');
  validation.className = 'receipt-editor-summary__state status-pill';
  validation.dataset.editorSummaryValidation = 'true';
  validation.setAttribute('role', 'status');

  const progress = document.createElement('div');
  progress.className = 'receipt-editor-summary__progress status-pill';
  progress.dataset.editorSummaryProgress = 'true';
  progress.setAttribute('role', 'status');
  progress.setAttribute('aria-live', 'polite');
  progress.hidden = true;

  const spinner = document.createElement('span');
  spinner.className = 'receipt-editor-summary__spinner';
  spinner.dataset.editorSummarySpinner = 'true';
  spinner.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.dataset.editorSummaryProgressText = 'true';
  progress.append(spinner, text);
  slot.append(validation, progress);
  return slot;
}

function createSummary(item) {
  const summaryTitleId = `${item.closest('dialog')?.id || DIALOG_ID}-summary-title`;
  const summary = document.createElement('aside');
  summary.className = 'receipt-line-editor-summary';
  summary.setAttribute('aria-labelledby', summaryTitleId);

  const heading = document.createElement('h3');
  heading.id = summaryTitleId;
  heading.textContent = 'Resumen';

  const values = document.createElement('dl');
  values.className = 'receipt-editor-summary__values';
  values.append(
    summaryRow('Subtotal', 'editorSummaryBase'),
    summaryRow('Descuento aplicado', 'editorSummaryDiscount', 'receipt-editor-summary__discount'),
    summaryRow('Total calculado', 'editorSummaryTotal', 'receipt-editor-summary__total'),
  );

  summary.append(heading, values, createSummaryStatus(), createSummaryStamp());
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
  const closeButton = editorAction(dialog, 'close');
  if (closeButton) header.insertBefore(status, closeButton);
  else header.append(status);
  return status;
}

function validationState(item) {
  if (item.dataset.editorValidation === 'confirmed') return true;
  if (item.dataset.editorValidation === 'review') return false;
  const canonical = item.querySelector('.receipt-item__legend-actions .status-pill');
  return canonical?.classList.contains('success') || canonical?.dataset.receiptValidation === 'confirmed';
}

function copyValidationState(item, target, summary = false) {
  if (!target) return;
  const confirmed = validationState(item);
  const stateKey = confirmed ? 'confirmed' : 'review';
  if (target.dataset.editorValidationState === stateKey) return;
  target.dataset.editorValidationState = stateKey;
  target.classList.toggle('success', confirmed);
  target.classList.toggle('warning', !confirmed);
  if (!summary) {
    target.textContent = confirmed ? 'Validada' : 'Revisar';
    return;
  }

  target.replaceChildren();
  const icon = document.createElement('span');
  icon.dataset.icon = confirmed ? 'check' : 'alert';
  icon.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = confirmed ? 'Total validado' : 'Revisar total';
  target.append(icon, text);
  hydrateIcons(target);
}

function fieldCaption(control) {
  const label = control?.closest('label.field');
  if (!label) return null;
  return [...label.children].find(child => (
    child instanceof HTMLSpanElement && !child.classList.contains('receipt-editor-control')
  )) || null;
}

function setFieldCaption(control, text) {
  const caption = fieldCaption(control);
  if (caption) caption.textContent = text;
}

function ensureControlShell(control, key) {
  if (!(control instanceof HTMLInputElement)) return null;
  const current = control.closest(`.receipt-editor-control[data-editor-affix="${key}"]`);
  if (current) return current;
  const shell = document.createElement('span');
  shell.className = 'receipt-editor-control';
  shell.dataset.editorAffix = key;
  control.before(shell);
  shell.append(control);
  return shell;
}

function ensureSuffix(shell, role) {
  if (!shell) return null;
  let suffix = shell.querySelector(`[data-editor-affix-role="${role}"]`);
  if (suffix) return suffix;
  suffix = document.createElement('span');
  suffix.className = 'receipt-editor-control__suffix';
  suffix.dataset.editorAffixRole = role;
  suffix.setAttribute('aria-hidden', 'true');
  shell.append(suffix);
  return suffix;
}

function ensureAffectedUnitsMeta(shell) {
  if (!shell) return null;
  let meta = shell.querySelector('[data-editor-affix-role="affected-units"]');
  if (meta) return meta;
  meta = document.createElement('span');
  meta.className = 'receipt-editor-control__suffix receipt-editor-control__suffix--units';
  meta.dataset.editorAffixRole = 'affected-units';
  meta.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.dataset.editorAffectedUnitsText = 'true';
  const icon = document.createElement('span');
  icon.className = 'receipt-editor-control__info';
  icon.dataset.icon = 'info';
  meta.append(text, icon);
  shell.append(meta);
  hydrateIcons(meta);
  return meta;
}

function lineQuantity(item) {
  const input = item.querySelector('[data-field="quantity"]');
  const quantity = input instanceof HTMLInputElement ? Number(input.value) : 1;
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;
}

function localizeEuroInput(input) {
  if (!(input instanceof HTMLInputElement) || document.activeElement === input) return;
  const match = /^(\d+)\.(\d{1,2})$/u.exec(input.value.trim());
  if (match) input.value = `${match[1]},${match[2]}`;
}

function syncPresentationControls(item) {
  const unitPrice = item.querySelector('[data-field="unitPriceEuro"]');
  const discountType = item.querySelector('[data-field="discountType"]');
  const discountValue = item.querySelector('[data-field="discountValue"]');
  const discountQuantity = item.querySelector('[data-field="discountQuantity"]');

  setFieldCaption(item.querySelector('[data-field="description"]'), 'Producto');
  setFieldCaption(item.querySelector('[data-field="quantity"]'), 'Cantidad');
  setFieldCaption(unitPrice, 'Precio unitario');
  setFieldCaption(discountType, 'Tipo');
  setFieldCaption(discountValue, 'Valor');
  setFieldCaption(discountQuantity, 'Unidades con descuento');
  localizeEuroInput(unitPrice);

  const priceShell = ensureControlShell(unitPrice, 'unit-price');
  const priceSuffix = ensureSuffix(priceShell, 'currency');
  if (priceSuffix) priceSuffix.textContent = '€';

  const discountShell = ensureControlShell(discountValue, 'discount-value');
  const discountSuffix = ensureSuffix(discountShell, 'discount');
  if (discountSuffix) {
    discountSuffix.textContent = discountType?.value === 'percentage'
      ? '%'
      : discountType?.value === 'amount' ? '€' : '';
  }

  const quantityShell = ensureControlShell(discountQuantity, 'discount-quantity');
  const quantityMeta = ensureAffectedUnitsMeta(quantityShell);
  const quantityText = quantityMeta?.querySelector('[data-editor-affected-units-text]');
  if (quantityText) quantityText.textContent = `de ${lineQuantity(item)}`;
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

function summaryAmountDensity(text) {
  const length = [...text].length;
  if (length >= SUMMARY_AMOUNT_DENSE_LENGTH) return 'dense';
  if (length >= SUMMARY_AMOUNT_COMPACT_LENGTH) return 'compact';
  return 'normal';
}

function setSummaryAmount(target, text) {
  if (!target) return;
  target.textContent = text;
  target.dataset.amountDensity = summaryAmountDensity(text);
}

function setSummaryState(summary, state) {
  summary.dataset.summaryState = state;
  summary.setAttribute('aria-busy', state === 'pending' ? 'true' : 'false');
  const validation = summary.querySelector('[data-editor-summary-validation]');
  const progress = summary.querySelector('[data-editor-summary-progress]');
  const progressText = progress?.querySelector('[data-editor-summary-progress-text]');
  const spinner = progress?.querySelector('[data-editor-summary-spinner]');
  const showProgress = state === 'pending' || state === 'error';
  if (validation) validation.hidden = showProgress;
  if (!progress) return;
  progress.hidden = !showProgress;
  if (!showProgress) return;
  const isError = state === 'error';
  progress.dataset.progressKind = isError ? 'error' : 'pending';
  if (progressText) progressText.textContent = isError ? 'Revisa el cálculo' : 'Calculando total…';
  if (spinner) spinner.hidden = isError;
}

function syncSummary(item) {
  const summary = item.querySelector('.receipt-line-editor-summary');
  if (!summary) return;
  const values = safeSummaryValues(item);
  const base = summary.querySelector('[data-editor-summary-base]');
  const discount = summary.querySelector('[data-editor-summary-discount]');
  const total = summary.querySelector('[data-editor-summary-total]');
  const validation = summary.querySelector('[data-editor-summary-validation]');
  const dialog = item.closest('dialog.receipt-invoice-dialog');
  copyValidationState(item, validation, true);
  copyValidationState(item, editorHeaderValidation(dialog));
  syncPresentationControls(item);

  if (!values) {
    setSummaryAmount(base, '—');
    setSummaryAmount(discount, '—');
    setSummaryAmount(total, '—');
    setSummaryState(summary, 'invalid');
    return;
  }

  setSummaryAmount(base, formatEuroMinor(values.subtotalMinor));
  setSummaryAmount(discount, values.discountMinor > 0
    ? `-${formatEuroMinor(values.discountMinor)}`
    : formatEuroMinor(0));
  setSummaryAmount(total, formatEuroMinor(values.totalMinor));
  setSummaryState(summary, 'ready');
}

function markSummaryPending(item) {
  const summary = item.querySelector('.receipt-line-editor-summary');
  if (!summary) return;
  setSummaryState(summary, 'pending');
}

function syncCalculationSummaryState(dialog, item) {
  const summary = item.querySelector('.receipt-line-editor-summary');
  if (!summary) return;
  syncPresentationControls(item);
  const total = item.querySelector('[data-field="lineTotalEuro"]');
  if (total?.getAttribute('aria-busy') === 'true') {
    setSummaryState(summary, 'pending');
    return;
  }

  const save = editorAction(dialog, 'save');
  if (save?.dataset.receiptCalculationDisabled === 'true') {
    setSummaryState(summary, 'error');
    return;
  }
  syncSummary(item);
}

function observeCalculationState(dialog, item) {
  if (!(item instanceof HTMLElement) || item.dataset.invoiceCalculationObserver === 'true') return;
  item.dataset.invoiceCalculationObserver = 'true';
  const sync = () => syncCalculationSummaryState(dialog, item);
  const total = item.querySelector('[data-field="lineTotalEuro"]');
  const derivedState = item.querySelector('.receipt-line-derived-state');

  if (total) {
    new MutationObserver(sync).observe(total, {
      attributes: true,
      attributeFilter: ['aria-busy'],
    });
  }
  if (derivedState) {
    new MutationObserver(sync).observe(derivedState, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
  sync();
}

function ensureItemLayout(item) {
  if (!(item instanceof HTMLElement)) return;
  if (item.dataset.invoiceEditorLayout === 'true') {
    syncPresentationControls(item);
    syncSummary(item);
    return;
  }

  const description = item.querySelector('[data-field="description"]');
  const quantity = item.querySelector('[data-field="quantity"]');
  const unitPrice = item.querySelector('[data-field="unitPriceEuro"]');
  const discountType = item.querySelector('[data-field="discountType"]');
  const detailRow = quantity?.closest('.quantity-row');
  const discountRow = discountType?.closest('.quantity-row');
  if (!(description instanceof HTMLInputElement)
    || !(detailRow instanceof HTMLElement)
    || !(discountRow instanceof HTMLElement)
    || !(quantity instanceof HTMLInputElement)
    || !(unitPrice instanceof HTMLInputElement)
    || !(discountType instanceof HTMLSelectElement)) return;

  const descriptionLabel = description.closest('label');
  const discountTypeLabel = discountType.closest('label');
  if (!descriptionLabel || !discountTypeLabel) return;

  descriptionLabel.before(sectionHeading(1, 'Producto', 'package'));
  detailRow.insertBefore(sectionHeading(2, 'Detalle de compra', 'cart'), detailRow.firstChild);
  discountRow.insertBefore(sectionHeading(3, 'Descuento', 'tag'), discountTypeLabel);
  detailRow.insertAdjacentElement('afterend', createSummary(item));
  item.classList.add('receipt-line-editor-layout');
  item.dataset.invoiceEditorLayout = 'true';
  syncPresentationControls(item);
  syncSummary(item);
}

function prepareEditorItem(dialog) {
  const item = editorItem(dialog);
  if (!item) return null;
  ensureItemLayout(item);
  observeCalculationState(dialog, item);
  return item;
}

function schedulePresentationSync(dialog) {
  queueMicrotask(() => {
    const item = editorItem(dialog);
    if (item) syncPresentationControls(item);
  });
}

export function refreshReceiptInvoiceEditor(dialog) {
  const item = prepareEditorItem(dialog);
  if (item) syncCalculationSummaryState(dialog, item);
}

export function enhanceReceiptInvoiceEditor(dialog) {
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (dialog.dataset.invoiceEditorUi === 'true') {
    refreshReceiptInvoiceEditor(dialog);
    return;
  }
  dialog.dataset.invoiceEditorUi = 'true';
  dialog.classList.add('receipt-invoice-dialog');
  dialog.querySelector('.dialog-content')?.classList.add('receipt-invoice-dialog__content');
  dialog.querySelector('.dialog-header')?.classList.add('receipt-invoice-dialog__header');
  editorSlot(dialog)?.classList.add('receipt-invoice-dialog__slot');
  dialog.querySelector('[data-editor-actions], .receipt-line-editor-actions')?.classList.add('receipt-invoice-dialog__actions');
  editorHeaderValidation(dialog);

  const slot = editorSlot(dialog);
  if (slot) {
    new MutationObserver(() => prepareEditorItem(dialog)).observe(slot, { childList: true });
  }

  dialog.addEventListener('input', event => {
    const item = editorItem(dialog);
    if (!item) return;
    schedulePresentationSync(dialog);
    if (event.target?.dataset?.field === 'lineTotalEuro') {
      syncCalculationSummaryState(dialog, item);
      return;
    }
    if (event.target?.matches?.(EDITOR_CALCULATION_FIELD_SELECTOR)) markSummaryPending(item);
  });

  dialog.addEventListener('change', event => {
    const item = editorItem(dialog);
    schedulePresentationSync(dialog);
    if (item && event.target?.matches?.(EDITOR_CALCULATION_FIELD_SELECTOR)) markSummaryPending(item);
  });

  refreshReceiptInvoiceEditor(dialog);
}

function installInvoiceEditor() {
  ensureInvoiceEditorStylesheet();
  const current = document.getElementById(DIALOG_ID);
  if (current) enhanceReceiptInvoiceEditor(current);
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.id === DIALOG_ID) {
          enhanceReceiptInvoiceEditor(node);
          continue;
        }
        const nestedDialog = node.querySelector?.(`#${DIALOG_ID}`);
        if (nestedDialog) enhanceReceiptInvoiceEditor(nestedDialog);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

installInvoiceEditor();
