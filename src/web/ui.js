import { applicationPathForRoute } from './routes.js';

const EURO_FORMATTER = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const SWIPE_REVEAL_RATIO = 0.16;
const SWIPE_START_COMMIT_RATIO = 0.38;
const SWIPE_END_COMMIT_RATIO = 0.68;
const SWIPE_REVEAL_MAX_PX = 152;

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5Z"/><path d="M9 21v-6h6v6"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="m3.5 6 .8.8L6 5M3.5 12l.8.8L6 11M3.5 18l.8.8L6 17"/>',
  scan: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M7 9h10M7 12h10M7 15h6"/>',
  camera: '<path d="M4 7h3l1.5-2h7L17 7h3v12H4Z"/><circle cx="12" cy="13" r="4"/>',
  prices: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/><path d="m3 6 5-3 5 4 7-5"/>',
  settings: '<circle cx="12" cy="12" r="3.5"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A7 7 0 0 0 15 6l-.3-2.6h-4L10.4 6A7 7 0 0 0 9 7.1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1A7 7 0 0 0 10.4 18l.3 2.6h4L15 18a7 7 0 0 0 1.5-1.1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z"/>',
  cart: '<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M3 4h2l2.4 10.5a2 2 0 0 0 2 1.5h7.8a2 2 0 0 0 1.9-1.4L21 8H6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  edit: '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10Z"/><path d="m13.5 6.5 3.5 3.5"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
  refresh: '<path d="M20 6v5h-5"/><path d="M19 11a7 7 0 1 0 1 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  memory: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
  sparkles: '<path d="m12 3 1.2 3.1L16 7.3l-2.8 1.2L12 12l-1.2-3.5L8 7.3l2.8-1.2Z"/><path d="m18.5 13 .8 2 1.7.8-1.7.8-.8 2.1-.8-2.1-1.7-.8 1.7-.8Z"/>',
  shield: '<path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6Z"/><path d="m9 12 2 2 4-5"/>',
  backup: '<path d="M4 7v5h5"/><path d="M5.5 12a7 7 0 1 0 2-5"/><path d="m4 7 3.5-3.5"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  wifi: '<path d="M5 9a10 10 0 0 1 14 0M8 12a6 6 0 0 1 8 0M11 15a2 2 0 0 1 2 0"/><circle cx="12" cy="18" r=".7" fill="currentColor" stroke="none"/>',
  wifiOff: '<path d="m3 3 18 18M8.5 8.5A10 10 0 0 1 19 9M5 9a10 10 0 0 1 1.8-1.4M9.5 12.5A6 6 0 0 1 16 12M8 12a6 6 0 0 1 .7-.5M11 15a2 2 0 0 1 2 0"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 5"/>',
  store: '<path d="M4 10v10h16V10M3 10l2-6h14l2 6"/><path d="M8 20v-6h8v6"/>',
  balance: '<path d="M12 4v16M5 7h14M7 7l-4 7h8ZM17 7l-4 7h8Z"/>',
  savings: '<path d="M5 8.5C5 6 7.7 4 11 4s6 2 6 4.5S14.3 13 11 13 5 11 5 8.5Z"/><path d="M17 8.5V15c0 2.5-2.7 4.5-6 4.5S5 17.5 5 15V8.5"/>',
  alert: '<path d="M12 4 3 20h18Z"/><path d="M12 9v5M12 17h.01"/>',
  tag: '<path d="M20 13 13 20l-9-9V4h7Z"/><circle cx="8.5" cy="8.5" r="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

export function icon(name, className = 'icon') {
  const content = ICONS[name];
  if (!content) throw new Error(`Unknown icon: ${name}`);
  return `<svg class="${escapeHtml(className)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(element => {
    element.innerHTML = icon(element.dataset.icon);
  });
}

export function breadcrumb(items) {
  const entries = Array.isArray(items) ? items.filter(entry => entry?.label) : [];
  if (entries.length === 0) return '';
  return `<nav class="breadcrumb" aria-label="Ruta de navegación">${entries.map((entry, index) => {
    const separator = index === 0 ? '' : `<span class="breadcrumb__separator" data-icon="chevronRight" aria-hidden="true"></span>`;
    const label = escapeHtml(entry.label);
    if (!entry.route) return `${separator}<span aria-current="page">${label}</span>`;
    const leadingIcon = index === 0 ? `<span data-icon="home"></span>` : '';
    const href = escapeHtml(applicationPathForRoute(entry.route));
    return `${separator}<a href="${href}" data-app-route="${escapeHtml(entry.route)}">${leadingIcon}${label}</a>`;
  }).join('')}</nav>`;
}

export function setFieldFeedback(fieldId, message, root = document) {
  const input = root.querySelector(`#${fieldId}`);
  const feedback = root.querySelector(`#${fieldId}-error`);
  if (input) input.setAttribute('aria-invalid', String(Boolean(message)));
  if (feedback) feedback.textContent = message || '';
}

export function formatEuroMinor(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('El importe debe ser válido');
  return EURO_FORMATTER.format(value / 100);
}

export function minorToEuroInput(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('El importe debe ser válido');
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

export function euroInputToMinor(input) {
  const normalized = String(input).trim().replace(/\s|€/gu, '').replace(',', '.');
  const match = /^(\d+)(?:\.(\d{0,2}))?$/u.exec(normalized);
  if (!match) throw new RangeError('Introduce un importe en euros con hasta dos decimales');
  const minor = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(minor)) throw new RangeError('El importe es demasiado grande');
  return minor;
}

function swipeContent(row) {
  return row.querySelector('[data-swipe-content]');
}

function isGenericSwipeRow(row) {
  return row instanceof Element && !row.classList.contains('inventory-entity-swipe');
}

function swipeActions(row) {
  return row.querySelector('[data-swipe-actions]');
}

function setActionsAccessible(row, accessible) {
  const actions = swipeActions(row);
  if (!actions) return;
  actions.setAttribute('aria-hidden', String(!accessible));
  actions.querySelectorAll('button').forEach(button => {
    button.tabIndex = accessible ? 0 : -1;
  });
  const toggle = row.querySelector('[data-swipe-toggle]');
  toggle?.setAttribute('aria-expanded', String(accessible));
}

function setSwipeOffset(row, pixels) {
  swipeContent(row)?.style.setProperty('--swipe-x', `${pixels}px`);
}

function closeSwipeRow(row) {
  row.classList.remove('is-dragging', 'is-swipe-committing');
  row.dataset.swipeOpen = 'false';
  row.dataset.swipeDeleteArmed = 'false';
  setSwipeOffset(row, 0);
  setActionsAccessible(row, false);
}

function closeSwipeRows(root, except) {
  root.querySelectorAll('[data-swipe-row]').forEach(row => {
    if (row !== except && isGenericSwipeRow(row)) closeSwipeRow(row);
  });
}

function resolveCurrentSwipeRow(root, row) {
  if (row.isConnected) return row;
  const id = row.dataset.swipeId;
  const kind = row.dataset.swipeKind;
  if (!id || !kind) return row;
  return [...root.querySelectorAll('[data-swipe-row]')].find(candidate => (
    candidate.dataset.swipeId === id && candidate.dataset.swipeKind === kind
  )) || row;
}

function openSwipeRow(root, row) {
  const currentRow = resolveCurrentSwipeRow(root, row);
  closeSwipeRows(root, currentRow);
  const width = Math.min(SWIPE_REVEAL_MAX_PX, Math.max(112, currentRow.clientWidth * 0.42));
  currentRow.dataset.swipeOpen = 'true';
  currentRow.dataset.swipeDeleteArmed = 'false';
  setSwipeOffset(currentRow, -width);
  setActionsAccessible(currentRow, true);
}

function dispatchSwipeAction(root, row, action) {
  const currentRow = resolveCurrentSwipeRow(root, row);
  currentRow.dispatchEvent(new CustomEvent('basketra:swipe-action', {
    bubbles: true,
    detail: { action, id: currentRow.dataset.swipeId, kind: currentRow.dataset.swipeKind },
  }));
}

export function bindSwipeActions(root = document) {
  let gesture;

  root.querySelectorAll('[data-swipe-row]').forEach(row => {
    if (isGenericSwipeRow(row)) closeSwipeRow(row);
  });

  root.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.clientX < 24 || event.target.closest('button,input,select,textarea,a,summary')) return;
    const row = event.target.closest('[data-swipe-row]');
    if (!isGenericSwipeRow(row) || !swipeContent(row)) return;
    closeSwipeRows(root, row);
    const width = Math.max(row.clientWidth, 1);
    gesture = {
      row,
      width,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      horizontal: false,
      deltaX: 0,
      initialOffset: row.dataset.swipeOpen === 'true'
        ? -Math.min(SWIPE_REVEAL_MAX_PX, Math.max(112, width * 0.42))
        : 0,
    };
  });

  root.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const deltaX = event.clientX - gesture.x;
    const deltaY = event.clientY - gesture.y;
    const row = resolveCurrentSwipeRow(root, gesture.row);
    if (!row.isConnected) {
      gesture = undefined;
      return;
    }
    gesture.row = row;
    if (!gesture.horizontal) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        gesture = undefined;
        return;
      }
      gesture.horizontal = true;
      row.classList.add('is-dragging');
      try {
        row.setPointerCapture?.(event.pointerId);
      } catch {
        // A realtime render can replace the pointerdown target before capture.
      }
    }
    event.preventDefault();
    gesture.deltaX = deltaX;
    const width = gesture.width;
    const minimum = row.dataset.swipeEndAction ? -width * 0.92 : -Math.min(SWIPE_REVEAL_MAX_PX, width * 0.42);
    const maximum = row.dataset.swipeStartAction ? width * 0.55 : 0;
    const offset = Math.max(minimum, Math.min(maximum, gesture.initialOffset + deltaX));
    const ratio = Math.abs(offset) / width;
    setSwipeOffset(row, offset);
    row.dataset.swipeDeleteArmed = String(offset < 0 && ratio >= SWIPE_END_COMMIT_RATIO && Boolean(row.dataset.swipeEndAction));
  }, { passive: false });

  const finish = (event, cancelled = false) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const { row: gestureRow, width, deltaX, horizontal, initialOffset } = gesture;
    gesture = undefined;
    const row = resolveCurrentSwipeRow(root, gestureRow);
    gestureRow.classList.remove('is-dragging');
    if (row !== gestureRow) row.classList.remove('is-dragging');
    if (!row.isConnected) return;
    if (!horizontal || cancelled) {
      if (initialOffset < 0) openSwipeRow(root, row);
      else closeSwipeRow(row);
      return;
    }

    const effectiveOffset = initialOffset + deltaX;
    const ratio = Math.abs(effectiveOffset) / width;
    if (effectiveOffset > 0 && ratio >= SWIPE_START_COMMIT_RATIO && row.dataset.swipeStartAction) {
      closeSwipeRow(row);
      dispatchSwipeAction(root, row, row.dataset.swipeStartAction);
      return;
    }
    if (effectiveOffset < 0 && ratio >= SWIPE_END_COMMIT_RATIO && row.dataset.swipeEndAction) {
      row.classList.add('is-swipe-committing');
      row.dataset.swipeDeleteArmed = 'true';
      setSwipeOffset(row, -row.clientWidth);
      const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150;
      setTimeout(() => dispatchSwipeAction(root, row, row.dataset.swipeEndAction), delay);
      return;
    }
    if (effectiveOffset < 0 && ratio >= SWIPE_REVEAL_RATIO && swipeActions(row)) {
      openSwipeRow(root, row);
      return;
    }
    closeSwipeRow(row);
  };

  root.addEventListener('pointerup', event => finish(event));
  root.addEventListener('pointercancel', event => finish(event, true));

  root.addEventListener('click', event => {
    const toggle = event.target.closest('[data-swipe-toggle]');
    if (toggle) {
      const row = toggle.closest('[data-swipe-row]');
      if (!isGenericSwipeRow(row)) return;
      if (row.dataset.swipeOpen === 'true') closeSwipeRow(row);
      else openSwipeRow(root, row);
      return;
    }
    const row = event.target.closest('[data-swipe-row]');
    if (row && !isGenericSwipeRow(row)) return;
    if (!row) {
      closeSwipeRows(root);
      return;
    }
    if (event.target.closest('[data-swipe-actions] button')) closeSwipeRow(row);
  });

  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const row = event.target.closest('[data-swipe-row]');
    if (isGenericSwipeRow(row)) closeSwipeRow(row);
  });
}

export function connectionStatus(connected) {
  return `${icon(connected ? 'wifi' : 'wifiOff')}<span>${connected ? 'Conectado' : 'Sin conexión'}</span>`;
}

export function suggestionOption(suggestion) {
  return `<button type="button" class="suggestion-option" role="option" data-suggestion="${escapeHtml(suggestion.name)}">${icon('plus')}<span>${escapeHtml(suggestion.name)}</span></button>`;
}

function swipeActionRail(editLabel, deleteLabel, editAttributes, deleteAttributes) {
  return `<div class="swipe-rail swipe-rail--end" data-swipe-actions aria-hidden="true">
    <button type="button" class="swipe-rail__action" data-primary-swipe-action ${editAttributes} tabindex="-1">${icon('edit')}<span>${escapeHtml(editLabel)}</span></button>
    <button type="button" class="swipe-rail__action swipe-rail__action--danger" data-destructive-action ${deleteAttributes} tabindex="-1">${icon('trash')}<span>${escapeHtml(deleteLabel)}</span></button>
    <span class="swipe-rail__commit" aria-hidden="true">${icon('trash')}<strong>Suelta para eliminar</strong></span>
  </div>`;
}

export function shoppingListItem(item, index, total) {
  const id = escapeHtml(item.id);
  const name = escapeHtml(item.text);
  const completionLabel = item.completed ? `Devolver ${name} a pendientes` : `Marcar ${name} como comprado`;
  const details = `${item.quantityMinor} ${escapeHtml(item.unit)} · ${item.exactRequired ? 'Exacto' : 'Flexible'} · ${item.substitutionAllowed ? 'Con alternativas' : 'Sin alternativas'}`;
  const editAttributes = `data-item-action="edit" data-item-id="${id}" aria-label="Editar ${name}"`;
  const deleteAttributes = `data-item-action="delete" data-item-id="${id}" aria-label="Eliminar ${name}"`;
  return `<li class="swipe-shell" data-swipe-row data-swipe-kind="shopping-item" data-swipe-id="${id}" data-swipe-start-action="complete" data-swipe-end-action="delete" data-swipe-open="false">
    <div class="swipe-rail swipe-rail--start" aria-hidden="true">${icon('check')}<strong>${item.completed ? 'Pendiente' : 'Completado'}</strong></div>
    ${swipeActionRail('Editar', 'Eliminar', editAttributes, deleteAttributes)}
    <div class="list-row${item.completed ? ' is-completed' : ''} swipe-content" data-swipe-content>
      <button type="button" class="completion-button" data-item-action="complete" data-item-id="${id}" aria-label="${completionLabel}" aria-pressed="${String(item.completed)}">${icon('check')}</button>
      <div class="list-row__content"><strong>${name}</strong><span>${details}</span></div>
      <div class="list-row__actions${item.completed ? ' list-row__actions--completed' : ''}">
        ${item.completed
          ? `<button type="button" class="button secondary completed-return-action" data-item-action="complete" data-item-id="${id}">${icon('refresh')}<span>Volver a pendientes</span></button>
             <button type="button" class="icon-button" data-swipe-toggle aria-expanded="false" aria-label="Mostrar acciones de ${name}">${icon('more')}</button>`
          : `<button type="button" class="icon-button" data-item-action="quantity" data-item-id="${id}" data-delta="-1" ${item.quantityMinor <= 1 ? 'disabled' : ''} aria-label="Reducir cantidad de ${name}">${icon('minus')}</button>
             <span class="quantity-chip" aria-label="Cantidad actual">${item.quantityMinor}</span>
             <button type="button" class="icon-button" data-item-action="quantity" data-item-id="${id}" data-delta="1" aria-label="Aumentar cantidad de ${name}">${icon('plus')}</button>
             <button type="button" class="icon-button" data-item-action="move" data-item-id="${id}" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Subir ${name}">${icon('chevronUp')}</button>
             <button type="button" class="icon-button" data-item-action="move" data-item-id="${id}" data-direction="1" ${index === total - 1 ? 'disabled' : ''} aria-label="Bajar ${name}">${icon('chevronDown')}</button>
             <button type="button" class="icon-button" data-swipe-toggle aria-expanded="false" aria-label="Mostrar acciones de ${name}">${icon('more')}</button>`}
      </div>
    </div>
  </li>`;
}

export function emptyListState(message = 'Añade el primer producto para empezar.') {
  return `<li class="empty-state"><span>${icon('list')}</span><strong>Sin productos</strong><small>${escapeHtml(message)}</small></li>`;
}

export function captureItem(capture, index, total) {
  const name = escapeHtml(capture.name);
  const isImage = capture.mimeType.startsWith('image/');
  const preview = isImage
    ? `<button type="button" class="capture-card__preview" data-capture-action="preview" data-capture-index="${index}" aria-label="Ampliar ${name}"><img data-capture-preview-image src="/api/v1/files/${encodeURIComponent(capture.storageKey)}" alt="Vista previa de ${name}" loading="lazy"><span class="capture-card__placeholder" hidden>${icon('image')}</span></button>`
    : `<span class="capture-card__placeholder" aria-label="Documento PDF">${icon('receipt')}<small>PDF</small></span>`;
  return `<li class="capture-card">
    ${preview}
    <div class="capture-card__content"><strong>${name}</strong><span>${formatBytes(capture.bytes)}</span></div>
    <div class="capture-card__actions">
      <button type="button" class="icon-button" data-capture-action="up" data-capture-index="${index}" ${index === 0 ? 'disabled' : ''} aria-label="Subir ${name}">${icon('chevronUp')}</button>
      <button type="button" class="icon-button" data-capture-action="down" data-capture-index="${index}" ${index === total - 1 ? 'disabled' : ''} aria-label="Bajar ${name}">${icon('chevronDown')}</button>
      <button type="button" class="icon-button danger" data-capture-action="delete" data-capture-index="${index}" aria-label="Retirar ${name} del borrador">${icon('trash')}</button>
    </div>
  </li>`;
}

export function proposalPanel(proposal) {
  return `<ul class="proposal-list">${proposal.items.map(item => `<li><strong>${escapeHtml(item.text)}</strong><span>${item.quantityMinor} ${escapeHtml(item.unit)}</span></li>`).join('')}</ul>`;
}

export function receiptReview(items, lines, total, categories = []) {
  const expected = total?.expectedMinor ?? items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
  const status = total?.valid === false ? 'warning' : 'success';
  const label = total?.valid === false ? 'Revisar total' : 'Total validado';
  const categoryNames = new Map(categories.map(category => [category.id, category.name]));
  return `<div class="review-summary"><div><p class="eyebrow">Revisión</p><h2>Comprueba cada línea</h2></div><span class="status-pill ${status}">${label}</span></div><div class="review-total"><span>Total calculado</span><strong>${formatEuroMinor(expected)}</strong></div><div class="receipt-items">${items.map((item, index) => receiptLine(item, index, lines[index], categoryNames.get(item.categoryId))).join('')}</div><button type="button" class="button secondary full" data-receipt-action="add-line">${icon('plus')}Añadir línea</button>`;
}

function receiptLine(item, index, validation = {}, categoryName = '') {
  const confirmed = validation.status === 'confirmed';
  const editAttributes = `data-receipt-action="edit" data-receipt-index="${index}" aria-label="Editar línea ${index + 1}"`;
  const deleteAttributes = `data-receipt-action="delete" data-receipt-index="${index}" aria-label="Eliminar línea ${index + 1}"`;
  const category = categoryName
    ? `<small class="receipt-line-category" data-receipt-category>${icon('tag')}<span>Categoría</span><strong data-receipt-category-label>${escapeHtml(categoryName)}</strong></small>`
    : '';
  return `<div class="swipe-shell" data-swipe-row data-swipe-kind="receipt-line" data-swipe-id="${index}" data-swipe-end-action="delete" data-swipe-open="false">
    ${swipeActionRail('Editar', 'Eliminar', editAttributes, deleteAttributes)}
    <fieldset class="receipt-item swipe-content" data-swipe-content data-item-index="${index}">
      <legend><span>Línea ${index + 1}</span><span class="receipt-item__legend-actions"><span class="status-pill ${confirmed ? 'success' : 'warning'}">${escapeHtml(validation.status || 'needs-review')}</span><button type="button" class="icon-button" data-swipe-toggle aria-expanded="false" aria-label="Mostrar acciones de la línea ${index + 1}">${icon('more')}</button></span></legend>
      <label class="field"><span>Producto</span><input data-field="description" maxlength="240" value="${escapeHtml(item.description)}" autocomplete="off">${category}</label>
      <div class="quantity-row"><label class="field"><span>Cantidad</span><input data-field="quantity" type="number" min="0" step="1" inputmode="numeric" value="${item.quantity}"></label><label class="field"><span>Precio unitario (€)</span><input data-field="unitPriceEuro" inputmode="decimal" value="${minorToEuroInput(item.unitPriceMinor)}"></label><label class="field"><span>Total (€)</span><input data-field="lineTotalEuro" inputmode="decimal" value="${minorToEuroInput(item.lineTotalMinor)}"></label></div>
    </fieldset>
  </div>`;
}

export function optimizationPlan(plan) {
  const presentation = {
    'single-retailer': ['store', 'Un solo comercio'],
    balanced: ['balance', 'Equilibrio recomendado'],
    'maximum-saving': ['savings', 'Máximo ahorro'],
  }[plan.kind] || ['prices', plan.kind];
  return `<article class="plan-card"><header><span>${icon(presentation[0])}</span><h2>${escapeHtml(presentation[1])}</h2></header><strong class="plan-total">${formatEuroMinor(plan.effectiveTotalMinor)}</strong><dl><div><dt>Comercios</dt><dd>${plan.retailerIds.length}</dd></div><div><dt>Faltantes</dt><dd>${plan.missingItemIds.length}</dd></div><div><dt>Confianza</dt><dd>${Math.round(plan.confidence * 100)}%</dd></div></dl><p>${escapeHtml(plan.explanation)}</p></article>`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
