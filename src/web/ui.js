const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5Z"/><path d="M9 21v-6h6v6"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="m3.5 6 .8.8L6 5M3.5 12l.8.8L6 11M3.5 18l.8.8L6 17"/>',
  scan: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M7 9h10M7 12h10M7 15h6"/>',
  prices: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/><path d="m3 6 5-3 5 4 7-5"/>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20.3h-3v-.08a1.7 1.7 0 0 0-1.03-1.56A1.7 1.7 0 0 0 8.8 19l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7.02 15a1.7 1.7 0 0 0-1.56-1.03H5.4v-3h.08A1.7 1.7 0 0 0 7.04 9.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56V4.6h3v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03h.08v3h-.08A1.7 1.7 0 0 0 19.4 15Z"/>',
  cart: '<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M3 4h2l2.4 10.5a2 2 0 0 0 2 1.5h7.8a2 2 0 0 0 1.9-1.4L21 8H6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  sparkles: '<path d="m12 3 1.2 3.1L16 7.3l-2.8 1.2L12 12l-1.2-3.5L8 7.3l2.8-1.2Z"/><path d="m18.5 13 .8 2 1.7.8-1.7.8-.8 2.1-.8-2.1-1.7-.8 1.7-.8ZM5.5 14l1 2.5L9 17.6l-2.5 1.1-1 2.6-1-2.6L2 17.6l2.5-1.1Z"/>',
  shield: '<path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6Z"/><path d="m9 12 2 2 4-5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  backup: '<path d="M4 7v5h5"/><path d="M5.5 12a7 7 0 1 0 2-5"/><path d="m4 7 3.5-3.5"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  wifi: '<path d="M5 9a10 10 0 0 1 14 0M8 12a6 6 0 0 1 8 0M11 15a2 2 0 0 1 2 0"/><circle cx="12" cy="18" r=".7" fill="currentColor" stroke="none"/>',
  wifiOff: '<path d="m3 3 18 18M8.5 8.5A10 10 0 0 1 19 9M5 9a10 10 0 0 1 1.8-1.4M9.5 12.5A6 6 0 0 1 16 12M8 12a6 6 0 0 1 .7-.5M11 15a2 2 0 0 1 2 0"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  balance: '<path d="M12 4v16M5 7h14M7 7l-4 7h8ZM17 7l-4 7h8Z"/>',
  store: '<path d="M4 10v10h16V10M3 10l2-6h14l2 6"/><path d="M8 20v-6h8v6M3 10c0 1.2 1 2 2.2 2 1.3 0 2.3-.8 2.3-2 0 1.2 1 2 2.3 2 1.2 0 2.2-.8 2.2-2 0 1.2 1 2 2.2 2 1.3 0 2.3-.8 2.3-2 0 1.2 1 2 2.3 2 1.2 0 2.2-.8 2.2-2"/>',
  savings: '<path d="M5 8.5C5 6 7.7 4 11 4s6 2 6 4.5S14.3 13 11 13 5 11 5 8.5Z"/><path d="M17 8.5V15c0 2.5-2.7 4.5-6 4.5S5 17.5 5 15V8.5M8.5 8h5"/><path d="M19 4v4M17 6h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  alert: '<path d="M12 4 3 20h18Z"/><path d="M12 9v5M12 17h.01"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

export function icon(name, className = 'icon') {
  const content = ICONS[name];
  if (!content) throw new Error(`Unknown icon: ${name}`);
  return `<svg class="${escapeHtml(className)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${content}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(element => {
    element.innerHTML = icon(element.dataset.icon, element.dataset.iconClass || 'icon');
  });
}

export function connectionStatus(connected) {
  return `${icon(connected ? 'wifi' : 'wifiOff')}<span>${connected ? 'Conectado' : 'Sin conexión'}</span>`;
}

export function suggestionOption(suggestion) {
  return `<button type="button" class="suggestion-option" role="option" data-suggestion="${escapeHtml(suggestion.name)}">${icon('plus')}<span>${escapeHtml(suggestion.name)}</span></button>`;
}

export function shoppingListItem(item) {
  const exactLabel = item.exactRequired ? 'Producto exacto' : 'Sustitución permitida';
  const alternativeLabel = item.substitutionAllowed ? 'Con alternativas' : 'Sin alternativas';
  return `<li class="list-row"><span class="list-row__icon">${icon('cart')}</span><div class="list-row__content"><strong>${escapeHtml(item.text)}</strong><span>${item.quantityMinor} ${escapeHtml(item.unit)} · ${exactLabel}</span></div><span class="status-pill">${alternativeLabel}</span></li>`;
}

export function emptyListState() {
  return `<li class="empty-state"><span class="empty-state__icon">${icon('list')}</span><strong>Tu lista está vacía</strong><span>Añade el primer producto para empezar a comparar.</span></li>`;
}

export function captureItem(capture, index, total) {
  return `<li class="capture-card"><span class="capture-card__icon">${icon('receipt')}</span><div class="capture-card__content"><strong>${escapeHtml(capture.name)}</strong><span>${escapeHtml(capture.mimeType)} · ${formatBytes(capture.bytes)}</span></div><div class="capture-card__actions" aria-label="Acciones de ${escapeHtml(capture.name)}"><button type="button" class="icon-button ghost" data-up="${index}" ${index === 0 ? 'disabled' : ''} aria-label="Subir">${icon('chevronUp')}</button><button type="button" class="icon-button ghost" data-down="${index}" ${index === total - 1 ? 'disabled' : ''} aria-label="Bajar">${icon('chevronDown')}</button><button type="button" class="icon-button danger" data-delete="${index}" aria-label="Eliminar">${icon('trash')}</button></div></li>`;
}

export function proposalPanel(proposal) {
  return `<div class="panel-heading"><span class="section-icon">${icon('sparkles')}</span><div><p class="eyebrow">Asistencia opcional</p><h2>Propuestas IA</h2></div></div><ul class="proposal-list">${proposal.items.map(item => `<li><strong>${escapeHtml(item.text)}</strong><span>${item.quantityMinor} ${escapeHtml(item.unit)}</span>${item.ambiguity ? `<small>${escapeHtml(item.ambiguity)}</small>` : ''}</li>`).join('')}</ul>`;
}

export function receiptReview(items, lines, total) {
  const expectedTotal = total?.expectedMinor ?? items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
  const totalTone = total?.valid === false ? 'warning' : 'success';
  const totalLabel = total?.valid === false ? 'Revisar diferencia' : 'Total validado';
  const prioritized = items.map((item, index) => ({ item, index, validation: lines[index] || { status: 'needs-review' } }))
    .sort((left, right) => Number(left.validation.status === 'confirmed') - Number(right.validation.status === 'confirmed') || left.index - right.index);
  return `<div class="review-summary"><div><p class="eyebrow">Revisión antes de importar</p><h2>Comprueba las líneas</h2></div><span class="status-pill ${totalTone}">${icon(totalTone === 'success' ? 'check' : 'alert')}${totalLabel}</span></div><div class="review-total"><span>Total calculado</span><strong>${expectedTotal} céntimos</strong></div><div class="receipt-items">${prioritized.map(({ item, index, validation }) => receiptLine(item, index, validation)).join('')}</div>`;
}

function receiptLine(item, index, validation) {
  const confirmed = validation.status === 'confirmed';
  return `<fieldset class="receipt-item" data-item-index="${index}"><legend><span>Línea ${index + 1}</span><span class="status-pill ${confirmed ? 'success' : 'warning'}">${icon(confirmed ? 'check' : 'alert')}${escapeHtml(validation.status)}</span></legend><label class="field field-wide"><span>Descripción</span><input data-field="description" maxlength="240" value="${escapeHtml(item.description)}"></label><div class="field-grid receipt-numbers"><label class="field"><span>Cantidad</span><input data-field="quantity" type="number" min="0" value="${item.quantity}"></label><label class="field"><span>Precio unitario</span><input data-field="unitPriceMinor" type="number" min="0" value="${item.unitPriceMinor}" inputmode="numeric"><small>céntimos</small></label><label class="field"><span>Total línea</span><input data-field="lineTotalMinor" type="number" min="0" value="${item.lineTotalMinor}" inputmode="numeric"><small>céntimos</small></label></div><small class="confidence">Confianza ${Math.round((item.confidence ?? 1) * 100)}%</small></fieldset>`;
}

export function optimizationPlan(plan) {
  const presentation = {
    'single-retailer': { iconName: 'store', label: 'Un solo comercio', detail: 'La compra más simple' },
    balanced: { iconName: 'balance', label: 'Equilibrio recomendado', detail: 'Ahorro sin complicarte' },
    'maximum-savings': { iconName: 'savings', label: 'Máximo ahorro', detail: 'Prioriza el menor coste' },
  }[plan.kind] || { iconName: 'prices', label: plan.kind, detail: 'Plan calculado' };
  return `<article class="plan-card"><header><span class="plan-card__icon">${icon(presentation.iconName)}</span><div><p class="eyebrow">${presentation.detail}</p><h2>${presentation.label}</h2></div></header><div class="plan-total"><span>Total efectivo</span><strong>${plan.effectiveTotalMinor} cént.</strong></div><dl class="metric-grid"><div><dt>Comercios</dt><dd>${plan.retailerIds.length}</dd></div><div><dt>Faltantes</dt><dd>${plan.missingItemIds.length}</dd></div><div><dt>Confianza</dt><dd>${Math.round(plan.confidence * 100)}%</dd></div></dl><p>${escapeHtml(plan.explanation)}</p>${plan.substitutions.length ? `<div class="inline-note">${icon('info')}<span>Sustituciones: ${plan.substitutions.map(escapeHtml).join(', ')}</span></div>` : ''}</article>`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
