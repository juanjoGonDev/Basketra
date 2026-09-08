import { api } from './api.js';
import { saveCaptures } from './state.js';
import { captureItem, formatEuroMinor, icon, swipeActionRail } from './ui.js';
import {
  ACTIVE_PAGE_STATUSES,
  REVIEWABLE_PAGE_STATUSES,
  PAGE_LABELS,
  $,
  captureKey,
  createPageState,
  ensurePageStates,
  metadata,
  openDialog,
  state,
  toast,
} from './receipt-state.js';
import {
  clearReceiptExtractionJob,
  currentElapsed,
  formatElapsed,
  rebuildCombinedReview,
  startAutomaticCaptureProcessing,
  updateGlobalProgress,
} from './receipt-lifecycle.js';
import {
  cancelCaptureProcessing,
  retryAiCorrection,
  retryCaptureProcessing,
  useManualReview,
} from './receipt-processing.js';

const MAX_PROGRESSIVE_OCR_ITEMS = 5;
const MAX_PROGRESSIVE_OCR_TEXT_CHARS = 4000;

function pluralFiles(count) {
  return `${count} ${count === 1 ? 'archivo' : 'archivos'}`;
}

export function renderReceiptQueueStatus() {
  const queue = $('#receipt-source-queue');
  const summary = $('#receipt-source-queue-summary');
  const detail = $('#receipt-source-queue-detail');
  if (!queue || !summary || !detail) return;

  const pages = state.captures.map(capture => state.pageStates.get(captureKey(capture)) ?? createPageState());
  const total = pages.length;
  const active = pages.filter(page => ACTIVE_PAGE_STATUSES.has(page.status)).length;
  const pending = pages.filter(page => page.status === 'pending' || page.status === 'preparing').length;
  const completed = pages.filter(page => REVIEWABLE_PAGE_STATUSES.has(page.status)).length;
  const failed = pages.filter(page => page.status === 'error').length;
  const cancelled = pages.filter(page => page.status === 'cancelled').length;

  const suffix = failed
    ? `${failed} con error`
    : active
      ? `${active} procesando`
      : pending
        ? `${pending} pendientes`
        : total > 0 && completed === total
          ? 'listos para revisar'
          : cancelled
            ? `${cancelled} cancelados`
            : '';

  summary.textContent = String(total);
  const summaryLabel = [pluralFiles(total), suffix].filter(Boolean).join(' · ');
  queue.querySelector(':scope > summary')?.setAttribute('aria-label', `Archivos del análisis: ${summaryLabel}`);
  detail.textContent = total === 0
    ? 'Añade imágenes o PDF con el botón +'
    : `${completed} de ${total} ${total === 1 ? 'página procesada' : 'páginas procesadas'}`;

  queue.dataset.state = failed
    ? 'error'
    : active || pending || state.finalizing
      ? 'working'
      : total > 0 && completed === total
        ? 'complete'
        : 'idle';
}

function pageDetectedItems(page) {
  if (Array.isArray(page?.result?.final?.items) && page.result.final.items.length > 0) {
    return page.result.final.items;
  }
  if (Array.isArray(page?.ocrEvidence?.deterministic?.items)) {
    return page.ocrEvidence.deterministic.items;
  }
  return [];
}

function detectedItemsSnapshot() {
  if (
    Array.isArray(state.items)
    && (state.extraction || (state.captures.length === 0 && state.items.length > 0))
  ) {
    return {
      items: state.items,
      provisional: false,
    };
  }

  return {
    items: state.captures.flatMap(capture => {
      const page = state.pageStates.get(captureKey(capture));
      return pageDetectedItems(page);
    }),
    provisional: true,
  };
}

function detectedDiscount(item) {
  if (item?.discount?.type === 'amount' && Number.isSafeInteger(item.discount.amountMinor)) {
    return {
      label: item.description || 'Descuento detectado',
      value: `−${formatEuroMinor(Math.abs(item.discount.amountMinor))}`,
    };
  }
  if (item?.discount?.type === 'percentage' && Number.isSafeInteger(item.discount.basisPoints)) {
    const percentage = item.discount.basisPoints / 100;
    return {
      label: item.description || 'Descuento detectado',
      value: `−${percentage.toLocaleString('es-ES')} %`,
    };
  }
  if (Number.isSafeInteger(item?.discountMinor) && item.discountMinor > 0) {
    return {
      label: item.description || 'Descuento detectado',
      value: `−${formatEuroMinor(item.discountMinor)}`,
    };
  }
  return null;
}

function receiptDiscountEntries(items) {
  const entries = items.map(detectedDiscount).filter(Boolean);
  const unassigned = state.extraction?.final?.unassignedDiscounts;
  if (!Array.isArray(unassigned)) return entries;
  for (const entry of unassigned) {
    const discount = detectedDiscount({
      description: entry?.description || 'Descuento sin asignar',
      discount: entry?.discount,
      discountMinor: entry?.discountMinor,
    });
    if (discount) entries.push(discount);
    else entries.push({ label: entry?.description || 'Descuento sin asignar', value: '' });
  }
  return entries;
}

function currentRetailerLabel(snapshot) {
  const candidates = [...state.retailerCandidates.values()].filter(Boolean);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return 'Varios comercios detectados';
  const extractionRetailer = state.extraction?.final?.retailerName
    || state.extraction?.ai?.interpretation?.retailerName
    || state.detectedStoreRetailerName;
  if (typeof extractionRetailer === 'string' && extractionRetailer.trim()) return extractionRetailer.trim();
  if (state.captures.length === 0 && snapshot.items.length > 0) return 'Entrada manual';
  return 'Sin identificar';
}

function receiptProgressSnapshot() {
  const pages = state.captures.map(capture => state.pageStates.get(captureKey(capture)) ?? createPageState());
  const total = pages.length;
  const completed = pages.filter(page => REVIEWABLE_PAGE_STATUSES.has(page.status)).length;
  const active = pages.filter(page => ACTIVE_PAGE_STATUSES.has(page.status)).length;
  const pending = pages.filter(page => page.status === 'pending' || page.status === 'preparing').length;
  const failed = pages.filter(page => page.status === 'error').length;
  const done = total > 0 && completed === total && active === 0 && pending === 0 && !state.finalizing;
  const stage = failed
    ? 'Revisión necesaria'
    : state.finalizing
      ? 'Combinando páginas'
      : active > 0 || pending > 0
        ? 'Analizando…'
        : done
          ? 'Análisis completado'
          : total > 0
            ? 'Preparando análisis'
            : 'Listo para analizar';
  return {
    total,
    completed,
    stage,
    progress: total === 0 ? 0 : completed / total,
  };
}

function liveTotalMinor(snapshot) {
  return snapshot.items.reduce((sum, item) => (
    Number.isSafeInteger(item?.lineTotalMinor) ? sum + item.lineTotalMinor : sum
  ), 0);
}

function renderReceiptAnalysisSummary(snapshot) {
  const overview = $('#receipt-analysis-overview');
  const summary = $('#receipt-live-summary');
  if (!overview || !summary) return;

  const retailer = $('#receipt-live-retailer-name');
  if (retailer) retailer.textContent = currentRetailerLabel(snapshot);

  const progress = receiptProgressSnapshot();
  const stage = $('#receipt-live-stage');
  const progressLabel = $('#receipt-live-progress-label');
  const progressTrack = $('#receipt-live-progress-track');
  if (stage) stage.textContent = progress.stage;
  if (progressLabel) {
    progressLabel.textContent = progress.total === 0
      ? 'Sin archivos'
      : `${progress.completed} de ${progress.total} ${progress.total === 1 ? 'imagen' : 'imágenes'}`;
  }
  if (progressTrack) {
    progressTrack.setAttribute('aria-valuemax', String(Math.max(progress.total, 1)));
    progressTrack.setAttribute('aria-valuenow', String(progress.completed));
    progressTrack.setAttribute('aria-valuetext', `${progress.stage}. ${progress.completed} de ${progress.total} imágenes`);
    progressTrack.style.setProperty('--receipt-live-progress', `${progress.progress * 100}%`);
  }

  const totalMinor = liveTotalMinor(snapshot);
  const totalText = formatEuroMinor(totalMinor);
  const totalLabel = snapshot.provisional ? 'Total provisional' : 'Total calculado';
  const liveTotal = $('#receipt-live-total');
  const liveTotalLabel = $('#receipt-live-total-label');
  const summaryTotal = $('#receipt-summary-total');
  const summaryTotalLabel = $('#receipt-summary-total-label');
  if (liveTotal) liveTotal.textContent = totalText;
  if (liveTotalLabel) liveTotalLabel.textContent = totalLabel;
  if (summaryTotal) summaryTotal.textContent = totalText;
  if (summaryTotalLabel) summaryTotalLabel.textContent = totalLabel;

  const productCount = $('#receipt-summary-products');
  if (productCount) productCount.textContent = String(snapshot.items.length);

  const discounts = receiptDiscountEntries(snapshot.items);
  const discountRow = $('#receipt-summary-discounts-row');
  const discountCount = $('#receipt-summary-discounts');
  const discountList = $('#receipt-summary-discounts-list');
  if (discountRow) discountRow.hidden = discounts.length === 0;
  if (discountCount) discountCount.textContent = String(discounts.length);
  if (discountList) {
    discountList.replaceChildren();
    for (const discount of discounts.slice(0, 4)) {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = discount.label;
      const value = document.createElement('strong');
      value.textContent = discount.value;
      row.append(label, value);
      discountList.append(row);
    }
    discountList.hidden = discounts.length === 0;
  }

  summary.hidden = snapshot.items.length === 0;
}

function detectedItemMeta(item, provisional) {
  const parts = [];
  if (Number.isFinite(item?.quantity)) {
    const unit = typeof item?.unit === 'string' && item.unit.trim() ? item.unit.trim() : 'ud';
    parts.push(`${item.quantity} ${unit}`);
  }
  if (Number.isSafeInteger(item?.unitPriceMinor)) parts.push(formatEuroMinor(item.unitPriceMinor));
  parts.push(provisional ? 'provisional' : 'listo para validar');
  return parts.join(' · ');
}

export function renderProgressiveDetectedItems() {
  const list = $('#receipt-detected-list');
  const count = $('#receipt-detected-count');
  const empty = $('#receipt-detected-empty');
  const help = $('#receipt-detected-help');
  if (!list || !count || !empty || !help) return;

  const snapshot = detectedItemsSnapshot();
  list.replaceChildren();
  snapshot.items.forEach((item, index) => {
    const row = document.createElement('li');
    row.className = 'receipt-detected-row';
    const editable = !snapshot.provisional && Boolean(state.items[index]);
    if (editable) {
      row.classList.add('swipe-shell');
      row.dataset.swipeRow = '';
      row.dataset.swipeKind = 'receipt-detected-line';
      row.dataset.swipeId = String(index);
      row.dataset.swipeEndAction = 'delete';
      row.dataset.swipeOpen = 'false';
      row.innerHTML = swipeActionRail(
        'Editar',
        'Eliminar',
        `data-receipt-action="edit" data-receipt-index="${index}" aria-label="Editar producto ${index + 1}"`,
        `data-receipt-action="delete" data-receipt-index="${index}" aria-label="Eliminar producto ${index + 1}"`,
      );
    }

    const surface = document.createElement('div');
    surface.className = 'receipt-detected-item';
    surface.dataset.provisional = String(snapshot.provisional);
    if (editable) {
      surface.classList.add('swipe-content');
      surface.dataset.swipeContent = '';
    }

    const copy = document.createElement('span');
    copy.className = 'receipt-detected-item__copy';
    const description = document.createElement('strong');
    description.textContent = typeof item?.description === 'string' && item.description.trim()
      ? item.description.trim()
      : 'Producto sin descripción legible';
    const meta = document.createElement('small');
    meta.textContent = detectedItemMeta(item, snapshot.provisional);
    copy.append(description, meta);

    const discount = detectedDiscount(item);
    if (discount) {
      surface.classList.add('receipt-detected-item--discounted');
      const discountMeta = document.createElement('small');
      discountMeta.className = 'receipt-detected-item__discount';
      discountMeta.innerHTML = `${icon('tag')}<span>Descuento detectado</span>${discount.value ? `<strong>${discount.value}</strong>` : ''}`;
      copy.append(discountMeta);
    }

    const amount = document.createElement('strong');
    amount.className = 'receipt-detected-item__amount';
    amount.textContent = Number.isSafeInteger(item?.lineTotalMinor)
      ? formatEuroMinor(item.lineTotalMinor)
      : '—';

    surface.append(copy, amount);
    if (editable) {
      const actions = document.createElement('button');
      actions.type = 'button';
      actions.className = 'icon-button receipt-detected-item__menu';
      actions.dataset.swipeToggle = '';
      actions.setAttribute('aria-expanded', 'false');
      actions.setAttribute('aria-label', `Mostrar acciones del producto ${index + 1}`);
      actions.innerHTML = icon('more');
      surface.append(actions);
    }

    row.append(surface);
    list.append(row);
  });

  count.textContent = String(snapshot.items.length);
  empty.hidden = snapshot.items.length > 0;
  help.hidden = snapshot.items.length === 0;
  help.textContent = snapshot.provisional
    ? 'Las líneas son provisionales hasta completar la revisión conjunta.'
    : 'Resultado combinado listo. Abre la vista previa para validar y corregir.';
  renderReceiptAnalysisSummary(snapshot);
}


export function persistAndRenderCaptures() {
  ensurePageStates();
  saveCaptures(state.captures);
  const list = $('#capture-list');
  list.innerHTML = state.captures
    .map((capture, index) => captureItem(capture, index, state.captures.length))
    .join('');

  state.captures.forEach((capture, index) => {
    const card = list.children[index];
    if (!(card instanceof HTMLElement)) return;
    card.dataset.captureKey = captureKey(capture);
    renderCaptureProgress(card, capture, index);
  });

  list.querySelectorAll('img[data-capture-preview-image]').forEach(image => {
    image.addEventListener('error', () => {
      image.hidden = true;
      if (image.nextElementSibling) image.nextElementSibling.hidden = false;
    }, { once: true });
  });
  updateGlobalProgress();
  renderReceiptQueueStatus();
  renderProgressiveDetectedItems();
}

function pageDiagnostic(page) {
  if (page.aiStatus === 'error' && typeof page.aiRecovery?.diagnostic === 'string') {
    return page.aiRecovery.diagnostic;
  }
  if ((page.status === 'error' || page.status === 'manual') && typeof page.recovery?.diagnostic === 'string') {
    return page.recovery.diagnostic;
  }
  return '';
}

function appendProgressiveOcrEvidence(section, page) {
  const evidence = page.ocrEvidence;
  if (!evidence || typeof evidence.text !== 'string' || !evidence.text) return;

  const items = Array.isArray(evidence.deterministic?.items)
    ? evidence.deterministic.items
    : [];
  const preview = document.createElement('details');
  preview.className = 'capture-card__ocr-preview';
  const summary = document.createElement('summary');
  summary.textContent = items.length === 0
    ? 'OCR disponible mientras continúa la IA'
    : `${items.length} ${items.length === 1 ? 'producto detectado' : 'productos detectados'} por OCR`;
  preview.append(summary);

  if (items.length > 0) {
    const list = document.createElement('ul');
    for (const item of items.slice(0, MAX_PROGRESSIVE_OCR_ITEMS)) {
      const row = document.createElement('li');
      row.textContent = typeof item?.description === 'string' && item.description
        ? item.description
        : 'Producto sin descripción legible';
      list.append(row);
    }
    if (items.length > MAX_PROGRESSIVE_OCR_ITEMS) {
      const remaining = document.createElement('li');
      remaining.textContent = `+ ${items.length - MAX_PROGRESSIVE_OCR_ITEMS} más`;
      list.append(remaining);
    }
    preview.append(list);
  }

  const text = document.createElement('pre');
  text.className = 'capture-card__ocr-text';
  text.textContent = evidence.text.length > MAX_PROGRESSIVE_OCR_TEXT_CHARS
    ? `${evidence.text.slice(0, MAX_PROGRESSIVE_OCR_TEXT_CHARS)}\n…`
    : evidence.text;
  preview.append(text);
  section.append(preview);
}

export function renderCaptureProgress(card, capture, index) {
  const key = captureKey(capture);
  const page = state.pageStates.get(key) ?? createPageState();
  const active = ACTIVE_PAGE_STATUSES.has(page.status);
  const details = document.createElement('details');
  details.className = 'capture-card__details';
  details.dataset.capturePageProgress = key;
  details.open = state.expandedCaptureKey === key;

  const summary = document.createElement('summary');
  summary.className = 'capture-card__summary';
  const summaryCopy = document.createElement('span');
  summaryCopy.className = 'capture-card__summary-copy';
  const position = document.createElement('strong');
  position.textContent = capture.name;
  const stage = document.createElement('small');
  stage.textContent = `Página ${index + 1} de ${state.captures.length} · ${pageStageDescription(page)}`;
  summaryCopy.append(position, stage);
  const status = document.createElement('span');
  status.className = `status-pill ${pageStatusClass(page)}`;
  status.textContent = page.status === 'completed' && page.aiStatus === 'error'
    ? 'OCR listo'
    : (PAGE_LABELS[page.status] || PAGE_LABELS.pending);
  summary.append(summaryCopy, status);

  const section = document.createElement('section');
  section.className = 'capture-card__progress';
  section.setAttribute('aria-live', 'polite');

  const meta = document.createElement('div');
  meta.className = 'capture-card__progress-meta';
  const metaStage = document.createElement('span');
  metaStage.textContent = pageStageDescription(page);
  const elapsed = document.createElement('span');
  elapsed.dataset.captureElapsed = key;
  elapsed.textContent = formatElapsed(currentElapsed(page));
  meta.append(metaStage, elapsed);

  const track = document.createElement('div');
  track.className = 'capture-card__stage-track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', `Etapa de procesamiento de la imagen ${index + 1}`);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '3');
  track.setAttribute('aria-valuenow', String(pageStageValue(page.status)));
  track.style.setProperty('--capture-stage-progress', `${pageStageValue(page.status) / 3 * 100}%`);
  section.append(meta, track);

  const partialText = pagePartialText(page);
  if (partialText) {
    const partial = document.createElement('p');
    partial.className = page.status === 'error'
      ? 'capture-card__error'
      : (page.aiStatus === 'error' ? 'capture-card__warning' : 'capture-card__partial');
    partial.textContent = partialText;
    section.append(partial);
  }
  appendProgressiveOcrEvidence(section, page);

  const showPrimaryAiRecovery = (page.status === 'error' || page.status === 'manual')
    && page.errorCode.startsWith('AI_')
    && state.aiConfigured;
  const showPrimaryRecovery = active
    || page.status === 'error'
    || page.status === 'cancelled'
    || showPrimaryAiRecovery;
  const showAiRecovery = page.status === 'completed' && page.aiStatus === 'error';
  if (showPrimaryRecovery || showAiRecovery) {
    const actions = document.createElement('div');
    actions.className = 'capture-card__page-actions';

    if (showPrimaryRecovery) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button secondary';
      button.dataset.captureIndex = String(index);
      if (active) {
        button.dataset.captureAction = 'cancel-processing';
        button.textContent = page.status === 'ai' && (page.rawText || page.result)
          ? 'Cancelar corrección con IA'
          : 'Cancelar esta imagen';
      } else if (showPrimaryAiRecovery) {
        button.dataset.captureAction = 'retry-ai';
        button.textContent = 'Volver a analizar con IA';
      } else {
        button.dataset.captureAction = 'retry-processing';
        button.textContent = page.recovery?.retryLabel || 'Reintentar imagen';
      }
      actions.append(button);
    }

    if ((page.status === 'error' && page.recovery?.allowManualReview) || showAiRecovery) {
      const manualButton = document.createElement('button');
      manualButton.type = 'button';
      manualButton.className = 'button secondary';
      manualButton.dataset.captureIndex = String(index);
      manualButton.dataset.captureAction = 'manual-review';
      manualButton.textContent = 'Revisar manualmente';
      actions.append(manualButton);
    }

    if (showAiRecovery) {
      const aiButton = document.createElement('button');
      aiButton.type = 'button';
      aiButton.className = 'button secondary';
      aiButton.dataset.captureIndex = String(index);
      aiButton.dataset.captureAction = 'retry-ai';
      aiButton.textContent = 'Volver a analizar con IA';
      actions.append(aiButton);
    }

    if (pageDiagnostic(page)) {
      const diagnosticButton = document.createElement('button');
      diagnosticButton.type = 'button';
      diagnosticButton.className = 'button secondary';
      diagnosticButton.dataset.captureIndex = String(index);
      diagnosticButton.dataset.captureAction = 'copy-ai-diagnostic';
      diagnosticButton.textContent = 'Copiar diagnóstico';
      actions.append(diagnosticButton);
    }

    section.append(actions);
  }

  const secondaryActions = card.querySelector('.capture-card__actions');
  if (secondaryActions) {
    secondaryActions.classList.add('capture-card__secondary-actions');
    section.append(secondaryActions);
  }

  details.append(summary, section);
  details.addEventListener('toggle', () => {
    if (details.open) state.expandedCaptureKey = key;
    else if (state.expandedCaptureKey === key) state.expandedCaptureKey = '';
  });
  card.append(details);
  card.querySelectorAll('[data-capture-action="up"], [data-capture-action="down"], [data-capture-action="delete"]')
    .forEach(button => {
      if (active) button.disabled = true;
    });
}

export function pageStatusClass(page) {
  if (page.status === 'completed' && page.aiStatus === 'error') return 'warning';
  if (page.status === 'completed') return 'success';
  if (page.status === 'manual') return 'warning';
  if (page.status === 'error') return 'error';
  if (page.status === 'cancelled') return 'warning';
  return '';
}

export function pageStageValue(status) {
  if (status === 'ready' || status === 'preparing' || status === 'pending' || status === 'cancelled' || status === 'error') return 0;
  if (status === 'ocr') return 1;
  if (status === 'ai') return 2;
  if (status === 'completed' || status === 'manual') return 3;
  return 0;
}

export function pageStageDescription(page) {
  if (page.status === 'ready') return 'Lista para procesar';
  if (page.status === 'pending') return 'En espera de un hueco del pool';
  if (page.status === 'preparing') return 'Preparando la captura almacenada';
  if (page.status === 'ocr') return 'Reconociendo el texto localmente';
  if (page.status === 'ai') return 'Corrigiendo el OCR con IA';
  if (page.status === 'completed' && page.aiStatus === 'error') return 'OCR listo · IA sin corregir';
  if (page.status === 'completed') return page.aiStatus === 'completed' ? 'OCR corregido con IA' : 'OCR listo para revisar';
  if (page.status === 'manual') return 'OCR conservado; cantidades e importes requieren revisión manual';
  if (page.status === 'cancelled') return 'Esta imagen no se incluirá hasta reintentar';
  if (page.status === 'error') return 'La captura y el OCR parcial se conservan';
  return '';
}

export function pagePartialText(page) {
  if (page.status === 'error') return page.error || 'No se pudo procesar esta imagen.';
  const itemCount = page.result?.final?.items?.length;
  const ocrItemCount = page.ocrEvidence?.deterministic?.items?.length;
  const hasStructuredItems = Number.isSafeInteger(itemCount) && itemCount > 0;
  const hasOcrEvidence = (Number.isSafeInteger(ocrItemCount) && ocrItemCount > 0) || Boolean(page.rawText);
  if (page.status === 'manual' && !hasStructuredItems && !hasOcrEvidence) {
    return 'Entrada manual pendiente; la captura original se conserva';
  }
  if (page.aiStatus === 'error') return page.aiError || 'La IA no pudo corregir esta imagen; el OCR local sigue disponible.';
  if (page.status === 'manual' && Number.isSafeInteger(itemCount)) {
    return `${itemCount} ${itemCount === 1 ? 'línea OCR pendiente' : 'líneas OCR pendientes'} de revisión manual`;
  }
  if (Number.isSafeInteger(itemCount)) {
    return `${itemCount} ${itemCount === 1 ? 'línea estructurada' : 'líneas estructuradas'}`;
  }
  if (Number.isSafeInteger(ocrItemCount)) {
    return `${ocrItemCount} ${ocrItemCount === 1 ? 'producto OCR detectado' : 'productos OCR detectados'} · ${page.status === 'ai' ? 'IA verificando' : 'OCR conservado'}`;
  }
  if (page.rawText) {
    const lines = page.rawText.split(/\r?\n/u).filter(line => line.trim()).length;
    return `${lines} ${lines === 1 ? 'línea OCR conservada' : 'líneas OCR conservadas'}`;
  }
  if (page.status === 'manual') return 'Entrada manual pendiente; la captura original se conserva';
  return '';
}

export function validateFile(file, runtimeCapabilities) {
  if (!metadata.files.mimeTypes.includes(file.type)) {
    throw new Error(`Tipo de archivo no admitido: ${file.name || 'archivo'}`);
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new Error(`El archivo está vacío: ${file.name || 'archivo'}`);
  }
  if (runtimeCapabilities === undefined) return;

  const maxBytes = file.type === 'application/pdf'
    ? runtimeCapabilities?.attachments?.maxFileBytes
    : runtimeCapabilities?.attachments?.maxImageBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return;
  if (file.size > maxBytes) {
    throw new Error(
      `El archivo ${file.name || 'archivo'} ocupa ${formatMegabytes(file.size)} MB y supera el límite de ${formatMegabytes(maxBytes)} MB`,
    );
  }
}

export function formatMegabytes(bytes) {
  const megabytes = bytes / (1024 * 1024);
  return new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: 1,
    minimumFractionDigits: Number.isInteger(megabytes) ? 0 : 1,
  }).format(megabytes);
}

function ensureReceiptAiLimitHelp() {
  return $('#receipt-ai-limit-help');
}

function renderReceiptAiLimits(runtimeCapabilities) {
  const maxImageBytes = runtimeCapabilities?.attachments?.maxImageBytes;
  const maxFileBytes = runtimeCapabilities?.attachments?.maxFileBytes;
  if (!Number.isSafeInteger(maxImageBytes) || maxImageBytes <= 0 || !Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
    throw new Error('WebAPI no ha devuelto límites de adjuntos válidos');
  }
  const help = ensureReceiptAiLimitHelp();
  if (help) help.textContent = `Límites actuales de WebAPI: imágenes ${formatMegabytes(maxImageBytes)} MB · PDF/archivos ${formatMegabytes(maxFileBytes)} MB.`;
  return runtimeCapabilities;
}

function renderReceiptAiLimitsUnavailable() {
  const help = ensureReceiptAiLimitHelp();
  if (help) help.textContent = 'No se pudieron consultar los límites actuales de WebAPI. El servidor validará el archivo al iniciar el análisis.';
}

async function readReceiptAiRuntimeCapabilities() {
  const runtimeCapabilities = await api('/api/v1/ai/runtime-capabilities', { cache: 'no-store' });
  return renderReceiptAiLimits(runtimeCapabilities);
}

export async function refreshReceiptAiLimitHelp() {
  if (!state.aiConfigured) return;
  try {
    await readReceiptAiRuntimeCapabilities();
  } catch {
    renderReceiptAiLimitsUnavailable();
  }
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}

async function readAiSizeWarning(files) {
  try {
    const runtimeCapabilities = await readReceiptAiRuntimeCapabilities();
    for (const file of files) {
      try {
        validateFile(file, runtimeCapabilities);
      } catch (error) {
        return error instanceof Error ? error.message : 'La captura supera el límite actual de WebAPI';
      }
    }
  } catch {
    renderReceiptAiLimitsUnavailable();
    return 'No se pudieron consultar los límites actuales de WebAPI; el servidor validará el límite al iniciar el análisis.';
  }
  return '';
}

export async function uploadFiles(fileList) {
  const files = [...fileList];
  if (files.length === 0) return;
  const addedCaptures = [];
  const hadBackgroundJob = Boolean(state.activeJobId);
  try {
    files.forEach(file => validateFile(file));
    const aiSizeWarning = state.aiConfigured
      ? await readAiSizeWarning(files)
      : '';
    for (const [index, file] of files.entries()) {
      $('#upload-state').textContent = `Subiendo ${index + 1} de ${files.length}: ${file.name || 'captura'}…`;
      const base64 = await fileToBase64(file);
      const result = await api('/api/v1/files', {
        method: 'POST',
        body: JSON.stringify({ base64, mimeType: file.type, originalName: file.name || 'captura' }),
      });
      const capture = {
        name: file.name || `captura-${Date.now()}`,
        mimeType: result.file.mimeType,
        bytes: result.file.bytes,
        storageKey: result.file.storageKey,
        contentHash: result.file.hash,
      };
      state.captures.push(capture);
      addedCaptures.push(capture);
    }

    if (hadBackgroundJob) clearReceiptExtractionJob({ cancel: true });
    ensurePageStates();
    persistAndRenderCaptures();
    $('#upload-state').textContent = aiSizeWarning
      ? `Capturas guardadas. OCR iniciado. ${aiSizeWarning}`
      : 'Capturas guardadas. El OCR ha empezado automáticamente.';
    toast(aiSizeWarning ? `Capturas guardadas · ${aiSizeWarning}` : 'Capturas guardadas · OCR iniciado');
    startAutomaticCaptureProcessing(hadBackgroundJob ? state.captures : addedCaptures, {
      resetAll: hadBackgroundJob,
    });
  } catch (error) {
    $('#upload-state').textContent = error.message;
    toast(error.message);
  }
}

export function showPreview(index) {
  const capture = state.captures[index];
  if (!capture || !capture.mimeType.startsWith('image/')) return;
  $('#capture-preview-name').textContent = capture.name;
  $('#capture-preview-image').src = `/api/v1/files/${encodeURIComponent(capture.storageKey)}`;
  $('#capture-preview-image').alt = `Vista ampliada de ${capture.name}`;
  openDialog($('#capture-preview-dialog'));
}

function invalidateDurableJobForCaptureMutation() {
  if (!state.activeJobId) return;
  clearReceiptExtractionJob({ cancel: true });
}

export function moveCapture(index, direction) {
  if (state.processing || state.finalizing) return;
  const target = index + direction;
  if (!state.captures[index] || !state.captures[target]) return;
  invalidateDurableJobForCaptureMutation();
  [state.captures[index], state.captures[target]] = [state.captures[target], state.captures[index]];
  saveCaptures(state.captures);
  rebuildCombinedReview();
}

export function deleteCapture(index) {
  if (state.processing || state.finalizing || !state.captures[index]) return;
  invalidateDurableJobForCaptureMutation();
  const [removed] = state.captures.splice(index, 1);
  if (removed) state.pageStates.delete(captureKey(removed));
  saveCaptures(state.captures);
  rebuildCombinedReview();
  persistAndRenderCaptures();
  $('#upload-state').textContent = 'Captura retirada del borrador; la evidencia original se conserva';
}

async function copyAiDiagnostic(index) {
  const capture = state.captures[index];
  if (!capture) return;
  const page = state.pageStates.get(captureKey(capture));
  const diagnostic = page ? pageDiagnostic(page) : '';
  if (!diagnostic || typeof navigator.clipboard?.writeText !== 'function') {
    toast('No se pudo copiar el diagnóstico');
    return;
  }
  try {
    await navigator.clipboard.writeText(diagnostic);
    toast('Diagnóstico copiado');
  } catch {
    toast('No se pudo copiar el diagnóstico');
  }
}

export function handleCaptureAction(event) {
  const button = event.target.closest('[data-capture-action]');
  if (!button) return;
  const index = Number(button.dataset.captureIndex);
  const action = button.dataset.captureAction;
  if (action === 'preview') showPreview(index);
  if (action === 'up') moveCapture(index, -1);
  if (action === 'down') moveCapture(index, 1);
  if (action === 'delete') deleteCapture(index);
  if (action === 'cancel-processing') cancelCaptureProcessing(index);
  if (action === 'retry-processing') retryCaptureProcessing(index);
  if (action === 'retry-ai') retryAiCorrection(index);
  if (action === 'manual-review') useManualReview(index);
  if (action === 'copy-ai-diagnostic') void copyAiDiagnostic(index);
}
