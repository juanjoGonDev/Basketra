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
  categories: [],
  stores: [],
  editingItemId: '',
  deletingItemId: '',
  swipeDeletingItemIds: new Set(),
  selectedProductVariantId: '',
  selectedProductName: '',
  globalProductEditingId: '',
  suggestionController: null,
  suggestionTimer: null,
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

function populateUnits() {
  const select = $('#item-unit');
  select.innerHTML = metadata.units
    .map(unit => `<option value="${escapeHtml(unit)}">${escapeHtml(UNIT_LABELS[unit] || unit)}</option>`)
    .join('');
  select.value = metadata.units.includes('unit') ? 'unit' : metadata.units[0] || '';
}

function ensureProgressiveFields() {
  const advancedBody = $('#item-advanced .details-body');
  if (!$('#open-manual-product-details')) {
    advancedBody.querySelector('#product-proposal').insertAdjacentHTML('beforebegin', `
      <button id="open-manual-product-details" class="button secondary full" type="button">Añadir ficha global o precio manual</button>
    `);
  }
  if (!$('#global-category-new')) {
    $('#global-category').closest('.field').insertAdjacentHTML('afterend', `
      <label class="field"><span>Nueva categoría opcional</span><input id="global-category-new" maxlength="120" placeholder="Ej. Lácteos"></label>
      <div class="quantity-row">
        <label class="field"><span>Cantidad del envase</span><input id="global-package-minor" type="number" min="1" max="100000000" inputmode="numeric" placeholder="1"></label>
        <label class="field"><span>Unidad del envase</span><select id="global-package-unit"><option value="">Sin especificar</option>${metadata.units.map(unit => `<option value="${escapeHtml(unit)}">${escapeHtml(UNIT_LABELS[unit] || unit)}</option>`).join('')}</select></label>
      </div>
    `);
  }
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

function renderItemGroups(container, items, emptyMessage) {
  if (items.length === 0) {
    container.innerHTML = `<ul class="item-list">${emptyListState(emptyMessage)}</ul>`;
    return;
  }
  const overallIndexes = new Map(items.map((item, index) => [item.id, index]));
  container.innerHTML = [...groupItems(items)].map(([category, group]) => `
    <section class="category-group" aria-label="${escapeHtml(category)}">
      <h3>${escapeHtml(category)}</h3>
      <ul class="item-list">${group.map(item => shoppingListItem(item, overallIndexes.get(item.id), items.length)).join('')}</ul>
    </section>
  `).join('');
}

function renderItems() {
  const pending = model.items.filter(item => !item.completed);
  const completed = model.items.filter(item => item.completed);
  renderItemGroups($('#pending-items'), pending, 'Añade el primer producto para empezar.');
  renderItemGroups($('#completed-items'), completed, 'Los productos comprados aparecerán aquí.');
  $('#pending-count').textContent = String(pending.length);
  $('#completed-count').textContent = String(completed.length);
  $('#completed-section').hidden = completed.length === 0;
}

function renderDetail() {
  if (!model.list) return;
  $('#active-list-title').textContent = model.list.name;
  renderItems();
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
  const result = await api(`/api/v1/shopping-lists/${encodeURIComponent(model.activeListId)}`);
  model.list = result.list;
  model.items = result.items;
  const index = model.lists.findIndex(list => list.id === result.list.id);
  if (index >= 0) model.lists[index] = { ...model.lists[index], ...result.list };
  renderDetail();
}

async function openList(listId) {
  model.activeListId = listId;
  saveActiveListId(listId);
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
      if (shouldReloadDetail) tasks.push(loadActiveList());
      if (event?.entityType === 'category') tasks.push(loadCategories());
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
  const options = model.categories.map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');
  for (const selector of ['#proposal-category', '#global-category']) {
    const select = $(selector);
    const current = select.value;
    select.innerHTML = `<option value="">Sin categoría</option>${options}`;
    if ([...select.options].some(option => option.value === current)) select.value = current;
  }
  if (model.proposedCategoryName) ensureProposedCategoryOption();
}

function ensureProposedCategoryOption() {
  const select = $('#proposal-category');
  const existing = model.categories.find(category => category.name.localeCompare(model.proposedCategoryName, 'es', { sensitivity: 'base' }) === 0);
  if (existing) {
    select.value = existing.id;
    return;
  }
  const option = document.createElement('option');
  option.value = '__proposal__';
  option.textContent = `${model.proposedCategoryName} (nueva al confirmar)`;
  select.append(option);
  select.value = '__proposal__';
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

function renderStoreOptions(selectedId = $('#store-select').value) {
  const select = $('#store-select');
  select.innerHTML = `<option value="">Sin tienda física</option>${model.stores.map(store => {
    const distance = Number.isFinite(store.distanceMeters) ? ` · ${Math.round(store.distanceMeters)} m` : '';
    return `<option value="${escapeHtml(store.id)}" data-retailer="${escapeHtml(store.retailerName)}">${escapeHtml(store.name)} · ${escapeHtml(store.retailerName)}${distance}</option>`;
  }).join('')}`;
  if ([...select.options].some(option => option.value === selectedId)) select.value = selectedId;
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
  $('#product-proposal').hidden = true;
  $('#proposal-canonical-name').value = '';
  $('#proposal-variant-name').value = '';
  $('#proposal-brand').value = '';
  $('#proposal-ean').value = '';
  $('#proposal-description').value = '';
  $('#proposal-price').value = '';
  $('#proposal-retailer').value = '';
  $('#proposal-warnings').innerHTML = '';
  $('#product-confidence').textContent = '';
  $('#product-photo-state').textContent = '';
  populateCategorySelects();
}

function clearLinkedProduct() {
  model.selectedProductVariantId = '';
  model.selectedProductName = '';
  $('#linked-product').hidden = true;
  $('#linked-product-name').textContent = '';
}

function setLinkedProduct(id, name) {
  model.selectedProductVariantId = id;
  model.selectedProductName = name;
  $('#linked-product-name').textContent = name;
  $('#linked-product').hidden = false;
}

function resetItemForm() {
  model.editingItemId = '';
  clearLinkedProduct();
  resetProductProposal();
  $('#item-form-title').textContent = 'Añadir producto';
  $('#item-submit-label').textContent = 'Añadir';
  $('#item-dialog-state').textContent = '';
  $('#suggestions').innerHTML = '';
  $('#item-advanced').open = false;
  restoreItemDraft();
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
  $('#item-form-title').textContent = 'Editar producto de esta lista';
  $('#item-submit-label').textContent = 'Guardar cambios';
  $('#item-text').value = item.text;
  $('#item-quantity').value = String(item.quantityMinor);
  $('#item-unit').value = item.unit;
  $('#exact-required').checked = item.exactRequired;
  $('#substitution-allowed').checked = item.substitutionAllowed;
  if (item.productVariantId) {
    try {
      const result = await api(`/api/v1/products/${encodeURIComponent(item.productVariantId)}`);
      setLinkedProduct(item.productVariantId, result.product.variantName);
    } catch {
      clearLinkedProduct();
    }
  } else {
    clearLinkedProduct();
  }
  openDialog($('#item-dialog'), '#item-text');
}

function showManualProductDetails() {
  $('#product-proposal').hidden = false;
  if (!$('#proposal-canonical-name').value.trim()) $('#proposal-canonical-name').value = $('#item-text').value.trim();
  if (!$('#proposal-variant-name').value.trim()) $('#proposal-variant-name').value = $('#item-text').value.trim();
  $('#proposal-canonical-name').focus();
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
      const result = await api(`/api/v1/products/suggestions?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      if (controller.signal.aborted || $('#item-text').value.trim() !== query) return;
      const options = result.suggestions.map(suggestion => `
        <button type="button" class="suggestion-option" role="option" data-product-id="${escapeHtml(suggestion.id)}" data-product-name="${escapeHtml(suggestion.name)}">
          <span>${escapeHtml(suggestion.name)}</span><small>${escapeHtml(suggestion.categoryName || suggestion.canonicalName)}</small>
        </button>
      `).join('');
      $('#suggestions').innerHTML = `${options}<button type="button" class="suggestion-option suggestion-option--create" data-create-global-product="true"><span>Crear ficha global de “${escapeHtml(query)}”</span><small>Opcional: categoría, marca, EAN y formato</small></button>`;
    } catch (error) {
      if (error.name !== 'AbortError') $('#suggestions').innerHTML = '';
    }
  }, 180);
}

async function openGlobalProductEditor(createNew = false) {
  model.globalProductEditingId = createNew ? '' : model.selectedProductVariantId;
  $('#global-product-state').textContent = '';
  $('#global-category-new').value = '';
  if (model.globalProductEditingId) {
    const result = await api(`/api/v1/products/${encodeURIComponent(model.globalProductEditingId)}`);
    const product = result.product;
    $('#global-canonical-name').value = product.canonicalName;
    $('#global-variant-name').value = product.variantName;
    $('#global-brand').value = product.brand || '';
    $('#global-ean').value = product.ean || '';
    $('#global-category').value = product.categoryId || '';
    $('#global-description').value = product.description || '';
    $('#global-aliases').value = (product.aliases || []).join('\n');
    $('#global-package-minor').value = product.packageMinor || '';
    $('#global-package-unit').value = product.packageUnit || '';
  } else {
    const name = $('#item-text').value.trim();
    $('#global-canonical-name').value = name;
    $('#global-variant-name').value = name;
    $('#global-brand').value = '';
    $('#global-ean').value = '';
    $('#global-category').value = '';
    $('#global-description').value = '';
    $('#global-aliases').value = '';
    $('#global-package-minor').value = '';
    $('#global-package-unit').value = '';
  }
  openDialog($('#global-product-dialog'), '#global-canonical-name');
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

async function submitGlobalProduct(event) {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true);
  $('#global-product-state').textContent = 'Guardando ficha global…';
  try {
    const categoryId = await resolveManualCategory();
    const packageMinorRaw = $('#global-package-minor').value.trim();
    const packageUnit = $('#global-package-unit').value;
    const payload = {
      canonicalName: $('#global-canonical-name').value.trim(),
      variantName: $('#global-variant-name').value.trim(),
      ...(categoryId ? { categoryId } : { categoryId: null }),
      description: $('#global-description').value.trim() || null,
      brand: $('#global-brand').value.trim() || null,
      ean: $('#global-ean').value.trim() || null,
      packageMinor: packageMinorRaw ? Number(packageMinorRaw) : null,
      packageUnit: packageUnit || null,
      aliases: $('#global-aliases').value.split('\n').map(value => value.trim()).filter(Boolean),
    };
    let result;
    if (model.globalProductEditingId) {
      result = await api(`/api/v1/products/${encodeURIComponent(model.globalProductEditingId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      const createPayload = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== null));
      result = await api('/api/v1/products', { method: 'POST', body: JSON.stringify(createPayload) });
    }
    setLinkedProduct(result.product.id, result.product.variantName);
    if (!model.editingItemId) $('#item-text').value = result.product.variantName;
    closeDialog($('#global-product-dialog'));
    $('#global-product-state').textContent = '';
    toast('Ficha global guardada');
    await loadCategories();
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

async function uploadProductImage(file) {
  if (!file || !['image/jpeg', 'image/png'].includes(file.type)) throw new Error('Usa una imagen JPEG o PNG');
  if (file.size > metadata.files.maxBytes) throw new Error('La imagen supera el límite configurado');
  const base64 = await readFileBase64(file);
  const result = await api('/api/v1/files', {
    method: 'POST',
    body: JSON.stringify({ base64, mimeType: file.type, originalName: file.name || 'product-photo' }),
  });
  return result.file.storageKey;
}

function applyPhotoProposal(proposal, storageKey) {
  model.photoStorageKey = storageKey;
  model.photoProposal = proposal;
  model.proposedCategoryName = proposal.category || '';
  $('#product-proposal').hidden = false;
  $('#proposal-canonical-name').value = proposal.canonicalName || $('#item-text').value.trim();
  $('#proposal-variant-name').value = proposal.variantName || proposal.canonicalName || $('#item-text').value.trim();
  $('#proposal-brand').value = proposal.brand || '';
  $('#proposal-ean').value = proposal.ean || '';
  $('#proposal-description').value = proposal.description || '';
  $('#proposal-price').value = Number.isSafeInteger(proposal.priceMinor) ? minorToEuroInput(proposal.priceMinor) : '';
  $('#proposal-retailer').value = proposal.retailerName || '';
  $('#product-confidence').textContent = `${Math.round(Number(proposal.confidence || 0) * 100)}%`;
  $('#product-confidence').className = `status-pill ${Number(proposal.confidence || 0) >= .8 ? 'success' : 'warning'}`;
  $('#proposal-warnings').innerHTML = (proposal.warnings || []).map(warning => `<p>${escapeHtml(warning)}</p>`).join('');
  populateCategorySelects();
  if (proposal.storeName) $('#location-state').textContent = `La foto sugiere “${proposal.storeName}”. Confirma una tienda guardada o búscala manualmente.`;
}

async function handleProductPhoto(file, source = 'item') {
  const state = source === 'ai' ? $('#ai-state') : $('#product-photo-state');
  state.textContent = 'Preparando imagen…';
  try {
    const storageKey = await uploadProductImage(file);
    state.textContent = aiConfigured ? 'Analizando imagen…' : 'Imagen guardada. La IA no está configurada; puedes completar los datos manualmente.';
    if (!aiConfigured) {
      model.photoStorageKey = storageKey;
      if (source === 'ai') {
        closeDialog($('#ai-assistant-dialog'));
        openItemCreate();
      }
      showManualProductDetails();
      return;
    }
    const result = await api('/api/v1/products/photo-proposal', {
      method: 'POST',
      body: JSON.stringify({ storageKey, contextText: $('#item-text').value.trim() || $('#ai-text').value.trim() }),
    });
    if (source === 'ai') {
      closeDialog($('#ai-assistant-dialog'));
      openItemCreate();
    }
    applyPhotoProposal(result.proposal, storageKey);
    state.textContent = 'Propuesta lista. Revísala antes de guardar.';
  } catch (error) {
    state.textContent = `No se pudo preparar la propuesta: ${error.message}. Puedes continuar manualmente.`;
  }
}

async function ensureProposalCategory() {
  const value = $('#proposal-category').value;
  if (value === '__proposal__' && model.proposedCategoryName) {
    const result = await api('/api/v1/categories', { method: 'POST', body: JSON.stringify({ name: model.proposedCategoryName }) });
    await loadCategories();
    return result.category.id;
  }
  return value || undefined;
}

async function ensureProductForItem() {
  if (model.selectedProductVariantId) return model.selectedProductVariantId;
  if ($('#product-proposal').hidden) return undefined;
  const canonicalName = $('#proposal-canonical-name').value.trim();
  if (!canonicalName) return undefined;
  const variantName = $('#proposal-variant-name').value.trim() || canonicalName;
  const categoryId = await ensureProposalCategory();
  const payload = {
    canonicalName,
    variantName,
    ...(categoryId ? { categoryId } : {}),
    ...($('#proposal-description').value.trim() ? { description: $('#proposal-description').value.trim() } : {}),
    ...($('#proposal-brand').value.trim() ? { brand: $('#proposal-brand').value.trim() } : {}),
    ...($('#proposal-ean').value.trim() ? { ean: $('#proposal-ean').value.trim() } : {}),
    ...(Number.isSafeInteger(model.photoProposal?.packageAmountMinor) ? { packageMinor: model.photoProposal.packageAmountMinor } : {}),
    ...(model.photoProposal?.packageUnit ? { packageUnit: model.photoProposal.packageUnit } : {}),
  };
  const result = await api('/api/v1/products', { method: 'POST', body: JSON.stringify(payload) });
  setLinkedProduct(result.product.id, result.product.variantName);
  return result.product.id;
}

async function persistConfirmedPrice(productVariantId) {
  const priceText = $('#proposal-price').value.trim();
  if (!priceText) return { persisted: false, reason: 'none' };
  const retailerName = $('#proposal-retailer').value.trim();
  if (!retailerName) return { persisted: false, reason: 'retailer-required' };
  if (!productVariantId) return { persisted: false, reason: 'product-required' };
  const storeId = $('#store-select').value || undefined;
  const payload = {
    priceMinor: euroInputToMinor(priceText),
    retailerName,
    ...(storeId ? { storeId } : {}),
    evidenceType: model.photoStorageKey ? 'product-photo' : 'manual',
    ...(model.photoStorageKey ? { storageKey: model.photoStorageKey } : {}),
    ...(Number.isSafeInteger(model.photoProposal?.packageAmountMinor) ? { packageNumerator: model.photoProposal.packageAmountMinor } : {}),
    ...(model.photoProposal?.packageUnit ? { packageUnit: model.photoProposal.packageUnit } : {}),
    confidence: model.photoProposal?.confidence ?? 1,
  };
  await api(`/api/v1/products/${encodeURIComponent(productVariantId)}/prices`, { method: 'POST', body: JSON.stringify(payload) });
  return { persisted: true };
}

function explicitEditPayload() {
  return {
    text: $('#item-text').value.trim(),
    quantityMinor: Number($('#item-quantity').value),
    unit: $('#item-unit').value,
    exactRequired: $('#exact-required').checked,
    substitutionAllowed: $('#substitution-allowed').checked,
    ...(model.selectedProductVariantId ? { productVariantId: model.selectedProductVariantId } : { productVariantId: null }),
  };
}

async function submitItemForm(event) {
  event.preventDefault();
  if (!model.list) return;
  const button = $('#add-item');
  setBusy(button, true);
  $('#item-dialog-state').textContent = model.editingItemId ? 'Guardando cambios…' : 'Añadiendo…';
  try {
    const productVariantId = await ensureProductForItem();
    if (productVariantId) setLinkedProduct(productVariantId, model.selectedProductName || $('#proposal-variant-name').value.trim() || $('#item-text').value.trim());
    const payload = explicitEditPayload();
    let item;
    if (model.editingItemId) {
      const current = model.items.find(candidate => candidate.id === model.editingItemId);
      if (!current) throw new Error('El producto ya no está en la lista');
      try {
        const result = await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/items/${encodeURIComponent(current.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...payload, version: current.version }),
        });
        item = result.item;
      } catch (error) {
        if (error.code === 'SHOPPING_CONFLICT' && error.details?.kind === 'item') {
          showConflict(payload, error.details.current);
          return;
        }
        throw error;
      }
    } else {
      const result = await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/items`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      item = result.item;
    }

    const price = await persistConfirmedPrice(item.productVariantId || productVariantId);
    if (!model.editingItemId) clearItemDraft();
    closeDialog($('#item-dialog'));
    resetItemForm();
    await Promise.all([loadActiveList(), loadLists()]);
    if (price.reason === 'retailer-required') {
      toast('Producto guardado. El precio no se añadió al historial porque falta el comercio.');
    } else if (price.reason === 'product-required') {
      toast('Producto guardado. Crea una ficha global para registrar historial de precio.');
    } else {
      toast(model.editingItemId ? 'Producto actualizado' : 'Producto añadido');
    }
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
    const result = await api(`/api/v1/shopping-lists/${encodeURIComponent(model.list.id)}/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...payload, version: item.version }),
    });
    const index = model.items.findIndex(candidate => candidate.id === itemId);
    if (index >= 0) model.items[index] = result.item;
    if (Number.isSafeInteger(result.listVersion)) model.list.version = result.listVersion;
    renderItems();
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

async function handleItemAction(event) {
  const button = event.target.closest('[data-item-action]');
  if (!button) return;
  const itemId = button.dataset.itemId;
  try {
    if (button.dataset.itemAction === 'edit') await beginItemEdit(itemId);
    if (button.dataset.itemAction === 'delete') showDeleteItemDialog(itemId);
    if (button.dataset.itemAction === 'complete') {
      const item = model.items.find(candidate => candidate.id === itemId);
      if (item) await updateItem(itemId, { completed: !item.completed }, item.completed ? 'Producto devuelto a pendientes' : 'Producto completado');
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

function requestGeolocation() {
  if (!window.isSecureContext) {
    $('#location-state').textContent = 'Tu navegador exige HTTPS para compartir ubicación. Puedes elegir tienda manualmente; un proxy privado con HTTPS habilita esta opción.';
    return;
  }
  if (!navigator.geolocation) {
    $('#location-state').textContent = 'Este navegador no ofrece geolocalización. Elige una tienda manualmente.';
    return;
  }
  const button = $('#use-current-location');
  setBusy(button, true);
  $('#location-state').textContent = 'Buscando tiendas guardadas cerca…';
  navigator.geolocation.getCurrentPosition(async position => {
    try {
      model.currentLocation = {
        latitudeMicrodegrees: Math.round(position.coords.latitude * 1_000_000),
        longitudeMicrodegrees: Math.round(position.coords.longitude * 1_000_000),
      };
      const stores = await loadStores(model.currentLocation);
      if (stores.length > 0) {
        $('#location-state').textContent = `Encontradas ${stores.length} tiendas guardadas cerca. Revisa la selección.`;
        $('#find-nearby-stores').hidden = true;
      } else {
        $('#location-state').textContent = 'No hay tiendas guardadas cerca. Puedes buscar candidatas en OpenStreetMap de forma explícita.';
        $('#find-nearby-stores').hidden = false;
      }
    } catch (error) {
      $('#location-state').textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }, error => {
    setBusy(button, false);
    $('#location-state').textContent = error.code === error.PERMISSION_DENIED
      ? 'No has dado permiso de ubicación. Puedes elegir tienda manualmente.'
      : 'No se pudo obtener la ubicación. Puedes elegir tienda manualmente.';
  }, { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 });
}

async function findNearbyStores() {
  if (!model.currentLocation) return;
  const button = $('#find-nearby-stores');
  setBusy(button, true);
  $('#location-state').textContent = 'Consultando tiendas cercanas…';
  try {
    const result = await api('/api/v1/stores/nearby', {
      method: 'POST',
      body: JSON.stringify({ ...model.currentLocation, radiusMeters: MAX_NEARBY_METERS, limit: 8 }),
    });
    model.nearbyCandidates = result.candidates;
    $('#nearby-stores').innerHTML = result.candidates.length
      ? result.candidates.map((candidate, index) => `<button class="suggestion-option" type="button" data-nearby-index="${index}"><span>${escapeHtml(candidate.name)}</span><small>${escapeHtml(candidate.address || 'OpenStreetMap')} · Usar esta tienda</small></button>`).join('')
      : '<p>No se encontraron tiendas cercanas.</p>';
    $('#osm-attribution').hidden = false;
    $('#location-state').textContent = result.candidates.length ? 'Elige una candidata para guardarla.' : 'Sin resultados cercanos.';
  } catch (error) {
    $('#location-state').textContent = `No se pudo consultar OpenStreetMap: ${error.message}`;
  } finally {
    setBusy(button, false);
  }
}

async function confirmNearbyStore(index) {
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
  $('#store-select').value = result.store.id;
  $('#proposal-retailer').value = result.store.retailerName;
  $('#location-state').textContent = `${result.store.name} guardada y seleccionada.`;
  $('#nearby-stores').innerHTML = '';
  toast('Tienda guardada');
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
  $('#close-item-dialog').addEventListener('click', () => { closeDialog($('#item-dialog')); resetItemForm(); });
  $('#cancel-item-edit').addEventListener('click', () => { closeDialog($('#item-dialog')); resetItemForm(); });
  $('#open-ai-assistant').addEventListener('click', () => {
    $('#ai-state').textContent = aiConfigured ? '' : 'La IA no está configurada; puedes seguir usando la lista manualmente.';
    $('#ai-proposals').hidden = true;
    openDialog($('#ai-assistant-dialog'), '#ai-text');
  });
}

function bindEvents() {
  bindListOverviewActions();
  bindDialogs();
  $('#back-to-lists').addEventListener('click', async () => {
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
  $('#item-form').addEventListener('input', persistItemDraft);
  $('#item-form').addEventListener('change', persistItemDraft);
  $('#item-text').addEventListener('input', scheduleSuggestions);
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
  $('#global-product-form').addEventListener('submit', submitGlobalProduct);
  $('#open-manual-product-details').addEventListener('click', showManualProductDetails);
  for (const selector of ['#product-camera', '#product-gallery']) {
    $(selector).addEventListener('change', event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void handleProductPhoto(file, 'item');
    });
  }
  for (const selector of ['#ai-product-camera', '#ai-product-gallery']) {
    $(selector).addEventListener('change', event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void handleProductPhoto(file, 'ai');
    });
  }
  $('#pending-items').addEventListener('click', event => void handleItemAction(event));
  $('#completed-items').addEventListener('click', event => void handleItemAction(event));
  $('#confirm-delete-item').addEventListener('click', () => void confirmDeleteItem());
  $('#cancel-delete-item').addEventListener('click', () => {
    model.deletingItemId = '';
    closeDialog($('#delete-item-dialog'));
  });
  $('#use-latest-conflict').addEventListener('click', () => void useLatestConflict());
  $('#use-my-conflict').addEventListener('click', () => void useMyConflict());
  $('#analyze-ai').addEventListener('click', () => void analyzeWithAi());
  $('#ai-proposals').addEventListener('submit', confirmAiProposal);
  $('#use-current-location').addEventListener('click', requestGeolocation);
  $('#find-nearby-stores').addEventListener('click', () => void findNearbyStores());
  $('#nearby-stores').addEventListener('click', event => {
    const button = event.target.closest('[data-nearby-index]');
    if (button) void confirmNearbyStore(Number(button.dataset.nearbyIndex));
  });
  $('#store-select').addEventListener('change', event => {
    const option = event.target.selectedOptions[0];
    if (option?.dataset.retailer) $('#proposal-retailer').value = option.dataset.retailer;
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
}

export async function initLists(options) {
  metadata = options.metadata;
  toast = options.toast;
  aiConfigured = options.aiConfigured === true;
  populateUnits();
  ensureProgressiveFields();
  restoreItemDraft();
  bindEvents();
  setOverviewVisible(true);
  await Promise.all([loadLists(), loadCategories(), loadStores()]);
}
