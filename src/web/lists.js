import { api, realtimeEndpoint, setBusy } from './api.js';
import {
  clearItemDraft,
  loadActiveListId,
  loadItemDraft,
  saveActiveListId,
  saveItemDraft,
} from './state.js';
import {
  emptyListState,
  escapeHtml,
  euroInputToMinor,
  minorToEuroInput,
  shoppingListItem,
} from './ui.js';
import { applicationPathForRoute, readApplicationLocation, writeApplicationLocation } from './routes.js';

const UNIT_LABELS = Object.freeze({
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'L',
  unit: 'ud',
  pack: 'pack',
  roll: 'rollo',
  sheet: 'hoja',
  capsule: 'cápsula',
  dose: 'dosis',
  wash: 'lavado',
  m: 'm',
});

const CATEGORY_FALLBACK = 'Sin categoría';
const REALTIME_COALESCE_MS = 90;
const LOCATION_MATCH_METERS = 2_000;
const MAX_NEARBY_METERS = 1_500;

const model = {
  lists: [],
  activeListId: loadActiveListId(),
  list: null,
  items: [],
  estimate: null,
  categories: [],
  stores: [],
  variantOptions: new Map(),
  editingItemId: '',
  deletingItemId: '',
  swipeDeletingItemIds: new Set(),
  multiSelectMode: false,
  selectedItemIds: new Set(),
  selectedProductVariantId: '',
  selectedProductName: '',
  selectedCanonicalProductId: '',
  selectedSuggestion: null,
  globalProductEditingId: '',
  globalProductAddToList: false,
  globalParentId: '',
  globalParentName: '',
  suggestionController: null,
  suggestionTimer: null,
  parentSuggestionController: null,
  parentSuggestionTimer: null,
  priceNormalizationController: null,
  priceNormalizationTimer: null,
  draftEstimateController: null,
  draftEstimateTimer: null,
  photoStorageKey: '',
  photoProposal: null,
  proposedCategoryName: '',
  currentLocation: null,
  nearbyCandidates: [],
  realtimeSource: null,
  realtimeTimer: null,
  conflict: null,
};

let metadata;
let toast = () => {};
let aiConfigured = false;

const $ = selector => document.querySelector(selector);

function listIdFromRoute(route) {
  const value = String(route || '');
  return value.startsWith('lists:') ? value.slice('lists:'.length) : '';
}

function writeListRoute(listId = '', { replace = false } = {}) {
  const route = listId ? `lists:${listId}` : 'lists';
  writeApplicationLocation(route, new URLSearchParams(), { replace });
}

function openDialog(dialog, focusSelector) {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  if (focusSelector) requestAnimationFrame(() => dialog.querySelector(focusSelector)?.focus());
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

function activeListSummary() {
  return model.lists.find(list => list.id === model.activeListId);
}

function setOverviewVisible(overviewVisible) {
  $('#lists-overview').hidden = !overviewVisible;
  $('#list-detail').hidden = overviewVisible;
  if (overviewVisible) {
    stopRealtime();
    $('#list-menu-panel').hidden = true;
    $('#list-menu').setAttribute('aria-expanded', 'false');
  }
}

function unitOptions({ includeEmpty = false } = {}) {
  const options = metadata.units
    .map(unit => `<option value="${escapeHtml(unit)}">${escapeHtml(UNIT_LABELS[unit] || unit)}</option>`)
    .join('');
  return `${includeEmpty ? '<option value="">Sin especificar</option>' : ''}${options}`;
}

function populateUnits() {
  for (const selector of ['#item-unit', '#global-item-unit']) {
    const select = $(selector);
    if (!select) continue;
    const current = select.value;
    select.innerHTML = unitOptions();
    select.value = metadata.units.includes(current)
      ? current
      : metadata.units.includes('unit') ? 'unit' : metadata.units[0] || '';
  }
  const packageUnit = $('#global-package-unit');
  if (packageUnit) {
    const current = packageUnit.value;
    packageUnit.innerHTML = unitOptions({ includeEmpty: true });
    if ([...packageUnit.options].some(option => option.value === current)) packageUnit.value = current;
  }
}

function ensureProgressiveFields() {
  // The shopping/product forms are now explicit canonical surfaces in index.html.
  // Keep this hook for initialization ordering without dynamically duplicating fields.
}

function formatEuroMinor(value) {
  const minor = Number(value);
  if (!Number.isSafeInteger(minor)) return '—';
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

function relativeAge(iso) {
  const timestamp = Date.parse(iso || '');
  if (!Number.isFinite(timestamp)) return '';
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} d`;
}

function packageLabel(product) {
  if (!product || !Number.isSafeInteger(product.packageMinor) || !product.packageUnit) return 'Sin tamaño';
  return `${product.packageMinor} ${UNIT_LABELS[product.packageUnit] || product.packageUnit}`;
}

function estimateLine(itemId) {
  return model.estimate?.lines?.find(line => line.itemId === itemId) || null;
}

function unpricedLabel(reason) {
  return {
    'store-required': 'Selecciona una tienda',
    'product-required': 'Vincula un producto guardado',
    'price-missing': 'Sin precio en esta tienda',
    'not-comparable': 'Sin precio comparable',
  }[reason] || 'Sin precio comparable';
}

function listStoreOptions(selectedId = '') {
  return `<option value="">Sin tienda de referencia</option>${model.stores.map(store =>
    `<option value="${escapeHtml(store.id)}"${store.id === selectedId ? ' selected' : ''}>${escapeHtml(store.name)} · ${escapeHtml(store.retailerName)}</option>`
  ).join('')}`;
}

function itemStoreOptions(selectedOverrideId = '') {
  const inherited = model.list?.referenceStoreId
    ? model.stores.find(store => store.id === model.list.referenceStoreId)?.name || 'tienda de la lista'
    : 'sin tienda';
  return `<option value="">Lista · ${escapeHtml(inherited)}</option>${model.stores.map(store =>
    `<option value="${escapeHtml(store.id)}"${store.id === selectedOverrideId ? ' selected' : ''}>${escapeHtml(store.name)}</option>`
  ).join('')}`;
}

function renderReferenceStore() {
  const select = $('#list-store-select');
  if (!select || !model.list) return;
  select.innerHTML = listStoreOptions(model.list.referenceStoreId || '');
}

function variantSelectOptions(line) {
  if (!line?.productVariantId) return '<option value="">Sin producto guardado</option>';
  const variants = model.variantOptions.get(line.canonicalProductId) || [];
  const options = variants.length ? variants : [{
    id: line.productVariantId,
    variantName: line.variantName || line.text,
    packageMinor: line.packageMinor,
    packageUnit: line.packageUnit,
  }];
  return options.map(variant =>
    `<option value="${escapeHtml(variant.id)}" data-variant-name="${escapeHtml(variant.variantName)}"${variant.id === line.productVariantId ? ' selected' : ''}>${escapeHtml(packageLabel(variant))}</option>`
  ).join('');
}

function selectionButton(item, name) {
  const selected = model.selectedItemIds.has(item.id);
  return `<button type="button" class="multi-select-check${selected ? ' is-selected' : ''}" data-select-item data-item-id="${escapeHtml(item.id)}" aria-label="${selected ? 'Quitar' : 'Seleccionar'} ${name}" aria-pressed="${String(selected)}"><span data-icon="check"></span></button>`;
}

function ticketItem(item, index, total) {
  const line = estimateLine(item.id);
  const name = escapeHtml(item.text);
  const id = escapeHtml(item.id);
  const priced = line?.status === 'priced';
  const priceContext = priced
    ? `${formatEuroMinor(line.normalizedPriceMinor ?? line.latestPriceMinor)}/${escapeHtml(UNIT_LABELS[line.normalizedPriceUnit || item.unit] || line.normalizedPriceUnit || item.unit)} · ${escapeHtml(relativeAge(line.observedAt))}`
    : escapeHtml(unpricedLabel(line?.reason));
  const totalText = priced ? formatEuroMinor(line.estimatedTotalMinor) : '—';
  const category = item.categoryName ? `<small class="ticket-item__category">${escapeHtml(item.categoryName)}</small>` : '';
  if (model.multiSelectMode) {
    const storeName = line?.effectiveStoreName
      || model.stores.find(store => store.id === (item.storeOverrideId || model.list?.referenceStoreId))?.name
      || 'Sin tienda';
    return `<div class="shopping-ticket-row bulk-select-row${model.selectedItemIds.has(item.id) ? ' is-selected' : ''}">
      <article class="ticket-item ticket-item--select" data-select-row data-item-id="${id}">
        ${selectionButton(item, name)}
        <div class="ticket-item__identity list-row__content"><span class="ticket-item__product-icon" data-icon="cart" aria-hidden="true"></span><span class="ticket-item__identity-copy"><strong>${name}</strong>${category}<small>${priceContext}</small><small>${escapeHtml(storeName)}</small></span></div>
        <strong class="ticket-item__total">${totalText}</strong>
      </article>
    </div>`;
  }
  const editAttributes = `data-item-action="edit" data-item-id="${id}" aria-label="Editar ${name}"`;
  const deleteAttributes = `data-item-action="delete" data-item-id="${id}" aria-label="Eliminar ${name}"`;
  return `<div class="shopping-ticket-row swipe-shell" data-swipe-row data-swipe-kind="shopping-item" data-swipe-id="${id}" data-swipe-start-action="complete" data-swipe-end-action="delete" data-swipe-open="false">
    <div class="swipe-rail swipe-rail--start" aria-hidden="true"><span data-icon="check"></span><strong>Completado</strong></div>
    <div class="swipe-rail swipe-rail--end" data-swipe-actions aria-hidden="true">
      <button type="button" class="swipe-rail__action" data-primary-swipe-action ${editAttributes} tabindex="-1"><span data-icon="edit"></span><span>Editar</span></button>
      <button type="button" class="swipe-rail__action swipe-rail__action--danger" data-destructive-action ${deleteAttributes} tabindex="-1"><span data-icon="trash"></span><span>Eliminar</span></button>
      <span class="swipe-rail__commit" aria-hidden="true"><span data-icon="trash"></span><strong>Suelta para eliminar</strong></span>
    </div>
    <article class="ticket-item swipe-content" data-swipe-content>
      <button type="button" class="completion-button" data-item-action="complete" data-item-id="${id}" aria-label="Marcar ${name} como comprado" aria-pressed="false"><span data-icon="check"></span></button>
      <div class="ticket-item__identity list-row__content"><span class="ticket-item__product-icon" data-icon="cart" aria-hidden="true"></span><span class="ticket-item__identity-copy"><strong>${name}</strong>${category}<small class="${priced ? '' : 'ticket-item__warning'}">${priceContext}</small></span></div>
      <strong class="ticket-item__total">${totalText}</strong>
      <div class="ticket-item__controls">
        <div class="quantity-stepper quantity-stepper--compact" aria-label="Cantidad de ${name}">
          <button type="button" data-item-action="quantity" data-item-id="${id}" data-delta="-1" ${item.quantityMinor <= 1 ? 'disabled' : ''} aria-label="Reducir cantidad de ${name}">−</button>
          <span class="quantity-chip" aria-label="Cantidad actual">${item.quantityMinor}</span>
          <button type="button" data-item-action="quantity" data-item-id="${id}" data-delta="1" aria-label="Aumentar cantidad de ${name}">+</button>
        </div>
        <label class="ticket-control"><span class="sr-only">Unidad de ${name}</span><select data-item-control="unit" data-item-id="${id}">${metadata.units.map(unit => `<option value="${escapeHtml(unit)}"${unit === item.unit ? ' selected' : ''}>${escapeHtml(UNIT_LABELS[unit] || unit)}</option>`).join('')}</select></label>
        <label class="ticket-control"><span class="sr-only">Peso o tamaño de ${name}</span><select data-item-control="variant" data-item-id="${id}" ${line?.productVariantId ? '' : 'disabled'}>${variantSelectOptions(line)}</select></label>
        <label class="ticket-control ticket-control--store"><span class="sr-only">Tienda de ${name}</span><select data-item-control="store" data-item-id="${id}">${itemStoreOptions(item.storeOverrideId || '')}</select></label>
        <div class="ticket-item__move" aria-label="Orden de ${name}">
          <button type="button" class="icon-button" data-item-action="move" data-item-id="${id}" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Subir ${name}"><span data-icon="chevronUp"></span></button>
          <button type="button" class="icon-button" data-item-action="move" data-item-id="${id}" data-direction="1" ${index === total - 1 ? 'disabled' : ''} aria-label="Bajar ${name}"><span data-icon="chevronDown"></span></button>
        </div>
        <button type="button" class="icon-button ticket-item__more" data-swipe-toggle aria-expanded="false" aria-label="Mostrar acciones de ${name}"><span data-icon="more"></span></button>
      </div>
      <span class="ticket-item__position sr-only">${index + 1} de ${total}</span>
    </article>
  </div>`;
}

function renderOverview() {
  const container = $('#list-cards');
  if (model.lists.length === 0) {
    container.innerHTML = `<div class="surface list-overview-empty"><span data-icon="list" aria-hidden="true"></span><h2>Tu primera lista empieza aquí</h2><p>Crea una lista y ábrela desde ambos móviles para comprar juntos.</p><button class="button primary" type="button" data-list-action="create">Crear lista</button></div>`;
    return;
  }
  container.innerHTML = model.lists.map(list => {
    const pending = Number(list.pendingCount || 0);
    const completed = Number(list.completedCount || 0);
    const updated = new Date(list.updatedAt);
    const activity = Number.isNaN(updated.getTime())
      ? 'Actividad reciente'
      : new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(updated);
    return `<article class="surface list-overview-card">
      <button class="list-overview-card__main" type="button" data-list-action="open" data-list-id="${escapeHtml(list.id)}">
        <span><strong>${escapeHtml(list.name)}</strong><small>${pending} pendientes · ${completed} completados</small></span>
        <small>Actualizada ${escapeHtml(activity)}</small>
      </button>
      <div class="list-overview-card__actions">
        <button class="icon-button" type="button" data-list-action="rename" data-list-id="${escapeHtml(list.id)}" aria-label="Renombrar ${escapeHtml(list.name)}"><span data-icon="edit"></span></button>
        <button class="icon-button danger" type="button" data-list-action="delete" data-list-id="${escapeHtml(list.id)}" aria-label="Eliminar ${escapeHtml(list.name)}"><span data-icon="trash"></span></button>
      </div>
    </article>`;
  }).join('');
  document.dispatchEvent(new CustomEvent('basketra:hydrate-icons', { detail: { root: container } }));
}

function groupItems(items) {
  const groups = new Map();
  items.forEach(item => {
    const name = item.categoryName || CATEGORY_FALLBACK;
    const group = groups.get(name) || [];
    group.push(item);
    groups.set(name, group);
  });
  return groups;
}

function bulkCompletedItem(item) {
  const name = escapeHtml(item.text);
  const id = escapeHtml(item.id);
  const selected = model.selectedItemIds.has(item.id);
  const storeName = model.stores.find(store => store.id === (item.storeOverrideId || model.list?.referenceStoreId))?.name || 'Sin tienda';
  return `<li class="list-row bulk-select-completed${selected ? ' is-selected' : ''}" data-select-row data-item-id="${id}">
    ${selectionButton(item, name)}
    <div class="list-row__content"><strong>${name}</strong><span>${item.quantityMinor} ${escapeHtml(UNIT_LABELS[item.unit] || item.unit)} · ${escapeHtml(storeName)}</span></div>
  </li>`;
}

function renderItemGroups(container, items, emptyMessage, renderer = shoppingListItem) {
  if (items.length === 0) {
    container.innerHTML = `<ul class="item-list">${emptyListState(emptyMessage)}</ul>`;
    return;
  }
  const overallIndexes = new Map(items.map((item, index) => [item.id, index]));
  container.innerHTML = [...groupItems(items)].map(([category, group]) => `
    <section class="category-group" aria-label="${escapeHtml(category)}">
      <h3>${escapeHtml(category)}</h3>
      <ul class="item-list">${group.map(item => renderer(item, overallIndexes.get(item.id), items.length)).join('')}</ul>
    </section>
  `).join('');
}

function renderEstimateSummary() {
  const estimate = model.estimate;
  if (!estimate) {
    $('#estimate-total').textContent = '—';
    $('#estimate-coverage').textContent = 'Sin estimación';
    $('#estimate-oldest').textContent = '';
    $('#list-store-coverage').textContent = 'La estimación usa el último precio guardado.';
    return;
  }
  const total = estimate.pricedItemCount + estimate.unpricedItemCount;
  $('#estimate-total').textContent = formatEuroMinor(estimate.totalMinor);
  $('#estimate-coverage').textContent = `${estimate.pricedItemCount} de ${total} con precio${estimate.unpricedItemCount ? ` · ${estimate.unpricedItemCount} sin precio` : ''}`;
  $('#estimate-oldest').textContent = estimate.oldestObservedAt ? `Más antiguo: ${relativeAge(estimate.oldestObservedAt)}` : '';
  $('#list-store-coverage').textContent = total
    ? `${estimate.pricedItemCount}/${total} productos con precio guardado`
    : 'Añade productos para calcular la estimación.';
}

function renderBulkSelection() {
  const validIds = new Set(model.items.map(item => item.id));
  for (const id of model.selectedItemIds) {
    if (!validIds.has(id)) model.selectedItemIds.delete(id);
  }
  const count = model.selectedItemIds.size;
  const total = model.items.length;
  const toggle = $('#toggle-multi-select');
  toggle.setAttribute('aria-pressed', String(model.multiSelectMode));
  toggle.querySelector('span:last-child').textContent = model.multiSelectMode ? 'Cancelar' : 'Seleccionar';
  $('#bulk-selection-bar').hidden = !model.multiSelectMode;
  $('#bulk-selection-count').textContent = `${count} seleccionado${count === 1 ? '' : 's'}`;
  $('#bulk-select-all').textContent = total > 0 && count === total ? 'Quitar selección' : 'Seleccionar todos';
  for (const selector of ['#bulk-mark-completed', '#bulk-mark-pending', '#bulk-apply-store', '#bulk-delete-items']) {
    $(selector).disabled = count === 0;
  }
  $('#bulk-store-select').disabled = count === 0;
  $('#list-detail').classList.toggle('is-multi-select', model.multiSelectMode);
}

function renderItems() {
  const pending = model.items.filter(item => !item.completed);
  const completed = model.items.filter(item => item.completed);
  const pendingRoot = $('#pending-items');
  pendingRoot.innerHTML = pending.length
    ? pending.map((item, index) => ticketItem(item, index, pending.length)).join('')
    : '<div class="shopping-ticket__empty"><strong>Lista vacía</strong><small>Añade el primer producto para empezar.</small></div>';
  renderItemGroups(
    $('#completed-items'),
    completed,
    'Los productos comprados aparecerán aquí.',
    model.multiSelectMode ? bulkCompletedItem : shoppingListItem,
  );
  $('#pending-count').textContent = String(pending.length);
  $('#completed-count').textContent = String(completed.length);
  $('#completed-section').hidden = completed.length === 0;
  renderEstimateSummary();
  renderBulkSelection();
  document.dispatchEvent(new CustomEvent('basketra:hydrate-icons', { detail: { root: pendingRoot } }));
  document.dispatchEvent(new CustomEvent('basketra:hydrate-icons', { detail: { root: $('#completed-items') } }));
}

function renderDetail() {
  if (!model.list) return;
  $('#active-list-title').textContent = model.list.name;
  renderReferenceStore();
  renderItems();
}

async function loadVariantOptions(lines = []) {
  const parentIds = [...new Set(lines.map(line => line.canonicalProductId).filter(Boolean))];
  await Promise.all(parentIds.map(async parentId => {
    if (model.variantOptions.has(parentId)) return;
    try {
      const result = await api(`/api/v1/products/parents/${encodeURIComponent(parentId)}/variants`);
      model.variantOptions.set(parentId, result.variants || []);
    } catch {
      model.variantOptions.set(parentId, []);
    }
  }));
}

async function loadLists() {
  const result = await api('/api/v1/shopping-lists');
  model.lists = result.lists;
  if (model.activeListId && !model.lists.some(list => list.id === model.activeListId)) {
    model.activeListId = '';
    model.list = null;
    model.items = [];
    saveActiveListId('');
    setOverviewVisible(true);
  }
  renderOverview();
}

async function loadActiveList() {
  if (!model.activeListId) return;
  const [detail, estimateResult] = await Promise.all([
    api(`/api/v1/shopping-lists/${encodeURIComponent(model.activeListId)}`),
    api(`/api/v1/shopping-lists/${encodeURIComponent(model.activeListId)}/estimate`),
  ]);
  model.list = detail.list;
  model.items = detail.items;
  model.estimate = estimateResult.estimate;
  await loadVariantOptions(model.estimate?.lines || []);
  const index = model.lists.findIndex(list => list.id === detail.list.id);
  if (index >= 0) model.lists[index] = { ...model.lists[index], ...detail.list };
  renderDetail();
}

async function openList(listId, { syncUrl = true, replace = false } = {}) {
  model.multiSelectMode = false;
  model.selectedItemIds.clear();
  model.activeListId = listId;
  saveActiveListId(listId);
  if (syncUrl) writeListRoute(listId, { replace });
  setOverviewVisible(false);
  $('#item-state').textContent = 'Sincronizando lista…';
  try {
    await Promise.all([loadActiveList(), loadCategories(), loadStores()]);
    $('#item-state').textContent = '';
    connectRealtime();
    $('#active-list-title').focus?.({ preventScroll: true });
  } catch (error) {
    $('#item-state').textContent = error.message;
  }
}

function setRealtimeState(state, label) {
  const element = $('#realtime-state');
  element.dataset.state = state;
  element.querySelector('span:last-child').textContent = label;
}

function stopRealtime() {
  if (model.realtimeTimer) clearTimeout(model.realtimeTimer);
  model.realtimeTimer = null;
  model.realtimeSource?.close();
  model.realtimeSource = null;
  setRealtimeState('paused', 'Pausado');
}

function scheduleRealtimeResync(event) {
  if (model.realtimeTimer) clearTimeout(model.realtimeTimer);
  model.realtimeTimer = setTimeout(async () => {
    model.realtimeTimer = null;
    try {
      const shouldReloadDetail = model.activeListId && (
        !event?.listId
        || event.listId === model.activeListId
      );
      const tasks = [loadLists()];
      if (event?.entityType === 'product') model.variantOptions.clear();
      if (shouldReloadDetail) tasks.push(loadActiveList());
      if (event?.entityType === 'category') tasks.push(loadCategories());
      if (event?.entityType === 'store') tasks.push(loadStores());
      await Promise.all(tasks);
      setRealtimeState('live', 'En tiempo real');
    } catch {
      setRealtimeState('reconnecting', 'Reintentando');
    }
  }, REALTIME_COALESCE_MS);
}

function connectRealtime() {
  stopRealtime();
  if (!model.activeListId || $('#list-detail').hidden || document.hidden) return;
  setRealtimeState('connecting', 'Conectando');
  const source = new EventSource(realtimeEndpoint());
  model.realtimeSource = source;
  source.addEventListener('open', () => {
    if (model.realtimeSource !== source) return;
    setRealtimeState('live', 'En tiempo real');
    scheduleRealtimeResync({ listId: model.activeListId });
  });
  source.addEventListener('invalidate', event => {
    if (model.realtimeSource !== source) return;
    try {
      const invalidation = JSON.parse(event.data);
      scheduleRealtimeResync(invalidation);
    } catch {
      scheduleRealtimeResync({ listId: model.activeListId });
    }
  });
  source.addEventListener('error', () => {
    if (model.realtimeSource === source) setRealtimeState('reconnecting', 'Reintentando');
  });
}

async function loadCategories() {
  const result = await api('/api/v1/categories');
  model.categories = result.categories;
  populateCategorySelects();
}

function populateCategorySelects() {
  const select = $('#global-category');
  if (!select) return;
  const current = select.value;
  const options = model.categories.map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');
  select.innerHTML = `<option value="">Sin categoría</option>${options}`;
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

async function loadStores(origin) {
  const params = new URLSearchParams({ limit: '12' });
  if (origin) {
    params.set('latitudeMicrodegrees', String(origin.latitudeMicrodegrees));
    params.set('longitudeMicrodegrees', String(origin.longitudeMicrodegrees));
    params.set('maximumDistanceMeters', String(LOCATION_MATCH_METERS));
  }
  const result = await api(`/api/v1/stores/suggestions?${params}`);
  model.stores = result.stores;
  renderStoreOptions();
  return model.stores;
}

function renderStoreOptions() {
  const configurations = [
    ['#store-select', itemStoreOptions($('#store-select')?.value || '')],
    ['#global-store-select', `<option value="">Sin tienda física</option>${model.stores.map(store => `<option value="${escapeHtml(store.id)}">${escapeHtml(store.name)} · ${escapeHtml(store.retailerName)}</option>`).join('')}`],
    ['#list-store-select', listStoreOptions(model.list?.referenceStoreId || '')],
    ['#bulk-store-select', itemStoreOptions($('#bulk-store-select')?.value || '')],
  ];
  for (const [selector, html] of configurations) {
    const select = $(selector);
    if (!select) continue;
    const current = select.value;
    select.innerHTML = html;
    if ([...select.options].some(option => option.value === current)) select.value = current;
  }
}

function restoreItemDraft() {
  const draft = loadItemDraft();
  $('#item-text').value = typeof draft.text === 'string' ? draft.text : '';
  $('#item-quantity').value = Number.isSafeInteger(draft.quantityMinor) && draft.quantityMinor > 0 ? String(draft.quantityMinor) : '1';
  $('#item-unit').value = metadata.units.includes(draft.unit) ? draft.unit : metadata.units.includes('unit') ? 'unit' : metadata.units[0] || '';
  $('#exact-required').checked = draft.exactRequired === true;
  $('#substitution-allowed').checked = draft.substitutionAllowed !== false;
}

function persistItemDraft() {
  if (model.editingItemId) return;
  saveItemDraft({
    text: $('#item-text').value,
    quantityMinor: Number($('#item-quantity').value),
    unit: $('#item-unit').value,
    exactRequired: $('#exact-required').checked,
    substitutionAllowed: $('#substitution-allowed').checked,
  });
}

function resetProductProposal() {
  model.photoStorageKey = '';
  model.photoProposal = null;
  model.proposedCategoryName = '';
  $('#product-photo-state').textContent = '';
  if ($('#global-ai-feedback')) $('#global-ai-feedback').hidden = true;
  if ($('#global-product-warnings')) $('#global-product-warnings').innerHTML = '';
  if ($('#global-product-confidence')) $('#global-product-confidence').textContent = '';
}

function clearLinkedProduct() {
  model.selectedProductVariantId = '';
  model.selectedProductName = '';
  model.selectedCanonicalProductId = '';
  model.selectedSuggestion = null;
  $('#linked-product').hidden = true;
  $('#linked-product-name').textContent = '';
  const size = $('#item-size');
  size.innerHTML = '<option value="">Sin producto seleccionado</option>';
  size.disabled = true;
  void refreshDraftEstimate();
}

async function hydrateItemProduct(variantId, knownProduct) {
  if (!variantId) return;
  try {
    const product = knownProduct || (await api(`/api/v1/products/${encodeURIComponent(variantId)}`)).product;
    if (model.selectedProductVariantId !== variantId) return;
    model.selectedCanonicalProductId = product.canonicalProductId;
    if (!model.variantOptions.has(product.canonicalProductId)) {
      const result = await api(`/api/v1/products/parents/${encodeURIComponent(product.canonicalProductId)}/variants`);
      model.variantOptions.set(product.canonicalProductId, result.variants || []);
    }
    const variants = model.variantOptions.get(product.canonicalProductId) || [product];
    const size = $('#item-size');
    size.innerHTML = variants.map(variant =>
      `<option value="${escapeHtml(variant.id)}" data-variant-name="${escapeHtml(variant.variantName)}"${variant.id === variantId ? ' selected' : ''}>${escapeHtml(packageLabel(variant))}</option>`
    ).join('');
    size.disabled = false;
    void refreshDraftEstimate();
  } catch {
    const size = $('#item-size');
    size.innerHTML = '<option value="">Tamaño no disponible</option>';
    size.disabled = true;
  }
}

function setLinkedProduct(id, name, product) {
  model.selectedProductVariantId = id;
  model.selectedProductName = name;
  model.selectedSuggestion = product || null;
  $('#linked-product-name').textContent = name;
  $('#linked-product').hidden = false;
  void hydrateItemProduct(id, product);
}

function setItemEntryMode(mode) {
  const scanning = mode === 'scan';
  $('#item-mode-create').classList.toggle('is-selected', !scanning);
  $('#item-mode-create').setAttribute('aria-pressed', String(!scanning));
  $('#item-mode-scan').classList.toggle('is-selected', scanning);
  $('#item-mode-scan').setAttribute('aria-pressed', String(scanning));
  $('#item-scan-options').hidden = !scanning;
}

function resetItemForm() {
  model.editingItemId = '';
  setItemEntryMode('create');
  clearLinkedProduct();
  resetProductProposal();
  $('#item-form-title').textContent = 'Nuevo ítem';
  $('#item-submit-label').textContent = 'Añadir';
  $('#item-dialog-state').textContent = '';
  $('#suggestions').innerHTML = '';
  $('#item-advanced').open = false;
  $('#store-select').value = '';
  restoreItemDraft();
  void refreshDraftEstimate();
}

function openItemCreate() {
  resetItemForm();
  openDialog($('#item-dialog'), '#item-text');
}

async function beginItemEdit(itemId) {
  const item = model.items.find(candidate => candidate.id === itemId);
  if (!item) return;
  resetProductProposal();
  model.editingItemId = item.id;
  $('#item-form-title').textContent = 'Editar ítem';
  $('#item-submit-label').textContent = 'Guardar cambios';
  $('#item-text').value = item.text;
  $('#item-quantity').value = String(item.quantityMinor);
  $('#item-unit').value = item.unit;
  $('#store-select').value = item.storeOverrideId || '';
  $('#exact-required').checked = item.exactRequired;
  $('#substitution-allowed').checked = item.substitutionAllowed;
  if (item.productVariantId) {
    try {
      const result = await api(`/api/v1/products/${encodeURIComponent(item.productVariantId)}`);
      setLinkedProduct(item.productVariantId, result.product.variantName, result.product);
      await hydrateItemProduct(item.productVariantId, result.product);
    } catch {
      clearLinkedProduct();
    }
  } else {
    clearLinkedProduct();
  }
  await refreshDraftEstimate({ immediate: true });
  openDialog($('#item-dialog'), '#item-text');
}

function showManualProductDetails() {
  void openGlobalProductEditor(!model.selectedProductVariantId);
}

function scheduleSuggestions() {
  model.suggestionController?.abort();
  if (model.suggestionTimer) clearTimeout(model.suggestionTimer);
  const query = $('#item-text').value.trim();
  if (model.selectedProductVariantId && query !== model.selectedProductName) clearLinkedProduct();
  if (query.length < 2) {
    $('#suggestions').innerHTML = '';
    return;
  }
  const controller = new AbortController();
  model.suggestionController = controller;
  model.suggestionTimer = setTimeout(async () => {
    if (controller.signal.aborted) return;
    try {
      const params = new URLSearchParams({ q: query });
      const effectiveStoreId = $('#store-select').value || model.list?.referenceStoreId || '';
      if (effectiveStoreId) params.set('storeId', effectiveStoreId);
      const result = await api(`/api/v1/products/suggestions?${params}`, { signal: controller.signal });
      if (controller.signal.aborted || $('#item-text').value.trim() !== query) return;
      const options = result.suggestions.map(suggestion => {
        const details = [suggestion.brand, suggestion.categoryName || suggestion.canonicalName, packageLabel(suggestion)]
          .filter(value => value && value !== 'Sin tamaño')
          .join(' · ');
        const price = suggestion.latestStorePrice
          ? `${suggestion.latestStorePrice.storeName} · ${formatEuroMinor(suggestion.latestStorePrice.priceMinor)} · ${relativeAge(suggestion.latestStorePrice.observedAt)}`
          : 'Sin precio guardado en la tienda seleccionada';
        return `<button type="button" class="suggestion-option" role="option" data-product-id="${escapeHtml(suggestion.id)}" data-product-name="${escapeHtml(suggestion.name)}">
          <span><strong>${escapeHtml(suggestion.name)}</strong><small>${escapeHtml(details)}</small><small class="suggestion-price">${escapeHtml(price)}</small></span>
        </button>`;
      }).join('');
      $('#suggestions').innerHTML = `${options}<button type="button" class="suggestion-option suggestion-option--create" data-create-global-product="true"><span><strong>Crear nuevo producto “${escapeHtml(query)}”</strong><small>Producto base, variante, marca, EAN, tamaño, precio y tienda</small></span></button>`;
    } catch (error) {
      if (error.name !== 'AbortError') $('#suggestions').innerHTML = '';
    }
  }, 180);
}

function setGlobalEntryMode(mode) {
  const scanning = mode === 'scan';
  $('#global-mode-scan').classList.toggle('is-selected', scanning);
  $('#global-mode-scan').setAttribute('aria-pressed', String(scanning));
  $('#global-mode-manual').classList.toggle('is-selected', !scanning);
  $('#global-mode-manual').setAttribute('aria-pressed', String(!scanning));
}

function clearGlobalParent({ keepName = false } = {}) {
  model.globalParentId = '';
  model.globalParentName = '';
  $('#global-parent-selected').hidden = true;
  $('#global-parent-selected-name').textContent = '';
  $('#global-parent-selected-meta').textContent = '';
  $('#global-canonical-field').hidden = false;
  if (!keepName) $('#global-canonical-name').value = $('#global-parent-search').value.trim();
}

function setGlobalParent(parent) {
  model.globalParentId = parent.id;
  model.globalParentName = parent.name;
  $('#global-parent-selected-name').textContent = parent.name;
  $('#global-parent-selected-meta').textContent = `${Number(parent.variantCount || 0)} variantes`;
  $('#global-parent-selected').hidden = false;
  $('#global-parent-suggestions').innerHTML = '';
  $('#global-parent-search').value = parent.name;
  $('#global-canonical-name').value = parent.name;
  $('#global-canonical-field').hidden = true;
}

function resetGlobalProductFields() {
  model.priceNormalizationController?.abort();
  if (model.priceNormalizationTimer) clearTimeout(model.priceNormalizationTimer);
  model.priceNormalizationController = null;
  model.priceNormalizationTimer = null;
  clearGlobalParent({ keepName: true });
  $('#global-category-new').value = '';
  $('#global-variant-name').value = '';
  $('#global-brand').value = '';
  $('#global-ean').value = '';
  $('#global-category').value = '';
  $('#global-description').value = '';
  $('#global-aliases').value = '';
  $('#global-package-minor').value = '';
  $('#global-package-unit').value = '';
  $('#global-price').value = '';
  $('#global-normalized-price').textContent = '';
  $('#global-product-state').textContent = '';
  $('#global-ai-feedback').hidden = true;
  $('#global-product-warnings').innerHTML = '';
  $('#global-product-confidence').textContent = '';
}

async function openGlobalProductEditor(createNew = false) {
  model.globalProductEditingId = createNew ? '' : model.selectedProductVariantId;
  model.globalProductAddToList = createNew;
  setGlobalEntryMode('manual');
  resetGlobalProductFields();
  $('#global-item-quantity').value = $('#item-quantity').value || '1';
  $('#global-item-unit').value = $('#item-unit').value || 'unit';
  const effectiveStoreId = $('#store-select').value || model.list?.referenceStoreId || '';
  $('#global-store-select').value = effectiveStoreId;

  if (model.globalProductEditingId) {
    const result = await api(`/api/v1/products/${encodeURIComponent(model.globalProductEditingId)}`);
    const product = result.product;
    model.globalParentId = product.canonicalProductId;
    model.globalParentName = product.canonicalName;
    $('#global-parent-search').value = product.canonicalName;
    $('#global-parent-selected-name').textContent = product.canonicalName;
    $('#global-parent-selected-meta').textContent = 'Producto base actual';
    $('#global-parent-selected').hidden = false;
    $('#global-canonical-field').hidden = false;
    $('#global-canonical-name').value = product.canonicalName;
    $('#global-variant-name').value = product.variantName;
    $('#global-brand').value = product.brand || '';
    $('#global-ean').value = product.ean || '';
    $('#global-category').value = product.categoryId || '';
    $('#global-description').value = product.description || '';
    $('#global-aliases').value = (product.aliases || []).join('\n');
    $('#global-package-minor').value = product.packageMinor || '';
    $('#global-package-unit').value = product.packageUnit || '';
    $('#global-product-title').textContent = 'Editar producto';
    $('#global-product-submit-label').textContent = 'Guardar cambios';
  } else {
    const name = $('#item-text').value.trim();
    $('#global-parent-search').value = name;
    $('#global-canonical-name').value = name;
    $('#global-variant-name').value = name;
    $('#global-product-title').textContent = 'Crear producto';
    $('#global-product-submit-label').textContent = 'Crear y añadir';
  }
  openDialog($('#global-product-dialog'), '#global-parent-search');
}

function scheduleParentSuggestions() {
  model.parentSuggestionController?.abort();
  if (model.parentSuggestionTimer) clearTimeout(model.parentSuggestionTimer);
  const query = $('#global-parent-search').value.trim();
  if (model.globalParentId && query !== model.globalParentName) clearGlobalParent({ keepName: true });
  if (query.length < 2) {
    $('#global-parent-suggestions').innerHTML = '';
    return;
  }
  const controller = new AbortController();
  model.parentSuggestionController = controller;
  model.parentSuggestionTimer = setTimeout(async () => {
    try {
      const result = await api(`/api/v1/products/parents?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      if (controller.signal.aborted || $('#global-parent-search').value.trim() !== query) return;
      $('#global-parent-suggestions').innerHTML = (result.parents || []).map(parent =>
        `<button type="button" class="suggestion-option" role="option" data-parent-id="${escapeHtml(parent.id)}" data-parent-name="${escapeHtml(parent.name)}" data-parent-variants="${Number(parent.variantCount || 0)}"><span><strong>${escapeHtml(parent.name)}</strong><small>${Number(parent.variantCount || 0)} variantes${parent.categoryName ? ` · ${escapeHtml(parent.categoryName)}` : ''}</small></span></button>`
      ).join('');
    } catch (error) {
      if (error.name !== 'AbortError') $('#global-parent-suggestions').innerHTML = '';
    }
  }, 180);
}

async function resolveManualCategory() {
  const newName = $('#global-category-new').value.trim();
  if (newName) {
    const result = await api('/api/v1/categories', { method: 'POST', body: JSON.stringify({ name: newName }) });
    await loadCategories();
    return result.category.id;
  }
  return $('#global-category').value || undefined;
}

function selectedStore(id) {
  return model.stores.find(store => store.id === id) || null;
}

function sameStoreText(left, right) {
  return Boolean(left && right)
    && left.localeCompare(right, 'es', { sensitivity: 'base' }) === 0;
}

function proposalStoreMatches(store, storeName, retailerName) {
  if (storeName && !sameStoreText(store.name, storeName)) return false;
  if (retailerName && !sameStoreText(store.retailerName, retailerName)) return false;
  return Boolean(storeName || retailerName);
}

async function resolveProposalStore(storeName, retailerName) {
  const cached = model.stores.filter(store => proposalStoreMatches(store, storeName, retailerName));
  if (cached.length === 1) return cached[0];

  const query = storeName || retailerName;
  if (!query) return null;
  try {
    const params = new URLSearchParams({ q: query, limit: '100' });
    if (retailerName) params.set('retailer', retailerName);
    const result = await api(`/api/v1/inventory/stores?${params}`);
    const matches = (result.stores || []).filter(store => proposalStoreMatches(store, storeName, retailerName));
    if (matches.length !== 1) return null;
    const match = matches[0];
    if (!model.stores.some(store => store.id === match.id)) {
      model.stores = [...model.stores, match];
      renderStoreOptions();
    }
    return match;
  } catch {
    return null;
  }
}

function renderGlobalNormalizedPrice(minor, unit) {
  const target = $('#global-normalized-price');
  if (!Number.isSafeInteger(minor) || !unit) {
    target.textContent = '';
    return;
  }
  target.textContent = `≈ ${formatEuroMinor(minor)}/${UNIT_LABELS[unit] || unit}`;
}

function scheduleGlobalNormalizedPrice() {
  void refreshGlobalNormalizedPrice();
}

async function refreshGlobalNormalizedPrice({ immediate = false } = {}) {
  model.priceNormalizationController?.abort();
  if (model.priceNormalizationTimer) clearTimeout(model.priceNormalizationTimer);
  const priceText = $('#global-price').value.trim();
  const packageNumerator = Number($('#global-package-minor').value);
  const packageUnit = $('#global-package-unit').value;
  if (!priceText || !Number.isSafeInteger(packageNumerator) || packageNumerator < 1 || !packageUnit) {
    renderGlobalNormalizedPrice();
    return;
  }
  const signature = `${priceText}|${packageNumerator}|${packageUnit}`;
  const run = async () => {
    const controller = new AbortController();
    model.priceNormalizationController = controller;
    try {
      const result = await api('/api/v1/products/price-normalization', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          priceMinor: euroInputToMinor(priceText),
          packageNumerator,
          packageDenominator: 1,
          packageUnit,
        }),
      });
      if (controller.signal.aborted) return;
      const current = `${$('#global-price').value.trim()}|${Number($('#global-package-minor').value)}|${$('#global-package-unit').value}`;
      if (current !== signature) return;
      renderGlobalNormalizedPrice(result.normalizedPriceMinor, result.normalizedPriceUnit);
    } catch (error) {
      if (error.name !== 'AbortError') renderGlobalNormalizedPrice();
    }
  };
  if (immediate) return await run();
  model.priceNormalizationTimer = setTimeout(() => void run(), 160);
}

async function persistGlobalPrice(productVariantId) {
  const priceText = $('#global-price').value.trim();
  if (!priceText) return null;
  const store = selectedStore($('#global-store-select').value);
  const retailerName = store?.retailerName || model.photoProposal?.retailerName || '';
  if (!retailerName) throw new Error('Selecciona una tienda o comercio para guardar el precio.');
  const packageMinor = Number($('#global-package-minor').value);
  const packageUnit = $('#global-package-unit').value;
  const payload = {
    priceMinor: euroInputToMinor(priceText),
    retailerName,
    ...(store ? { storeId: store.id } : {}),
    evidenceType: model.photoStorageKey ? 'product-photo' : 'manual',
    ...(model.photoStorageKey ? { storageKey: model.photoStorageKey } : {}),
    ...(Number.isSafeInteger(packageMinor) && packageMinor > 0 ? { packageNumerator: packageMinor } : {}),
    ...(packageUnit ? { packageUnit } : {}),
    confidence: model.photoProposal?.confidence ?? 1,
  };
  const result = await api(`/api/v1/products/${encodeURIComponent(productVariantId)}/prices`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  renderGlobalNormalizedPrice(
    result.observation.normalizedDisplayPriceMinor,
    result.observation.normalizedDisplayPriceUnit,
  );
  return result.observation;
}

function storeOverrideFromSelection(storeId) {
  if (!storeId || storeId === model.list?.referenceStoreId) return null;
  return storeId;
}

async function persistItemWithProduct(product) {
  if (!model.list) return;
  const storeOverrideId = storeOverrideFromSelection($('#global-store-select').value);
  const payload = {
    text: product.variantName,
    quantityMinor: Number($('#global-item-quantity').value) || 1,
    unit: $('#global-item-unit').value || 'unit',
    exactRequired: $('#exact-required').checked,
    substitutionAllowed: $('#substitution-allowed').checked,
    productVariantId: product.id,
    storeOverrideId,
  };
  if (model.editingItemId) {
    const current = model.items.find(item => item.id === model.editingItemId);
    if (!current) throw new Error('El producto ya no está en la lista');
    await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/items/${encodeURIComponent(current.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...payload, version: current.version }),
    });
  } else {
    await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/items`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

async function submitGlobalProduct(event) {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true);
  $('#global-product-state').textContent = 'Guardando producto…';
  try {
    const packageMinorRaw = $('#global-package-minor').value.trim();
    const packageUnit = $('#global-package-unit').value;
    const variantFields = {
      variantName: $('#global-variant-name').value.trim(),
      brand: $('#global-brand').value.trim() || null,
      ean: $('#global-ean').value.trim() || null,
      packageMinor: packageMinorRaw ? Number(packageMinorRaw) : null,
      packageUnit: packageUnit || null,
      aliases: $('#global-aliases').value.split('\n').map(value => value.trim()).filter(Boolean),
    };

    let result;
    if (model.globalProductEditingId) {
      const categoryId = await resolveManualCategory();
      const payload = {
        canonicalName: $('#global-canonical-name').value.trim(),
        ...variantFields,
        ...(categoryId ? { categoryId } : { categoryId: null }),
        description: $('#global-description').value.trim() || null,
      };
      result = await api(`/api/v1/products/${encodeURIComponent(model.globalProductEditingId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    } else if (model.globalParentId) {
      const payload = Object.fromEntries(Object.entries({
        canonicalProductId: model.globalParentId,
        ...variantFields,
      }).filter(([, value]) => value !== null));
      result = await api('/api/v1/products', { method: 'POST', body: JSON.stringify(payload) });
    } else {
      const categoryId = await resolveManualCategory();
      const canonicalName = $('#global-canonical-name').value.trim() || $('#global-parent-search').value.trim();
      const payload = Object.fromEntries(Object.entries({
        canonicalName,
        ...variantFields,
        ...(categoryId ? { categoryId } : {}),
        description: $('#global-description').value.trim() || null,
      }).filter(([, value]) => value !== null));
      result = await api('/api/v1/products', { method: 'POST', body: JSON.stringify(payload) });
    }

    await persistGlobalPrice(result.product.id);
    setLinkedProduct(result.product.id, result.product.variantName, result.product);
    $('#item-text').value = result.product.variantName;

    if (model.globalProductAddToList) {
      await persistItemWithProduct(result.product);
      if (!model.editingItemId) clearItemDraft();
      closeDialog($('#global-product-dialog'));
      closeDialog($('#item-dialog'));
      resetItemForm();
      await Promise.all([loadActiveList(), loadLists()]);
      toast(model.editingItemId ? 'Producto y línea actualizados' : 'Producto añadido');
    } else {
      closeDialog($('#global-product-dialog'));
      $('#global-product-state').textContent = '';
      await Promise.all([loadCategories(), loadActiveList()]);
      await refreshDraftEstimate({ immediate: true });
      toast('Ficha de producto guardada');
    }
  } catch (error) {
    $('#global-product-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.onload = () => {
      const value = String(reader.result || '');
      const comma = value.indexOf(',');
      if (comma < 0) reject(new Error('La imagen no tiene un formato válido'));
      else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function formatMegabytes(bytes) {
  const megabytes = bytes / (1024 * 1024);
  return new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: 1,
    minimumFractionDigits: Number.isInteger(megabytes) ? 0 : 1,
  }).format(megabytes);
}

function ensureImageLimitHelp(targetSelector, id) {
  let help = $(`#${id}`);
  if (help) return help;
  const target = $(targetSelector);
  if (!target) return null;
  help = document.createElement('p');
  help.id = id;
  help.className = 'field-help';
  help.setAttribute('role', 'status');
  target.before(help);
  return help;
}

function renderImageLimitHelp(maxImageBytes, maxFileBytes) {
  const copy = `Límites actuales de WebAPI: imágenes ${formatMegabytes(maxImageBytes)} MB · archivos ${formatMegabytes(maxFileBytes)} MB.`;
  ensureImageLimitHelp('#product-photo-state', 'product-image-limit-help')?.replaceChildren(copy);
  ensureImageLimitHelp('#ai-state', 'ai-image-limit-help')?.replaceChildren(copy);
}

function renderImageLimitUnavailable() {
  const copy = 'No se pudieron consultar los límites actuales de WebAPI. No se enviarán imágenes a la IA hasta recuperarlos.';
  ensureImageLimitHelp('#product-photo-state', 'product-image-limit-help')?.replaceChildren(copy);
  ensureImageLimitHelp('#ai-state', 'ai-image-limit-help')?.replaceChildren(copy);
}

async function readLiveAiAttachmentLimits() {
  const runtimeCapabilities = await api('/api/v1/ai/runtime-capabilities', { cache: 'no-store' });
  const maxImageBytes = runtimeCapabilities?.attachments?.maxImageBytes;
  const maxFileBytes = runtimeCapabilities?.attachments?.maxFileBytes;
  if (!Number.isSafeInteger(maxImageBytes) || maxImageBytes <= 0 || !Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
    throw new Error('WebAPI no ha devuelto límites de adjuntos válidos');
  }
  renderImageLimitHelp(maxImageBytes, maxFileBytes);
  return { maxImageBytes, maxFileBytes };
}

async function refreshImageLimitHelp() {
  if (!aiConfigured) return;
  try {
    await readLiveAiAttachmentLimits();
  } catch {
    renderImageLimitUnavailable();
  }
}

async function uploadProductImage(file) {
  if (!file || !['image/jpeg', 'image/png'].includes(file.type)) throw new Error('Usa una imagen JPEG o PNG');
  if (aiConfigured) {
    let limits;
    try {
      limits = await readLiveAiAttachmentLimits();
    } catch (error) {
      renderImageLimitUnavailable();
      throw error;
    }
    if (file.size > limits.maxImageBytes) {
      throw new Error(
        `La imagen ${file.name || 'archivo'} ocupa ${formatMegabytes(file.size)} MB y supera el máximo de ${formatMegabytes(limits.maxImageBytes)} MB admitido por WebAPI`,
      );
    }
  }
  const base64 = await readFileBase64(file);
  const result = await api('/api/v1/files', {
    method: 'POST',
    body: JSON.stringify({ base64, mimeType: file.type, originalName: file.name || 'product-photo' }),
  });
  return result.file.storageKey;
}

async function applyPhotoProposal(proposal, storageKey) {
  model.photoStorageKey = storageKey;
  model.photoProposal = proposal;
  model.proposedCategoryName = proposal.category || '';

  if (!$('#global-product-dialog').open) await openGlobalProductEditor(true);
  const canonicalName = proposal.canonicalName || $('#item-text').value.trim();
  $('#global-parent-search').value = canonicalName;
  $('#global-canonical-name').value = canonicalName;
  $('#global-variant-name').value = proposal.variantName || canonicalName;
  $('#global-brand').value = proposal.brand || '';
  $('#global-ean').value = proposal.ean || '';
  $('#global-description').value = proposal.description || '';
  $('#global-package-minor').value = Number.isSafeInteger(proposal.packageAmountMinor) ? String(proposal.packageAmountMinor) : '';
  $('#global-package-unit').value = proposal.packageUnit || '';
  $('#global-item-quantity').value = Number.isSafeInteger(proposal.quantityMinor) ? String(proposal.quantityMinor) : $('#item-quantity').value || '1';
  $('#global-item-unit').value = proposal.unit || $('#item-unit').value || 'unit';
  $('#global-price').value = Number.isSafeInteger(proposal.priceMinor) ? minorToEuroInput(proposal.priceMinor) : '';

  if (proposal.category) {
    const category = model.categories.find(candidate => candidate.name.localeCompare(proposal.category, 'es', { sensitivity: 'base' }) === 0);
    if (category) $('#global-category').value = category.id;
    else $('#global-category-new').value = proposal.category;
  }

  if (canonicalName) {
    try {
      const result = await api(`/api/v1/products/parents?q=${encodeURIComponent(canonicalName)}`);
      const exact = (result.parents || []).filter(parent => parent.name.localeCompare(canonicalName, 'es', { sensitivity: 'base' }) === 0);
      if (exact.length === 1) setGlobalParent(exact[0]);
    } catch {
      // Parent matching is an optional convenience; the editable form remains available.
    }
  }

  const storeName = proposal.storeName?.trim();
  const retailerName = proposal.retailerName?.trim();
  const proposalStore = await resolveProposalStore(storeName, retailerName);
  if (proposalStore) $('#global-store-select').value = proposalStore.id;

  setGlobalEntryMode('manual');
  $('#global-product-confidence').textContent = `${Math.round(Number(proposal.confidence || 0) * 100)}%`;
  $('#global-product-confidence').className = `status-pill ${Number(proposal.confidence || 0) >= .8 ? 'success' : 'warning'}`;
  $('#global-product-warnings').innerHTML = (proposal.warnings || []).map(warning => `<p>${escapeHtml(warning)}</p>`).join('');
  $('#global-ai-feedback').hidden = false;
  if ((storeName || retailerName) && !proposalStore) {
    $('#global-product-warnings').insertAdjacentHTML('beforeend', `<p>${escapeHtml(storeName || retailerName)} no coincide de forma única con una tienda guardada. Confirma la tienda antes de guardar el precio.</p>`);
  }
  await refreshGlobalNormalizedPrice({ immediate: true });
}

async function handleProductPhoto(file, source = 'item') {
  const state = source === 'ai'
    ? $('#ai-state')
    : source === 'global'
      ? $('#global-product-state')
      : $('#product-photo-state');
  state.textContent = 'Preparando imagen…';
  try {
    const storageKey = await uploadProductImage(file);
    state.textContent = aiConfigured
      ? 'Analizando imagen…'
      : 'Imagen guardada. La IA no está configurada; completa los datos manualmente.';
    if (source !== 'global' && !$('#item-dialog').open) openItemCreate();
    if (!aiConfigured) {
      model.photoStorageKey = storageKey;
      if (source === 'ai') closeDialog($('#ai-assistant-dialog'));
      if (!$('#global-product-dialog').open) await openGlobalProductEditor(true);
      return;
    }
    const result = await api('/api/v1/products/photo-proposal', {
      method: 'POST',
      body: JSON.stringify({
        storageKey,
        contextText: $('#item-text').value.trim() || $('#ai-text').value.trim(),
      }),
    });
    if (source === 'ai') closeDialog($('#ai-assistant-dialog'));
    await applyPhotoProposal(result.proposal, storageKey);
    state.textContent = 'Datos detectados. Revisa el mismo formulario antes de crear.';
  } catch (error) {
    state.textContent = `No se pudo analizar la foto: ${error.message}. El formulario manual sigue disponible.`;
  }
}

function scheduleDraftEstimate() {
  void refreshDraftEstimate();
}

async function refreshDraftEstimate({ immediate = false } = {}) {
  model.draftEstimateController?.abort();
  if (model.draftEstimateTimer) clearTimeout(model.draftEstimateTimer);
  const variantId = model.selectedProductVariantId;
  const context = $('#item-line-estimate-context');
  const total = $('#item-line-estimate-total');
  if (!variantId || !model.list) {
    context.textContent = 'Selecciona un producto guardado para calcularla.';
    total.textContent = '—';
    return;
  }
  const run = async () => {
    const controller = new AbortController();
    model.draftEstimateController = controller;
    try {
      const storeOverrideId = $('#store-select').value || null;
      const result = await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/estimate-item`, {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          text: $('#item-text').value.trim() || model.selectedProductName || 'Producto',
          quantityMinor: Number($('#item-quantity').value) || 1,
          unit: $('#item-unit').value || 'unit',
          productVariantId: variantId,
          ...(storeOverrideId ? { storeOverrideId } : {}),
        }),
      });
      if (controller.signal.aborted) return;
      const line = result.line;
      if (line.status === 'priced') {
        total.textContent = formatEuroMinor(line.estimatedTotalMinor);
        context.textContent = `${line.effectiveStoreName || 'Tienda'} · ${relativeAge(line.observedAt)}`;
      } else {
        total.textContent = '—';
        context.textContent = unpricedLabel(line.reason);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        total.textContent = '—';
        context.textContent = 'No se pudo actualizar la estimación.';
      }
    }
  };
  if (immediate) return await run();
  model.draftEstimateTimer = setTimeout(() => void run(), 160);
}

function explicitEditPayload() {
  const storeOverrideId = $('#store-select').value || null;
  return {
    text: $('#item-text').value.trim(),
    quantityMinor: Number($('#item-quantity').value),
    unit: $('#item-unit').value,
    exactRequired: $('#exact-required').checked,
    substitutionAllowed: $('#substitution-allowed').checked,
    ...(model.selectedProductVariantId
      ? { productVariantId: model.selectedProductVariantId }
      : model.editingItemId
        ? { productVariantId: null }
        : {}),
    ...(storeOverrideId ? { storeOverrideId } : model.editingItemId ? { storeOverrideId: null } : {}),
  };
}

async function submitItemForm(event) {
  event.preventDefault();
  if (!model.list) return;
  const button = $('#add-item');
  setBusy(button, true);
  $('#item-dialog-state').textContent = model.editingItemId ? 'Guardando cambios…' : 'Añadiendo…';
  try {
    const wasEditing = Boolean(model.editingItemId);
    const payload = explicitEditPayload();
    if (model.editingItemId) {
      const current = model.items.find(candidate => candidate.id === model.editingItemId);
      if (!current) throw new Error('El producto ya no está en la lista');
      try {
        await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/items/${encodeURIComponent(current.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...payload, version: current.version }),
        });
      } catch (error) {
        if (error.code === 'SHOPPING_CONFLICT' && error.details?.kind === 'item') {
          showConflict(payload, error.details.current);
          return;
        }
        throw error;
      }
    } else {
      await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/items`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      clearItemDraft();
    }

    closeDialog($('#item-dialog'));
    resetItemForm();
    await Promise.all([loadActiveList(), loadLists()]);
    toast(wasEditing ? 'Producto actualizado' : 'Producto añadido');
  } catch (error) {
    $('#item-dialog-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function conflictField(label, mine, latest) {
  if (String(mine) === String(latest)) return '';
  return `<div class="conflict-field"><strong>${escapeHtml(label)}</strong><div><span>Tu cambio</span><b>${escapeHtml(String(mine))}</b></div><div><span>Última versión</span><b>${escapeHtml(String(latest))}</b></div></div>`;
}

function showConflict(attempted, current) {
  model.conflict = { attempted, current, itemId: model.editingItemId };
  const fields = [
    conflictField('Producto', attempted.text, current.text),
    conflictField('Cantidad', attempted.quantityMinor, current.quantityMinor),
    conflictField('Unidad', attempted.unit, current.unit),
    conflictField('Producto exacto', attempted.exactRequired ? 'Sí' : 'No', current.exactRequired ? 'Sí' : 'No'),
    conflictField('Alternativas', attempted.substitutionAllowed ? 'Sí' : 'No', current.substitutionAllowed ? 'Sí' : 'No'),
  ].filter(Boolean);
  $('#conflict-fields').innerHTML = fields.join('') || '<p>No hay diferencias de campos visibles; la versión cambió por otra acción.</p>';
  openDialog($('#conflict-dialog'));
}

async function useLatestConflict() {
  model.conflict = null;
  closeDialog($('#conflict-dialog'));
  closeDialog($('#item-dialog'));
  await loadActiveList();
  toast('Se conserva la última versión guardada');
}

async function useMyConflict() {
  const conflict = model.conflict;
  if (!conflict || !model.list) return;
  const button = $('#use-my-conflict');
  setBusy(button, true);
  try {
    await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/items/${encodeURIComponent(conflict.itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...conflict.attempted, version: conflict.current.version }),
    });
    model.conflict = null;
    closeDialog($('#conflict-dialog'));
    closeDialog($('#item-dialog'));
    await Promise.all([loadActiveList(), loadLists()]);
    toast('Tus cambios se guardaron sobre la última versión');
  } catch (error) {
    if (error.code === 'SHOPPING_CONFLICT' && error.details?.kind === 'item') {
      showConflict(conflict.attempted, error.details.current);
    } else {
      $('#item-state').textContent = error.message;
    }
  } finally {
    setBusy(button, false);
  }
}

async function resyncAfterSimpleConflict(message = 'La lista cambió en el otro móvil. Se ha cargado la versión más reciente.') {
  await Promise.all([loadActiveList(), loadLists()]);
  toast(message);
}

async function updateItem(itemId, payload, status) {
  const item = model.items.find(candidate => candidate.id === itemId);
  if (!item || !model.list) return;
  try {
    await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...payload, version: item.version }),
    });
    await loadActiveList();
    $('#item-state').textContent = status;
  } catch (error) {
    if (error.code === 'SHOPPING_CONFLICT') return resyncAfterSimpleConflict();
    throw error;
  }
}

async function moveItem(itemId, direction) {
  if (!model.list) return;
  const item = model.items.find(candidate => candidate.id === itemId);
  if (!item) return;
  const group = model.items.filter(candidate => candidate.completed === item.completed);
  const groupIndex = group.findIndex(candidate => candidate.id === itemId);
  const target = group[groupIndex + direction];
  if (!target) return;
  const orderedIds = model.items.map(candidate => candidate.id);
  const sourceIndex = orderedIds.indexOf(item.id);
  const targetIndex = orderedIds.indexOf(target.id);
  [orderedIds[sourceIndex], orderedIds[targetIndex]] = [orderedIds[targetIndex], orderedIds[sourceIndex]];
  try {
    const result = await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/items/order`, {
      method: 'PUT',
      body: JSON.stringify({ itemIds: orderedIds, listVersion: model.list.version }),
    });
    model.list = result.list;
    model.items = result.items;
    renderItems();
    $('#item-state').textContent = 'Orden actualizado';
  } catch (error) {
    if (error.code === 'SHOPPING_CONFLICT') return resyncAfterSimpleConflict('El orden cambió en el otro móvil. Se conserva el orden más reciente.');
    throw error;
  }
}

function showDeleteItemDialog(itemId) {
  const item = model.items.find(candidate => candidate.id === itemId);
  if (!item) return;
  model.deletingItemId = item.id;
  $('#delete-item-name').textContent = item.text;
  openDialog($('#delete-item-dialog'));
}

function itemCreationPayload(item) {
  return {
    text: item.text,
    quantityMinor: item.quantityMinor,
    unit: item.unit,
    exactRequired: item.exactRequired,
    substitutionAllowed: item.substitutionAllowed,
    ...(item.productVariantId ? { productVariantId: item.productVariantId } : {}),
    ...(item.storeOverrideId ? { storeOverrideId: item.storeOverrideId } : {}),
  };
}

async function restoreSwipedItem(listId, item, originalIndex) {
  try {
    const created = await api(`/api/v1/shopping-lists/${encodeURIComponent(listId)}/items`, {
      method: 'POST',
      body: JSON.stringify(itemCreationPayload(item)),
    });
    let restored = created.item;
    if (item.completed) {
      const completed = await api(`/api/v1/shopping-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(restored.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: true, version: restored.version }),
      });
      restored = completed.item;
    }
    const current = await api(`/api/v1/shopping-lists/${encodeURIComponent(listId)}`);
    const orderedIds = current.items.filter(candidate => candidate.id !== restored.id).map(candidate => candidate.id);
    orderedIds.splice(Math.min(originalIndex, orderedIds.length), 0, restored.id);
    await api(`/api/v1/shopping-lists/${encodeURIComponent(listId)}/items/order`, {
      method: 'PUT',
      body: JSON.stringify({ itemIds: orderedIds, listVersion: current.list.version }),
    });
    if (model.activeListId === listId) await loadActiveList();
    toast('Producto restaurado');
  } catch (error) {
    toast(`No se pudo deshacer: ${error.message}`);
  }
}

async function deleteItemFromSwipe(itemId) {
  if (model.swipeDeletingItemIds.has(itemId) || !model.list) return;
  const item = model.items.find(candidate => candidate.id === itemId);
  const originalIndex = model.items.findIndex(candidate => candidate.id === itemId);
  const listId = model.list.id;
  if (!item || originalIndex < 0) return;
  model.swipeDeletingItemIds.add(itemId);
  try {
    await api(`/api/v1/shopping-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ version: item.version }),
    });
    model.items.splice(originalIndex, 1);
    renderItems();
    toast('Producto eliminado', {
      actionLabel: 'Deshacer',
      duration: 5200,
      onAction: () => restoreSwipedItem(listId, item, originalIndex),
    });
  } catch (error) {
    if (error.code === 'SHOPPING_CONFLICT') await resyncAfterSimpleConflict('No se eliminó porque el producto había cambiado.');
    else toast(error.message);
  } finally {
    model.swipeDeletingItemIds.delete(itemId);
  }
}

async function confirmDeleteItem() {
  const item = model.items.find(candidate => candidate.id === model.deletingItemId);
  if (!item || !model.list) return;
  const button = $('#confirm-delete-item');
  setBusy(button, true);
  try {
    await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/items/${encodeURIComponent(item.id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ version: item.version }),
    });
    model.deletingItemId = '';
    closeDialog($('#delete-item-dialog'));
    await Promise.all([loadActiveList(), loadLists()]);
    toast('Producto eliminado');
  } catch (error) {
    if (error.code === 'SHOPPING_CONFLICT') await resyncAfterSimpleConflict('No se eliminó porque el producto había cambiado.');
    else $('#item-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function revealCompletedRecovery() {
  const section = $('#completed-section');
  if (!section || section.hidden) return;
  section.open = true;
}

async function setItemCompleted(itemId, completed, { offerUndo = false } = {}) {
  await updateItem(itemId, { completed }, completed ? 'Producto completado' : 'Producto devuelto a pendientes');
  if (!completed) return;
  revealCompletedRecovery();
  if (offerUndo) {
    toast('Producto marcado como comprado', {
      actionLabel: 'Deshacer',
      duration: 5200,
      onAction: () => undoCompletedItem(itemId),
    });
  }
}

async function undoCompletedItem(itemId) {
  const current = model.items.find(candidate => candidate.id === itemId);
  if (!current?.completed) return;
  try {
    await setItemCompleted(itemId, false);
    toast('Producto devuelto a pendientes');
  } catch (error) {
    toast(`No se pudo deshacer: ${error.message}`);
  }
}

async function handleItemAction(event) {
  const button = event.target.closest('[data-item-action]');
  if (!button) return;
  const itemId = button.dataset.itemId;
  try {
    if (button.dataset.itemAction === 'edit') await beginItemEdit(itemId);
    if (button.dataset.itemAction === 'delete') showDeleteItemDialog(itemId);
    if (button.dataset.itemAction === 'complete') {
      const item = model.items.find(candidate => candidate.id === itemId);
      if (item) await setItemCompleted(itemId, !item.completed, { offerUndo: !item.completed });
    }
    if (button.dataset.itemAction === 'quantity') await updateItem(itemId, { quantityDelta: Number(button.dataset.delta) }, 'Cantidad actualizada');
    if (button.dataset.itemAction === 'move') await moveItem(itemId, Number(button.dataset.direction));
  } catch (error) {
    $('#item-state').textContent = error.message;
  }
}

function selectListForAction(listId) {
  model.activeListId = listId;
  saveActiveListId(listId);
}

function openCreateListDialog() {
  $('#new-list-name').value = '';
  openDialog($('#create-list-dialog'), '#new-list-name');
}

async function createList(event) {
  event.preventDefault();
  const name = $('#new-list-name').value.trim();
  if (!name) return;
  const button = event.submitter;
  setBusy(button, true);
  try {
    const result = await api('/api/v1/shopping-lists', { method: 'POST', body: JSON.stringify({ name }) });
    closeDialog($('#create-list-dialog'));
    await loadLists();
    toast('Lista creada');
    await openList(result.list.id);
  } catch (error) {
    $('#list-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function beginRenameList(listId = model.activeListId) {
  const list = model.lists.find(candidate => candidate.id === listId) || (model.list?.id === listId ? model.list : null);
  if (!list) return;
  selectListForAction(list.id);
  $('#rename-list-name').value = list.name;
  openDialog($('#rename-list-dialog'), '#rename-list-name');
}

async function renameList(event) {
  event.preventDefault();
  const list = model.lists.find(candidate => candidate.id === model.activeListId) || model.list;
  const name = $('#rename-list-name').value.trim();
  if (!list || !name) return;
  const button = event.submitter;
  setBusy(button, true);
  try {
    await api(`/api/v1/shopping-lists/${encodeURIComponent(list.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, version: list.version }),
    });
    closeDialog($('#rename-list-dialog'));
    await Promise.all([loadLists(), model.list?.id === list.id ? loadActiveList() : Promise.resolve()]);
    toast('Lista renombrada');
  } catch (error) {
    if (error.code === 'SHOPPING_CONFLICT') {
      closeDialog($('#rename-list-dialog'));
      await Promise.all([loadLists(), model.list ? loadActiveList() : Promise.resolve()]);
      toast('La lista cambió en el otro móvil. Se ha cargado el nombre más reciente.');
    } else {
      $('#list-state').textContent = error.message;
    }
  } finally {
    setBusy(button, false);
  }
}

function showDeleteListDialog(listId = model.activeListId) {
  const list = model.lists.find(candidate => candidate.id === listId) || model.list;
  if (!list) return;
  selectListForAction(list.id);
  $('#delete-list-name').textContent = list.name;
  openDialog($('#delete-list-dialog'));
}

async function confirmDeleteList() {
  const list = model.lists.find(candidate => candidate.id === model.activeListId) || model.list;
  if (!list) return;
  const button = $('#confirm-delete-list');
  setBusy(button, true);
  try {
    await api(`/api/v1/shopping-lists/${encodeURIComponent(list.id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ version: list.version }),
    });
    closeDialog($('#delete-list-dialog'));
    if (model.list?.id === list.id) {
      model.list = null;
      model.items = [];
      stopRealtime();
      setOverviewVisible(true);
      writeListRoute('', { replace: true });
    }
    model.activeListId = '';
    saveActiveListId('');
    await loadLists();
    toast('Lista eliminada');
  } catch (error) {
    if (error.code === 'SHOPPING_CONFLICT') {
      closeDialog($('#delete-list-dialog'));
      await loadLists();
      toast('La lista cambió en el otro móvil y no se eliminó.');
    } else {
      $('#list-state').textContent = error.message;
    }
  } finally {
    setBusy(button, false);
  }
}

function renderAiProposal(proposal) {
  const items = proposal.items || [];
  $('#ai-proposals').innerHTML = items.map((item, index) => `
    <fieldset class="ai-proposal-row" data-ai-proposal-row>
      <label class="ai-proposal-select"><input type="checkbox" data-ai-field="selected" checked><span>Añadir</span></label>
      <label class="field"><span>Producto</span><input data-ai-field="text" maxlength="240" value="${escapeHtml(item.text)}" required></label>
      <div class="quantity-row">
        <label class="field"><span>Cantidad</span><input data-ai-field="quantity" type="number" min="1" max="100000" value="${Number(item.quantityMinor) || 1}"></label>
        <label class="field"><span>Unidad</span><select data-ai-field="unit">${metadata.units.map(unit => `<option value="${escapeHtml(unit)}"${unit === item.unit ? ' selected' : ''}>${escapeHtml(UNIT_LABELS[unit] || unit)}</option>`).join('')}</select></label>
      </div>
      ${item.ambiguity ? `<small>${escapeHtml(item.ambiguity)}</small>` : ''}
    </fieldset>
  `).join('') + '<button class="button primary full" type="submit">Añadir seleccionados a la lista</button>';
  $('#ai-proposals').hidden = false;
}

async function analyzeWithAi() {
  const text = $('#ai-text').value.trim();
  if (!text) {
    $('#ai-state').textContent = 'Describe lo que quieres añadir o adjunta una foto.';
    return;
  }
  if (!aiConfigured) {
    $('#ai-state').textContent = 'La IA no está configurada. La lista y el alta manual siguen disponibles.';
    return;
  }
  const button = $('#analyze-ai');
  setBusy(button, true);
  $('#ai-state').textContent = 'Preparando propuesta…';
  $('#ai-proposals').hidden = true;
  try {
    const result = await api('/api/v1/ai/shopping-list-analysis', { method: 'POST', body: JSON.stringify({ text }) });
    renderAiProposal(result.proposal);
    $('#ai-state').textContent = 'Revisa y edita antes de añadir.';
  } catch (error) {
    $('#ai-state').textContent = `Proveedor IA no disponible: ${error.message}. Puedes continuar manualmente.`;
  } finally {
    setBusy(button, false);
  }
}

async function confirmAiProposal(event) {
  event.preventDefault();
  if (!model.list) return;
  const button = event.submitter;
  setBusy(button, true);
  try {
    const rows = [...$('#ai-proposals').querySelectorAll('[data-ai-proposal-row]')].filter(row => row.querySelector('[data-ai-field="selected"]').checked);
    for (const row of rows) {
      await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/items`, {
        method: 'POST',
        body: JSON.stringify({
          text: row.querySelector('[data-ai-field="text"]').value.trim(),
          quantityMinor: Number(row.querySelector('[data-ai-field="quantity"]').value),
          unit: row.querySelector('[data-ai-field="unit"]').value,
          exactRequired: false,
          substitutionAllowed: true,
        }),
      });
    }
    closeDialog($('#ai-assistant-dialog'));
    $('#ai-text').value = '';
    $('#ai-proposals').hidden = true;
    await Promise.all([loadActiveList(), loadLists()]);
    toast(`${rows.length} ${rows.length === 1 ? 'producto añadido' : 'productos añadidos'}`);
  } catch (error) {
    $('#ai-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function locationUi(scope) {
  const global = scope === 'global';
  return {
    button: $(global ? '#global-use-current-location' : '#use-current-location'),
    nearbyButton: $(global ? '#global-find-nearby-stores' : '#find-nearby-stores'),
    state: global ? $('#global-product-state') : $('#location-state'),
    results: $(global ? '#global-nearby-stores' : '#nearby-stores'),
    attribution: $(global ? '#global-osm-attribution' : '#osm-attribution'),
    select: $(global ? '#global-store-select' : '#store-select'),
  };
}

function requestGeolocation(scope = 'item') {
  const ui = locationUi(scope);
  if (!window.isSecureContext) {
    ui.state.textContent = 'Tu navegador exige HTTPS para compartir ubicación. Puedes elegir una tienda manualmente.';
    return;
  }
  if (!navigator.geolocation) {
    ui.state.textContent = 'Este navegador no ofrece geolocalización. Elige una tienda manualmente.';
    return;
  }
  setBusy(ui.button, true);
  ui.state.textContent = 'Buscando tiendas guardadas cerca…';
  navigator.geolocation.getCurrentPosition(async position => {
    try {
      model.currentLocation = {
        latitudeMicrodegrees: Math.round(position.coords.latitude * 1_000_000),
        longitudeMicrodegrees: Math.round(position.coords.longitude * 1_000_000),
      };
      const current = ui.select.value;
      const stores = await loadStores(model.currentLocation);
      renderStoreOptions();
      if ([...ui.select.options].some(option => option.value === current)) ui.select.value = current;
      if (stores.length > 0) {
        ui.state.textContent = `Encontradas ${stores.length} tiendas guardadas cerca.`;
        ui.nearbyButton.hidden = true;
      } else {
        ui.state.textContent = 'No hay tiendas guardadas cerca. Puedes buscar candidatas en OpenStreetMap.';
        ui.nearbyButton.hidden = false;
      }
    } catch (error) {
      ui.state.textContent = error.message;
    } finally {
      setBusy(ui.button, false);
    }
  }, error => {
    setBusy(ui.button, false);
    ui.state.textContent = error.code === error.PERMISSION_DENIED
      ? 'No has dado permiso de ubicación. Puedes elegir tienda manualmente.'
      : 'No se pudo obtener la ubicación. Puedes elegir tienda manualmente.';
  }, { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 });
}

async function findNearbyStores(scope = 'item') {
  if (!model.currentLocation) return;
  const ui = locationUi(scope);
  setBusy(ui.nearbyButton, true);
  ui.state.textContent = 'Consultando tiendas cercanas…';
  try {
    const result = await api('/api/v1/stores/nearby', {
      method: 'POST',
      body: JSON.stringify({ ...model.currentLocation, radiusMeters: MAX_NEARBY_METERS, limit: 8 }),
    });
    model.nearbyCandidates = result.candidates;
    ui.results.innerHTML = result.candidates.length
      ? result.candidates.map((candidate, index) => `<button class="suggestion-option" type="button" data-nearby-index="${index}" data-nearby-scope="${scope}"><span><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(candidate.address || 'OpenStreetMap')}</small></span></button>`).join('')
      : '<p>No se encontraron tiendas cercanas.</p>';
    ui.attribution.hidden = false;
    ui.state.textContent = result.candidates.length ? 'Elige una candidata para guardarla.' : 'Sin resultados cercanos.';
  } catch (error) {
    ui.state.textContent = `No se pudo consultar OpenStreetMap: ${error.message}`;
  } finally {
    setBusy(ui.nearbyButton, false);
  }
}

async function confirmNearbyStore(index, scope = 'item') {
  const candidate = model.nearbyCandidates[index];
  if (!candidate) return;
  const result = await api('/api/v1/stores', {
    method: 'POST',
    body: JSON.stringify({
      retailerName: candidate.name,
      name: candidate.name,
      ...(candidate.address ? { address: candidate.address } : {}),
      latitudeMicrodegrees: candidate.latitudeMicrodegrees,
      longitudeMicrodegrees: candidate.longitudeMicrodegrees,
      osmType: candidate.osmType,
      osmId: candidate.osmId,
    }),
  });
  await loadStores(model.currentLocation || undefined);
  const ui = locationUi(scope);
  ui.select.value = result.store.id;
  ui.state.textContent = `${result.store.name} guardada y seleccionada.`;
  ui.results.innerHTML = '';
  if (scope === 'item') void refreshDraftEstimate();
  toast('Tienda guardada');
}

function openStoreCreator(statusTarget) {
  window.open(applicationPathForRoute('stores:new'), '_blank', 'noopener,noreferrer');
  statusTarget.textContent = 'Crea la tienda en la nueva pestaña y vuelve aquí para actualizar las tiendas sin perder este formulario.';
}

async function refreshStoreChoices(select, statusTarget) {
  const selectedId = select.value;
  try {
    await loadStores(model.currentLocation || undefined);
    renderStoreOptions();
    if ([...select.options].some(option => option.value === selectedId)) select.value = selectedId;
    statusTarget.textContent = 'Tiendas actualizadas.';
  } catch (error) {
    statusTarget.textContent = error.message;
  }
}

function setMultiSelectMode(enabled) {
  model.multiSelectMode = enabled;
  if (!enabled) model.selectedItemIds.clear();
  renderItems();
}

function toggleSelectedItem(itemId) {
  if (!model.multiSelectMode || !model.items.some(item => item.id === itemId)) return;
  if (model.selectedItemIds.has(itemId)) model.selectedItemIds.delete(itemId);
  else model.selectedItemIds.add(itemId);
  renderItems();
}

function handleSelectionEvent(event) {
  if (!model.multiSelectMode) return false;
  const target = event.target.closest('[data-select-item], [data-select-row]');
  if (!target) return false;
  const itemId = target.dataset.itemId;
  if (itemId) toggleSelectedItem(itemId);
  return true;
}

function selectedItemsForBulk() {
  return model.items
    .filter(item => model.selectedItemIds.has(item.id))
    .map(item => ({ id: item.id, version: item.version }));
}

async function runBulkAction(action, payload, status) {
  if (!model.list) return false;
  const items = selectedItemsForBulk();
  if (items.length === 0) return false;
  try {
    await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/items/bulk`, {
      method: 'POST',
      body: JSON.stringify({ items, action, ...payload }),
    });
    setMultiSelectMode(false);
    await Promise.all([loadActiveList(), loadLists()]);
    if (action === 'completed' && payload.completed === true) revealCompletedRecovery();
    toast(status);
    return true;
  } catch (error) {
    if (error.code === 'SHOPPING_CONFLICT') {
      await resyncAfterSimpleConflict('Alguno de los productos seleccionados cambió en otro dispositivo. Revisa la selección y vuelve a intentarlo.');
      return false;
    }
    $('#item-state').textContent = error.message;
    return false;
  }
}

function openBulkDeleteDialog() {
  const count = model.selectedItemIds.size;
  if (count === 0) return;
  $('#bulk-delete-count').textContent = `${count} producto${count === 1 ? '' : 's'}`;
  $('#bulk-delete-state').textContent = '';
  openDialog($('#bulk-delete-dialog'));
}

async function confirmBulkDelete() {
  const button = $('#confirm-bulk-delete');
  setBusy(button, true);
  try {
    const deleted = await runBulkAction('delete', {}, 'Productos eliminados');
    if (deleted) closeDialog($('#bulk-delete-dialog'));
  } finally {
    setBusy(button, false);
  }
}

async function updateReferenceStore(scope) {
  if (!model.list) return;
  const button = scope === 'all' ? $('#apply-list-store-all') : $('#list-store-select');
  setBusy(button, true);
  try {
    const storeId = $('#list-store-select').value || null;
    await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/store-selection`, {
      method: 'PUT',
      body: JSON.stringify({ storeId, scope, version: model.list.version }),
    });
    await Promise.all([loadActiveList(), loadLists()]);
    toast(scope === 'all' ? 'Tienda aplicada a todos los productos' : 'Tienda de referencia actualizada');
  } catch (error) {
    if (error.code === 'SHOPPING_CONFLICT') await resyncAfterSimpleConflict();
    else $('#item-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function handleTicketControl(event) {
  const select = event.target.closest('[data-item-control]');
  if (!select) return;
  const itemId = select.dataset.itemId;
  if (select.dataset.itemControl === 'unit') {
    await updateItem(itemId, { unit: select.value }, 'Unidad actualizada');
    return;
  }
  if (select.dataset.itemControl === 'store') {
    await updateItem(itemId, { storeOverrideId: select.value || null }, 'Tienda actualizada');
    return;
  }
  if (select.dataset.itemControl === 'variant') {
    const option = select.selectedOptions[0];
    await updateItem(itemId, {
      productVariantId: select.value,
      text: option?.dataset.variantName || model.items.find(item => item.id === itemId)?.text,
    }, 'Tamaño actualizado');
  }
}

function bindListOverviewActions() {
  $('#list-cards').addEventListener('click', event => {
    const action = event.target.closest('[data-list-action]');
    if (!action) return;
    if (action.dataset.listAction === 'create') return openCreateListDialog();
    const listId = action.dataset.listId;
    if (action.dataset.listAction === 'open') void openList(listId);
    if (action.dataset.listAction === 'rename') beginRenameList(listId);
    if (action.dataset.listAction === 'delete') showDeleteListDialog(listId);
  });
}

function bindDialogs() {
  document.addEventListener('click', event => {
    const close = event.target.closest('[data-close-dialog]');
    if (close) closeDialog($(`#${CSS.escape(close.dataset.closeDialog)}`));
  });
  $('#open-create-list').addEventListener('click', openCreateListDialog);
  $('#open-item-dialog').addEventListener('click', openItemCreate);
  $('#scan-list-item').addEventListener('click', () => {
    openItemCreate();
    setItemEntryMode('scan');
  });
  $('#close-item-dialog').addEventListener('click', () => { closeDialog($('#item-dialog')); resetItemForm(); });
  $('#cancel-item-edit').addEventListener('click', () => { closeDialog($('#item-dialog')); resetItemForm(); });
  $('#open-ai-assistant').addEventListener('click', () => {
    $('#list-menu-panel').hidden = true;
    $('#ai-state').textContent = aiConfigured ? '' : 'La IA no está configurada; puedes seguir usando la lista manualmente.';
    $('#ai-proposals').hidden = true;
    openDialog($('#ai-assistant-dialog'), '#ai-text');
  });
}

function bindEvents() {
  bindListOverviewActions();
  bindDialogs();
  $('#back-to-lists').addEventListener('click', async () => {
    writeListRoute();
    setOverviewVisible(true);
    await loadLists();
  });
  $('#list-menu').addEventListener('click', () => {
    const panel = $('#list-menu-panel');
    panel.hidden = !panel.hidden;
    $('#list-menu').setAttribute('aria-expanded', String(!panel.hidden));
  });
  $('#rename-list').addEventListener('click', () => { $('#list-menu-panel').hidden = true; beginRenameList(); });
  $('#delete-list').addEventListener('click', () => { $('#list-menu-panel').hidden = true; showDeleteListDialog(); });
  $('#new-list-form').addEventListener('submit', createList);
  $('#rename-list-form').addEventListener('submit', renameList);
  $('#confirm-delete-list').addEventListener('click', () => void confirmDeleteList());
  $('#cancel-delete-list').addEventListener('click', () => closeDialog($('#delete-list-dialog')));

  $('#item-form').addEventListener('submit', submitItemForm);
  $('#item-form').addEventListener('input', event => {
    persistItemDraft();
    if (event.target.matches('#item-quantity')) scheduleDraftEstimate();
  });
  $('#item-form').addEventListener('change', event => {
    persistItemDraft();
    if (event.target.matches('#item-unit, #store-select')) scheduleDraftEstimate();
  });
  $('#item-text').addEventListener('input', scheduleSuggestions);
  $('#item-quantity-minus').addEventListener('click', () => {
    $('#item-quantity').value = String(Math.max(1, Number($('#item-quantity').value) - 1));
    persistItemDraft();
    scheduleDraftEstimate();
  });
  $('#item-quantity-plus').addEventListener('click', () => {
    $('#item-quantity').value = String(Math.min(100000, Number($('#item-quantity').value) + 1));
    persistItemDraft();
    scheduleDraftEstimate();
  });
  $('#item-size').addEventListener('change', event => {
    const option = event.target.selectedOptions[0];
    if (!event.target.value) return;
    $('#item-text').value = option?.dataset.variantName || $('#item-text').value;
    setLinkedProduct(event.target.value, option?.dataset.variantName || $('#item-text').value);
  });
  $('#suggestions').addEventListener('click', event => {
    const product = event.target.closest('[data-product-id]');
    if (product) {
      $('#item-text').value = product.dataset.productName;
      setLinkedProduct(product.dataset.productId, product.dataset.productName);
      $('#suggestions').innerHTML = '';
      persistItemDraft();
      return;
    }
    if (event.target.closest('[data-create-global-product]')) void openGlobalProductEditor(true);
  });
  $('#edit-global-product').addEventListener('click', () => void openGlobalProductEditor(false));
  $('#item-mode-create').addEventListener('click', () => setItemEntryMode('create'));
  $('#item-mode-scan').addEventListener('click', () => setItemEntryMode('scan'));
  $('#scan-product-photo').addEventListener('click', () => $('#product-camera').click());
  $('#scan-ticket').addEventListener('click', () => {
    persistItemDraft();
    closeDialog($('#item-dialog'));
    document.dispatchEvent(new CustomEvent('basketra:navigate', { detail: { route: 'scan' } }));
  });
  $('#open-product-photo').addEventListener('click', () => $('#product-camera').click());

  $('#global-product-form').addEventListener('submit', submitGlobalProduct);
  $('#global-product-form').addEventListener('input', event => {
    if (event.target.matches('#global-price, #global-package-minor')) scheduleGlobalNormalizedPrice();
  });
  $('#global-product-form').addEventListener('change', event => {
    if (event.target.matches('#global-package-unit')) scheduleGlobalNormalizedPrice();
  });
  $('#global-parent-search').addEventListener('input', scheduleParentSuggestions);
  $('#global-parent-suggestions').addEventListener('click', event => {
    const button = event.target.closest('[data-parent-id]');
    if (!button) return;
    setGlobalParent({
      id: button.dataset.parentId,
      name: button.dataset.parentName,
      variantCount: Number(button.dataset.parentVariants || 0),
    });
  });
  $('#global-parent-create').addEventListener('click', () => {
    clearGlobalParent({ keepName: true });
    $('#global-canonical-name').value = $('#global-parent-search').value.trim();
    $('#global-canonical-field').hidden = false;
    $('#global-canonical-name').focus();
  });
  $('#global-parent-clear').addEventListener('click', () => clearGlobalParent({ keepName: true }));
  $('#global-mode-manual').addEventListener('click', () => setGlobalEntryMode('manual'));
  $('#global-mode-scan').addEventListener('click', () => {
    setGlobalEntryMode('scan');
    $('#global-product-camera').click();
  });
  $('#global-item-quantity-minus').addEventListener('click', () => {
    $('#global-item-quantity').value = String(Math.max(1, Number($('#global-item-quantity').value) - 1));
  });
  $('#global-item-quantity-plus').addEventListener('click', () => {
    $('#global-item-quantity').value = String(Math.min(100000, Number($('#global-item-quantity').value) + 1));
  });

  for (const selector of ['#product-camera', '#product-gallery']) {
    $(selector).addEventListener('change', event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void handleProductPhoto(file, 'item');
    });
  }
  for (const selector of ['#global-product-camera', '#global-product-gallery']) {
    $(selector).addEventListener('change', event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void handleProductPhoto(file, 'global');
    });
  }
  for (const selector of ['#ai-product-camera', '#ai-product-gallery']) {
    $(selector).addEventListener('change', event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void handleProductPhoto(file, 'ai');
    });
  }

  $('#list-store-select').addEventListener('change', () => void updateReferenceStore('default'));
  $('#apply-list-store-all').addEventListener('click', () => void updateReferenceStore('all'));
  $('#toggle-multi-select').addEventListener('click', () => setMultiSelectMode(!model.multiSelectMode));
  $('#bulk-select-all').addEventListener('click', () => {
    if (model.selectedItemIds.size === model.items.length) model.selectedItemIds.clear();
    else model.items.forEach(item => model.selectedItemIds.add(item.id));
    renderItems();
  });
  $('#bulk-mark-completed').addEventListener('click', () => void runBulkAction('completed', { completed: true }, 'Productos marcados como comprados'));
  $('#bulk-mark-pending').addEventListener('click', () => void runBulkAction('completed', { completed: false }, 'Productos devueltos a pendientes'));
  $('#bulk-apply-store').addEventListener('click', () => void runBulkAction('store', { storeOverrideId: $('#bulk-store-select').value || null }, 'Tienda actualizada en la selección'));
  $('#bulk-delete-items').addEventListener('click', openBulkDeleteDialog);
  $('#confirm-bulk-delete').addEventListener('click', () => void confirmBulkDelete());
  $('#cancel-bulk-delete').addEventListener('click', () => closeDialog($('#bulk-delete-dialog')));
  $('#pending-items').addEventListener('click', event => {
    if (handleSelectionEvent(event)) return;
    void handleItemAction(event);
  });
  $('#pending-items').addEventListener('change', event => void handleTicketControl(event));
  $('#completed-items').addEventListener('click', event => {
    if (handleSelectionEvent(event)) return;
    void handleItemAction(event);
  });
  $('#confirm-delete-item').addEventListener('click', () => void confirmDeleteItem());
  $('#cancel-delete-item').addEventListener('click', () => {
    model.deletingItemId = '';
    closeDialog($('#delete-item-dialog'));
  });
  $('#use-latest-conflict').addEventListener('click', () => void useLatestConflict());
  $('#use-my-conflict').addEventListener('click', () => void useMyConflict());
  $('#analyze-ai').addEventListener('click', () => void analyzeWithAi());
  $('#ai-proposals').addEventListener('submit', confirmAiProposal);

  $('#use-current-location').addEventListener('click', () => requestGeolocation('item'));
  $('#find-nearby-stores').addEventListener('click', () => void findNearbyStores('item'));
  $('#nearby-stores').addEventListener('click', event => {
    const button = event.target.closest('[data-nearby-index]');
    if (button) void confirmNearbyStore(Number(button.dataset.nearbyIndex), 'item');
  });
  $('#global-use-current-location').addEventListener('click', () => requestGeolocation('global'));
  $('#global-find-nearby-stores').addEventListener('click', () => void findNearbyStores('global'));
  $('#global-nearby-stores').addEventListener('click', event => {
    const button = event.target.closest('[data-nearby-index]');
    if (button) void confirmNearbyStore(Number(button.dataset.nearbyIndex), 'global');
  });
  $('#create-store-from-item').addEventListener('click', () => {
    persistItemDraft();
    openStoreCreator($('#location-state'));
  });
  $('#refresh-item-stores').addEventListener('click', () => {
    void refreshStoreChoices($('#store-select'), $('#location-state'));
  });
  $('#global-create-store').addEventListener('click', () => {
    openStoreCreator($('#global-product-state'));
  });
  $('#global-refresh-stores').addEventListener('click', () => {
    void refreshStoreChoices($('#global-store-select'), $('#global-product-state'));
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopRealtime();
    else if (model.list && !$('#list-detail').hidden) {
      connectRealtime();
      scheduleRealtimeResync({ listId: model.list.id });
    }
  });
  document.addEventListener('basketra:swipe-action', event => {
    if (event.detail?.kind !== 'shopping-item' || event.detail?.action !== 'delete') return;
    void deleteItemFromSwipe(String(event.detail.id || ''));
  });
  document.addEventListener('basketra:view-changed', event => {
    if (event.detail?.view !== 'lists') {
      stopRealtime();
      return;
    }
    if (aiConfigured) void refreshImageLimitHelp();
    const listId = listIdFromRoute(event.detail?.route);
    if (!listId) {
      setOverviewVisible(true);
      return;
    }
    if (model.list?.id === listId && !$('#list-detail').hidden) return;
    void openList(listId, { syncUrl: false });
  });
}

export async function initLists(options) {
  metadata = options.metadata;
  toast = options.toast;
  aiConfigured = options.aiConfigured === true;
  populateUnits();
  ensureProgressiveFields();
  restoreItemDraft();
  bindEvents();
  const current = readApplicationLocation();
  const requestedListId = current.route === 'lists' ? '' : listIdFromRoute(current.route);
  if (requestedListId) {
    model.activeListId = requestedListId;
    saveActiveListId(requestedListId);
    setOverviewVisible(false);
  } else {
    setOverviewVisible(true);
  }
  if (aiConfigured) void refreshImageLimitHelp();
  await Promise.all([loadLists(), loadCategories(), loadStores()]);
  if (!requestedListId) return;
  if (model.lists.some(list => list.id === requestedListId)) {
    await openList(requestedListId, { syncUrl: false });
    return;
  }
  writeListRoute('', { replace: true });
  setOverviewVisible(true);
}
