const EURO_FORMATTER = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  sparkles: '<path d="m12 3 1.2 3.1L16 7.3l-2.8 1.2L12 12l-1.2-3.5L8 7.3l2.8-1.2Z"/><path d="m18.5 13 .8 2 1.7.8-1.7.8-.8 2.1-.8-2.1-1.7-.8 1.7-.8Z"/>',
  shield: '<path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6Z"/><path d="m9 12 2 2 4-5"/>',
  backup: '<path d="M4 7v5h5"/><path d="M5.5 12a7 7 0 1 0 2-5"/><path d="m4 7 3.5-3.5"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
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

function hideSwipeActions(root, except) {
  root.querySelectorAll('[data-swipe-actions]').forEach(actions => {
    if (actions !== except) actions.hidden = true;
  });
}

export function bindSwipeActions(root = document) {
  let gesture;
  root.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.clientX < 24 || event.target.closest('button,input,select,textarea,a,summary')) return;
    const row = event.target.closest('[data-swipe-row]');
    if (!row) return;
    gesture = { row, pointerId: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false, deltaX: 0 };
  });
  root.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const deltaX = event.clientX - gesture.x;
    const deltaY = event.clientY - gesture.y;
    if (!gesture.horizontal) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        gesture = undefined;
        return;
      }
      gesture.horizontal = true;
      gesture.row.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault();
    gesture.deltaX = deltaX;
  }, { passive: false });
  const finish = event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const { row, deltaX, horizontal } = gesture;
    gesture = undefined;
    if (!horizontal) return;
    const ratio = Math.abs(deltaX) / Math.max(row.clientWidth, 1);
    if (deltaX > 0 && ratio >= .38 && row.dataset.swipeStartAction) {
      row.dispatchEvent(new CustomEvent('basketra:swipe-action', { bubbles: true, detail: { action: row.dataset.swipeStartAction, id: row.dataset.swipeId, kind: row.dataset.swipeKind } }));
      return;
    }
    if (deltaX < 0) {
      const actions = row.querySelector('[data-swipe-actions]');
      if (!actions) return;
      hideSwipeActions(root, actions);
      actions.hidden = false;
      const target = ratio >= .62 ? actions.querySelector('[data-destructive-action]') : actions.querySelector('[data-primary-swipe-action]');
      target?.focus();
    }
  };
  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', finish);
  root.addEventListener('click', event => {
    if (!event.target.closest('[data-swipe-row]')) hideSwipeActions(root);
  });
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const row = event.target.closest('[data-swipe-row]');
    const actions = row?.querySelector('[data-swipe-actions]');
    if (actions) actions.hidden = true;
  });
}

export function connectionStatus(connected) {
  return `${icon(connected ? 'wifi' : 'wifiOff')}<span>${connected ? 'Conectado' : 'Sin conexión'}</span>`;
}

export function suggestionOption(suggestion) {
  return `<button type="button" class="suggestion-option" role="option" data-suggestion="${escapeHtml(suggestion.name)}">${icon('plus')}<span>${escapeHtml(suggestion.name)}</span></button>`;
}

export function shoppingListItem(item, index, total) {
  const id = escapeHtml(item.id);
  const name = escapeHtml(item.text);
  const completionLabel = item.completed ? `Devolver ${name} a pendientes` : `Marcar ${name} como comprado`;
  const details = `${item.quantityMinor} ${escapeHtml(item.unit)} · ${item.exactRequired ? 'Exacto' : 'Flexible'} · ${item.substitutionAllowed ? 'Con alternativas' : 'Sin alternativas'}`;
  return `<li class="list-row${item.completed ? ' is-completed' : ''}" data-swipe-row data-swipe-kind="shopping-item" data-swipe-id="${id}" data-swipe-start-action="complete">
    <button type="button" class="completion-button" data-item-action="complete" data-item-id="${id}" aria-label="${completionLabel}" aria-pressed="${String(item.completed)}">${icon('check')}</button>
    <div class="list-row__content"><strong>${name}</strong><span>${details}</span></div>
    <div class="list-row__actions">
      <button type="button" class="icon-button" data-item-action="quantity" data-item-id="${id}" data-delta="-1" ${item.quantityMinor <= 1 ? 'disabled' : ''} aria-label="Reducir cantidad de ${name}">${icon('minus')}</button>
      <span class="quantity-chip" aria-label="Cantidad actual">${item.quantityMinor}</span>
      <button type="button" class="icon-button" data-item-action="quantity" data-item-id="${id}" data-delta="1" aria-label="Aumentar cantidad de ${name}">${icon('plus')}</button>
      <button type="button" class="icon-button" data-item-action="move" data-item-id="${id}" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Subir ${name}">${icon('chevronUp')}</button>
      <button type="button" class="icon-button" data-item-action="move" data-item-id="${id}" data-direction="1" ${index === total - 1 ? 'disabled' : ''} aria-label="Bajar ${name}">${icon('chevronDown')}</button>
    </div>
    <div class="list-row__actions" data-swipe-actions hidden>
      <button type="button" class="icon-button" data-primary-swipe-action data-item-action="edit" data-item-id="${id}" aria-label="Editar ${name}">${icon('edit')}</button>
      <button type="button" class="icon-button danger" data-destructive-action data-item-action="delete" data-item-id="${id}" aria-label="Eliminar ${name}">${icon('trash')}</button>
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

export function receiptReview(items, lines, total) {
  const expected = total?.expectedMinor ?? items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
  const status = total?.valid === false ? 'warning' : 'success';
  const label = total?.valid === false ? 'Revisar total' : 'Total validado';
  return `<div class="review-summary"><div><p class="eyebrow">Revisión</p><h2>Comprueba cada línea</h2></div><span class="status-pill ${status}">${label}</span></div><div class="review-total"><span>Total calculado</span><strong>${formatEuroMinor(expected)}</strong></div><div class="receipt-items">${items.map((item, index) => receiptLine(item, index, lines[index])).join('')}</div><button type="button" class="button secondary full" data-receipt-action="add-line">${icon('plus')}Añadir línea</button>`;
}

function receiptLine(item, index, validation = {}) {
  const confirmed = validation.status === 'confirmed';
  return `<fieldset class="receipt-item" data-item-index="${index}" data-swipe-row data-swipe-kind="receipt-line" data-swipe-id="${index}"><legend>Línea ${index + 1}<span class="status-pill ${confirmed ? 'success' : 'warning'}">${escapeHtml(validation.status || 'needs-review')}</span></legend><label class="field"><span>Producto</span><input data-field="description" maxlength="240" value="${escapeHtml(item.description)}" autocomplete="off"></label><div class="quantity-row"><label class="field"><span>Cantidad</span><input data-field="quantity" type="number" min="0" step="1" inputmode="numeric" value="${item.quantity}"></label><label class="field"><span>Precio unitario (€)</span><input data-field="unitPriceEuro" inputmode="decimal" value="${minorToEuroInput(item.unitPriceMinor)}"></label><label class="field"><span>Total (€)</span><input data-field="lineTotalEuro" inputmode="decimal" value="${minorToEuroInput(item.lineTotalMinor)}"></label></div><div class="list-row__actions" data-swipe-actions hidden><button type="button" class="icon-button" data-primary-swipe-action data-receipt-action="edit" data-receipt-index="${index}" aria-label="Editar línea ${index + 1}">${icon('edit')}</button><button type="button" class="icon-button danger" data-destructive-action data-receipt-action="delete" data-receipt-index="${index}" aria-label="Eliminar línea ${index + 1}">${icon('trash')}</button></div></fieldset>`;
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
