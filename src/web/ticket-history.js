import { api, setBusy } from './api.js';
import {
  escapeHtml,
  euroInputToMinor,
  formatEuroMinor,
  hydrateIcons,
  icon,
  minorToEuroInput,
} from './ui.js';
import {
  enhanceReceiptInvoiceEditor,
  refreshReceiptInvoiceEditor,
} from './receipt-editor-invoice.js';
import { localDateBoundaryIso, parsePercentageBasisPoints } from './ticket-history-values.js';

const PAGE_SIZE = 12;
const SEARCH_DELAY_MS = 250;
const LINE_CALCULATION_DELAY_MS = 120;
const STORE_METADATA_PAGE_SIZE = 100;
const STORE_METADATA_MAX_PAGES = 5;
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

const $ = selector => document.querySelector(selector);

const state = {
  initialized: false,
  page: 1,
  query: '',
  dateFrom: '',
  dateTo: '',
  storeId: '',
  categoryId: '',
  paymentStatus: '',
  result: { tickets: [], total: 0, offset: 0, limit: PAGE_SIZE, hasMore: false, summary: {} },
  stores: [],
  categories: [],
  units: [],
  metadataLoaded: { stores: false, categories: false, units: false },
  ticket: null,
  editorItems: [],
  searchTimer: null,
  loadController: null,
  loadGeneration: 0,
  lineIndex: -1,
  lineCalculationTimer: null,
  lineCalculationController: null,
  lineCalculationGeneration: 0,
};

function injectStylesheet() {
  if (document.querySelector('link[href="/ticket-history.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/ticket-history.css';
  document.head.append(link);
}

function installTicketEntryNavigation() {
  const capture = document.querySelector('.view[data-view="scan"]');
  const header = capture?.querySelector('.page-header');
  if (!capture || !header || capture.querySelector('[data-ticket-destinations]')) return;

  const nav = document.createElement('nav');
  nav.className = 'task-tablist ticket-destination-tabs';
  nav.dataset.ticketDestinations = 'true';
  nav.setAttribute('aria-label', 'Secciones de Tickets');
  nav.innerHTML = `
    <button class="task-tab" type="button" data-ticket-destination="capture" aria-current="page">Captura</button>
    <button class="task-tab" type="button" data-ticket-destination="history">Historial</button>`;
  header.insertAdjacentElement('afterend', nav);
  nav.querySelector('[data-ticket-destination="capture"]').addEventListener('click', () => navigateToCapture());
  nav.querySelector('[data-ticket-destination="history"]').addEventListener('click', () => void activateTicketHistory({ push: true }));
}

function installHistoryView() {
  if (document.querySelector('.view[data-view="ticket-history"]')) return;
  const main = $('#main');
  if (!main) return;

  const view = document.createElement('section');
  view.className = 'view ticket-history-view';
  view.dataset.view = 'ticket-history';
  view.innerHTML = `
    <section id="ticket-history-list-screen" class="ticket-history-screen" aria-labelledby="ticket-history-title">
      <header class="inventory-entity-header ticket-history-header">
        <div><p class="eyebrow">Tickets · Historial</p><h1 id="ticket-history-title">Historial de tickets</h1><p>Busca tickets confirmados, revisa el periodo y abre cada factura sin alterar su evidencia original.</p></div>
        <button id="ticket-history-capture" class="button primary" type="button"><span data-icon="camera"></span>Importar ticket</button>
      </header>
      <nav class="task-tablist ticket-destination-tabs" aria-label="Secciones de Tickets">
        <button class="task-tab" type="button" data-ticket-history-capture>Captura</button>
        <button class="task-tab" type="button" aria-current="page">Historial</button>
      </nav>
      <section class="surface ticket-history-toolbar" aria-label="Filtros del historial">
        <label class="field ticket-history-search"><span>Buscar</span><input id="ticket-history-search" type="search" maxlength="160" autocomplete="off" placeholder="Tienda, nota, importe o ID"></label>
        <label class="field"><span>Desde</span><input id="ticket-history-date-from" type="date"></label>
        <label class="field"><span>Hasta</span><input id="ticket-history-date-to" type="date"></label>
        <label class="field"><span>Tienda</span><select id="ticket-history-store"><option value="">Todas</option></select></label>
        <label class="field"><span>Categoría</span><select id="ticket-history-category"><option value="">Todas</option></select></label>
        <label class="field"><span>Estado</span><select id="ticket-history-status"><option value="">Todos</option><option value="paid">Pagado</option><option value="pending">Pendiente</option><option value="cancelled">Cancelado</option></select></label>
        <button id="ticket-history-clear" class="button secondary" type="button">Limpiar filtros</button>
      </section>
      <p id="ticket-history-state" class="inline-status" role="status" aria-live="polite"></p>
      <section class="ticket-history-summary" aria-label="Resumen del periodo">
        <article class="surface"><span>Tickets</span><strong id="ticket-summary-count">0</strong></article>
        <article class="surface"><span>Gasto</span><strong id="ticket-summary-spent">0,00 €</strong></article>
        <article class="surface"><span>Artículos</span><strong id="ticket-summary-items">0</strong></article>
        <article class="surface"><span>Ticket medio</span><strong id="ticket-summary-average">0,00 €</strong></article>
      </section>
      <section class="surface ticket-history-list-surface" aria-label="Tickets históricos">
        <div class="ticket-history-list-heading ticket-history-grid" aria-hidden="true"><span>Fecha</span><span>Tienda</span><span>Importe</span><span>Artículos</span><span>Estado</span><span>Pago</span><span>Notas</span><span></span></div>
        <div id="ticket-history-list" class="ticket-history-list" aria-live="polite"></div>
        <footer class="inventory-pagination"><span id="ticket-history-range">0 resultados</span><div><button id="ticket-history-prev" class="button secondary" type="button">Anterior</button><span id="ticket-history-page" class="count-badge">1</span><button id="ticket-history-next" class="button secondary" type="button">Siguiente</button></div></footer>
      </section>
    </section>

    <section id="ticket-history-detail-screen" class="ticket-history-screen" aria-labelledby="ticket-editor-title" hidden>
      <header class="inventory-detail-header ticket-editor-header">
        <button id="ticket-history-back" class="button secondary" type="button"><span data-icon="chevronUp" class="icon-rotate-left"></span>Historial</button>
        <div class="inventory-detail-header__copy"><p class="eyebrow">Ticket histórico</p><h1 id="ticket-editor-title">Ticket</h1><p id="ticket-editor-identity"></p></div>
        <div class="inventory-header-actions"><span id="ticket-editor-status" class="status-pill">Guardado</span><button id="ticket-delete" class="button danger" type="button"><span data-icon="trash"></span>Eliminar</button></div>
      </header>
      <form id="ticket-editor-form" class="ticket-editor-form">
        <section class="surface ticket-editor-metadata" aria-labelledby="ticket-metadata-title">
          <div class="section-header"><div><p class="eyebrow">Factura</p><h2 id="ticket-metadata-title">Datos del ticket</h2></div></div>
          <div class="ticket-editor-metadata-grid">
            <label class="field"><span>Fecha y hora</span><input id="ticket-editor-purchased-at" type="datetime-local" required></label>
            <label class="field"><span>Tienda</span><select id="ticket-editor-store"><option value="">Sin tienda</option></select></label>
            <label class="field"><span>Estado</span><select id="ticket-editor-payment-status"><option value="paid">Pagado</option><option value="pending">Pendiente</option><option value="cancelled">Cancelado</option></select></label>
            <label class="field"><span>Método de pago</span><input id="ticket-editor-payment-method" maxlength="80" autocomplete="off"></label>
          </div>
        </section>
        <section class="ticket-editor-total-grid" aria-label="Totales canónicos">
          <article class="surface"><span>Impuestos</span><strong id="ticket-editor-tax">0,00 €</strong></article>
          <article class="surface"><span>Descuento de ticket</span><strong id="ticket-editor-discount">0,00 €</strong></article>
          <article class="surface ticket-editor-total"><span>Total backend</span><strong id="ticket-editor-total">0,00 €</strong><small>Se recalcula al guardar desde las líneas, impuestos y descuento.</small></article>
        </section>
        <section class="surface ticket-editor-lines" aria-labelledby="ticket-lines-title">
          <div class="section-header"><div><p class="eyebrow">Artículos</p><h2 id="ticket-lines-title">Líneas del ticket</h2></div><button id="ticket-add-line" class="button secondary" type="button"><span data-icon="plus"></span>Añadir artículo</button></div>
          <div class="ticket-line-heading ticket-line-grid" aria-hidden="true"><span>Producto</span><span>Categoría</span><span>Cantidad</span><span>Unidad</span><span>Unitario</span><span>Descuento</span><span>Total</span><span></span></div>
          <div id="ticket-editor-lines-list" class="ticket-editor-lines-list"></div>
        </section>
        <section class="surface ticket-editor-notes"><label class="field"><span>Notas</span><textarea id="ticket-editor-notes" maxlength="2000" rows="4"></textarea></label><div class="quantity-row"><label class="field"><span>Impuestos (€)</span><input id="ticket-editor-tax-input" inputmode="decimal"></label><label class="field"><span>Descuento del ticket (€)</span><input id="ticket-editor-discount-input" inputmode="decimal"></label></div></section>
        <p id="ticket-editor-form-state" class="inline-status" role="status"></p>
        <div class="ticket-editor-footer-actions"><button id="ticket-editor-cancel" class="button secondary" type="button">Cancelar cambios</button><button id="ticket-editor-save" class="button primary" type="submit"><span data-icon="check"></span>Guardar cambios</button></div>
      </form>
    </section>`;
  main.append(view);

  const lineDialog = document.createElement('dialog');
  lineDialog.id = 'historical-ticket-line-dialog';
  lineDialog.className = 'sheet-dialog receipt-invoice-dialog ticket-line-dialog';
  lineDialog.setAttribute('aria-labelledby', 'historical-ticket-line-title');
  lineDialog.innerHTML = `
    <form id="historical-ticket-line-form" class="dialog-content receipt-invoice-dialog__content">
      <div class="dialog-header receipt-invoice-dialog__header"><div><p class="eyebrow">Línea del ticket</p><h2 id="historical-ticket-line-title">Editar artículo</h2></div><button id="historical-ticket-line-close" data-editor-action="close" class="icon-button" type="button" aria-label="Cerrar"><span data-icon="close"></span></button></div>
      <div class="receipt-invoice-dialog__slot" data-editor-slot>
        <fieldset class="receipt-item receipt-item--editing" data-receipt-line-editor data-editor-validation="review">
          <legend>Línea del ticket</legend>
          <label class="field"><span>Producto</span><input id="historical-ticket-line-description" data-field="description" maxlength="240" required autocomplete="off"></label>
          <label class="field receipt-editor-category-field"><span>Categoría</span><select id="historical-ticket-line-category"><option value="">Sin categoría</option></select></label>
          <div class="quantity-row"><label class="field"><span>Cantidad</span><input id="historical-ticket-line-quantity" data-field="quantity" type="number" min="1" max="100000" step="1" required></label><label class="field"><span>Unidad</span><select id="historical-ticket-line-unit"></select></label><label class="field"><span>Precio unitario (€)</span><input id="historical-ticket-line-unit-price" data-field="unitPriceEuro" inputmode="decimal" required></label></div>
          <div class="quantity-row"><label class="field receipt-discount-type-field"><span>Descuento</span><select id="historical-ticket-line-discount-type" data-field="discountType"><option value="none">Sin descuento</option><option value="amount">Importe (€)</option><option value="percentage">Porcentaje</option></select></label><label id="historical-ticket-line-discount-field" class="field receipt-discount-value-field"><span id="historical-ticket-line-discount-label">Valor</span><input id="historical-ticket-line-discount-value" data-field="discountValue" inputmode="decimal"></label><label id="historical-ticket-line-discount-quantity-field" class="field receipt-discount-quantity-field"><span>Unidades con descuento</span><input id="historical-ticket-line-discount-quantity" data-field="discountQuantity" type="number" min="1" step="1"></label><output id="historical-ticket-line-total" class="receipt-line-result" data-field="lineTotalEuro" aria-label="Total calculado (€)">0.00</output><p id="historical-ticket-line-state" class="inline-status receipt-line-derived-state" role="status" aria-live="polite"></p></div>
        </fieldset>
      </div>
      <div class="dialog-actions receipt-line-editor-actions receipt-invoice-dialog__actions" data-editor-actions><button id="historical-ticket-line-cancel" class="button secondary" type="button">Cancelar</button><button id="historical-ticket-line-save" data-editor-action="save" class="button primary" type="submit"><span data-icon="check"></span>Guardar línea</button></div>
    </form>`;
  document.body.append(lineDialog);
  enhanceReceiptInvoiceEditor(lineDialog);
  const deleteDialog = document.createElement('dialog');
  deleteDialog.id = 'ticket-history-delete-dialog';
  deleteDialog.className = 'confirm-dialog';
  deleteDialog.setAttribute('aria-labelledby', 'ticket-history-delete-title');
  deleteDialog.innerHTML = `<div class="dialog-content"><span class="dialog-icon" data-icon="alert"></span><h2 id="ticket-history-delete-title">Eliminar ticket</h2><p id="ticket-history-delete-identity"></p><p id="ticket-history-delete-impact">Comprobando evidencia histórica…</p><p id="ticket-history-delete-state" class="inline-status" role="status"></p><div class="dialog-actions"><button id="ticket-history-delete-cancel" class="button secondary" type="button">Cancelar</button><button id="ticket-history-delete-confirm" class="button danger" type="button" disabled>Eliminar ticket</button></div></div>`;
  document.body.append(deleteDialog);

  hydrateIcons(view);
  hydrateIcons(lineDialog);
  hydrateIcons(deleteDialog);
}

function navigateToCapture() {
  document.dispatchEvent(new CustomEvent('basketra:navigate', { detail: { route: 'scan' } }));
}

function setPrimaryTicketsActive() {
  document.querySelectorAll('.bottom-nav [data-nav]').forEach(element => element.removeAttribute('aria-current'));
  document.querySelector('.bottom-nav [data-nav="scan"]')?.setAttribute('aria-current', 'page');
}

function activateFeatureView() {
  const view = document.querySelector('.view[data-view="ticket-history"]');
  if (!view) return false;
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element === view));
  setPrimaryTicketsActive();
  document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: 'ticket-history' } }));
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo(0, 0);
  $('#main')?.focus({ preventScroll: true });
  return true;
}

function readFilters() {
  state.query = $('#ticket-history-search').value.trim();
  state.dateFrom = $('#ticket-history-date-from').value;
  state.dateTo = $('#ticket-history-date-to').value;
  state.storeId = $('#ticket-history-store').value;
  state.categoryId = $('#ticket-history-category').value;
  state.paymentStatus = $('#ticket-history-status').value;
}

function historyQueryString() {
  const params = new URLSearchParams({
    q: state.query,
    limit: String(PAGE_SIZE),
    offset: String((state.page - 1) * PAGE_SIZE),
  });
  if (state.dateFrom) params.set('dateFrom', localDateBoundaryIso(state.dateFrom));
  if (state.dateTo) params.set('dateTo', localDateBoundaryIso(state.dateTo, { endOfDay: true }));
  if (state.storeId) params.set('storeId', state.storeId);
  if (state.categoryId) params.set('categoryId', state.categoryId);
  if (state.paymentStatus) params.set('paymentStatus', state.paymentStatus);
  return params.toString();
}

function ticketStatusLabel(status) {
  return ({ paid: 'Pagado', pending: 'Pendiente', cancelled: 'Cancelado' })[status] || String(status || '—');
}

function ticketStatusClass(status) {
  if (status === 'paid') return 'success';
  if (status === 'pending') return 'warning';
  return 'danger';
}

function ticketDate(ticket) {
  const timestamp = ticket.purchasedAt || ticket.createdAt;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? String(timestamp || '—') : DATE_TIME_FORMATTER.format(parsed);
}

function swipeRail(ticket) {
  const id = escapeHtml(ticket.id);
  return `<div class="swipe-rail swipe-rail--end" data-swipe-actions aria-hidden="true"><button type="button" class="swipe-rail__action" data-ticket-action="edit" data-ticket-id="${id}" tabindex="-1">${icon('edit')}<span>Editar</span></button><button type="button" class="swipe-rail__action swipe-rail__action--danger" data-ticket-action="delete" data-ticket-id="${id}" tabindex="-1">${icon('trash')}<span>Eliminar</span></button><span class="swipe-rail__commit" aria-hidden="true">${icon('trash')}<strong>Suelta para eliminar</strong></span></div>`;
}

function ticketRow(ticket) {
  const id = escapeHtml(ticket.id);
  const statusLabel = escapeHtml(ticketStatusLabel(ticket.paymentStatus));
  return `<article class="swipe-shell ticket-history-swipe" data-swipe-row data-swipe-kind="ticket-history" data-swipe-id="${id}" data-swipe-end-action="delete" data-swipe-open="false">${swipeRail(ticket)}<div class="ticket-history-row ticket-history-grid swipe-content" data-swipe-content role="button" tabindex="0" data-ticket-action="open" data-ticket-id="${id}" aria-label="Abrir ticket ${id}"><span data-label="Fecha"><strong>${escapeHtml(ticketDate(ticket))}</strong><small>${id}</small></span><span data-label="Tienda">${escapeHtml(ticket.storeName || ticket.retailerName || 'Sin tienda')}</span><strong data-label="Importe">${escapeHtml(formatEuroMinor(ticket.declaredTotalMinor))}</strong><span data-label="Artículos">${Number(ticket.itemCount || 0)}</span><span data-label="Estado"><span class="status-pill ${ticketStatusClass(ticket.paymentStatus)}">${statusLabel}</span></span><span data-label="Pago">${escapeHtml(ticket.paymentMethod || '—')}</span><span class="ticket-history-notes" data-label="Notas">${escapeHtml(ticket.notes || '—')}</span><span class="inventory-row-action">Ver</span><button type="button" class="icon-button ticket-history-more" data-swipe-toggle aria-expanded="false" aria-label="Mostrar acciones del ticket ${id}">${icon('more')}</button></div></article>`;
}

function renderSummary() {
  const summary = state.result.summary || {};
  $('#ticket-summary-count').textContent = String(Number(summary.ticketCount || 0));
  $('#ticket-summary-spent').textContent = formatEuroMinor(Number(summary.totalSpentMinor || 0));
  $('#ticket-summary-items').textContent = String(Number(summary.itemCount || 0));
  $('#ticket-summary-average').textContent = formatEuroMinor(Number(summary.averageTicketMinor || 0));
}

function renderHistory() {
  const container = $('#ticket-history-list');
  const tickets = Array.isArray(state.result.tickets) ? state.result.tickets : [];
  container.innerHTML = tickets.length
    ? tickets.map(ticketRow).join('')
    : '<div class="catalog-empty"><strong>No hay tickets para estos filtros.</strong><span>Prueba otro periodo, tienda, categoría o estado.</span></div>';

  const total = Number(state.result.total || 0);
  const offset = Number(state.result.offset || 0);
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + tickets.length, total);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  $('#ticket-history-range').textContent = `${from}-${to} de ${total}`;
  $('#ticket-history-page').textContent = `${state.page} / ${pages}`;
  $('#ticket-history-prev').disabled = state.page <= 1;
  $('#ticket-history-next').disabled = !state.result.hasMore;
  renderSummary();
}

async function loadStoreOptions() {
  const stores = [];
  let offset = 0;
  for (let page = 0; page < STORE_METADATA_MAX_PAGES; page += 1) {
    const result = await api(`/api/v1/inventory/stores?sort=name&limit=${STORE_METADATA_PAGE_SIZE}&offset=${offset}`);
    const pageStores = Array.isArray(result.stores) ? result.stores : [];
    stores.push(...pageStores);
    if (!result.hasMore || pageStores.length === 0) break;
    offset += pageStores.length;
  }
  state.stores = stores;
  state.metadataLoaded.stores = true;
}

function renderMetadataOptions() {
  const historyStore = $('#ticket-history-store');
  const editorStore = $('#ticket-editor-store');
  const currentEditorStore = state.ticket?.storeId || '';
  historyStore.replaceChildren(new Option('Todas', ''));
  editorStore.replaceChildren(new Option('Sin tienda', ''));
  for (const store of state.stores) {
    const label = `${store.name}${store.retailerName && store.retailerName !== store.name ? ` · ${store.retailerName}` : ''}`;
    historyStore.append(new Option(label, store.id));
    editorStore.append(new Option(label, store.id));
  }
  historyStore.value = state.storeId;
  if (currentEditorStore && ![...editorStore.options].some(option => option.value === currentEditorStore)) {
    editorStore.append(new Option(state.ticket?.storeName || currentEditorStore, currentEditorStore));
  }
  editorStore.value = currentEditorStore;

  const historyCategory = $('#ticket-history-category');
  const lineCategory = $('#historical-ticket-line-category');
  historyCategory.replaceChildren(new Option('Todas', ''));
  lineCategory.replaceChildren(new Option('Sin categoría', ''));
  for (const category of state.categories) {
    historyCategory.append(new Option(category.name, category.id));
    lineCategory.append(new Option(category.name, category.id));
  }
  historyCategory.value = state.categoryId;

  const lineUnit = $('#historical-ticket-line-unit');
  lineUnit.replaceChildren();
  for (const unit of state.units) lineUnit.append(new Option(unit, unit));
}

async function ensureMetadata() {
  const [categories, meta] = await Promise.all([
    state.metadataLoaded.categories ? null : api('/api/v1/categories'),
    state.metadataLoaded.units ? null : api('/api/v1/meta'),
    state.metadataLoaded.stores ? null : loadStoreOptions(),
  ]);
  if (categories) {
    state.categories = Array.isArray(categories.categories) ? categories.categories : [];
    state.metadataLoaded.categories = true;
  }
  if (meta) {
    state.units = Array.isArray(meta.units) ? meta.units : [];
    state.metadataLoaded.units = true;
  }
  renderMetadataOptions();
}

async function loadHistory({ resetPage = false } = {}) {
  const generation = ++state.loadGeneration;
  state.loadController?.abort();
  const controller = new AbortController();
  state.loadController = controller;
  if (resetPage) state.page = 1;
  $('#ticket-history-state').textContent = 'Cargando historial…';

  try {
    await ensureMetadata();
    if (generation !== state.loadGeneration) return;
    readFilters();
    const result = await api(`/api/v1/inventory/tickets?${historyQueryString()}`, { signal: controller.signal });
    if (generation !== state.loadGeneration) return;
    state.result = result;
    renderHistory();
    $('#ticket-history-state').textContent = `${Number(state.result.total || 0)} tickets encontrados.`;
  } catch (error) {
    if (error?.name === 'AbortError' || generation !== state.loadGeneration) return;
    $('#ticket-history-state').textContent = `No se pudo cargar el historial: ${error.message}`;
  } finally {
    if (generation === state.loadGeneration) state.loadController = null;
  }
}

function toLocalDateTimeInput(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDateTimeToIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Indica una fecha y hora válidas.');
  return date.toISOString();
}

function discountLabel(item) {
  if (item.discount?.type === 'amount') return formatEuroMinor(item.discount.amountMinor);
  if (item.discount?.type === 'percentage') return `${(item.discount.basisPoints / 100).toLocaleString('es-ES', { maximumFractionDigits: 2 })}%`;
  return '—';
}

function renderEditorLines() {
  const container = $('#ticket-editor-lines-list');
  container.replaceChildren();
  if (!state.editorItems.length) {
    container.innerHTML = '<div class="catalog-empty"><strong>Este ticket no tiene líneas activas.</strong><span>Añade un artículo antes de guardar.</span></div>';
    return;
  }

  state.editorItems.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'ticket-editor-line ticket-line-grid';
    const original = item.originalDescription && item.originalDescription !== item.description ? `Original: ${item.originalDescription}` : '';
    row.innerHTML = `<span class="ticket-line-product"><strong>${escapeHtml(item.description)}</strong><small>${escapeHtml(original)}</small></span><span>${escapeHtml(item.categoryName || 'Sin categoría')}</span><span>${Number(item.quantity)}</span><span>${escapeHtml(item.unit)}</span><span>${escapeHtml(formatEuroMinor(item.unitPriceMinor))}</span><span>${escapeHtml(discountLabel(item))}</span><strong>${escapeHtml(formatEuroMinor(item.lineTotalMinor))}</strong><span class="ticket-line-actions"><button class="icon-button" type="button" data-ticket-line-action="edit" data-ticket-line-index="${index}" aria-label="Editar línea ${index + 1}">${icon('edit')}</button><button class="icon-button danger" type="button" data-ticket-line-action="delete" data-ticket-line-index="${index}" aria-label="Eliminar línea ${index + 1}">${icon('trash')}</button></span>`;
    container.append(row);
  });
}

function populateTicketEditor(ticket) {
  state.ticket = ticket;
  state.editorItems = (ticket.items || []).map(item => ({ ...item }));
  renderMetadataOptions();
  $('#ticket-editor-title').textContent = `Ticket ${ticket.id}`;
  $('#ticket-editor-identity').textContent = `${ticketDate(ticket)} · ${ticket.storeName || ticket.retailerName || 'Sin tienda'}`;
  $('#ticket-editor-purchased-at').value = toLocalDateTimeInput(ticket.purchasedAt || ticket.createdAt);
  $('#ticket-editor-store').value = ticket.storeId || '';
  $('#ticket-editor-payment-status').value = ticket.paymentStatus || 'paid';
  $('#ticket-editor-payment-method').value = ticket.paymentMethod || '';
  $('#ticket-editor-notes').value = ticket.notes || '';
  $('#ticket-editor-tax-input').value = minorToEuroInput(ticket.taxMinor || 0);
  $('#ticket-editor-discount-input').value = minorToEuroInput(ticket.receiptDiscountMinor || 0);
  $('#ticket-editor-tax').textContent = formatEuroMinor(ticket.taxMinor || 0);
  $('#ticket-editor-discount').textContent = formatEuroMinor(ticket.receiptDiscountMinor || 0);
  $('#ticket-editor-total').textContent = formatEuroMinor(ticket.declaredTotalMinor || 0);
  $('#ticket-editor-status').textContent = 'Guardado';
  $('#ticket-editor-form-state').textContent = '';
  renderEditorLines();
}

async function openTicket(ticketId, { push = true } = {}) {
  activateFeatureView();
  $('#ticket-history-list-screen').hidden = true;
  $('#ticket-history-detail-screen').hidden = false;
  $('#ticket-editor-status').textContent = 'Cargando…';
  try {
    await ensureMetadata();
    const result = await api(`/api/v1/inventory/tickets/${encodeURIComponent(ticketId)}`);
    populateTicketEditor(result.ticket);
    const url = `#ticket-history:${encodeURIComponent(ticketId)}`;
    if (push) history.pushState({ ticketHistory: true }, '', url);
    else history.replaceState({ ticketHistory: true }, '', url);
  } catch (error) {
    $('#ticket-editor-status').textContent = 'Error';
    $('#ticket-editor-form-state').textContent = `No se pudo abrir el ticket: ${error.message}`;
  }
}

function showHistoryList({ updateHistory = true, reload = true } = {}) {
  activateFeatureView();
  $('#ticket-history-detail-screen').hidden = true;
  $('#ticket-history-list-screen').hidden = false;
  state.ticket = null;
  state.editorItems = [];
  if (updateHistory) history.replaceState({ ticketHistory: true }, '', '#ticket-history');
  if (reload) void loadHistory();
}

async function activateTicketHistory({ push = false } = {}) {
  activateFeatureView();
  $('#ticket-history-detail-screen').hidden = true;
  $('#ticket-history-list-screen').hidden = false;
  if (push) history.pushState({ ticketHistory: true }, '', '#ticket-history');
  else history.replaceState({ ticketHistory: true }, '', '#ticket-history');
  await loadHistory({ resetPage: true });
}

function parseDiscountQuantity(lineQuantity) {
  if (lineQuantity <= 1) return undefined;
  const raw = $('#historical-ticket-line-discount-quantity').value;
  const quantity = Number(raw);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > lineQuantity) {
    throw new Error(`Las unidades con descuento deben estar entre 1 y ${lineQuantity}.`);
  }
  return quantity === lineQuantity ? undefined : quantity;
}

function lineDiscountFromForm(lineQuantity) {
  const type = $('#historical-ticket-line-discount-type').value;
  if (type === 'none') return undefined;
  const rawValue = $('#historical-ticket-line-discount-value').value.trim();
  if (!rawValue) throw new Error('Completa el valor del descuento.');
  const quantity = parseDiscountQuantity(lineQuantity);
  const quantityField = quantity === undefined ? {} : { quantity };
  if (type === 'amount') return { type: 'amount', amountMinor: euroInputToMinor(rawValue), ...quantityField };
  if (type === 'percentage') return { type: 'percentage', basisPoints: parsePercentageBasisPoints(rawValue), ...quantityField };
  throw new Error('Selecciona un tipo de descuento válido.');
}

function lineCalculationPayload() {
  const quantity = Number($('#historical-ticket-line-quantity').value);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100_000) {
    throw new Error('La cantidad debe ser un entero positivo.');
  }
  const unitPriceMinor = euroInputToMinor($('#historical-ticket-line-unit-price').value);
  const discount = lineDiscountFromForm(quantity);
  return { quantity, unitPriceMinor, ...(discount ? { discount } : {}) };
}

function syncLineDiscountFields() {
  const type = $('#historical-ticket-line-discount-type').value;
  const field = $('#historical-ticket-line-discount-field');
  const quantityField = $('#historical-ticket-line-discount-quantity-field');
  const quantity = Number($('#historical-ticket-line-quantity').value) || 1;
  field.hidden = type === 'none';
  quantityField.hidden = type === 'none' || quantity <= 1;
  $('#historical-ticket-line-discount-quantity').max = String(Math.max(quantity, 1));
  $('#historical-ticket-line-discount-label').textContent = type === 'percentage' ? 'Porcentaje (%)' : 'Importe (€)';
}

async function calculateLine(generation) {
  state.lineCalculationController?.abort();
  const controller = new AbortController();
  state.lineCalculationController = controller;
  const lineItem = $('#historical-ticket-line-dialog [data-receipt-line-editor]');
  const total = $('#historical-ticket-line-total');
  try {
    const payload = lineCalculationPayload();
    total?.setAttribute('aria-busy', 'true');
    lineItem?.setAttribute('data-editor-validation', 'review');
    const result = await api('/api/v1/receipts/calculate-line', {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
    if (generation !== state.lineCalculationGeneration) return null;
    if (total instanceof HTMLOutputElement) total.value = minorToEuroInput(result.lineTotalMinor);
    lineItem?.setAttribute('data-editor-validation', 'confirmed');
    $('#historical-ticket-line-state').textContent = '';
    total?.removeAttribute('aria-busy');
    refreshReceiptInvoiceEditor($('#historical-ticket-line-dialog'));
    return { ...payload, lineTotalMinor: result.lineTotalMinor };
  } catch (error) {
    if (error?.name === 'AbortError' || generation !== state.lineCalculationGeneration) return null;
    lineItem?.setAttribute('data-editor-validation', 'review');
    $('#historical-ticket-line-state').textContent = error.message;
    total?.removeAttribute('aria-busy');
    refreshReceiptInvoiceEditor($('#historical-ticket-line-dialog'));
    return null;
  } finally {
    if (generation === state.lineCalculationGeneration) state.lineCalculationController = null;
  }
}

function scheduleLineCalculation() {
  clearTimeout(state.lineCalculationTimer);
  const generation = ++state.lineCalculationGeneration;
  state.lineCalculationTimer = setTimeout(() => void calculateLine(generation), LINE_CALCULATION_DELAY_MS);
}

function percentageInput(discount) {
  if (discount?.type !== 'percentage') return '';
  const whole = Math.floor(discount.basisPoints / 100);
  const fractional = discount.basisPoints % 100;
  return fractional === 0 ? String(whole) : `${whole},${String(fractional).padStart(2, '0').replace(/0$/u, '')}`;
}

function openLineEditor(index) {
  const item = index >= 0 ? state.editorItems[index] : null;
  state.lineIndex = index;
  $('#historical-ticket-line-title').textContent = item ? `Editar línea ${index + 1}` : 'Añadir artículo';
  $('#historical-ticket-line-description').value = item?.description || '';
  $('#historical-ticket-line-category').value = item?.categoryId || '';
  $('#historical-ticket-line-quantity').value = String(item?.quantity || 1);
  $('#historical-ticket-line-unit').value = item?.unit || state.units[0] || 'unit';
  $('#historical-ticket-line-unit-price').value = minorToEuroInput(item?.unitPriceMinor || 0);
  $('#historical-ticket-line-discount-type').value = item?.discount?.type || 'none';
  $('#historical-ticket-line-discount-value').value = item?.discount?.type === 'amount'
    ? minorToEuroInput(item.discount.amountMinor)
    : percentageInput(item?.discount);
  $('#historical-ticket-line-discount-quantity').value = String(item?.discount?.quantity || item?.quantity || 1);
  const total = $('#historical-ticket-line-total');
  if (total instanceof HTMLOutputElement) total.value = minorToEuroInput(item?.lineTotalMinor || 0);
  $('#historical-ticket-line-dialog [data-receipt-line-editor]').dataset.editorValidation = item ? 'confirmed' : 'review';
  $('#historical-ticket-line-state').textContent = '';
  syncLineDiscountFields();
  refreshReceiptInvoiceEditor($('#historical-ticket-line-dialog'));
  $('#historical-ticket-line-dialog').showModal();
  requestAnimationFrame(() => $('#historical-ticket-line-description').focus());
}

async function saveLine(button) {
  const description = $('#historical-ticket-line-description').value.trim();
  if (!description) {
    $('#historical-ticket-line-state').textContent = 'El producto es obligatorio.';
    return;
  }
  setBusy(button, true);
  try {
    clearTimeout(state.lineCalculationTimer);
    const generation = ++state.lineCalculationGeneration;
    const calculation = await calculateLine(generation);
    if (!calculation) return;

    const current = state.lineIndex >= 0 ? state.editorItems[state.lineIndex] : null;
    const categoryId = $('#historical-ticket-line-category').value || null;
    const category = state.categories.find(candidate => candidate.id === categoryId);
    const next = {
      ...(current?.id ? { id: current.id } : {}),
      ...(current?.originalDescription ? { originalDescription: current.originalDescription } : {}),
      description,
      categoryId,
      ...(category ? { categoryName: category.name } : {}),
      quantity: calculation.quantity,
      unit: $('#historical-ticket-line-unit').value || 'unit',
      unitPriceMinor: calculation.unitPriceMinor,
      ...(calculation.discount ? { discount: calculation.discount } : {}),
      lineTotalMinor: calculation.lineTotalMinor,
    };
    if (state.lineIndex >= 0) state.editorItems[state.lineIndex] = next;
    else state.editorItems.push(next);
    $('#historical-ticket-line-dialog').close();
    renderEditorLines();
    $('#ticket-editor-status').textContent = 'Sin guardar';
  } finally {
    setBusy(button, false);
  }
}

function ticketPayload() {
  if (!state.editorItems.length) throw new Error('El ticket debe conservar al menos una línea activa.');
  return {
    purchasedAt: localDateTimeToIso($('#ticket-editor-purchased-at').value),
    storeId: $('#ticket-editor-store').value || null,
    paymentStatus: $('#ticket-editor-payment-status').value,
    paymentMethod: $('#ticket-editor-payment-method').value.trim() || null,
    notes: $('#ticket-editor-notes').value.trim() || null,
    taxMinor: euroInputToMinor($('#ticket-editor-tax-input').value || '0'),
    receiptDiscountMinor: euroInputToMinor($('#ticket-editor-discount-input').value || '0'),
    items: state.editorItems.map(item => ({
      ...(item.id ? { id: item.id } : {}),
      description: item.description,
      categoryId: item.categoryId || null,
      quantity: item.quantity,
      unit: item.unit,
      unitPriceMinor: item.unitPriceMinor,
      ...(item.discount ? { discount: item.discount } : {}),
    })),
  };
}

async function saveTicket(button) {
  if (!state.ticket) return;
  setBusy(button, true);
  $('#ticket-editor-status').textContent = 'Guardando…';
  try {
    const result = await api(`/api/v1/inventory/tickets/${encodeURIComponent(state.ticket.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(ticketPayload()),
    });
    populateTicketEditor(result.ticket);
    $('#ticket-editor-form-state').textContent = 'Cambios guardados sin reescribir la evidencia original.';
    $('#ticket-editor-status').textContent = 'Guardado';
    void loadHistory();
  } catch (error) {
    $('#ticket-editor-status').textContent = 'Revisar';
    $('#ticket-editor-form-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function openDeleteDialog(ticketId) {
  const ticket = state.ticket?.id === ticketId
    ? state.ticket
    : state.result.tickets.find(candidate => candidate.id === ticketId);
  if (!ticket) return;

  const dialog = $('#ticket-history-delete-dialog');
  const confirm = $('#ticket-history-delete-confirm');
  confirm.dataset.ticketId = ticketId;
  confirm.disabled = true;
  $('#ticket-history-delete-identity').textContent = `${ticket.id} · ${ticketDate(ticket)} · ${ticket.storeName || ticket.retailerName || 'Sin tienda'} · ${formatEuroMinor(ticket.declaredTotalMinor)} · ${Number(ticket.itemCount || 0)} artículos.`;
  $('#ticket-history-delete-impact').textContent = 'Comprobando capturas, extracciones, correcciones y precios históricos…';
  $('#ticket-history-delete-state').textContent = '';
  dialog.showModal();

  try {
    const result = await api(`/api/v1/inventory/tickets/${encodeURIComponent(ticketId)}/delete-impact`);
    const impact = result.impact;
    $('#ticket-history-delete-impact').textContent = impact.warning;
    $('#ticket-history-delete-state').textContent = impact.canDelete
      ? 'No existe evidencia inmutable asociada; el ticket se puede eliminar.'
      : `Borrado bloqueado: ${impact.captures} capturas, ${impact.extractions} extracciones, ${impact.corrections} correcciones, ${impact.externalEvidence} evidencias externas y ${impact.retainedPriceObservations} precios históricos.`;
    confirm.disabled = !impact.canDelete;
  } catch (error) {
    $('#ticket-history-delete-state').textContent = error.message;
  }
}

async function confirmDelete(button) {
  const ticketId = button.dataset.ticketId;
  if (!ticketId) return;
  setBusy(button, true);
  try {
    await api(`/api/v1/inventory/tickets/${encodeURIComponent(ticketId)}`, { method: 'DELETE' });
    $('#ticket-history-delete-dialog').close();
    if (state.ticket?.id === ticketId) showHistoryList();
    else await loadHistory();
    $('#ticket-history-state').textContent = 'Ticket eliminado.';
  } catch (error) {
    $('#ticket-history-delete-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function clearFilters() {
  for (const id of [
    'ticket-history-search',
    'ticket-history-date-from',
    'ticket-history-date-to',
    'ticket-history-store',
    'ticket-history-category',
    'ticket-history-status',
  ]) {
    $(`#${id}`).value = '';
  }
  state.query = '';
  state.dateFrom = '';
  state.dateTo = '';
  state.storeId = '';
  state.categoryId = '';
  state.paymentStatus = '';
  void loadHistory({ resetPage: true });
}

function bindInteractions() {
  $('#ticket-history-capture').addEventListener('click', navigateToCapture);
  document.querySelector('[data-ticket-history-capture]').addEventListener('click', navigateToCapture);
  $('#ticket-history-back').addEventListener('click', () => showHistoryList());
  $('#ticket-editor-cancel').addEventListener('click', () => state.ticket && populateTicketEditor(state.ticket));
  $('#ticket-delete').addEventListener('click', () => state.ticket && void openDeleteDialog(state.ticket.id));
  $('#ticket-add-line').addEventListener('click', () => openLineEditor(-1));
  $('#ticket-editor-form').addEventListener('submit', event => {
    event.preventDefault();
    void saveTicket($('#ticket-editor-save'));
  });

  $('#ticket-history-search').addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => void loadHistory({ resetPage: true }), SEARCH_DELAY_MS);
  });
  for (const id of ['ticket-history-date-from', 'ticket-history-date-to', 'ticket-history-store', 'ticket-history-category', 'ticket-history-status']) {
    $(`#${id}`).addEventListener('change', () => void loadHistory({ resetPage: true }));
  }
  $('#ticket-history-clear').addEventListener('click', clearFilters);
  $('#ticket-history-prev').addEventListener('click', () => {
    if (state.page <= 1) return;
    state.page -= 1;
    void loadHistory();
  });
  $('#ticket-history-next').addEventListener('click', () => {
    if (!state.result.hasMore) return;
    state.page += 1;
    void loadHistory();
  });

  $('#ticket-history-list').addEventListener('click', event => {
    const target = event.target.closest('[data-ticket-action]');
    if (!target) return;
    const ticketId = target.dataset.ticketId;
    if (!ticketId) return;
    if (target.dataset.ticketAction === 'open' || target.dataset.ticketAction === 'edit') void openTicket(ticketId);
    if (target.dataset.ticketAction === 'delete') void openDeleteDialog(ticketId);
  });
  $('#ticket-history-list').addEventListener('keydown', event => {
    const target = event.target.closest('[data-ticket-action="open"]');
    if (!target || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    void openTicket(target.dataset.ticketId);
  });
  document.querySelector('.view[data-view="ticket-history"]').addEventListener('basketra:swipe-action', event => {
    if (event.detail?.kind !== 'ticket-history' || event.detail?.action !== 'delete') return;
    void openDeleteDialog(String(event.detail.id || ''));
  });

  $('#ticket-editor-lines-list').addEventListener('click', event => {
    const action = event.target.closest('[data-ticket-line-action]');
    if (!action) return;
    const index = Number(action.dataset.ticketLineIndex);
    if (!Number.isSafeInteger(index) || !state.editorItems[index]) return;
    if (action.dataset.ticketLineAction === 'edit') openLineEditor(index);
    if (action.dataset.ticketLineAction === 'delete') {
      state.editorItems.splice(index, 1);
      renderEditorLines();
      $('#ticket-editor-status').textContent = 'Sin guardar';
    }
  });

  $('#historical-ticket-line-form').addEventListener('submit', event => {
    event.preventDefault();
    void saveLine($('#historical-ticket-line-save'));
  });
  $('#historical-ticket-line-close').addEventListener('click', () => $('#historical-ticket-line-dialog').close());
  $('#historical-ticket-line-cancel').addEventListener('click', () => $('#historical-ticket-line-dialog').close());
  for (const id of [
    'historical-ticket-line-quantity',
    'historical-ticket-line-unit-price',
    'historical-ticket-line-discount-value',
    'historical-ticket-line-discount-quantity',
  ]) {
    $(`#${id}`).addEventListener('input', () => {
      syncLineDiscountFields();
      scheduleLineCalculation();
    });
  }
  $('#historical-ticket-line-discount-type').addEventListener('change', () => {
    syncLineDiscountFields();
    scheduleLineCalculation();
  });

  $('#ticket-history-delete-cancel').addEventListener('click', () => $('#ticket-history-delete-dialog').close());
  $('#ticket-history-delete-confirm').addEventListener('click', event => void confirmDelete(event.currentTarget));
}

function handleRoute({ initial = false } = {}) {
  const requested = location.hash.slice(1);
  if (requested === 'ticket-history') {
    activateFeatureView();
    $('#ticket-history-detail-screen').hidden = true;
    $('#ticket-history-list-screen').hidden = false;
    void loadHistory({ resetPage: initial });
    return true;
  }
  if (requested.startsWith('ticket-history:')) {
    const encodedId = requested.slice('ticket-history:'.length);
    try {
      void openTicket(decodeURIComponent(encodedId), { push: false });
    } catch {
      showHistoryList({ updateHistory: true });
    }
    return true;
  }
  if (!initial && requested === 'scan' && document.querySelector('.view[data-view="ticket-history"]')?.classList.contains('active')) {
    navigateToCapture();
  }
  return false;
}

export function initializeTicketHistoryFeature() {
  if (state.initialized) return;
  state.initialized = true;
  injectStylesheet();
  installTicketEntryNavigation();
  installHistoryView();
  bindInteractions();
  window.addEventListener('popstate', () => handleRoute());
  handleRoute({ initial: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeTicketHistoryFeature, { once: true });
} else {
  initializeTicketHistoryFeature();
}
