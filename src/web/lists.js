import { api, setBusy } from './api.js';
import {
  clearItemDraft,
  loadActiveListId,
  loadItemDraft,
  saveActiveListId,
  saveItemDraft,
} from './state.js';
import { emptyListState, escapeHtml, shoppingListItem, suggestionOption } from './ui.js';

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

const model = {
  lists: [],
  activeListId: loadActiveListId(),
  items: [],
  editingItemId: '',
  deletingItemId: '',
  swipeDeletingItemIds: new Set(),
  suggestionController: null,
};

let metadata;
let toast = () => {};

const $ = selector => document.querySelector(selector);

function activeList() {
  return model.lists.find(list => list.id === model.activeListId);
}

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function populateUnits() {
  const select = $('#item-unit');
  select.innerHTML = metadata.units
    .map(unit => `<option value="${escapeHtml(unit)}">${escapeHtml(UNIT_LABELS[unit] || unit)}</option>`)
    .join('');
  select.value = metadata.units.includes('unit') ? 'unit' : metadata.units[0] || '';
}

function setItemFormEnabled(enabled) {
  $('#item-form').classList.toggle('is-disabled', !enabled);
  $('#item-form').querySelectorAll('input, select, button').forEach(control => {
    control.disabled = !enabled;
  });
}

function renderLists() {
  const select = $('#list-select');
  select.innerHTML = model.lists.length
    ? model.lists.map(list => `<option value="${escapeHtml(list.id)}"${list.id === model.activeListId ? ' selected' : ''}>${escapeHtml(list.name)}</option>`).join('')
    : '<option value="">Todavía no hay listas</option>';
  select.disabled = model.lists.length === 0;
  $('#rename-list').disabled = !model.activeListId;
  $('#delete-list').disabled = !model.activeListId;
  setItemFormEnabled(Boolean(model.activeListId));
}

function renderItems() {
  const pending = model.items.filter(item => !item.completed);
  const completed = model.items.filter(item => item.completed);
  $('#pending-items').innerHTML = pending.length
    ? pending.map((item, index) => shoppingListItem(item, index, pending.length)).join('')
    : emptyListState(model.activeListId ? 'Añade el primer producto para empezar.' : 'Crea una lista para empezar.');
  $('#completed-items').innerHTML = completed.length
    ? completed.map((item, index) => shoppingListItem(item, index, completed.length)).join('')
    : emptyListState('Los productos marcados como comprados aparecerán aquí.');
  $('#pending-count').textContent = String(pending.length);
  $('#completed-count').textContent = String(completed.length);
  $('#completed-section').hidden = completed.length === 0;
}

async function loadActiveList() {
  if (!model.activeListId) {
    model.items = [];
    renderItems();
    return;
  }
  const result = await api(`/api/v1/shopping-lists/${encodeURIComponent(model.activeListId)}`);
  model.items = result.items;
  const index = model.lists.findIndex(list => list.id === result.list.id);
  if (index >= 0) model.lists[index] = result.list;
  renderLists();
  renderItems();
}

export async function loadLists() {
  const result = await api('/api/v1/shopping-lists');
  model.lists = result.lists;
  if (!model.lists.some(list => list.id === model.activeListId)) {
    model.activeListId = model.lists[0]?.id || '';
  }
  saveActiveListId(model.activeListId);
  renderLists();
  await loadActiveList();
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

function cancelItemEdit() {
  model.editingItemId = '';
  $('#item-form-title').textContent = '¿Qué necesitas?';
  $('#item-submit-label').textContent = 'Añadir a la lista';
  $('#cancel-item-edit').hidden = true;
  $('#item-state').textContent = '';
  restoreItemDraft();
}

function beginItemEdit(itemId) {
  const item = model.items.find(candidate => candidate.id === itemId);
  if (!item) return;
  model.editingItemId = item.id;
  $('#item-form-title').textContent = 'Editar producto';
  $('#item-submit-label').textContent = 'Guardar cambios';
  $('#cancel-item-edit').hidden = false;
  $('#item-text').value = item.text;
  $('#item-quantity').value = String(item.quantityMinor);
  $('#item-unit').value = item.unit;
  $('#exact-required').checked = item.exactRequired;
  $('#substitution-allowed').checked = item.substitutionAllowed;
  $('#item-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#item-text').focus({ preventScroll: true });
}

async function submitItemForm(event) {
  event.preventDefault();
  if (!model.activeListId) {
    $('#item-state').textContent = 'Crea una lista antes de añadir productos.';
    $('#new-list-name').focus();
    return;
  }
  const text = $('#item-text').value.trim();
  if (!text) return;
  const button = $('#add-item');
  setBusy(button, true);
  $('#item-state').textContent = model.editingItemId ? 'Guardando cambios…' : 'Añadiendo…';
  const payload = {
    text,
    quantityMinor: Number($('#item-quantity').value),
    unit: $('#item-unit').value,
    exactRequired: $('#exact-required').checked,
    substitutionAllowed: $('#substitution-allowed').checked,
  };
  try {
    if (model.editingItemId) {
      await api(`/api/v1/shopping-lists/${encodeURIComponent(model.activeListId)}/items/${encodeURIComponent(model.editingItemId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      cancelItemEdit();
      $('#item-state').textContent = 'Producto actualizado';
      toast('Producto actualizado');
    } else {
      await api(`/api/v1/shopping-lists/${encodeURIComponent(model.activeListId)}/items`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      clearItemDraft();
      $('#item-form').reset();
      $('#item-quantity').value = '1';
      $('#item-unit').value = metadata.units.includes('unit') ? 'unit' : metadata.units[0] || '';
      $('#substitution-allowed').checked = true;
      $('#suggestions').innerHTML = '';
      $('#item-state').textContent = 'Producto añadido';
      toast('Producto añadido');
    }
    await loadActiveList();
    $('#item-text').focus();
  } catch (error) {
    $('#item-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function scheduleSuggestions() {
  model.suggestionController?.abort();
  const query = $('#item-text').value.trim();
  document.dispatchEvent(new CustomEvent('basketra:item-text-changed', { detail: { text: query } }));
  if (query.length < 2) {
    $('#suggestions').innerHTML = '';
    return;
  }
  const controller = new AbortController();
  model.suggestionController = controller;
  setTimeout(async () => {
    if (controller.signal.aborted) return;
    try {
      const result = await api(`/api/v1/products/suggestions?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      if (controller.signal.aborted || $('#item-text').value.trim() !== query) return;
      $('#suggestions').innerHTML = result.suggestions.map(suggestionOption).join('');
    } catch (error) {
      if (error.name !== 'AbortError') $('#suggestions').innerHTML = '';
    }
  }, 180);
}

async function updateItem(itemId, payload, status) {
  const result = await api(`/api/v1/shopping-lists/${encodeURIComponent(model.activeListId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  const index = model.items.findIndex(item => item.id === itemId);
  if (index >= 0) model.items[index] = result.item;
  renderItems();
  $('#item-state').textContent = status;
}

async function moveItem(itemId, direction) {
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
  const result = await api(`/api/v1/shopping-lists/${encodeURIComponent(model.activeListId)}/items/order`, {
    method: 'PUT',
    body: JSON.stringify({ itemIds: orderedIds }),
  });
  model.items = result.items;
  renderItems();
  $('#item-state').textContent = 'Orden actualizado';
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
        body: JSON.stringify({ completed: true }),
      });
      restored = completed.item;
    }

    const current = await api(`/api/v1/shopping-lists/${encodeURIComponent(listId)}`);
    const orderedIds = current.items.filter(candidate => candidate.id !== restored.id).map(candidate => candidate.id);
    orderedIds.splice(Math.min(originalIndex, orderedIds.length), 0, restored.id);
    const ordered = await api(`/api/v1/shopping-lists/${encodeURIComponent(listId)}/items/order`, {
      method: 'PUT',
      body: JSON.stringify({ itemIds: orderedIds }),
    });
    if (model.activeListId === listId) {
      model.items = ordered.items;
      renderItems();
      $('#item-state').textContent = 'Producto restaurado';
    }
    toast('Producto restaurado');
  } catch (error) {
    $('#item-state').textContent = `No se pudo deshacer: ${error.message}`;
    toast(`No se pudo deshacer: ${error.message}`);
  }
}

async function deleteItemFromSwipe(itemId) {
  if (model.swipeDeletingItemIds.has(itemId)) return;
  const item = model.items.find(candidate => candidate.id === itemId);
  const originalIndex = model.items.findIndex(candidate => candidate.id === itemId);
  const listId = model.activeListId;
  if (!item || originalIndex < 0 || !listId) return;
  model.swipeDeletingItemIds.add(itemId);
  try {
    await api(`/api/v1/shopping-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
    if (model.editingItemId === itemId) cancelItemEdit();
    if (model.activeListId === listId) {
      model.items.splice(originalIndex, 1);
      renderItems();
      $('#item-state').textContent = 'Producto eliminado';
    }
    toast('Producto eliminado', {
      actionLabel: 'Deshacer',
      duration: 5200,
      onAction: () => restoreSwipedItem(listId, item, originalIndex),
    });
  } catch (error) {
    $('#item-state').textContent = error.message;
    toast(error.message);
  } finally {
    model.swipeDeletingItemIds.delete(itemId);
  }
}

async function confirmDeleteItem() {
  if (!model.deletingItemId) return;
  const button = $('#confirm-delete-item');
  setBusy(button, true);
  try {
    await api(`/api/v1/shopping-lists/${encodeURIComponent(model.activeListId)}/items/${encodeURIComponent(model.deletingItemId)}`, { method: 'DELETE' });
    if (model.editingItemId === model.deletingItemId) cancelItemEdit();
    model.deletingItemId = '';
    closeDialog($('#delete-item-dialog'));
    await loadActiveList();
    $('#item-state').textContent = 'Producto eliminado';
    toast('Producto eliminado');
  } catch (error) {
    $('#item-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function handleItemAction(event) {
  const button = event.target.closest('[data-item-action]');
  if (!button) return;
  const itemId = button.dataset.itemId;
  try {
    if (button.dataset.itemAction === 'edit') beginItemEdit(itemId);
    if (button.dataset.itemAction === 'delete') showDeleteItemDialog(itemId);
    if (button.dataset.itemAction === 'complete') {
      const item = model.items.find(candidate => candidate.id === itemId);
      if (item) await updateItem(itemId, { completed: !item.completed }, item.completed ? 'Producto devuelto a pendientes' : 'Producto completado');
    }
    if (button.dataset.itemAction === 'quantity') {
      await updateItem(itemId, { quantityDelta: Number(button.dataset.delta) }, 'Cantidad actualizada');
    }
    if (button.dataset.itemAction === 'move') await moveItem(itemId, Number(button.dataset.direction));
  } catch (error) {
    $('#item-state').textContent = error.message;
  }
}

async function createList(event) {
  event.preventDefault();
  const input = $('#new-list-name');
  const name = input.value.trim();
  if (!name) return;
  const button = event.submitter;
  setBusy(button, true);
  $('#list-state').textContent = 'Creando lista…';
  try {
    const result = await api('/api/v1/shopping-lists', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    model.activeListId = result.list.id;
    saveActiveListId(model.activeListId);
    input.value = '';
    await loadLists();
    $('#list-state').textContent = 'Lista lista para usar';
    toast('Lista creada');
    $('#item-text').focus();
  } catch (error) {
    $('#list-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function beginRenameList() {
  const list = activeList();
  if (!list) return;
  $('#rename-list-name').value = list.name;
  $('#rename-list-form').hidden = false;
  $('#rename-list-name').focus();
}

async function renameList(event) {
  event.preventDefault();
  const list = activeList();
  const name = $('#rename-list-name').value.trim();
  if (!list || !name) return;
  const button = event.submitter;
  setBusy(button, true);
  $('#list-state').textContent = 'Renombrando lista…';
  try {
    await api(`/api/v1/shopping-lists/${encodeURIComponent(list.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    $('#rename-list-form').hidden = true;
    await loadLists();
    $('#list-state').textContent = 'Lista renombrada';
    toast('Lista renombrada');
  } catch (error) {
    $('#list-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function showDeleteListDialog() {
  const list = activeList();
  if (!list) return;
  $('#delete-list-name').textContent = list.name;
  openDialog($('#delete-list-dialog'));
}

async function confirmDeleteList() {
  const list = activeList();
  if (!list) return;
  const button = $('#confirm-delete-list');
  setBusy(button, true);
  try {
    await api(`/api/v1/shopping-lists/${encodeURIComponent(list.id)}`, { method: 'DELETE' });
    model.activeListId = '';
    saveActiveListId('');
    cancelItemEdit();
    closeDialog($('#delete-list-dialog'));
    await loadLists();
    $('#list-state').textContent = 'Lista eliminada';
    toast('Lista eliminada');
  } catch (error) {
    $('#list-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function bindEvents() {
  $('#new-list-form').addEventListener('submit', createList);
  $('#rename-list-form').addEventListener('submit', renameList);
  $('#rename-list').addEventListener('click', beginRenameList);
  $('#cancel-rename-list').addEventListener('click', () => {
    $('#rename-list-form').hidden = true;
    $('#list-state').textContent = '';
  });
  $('#delete-list').addEventListener('click', showDeleteListDialog);
  $('#confirm-delete-list').addEventListener('click', () => void confirmDeleteList());
  $('#cancel-delete-list').addEventListener('click', () => closeDialog($('#delete-list-dialog')));
  $('#list-select').addEventListener('change', async event => {
    model.activeListId = event.target.value;
    saveActiveListId(model.activeListId);
    cancelItemEdit();
    try {
      await loadActiveList();
    } catch (error) {
      $('#list-state').textContent = error.message;
    }
  });
  $('#item-form').addEventListener('submit', submitItemForm);
  $('#cancel-item-edit').addEventListener('click', cancelItemEdit);
  $('#item-form').addEventListener('input', persistItemDraft);
  $('#item-form').addEventListener('change', persistItemDraft);
  $('#item-text').addEventListener('input', scheduleSuggestions);
  $('#suggestions').addEventListener('click', event => {
    const button = event.target.closest('[data-suggestion]');
    if (!button) return;
    $('#item-text').value = button.dataset.suggestion;
    persistItemDraft();
    $('#suggestions').innerHTML = '';
    $('#item-text').focus();
    document.dispatchEvent(new CustomEvent('basketra:item-text-changed', { detail: { text: $('#item-text').value.trim() } }));
  });
  $('#pending-items').addEventListener('click', event => void handleItemAction(event));
  $('#completed-items').addEventListener('click', event => void handleItemAction(event));
  $('#confirm-delete-item').addEventListener('click', () => void confirmDeleteItem());
  $('#cancel-delete-item').addEventListener('click', () => {
    model.deletingItemId = '';
    closeDialog($('#delete-item-dialog'));
  });
  document.addEventListener('basketra:swipe-action', event => {
    if (event.detail?.kind !== 'shopping-item' || event.detail?.action !== 'delete') return;
    void deleteItemFromSwipe(String(event.detail.id || ''));
  });
}

export async function initLists(options) {
  metadata = options.metadata;
  toast = options.toast;
  populateUnits();
  restoreItemDraft();
  bindEvents();
  await loadLists();
}
