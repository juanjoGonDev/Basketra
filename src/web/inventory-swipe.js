import { escapeHtml, icon } from './ui.js';

const ENHANCED_ATTR = 'inventorySwipeEnhanced';
const ACTION_WAIT_MS = 5_000;
const DRAG_THRESHOLD_PX = 8;

const ENTITY_CONFIG = {
  'inventory-product': {
    container: '#catalog-products',
    row: '.inventory-product-row',
    id: row => row.dataset.catalogProductId,
    detail: '#catalog-detail',
    edit: '#catalog-edit-product',
    delete: '#catalog-delete-product',
    status: '#catalog-state',
  },
  'inventory-category': {
    container: '#category-tree',
    row: '.category-row',
    id: row => row.dataset.categoryId,
    detail: '#category-detail',
    edit: '#category-edit',
    delete: '#category-delete',
    status: '#category-state',
    deleteBlocked: row => row.dataset.categoryId === 'category_unknown',
  },
  'inventory-store': {
    container: '#store-list',
    row: '.inventory-store-row',
    id: row => row.dataset.storeId,
    detail: '#store-detail-screen',
    edit: '#store-edit',
    delete: '#store-delete',
    status: '#store-state',
  },
};

let touchGesture;

function rowLabel(row) {
  return row.querySelector('strong')?.textContent?.trim() || 'elemento';
}

export function inventorySwipeRail(kind, id, label, { deleteDisabled = false } = {}) {
  const safeKind = escapeHtml(String(kind));
  const safeId = escapeHtml(String(id));
  const safeLabel = escapeHtml(String(label));
  const deleteAttributes = deleteDisabled ? ' disabled aria-disabled="true"' : '';
  return `<div class="swipe-rail swipe-rail--end" data-swipe-actions aria-hidden="true">
    <button type="button" class="swipe-rail__action" data-inventory-row-action="edit" data-inventory-kind="${safeKind}" data-inventory-id="${safeId}" aria-label="Editar ${safeLabel}" tabindex="-1">${icon('edit')}<span>Editar</span></button>
    <button type="button" class="swipe-rail__action swipe-rail__action--danger" data-inventory-row-action="delete" data-inventory-kind="${safeKind}" data-inventory-id="${safeId}" aria-label="Eliminar ${safeLabel}" tabindex="-1"${deleteAttributes}>${icon('trash')}<span>Eliminar</span></button>
    <span class="swipe-rail__commit" aria-hidden="true">${icon('trash')}<strong>Suelta para eliminar</strong></span>
  </div>`;
}

export function inventorySwipeToggle(label) {
  const safeLabel = escapeHtml(String(label));
  return `<button type="button" class="icon-button inventory-row-more" data-swipe-toggle aria-expanded="false" aria-label="Mostrar acciones de ${safeLabel}">${icon('more')}</button>`;
}

function fragment(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

function enhanceRow(row, kind, config) {
  if (!(row instanceof HTMLButtonElement) || row.closest('.inventory-entity-swipe')) return;
  const id = config.id(row);
  if (!id) return;
  const label = rowLabel(row);
  const deleteBlocked = config.deleteBlocked?.(row) === true;
  const wrapper = document.createElement('article');
  wrapper.className = 'swipe-shell inventory-entity-swipe';
  wrapper.dataset.swipeRow = '';
  wrapper.dataset.swipeKind = kind;
  wrapper.dataset.swipeId = String(id);
  wrapper.dataset.swipeOpen = 'false';
  wrapper.dataset[ENHANCED_ATTR] = 'true';
  if (!deleteBlocked) wrapper.dataset.swipeEndAction = 'delete';

  const rail = fragment(inventorySwipeRail(kind, id, label, { deleteDisabled: deleteBlocked }));
  const content = document.createElement('div');
  content.className = 'inventory-entity-swipe__content swipe-content';
  content.dataset.swipeContent = '';
  const touchSurface = document.createElement('span');
  touchSurface.className = 'inventory-swipe-touch-surface';
  touchSurface.dataset.inventoryTouchSurface = '';
  touchSurface.setAttribute('aria-hidden', 'true');
  const toggle = fragment(inventorySwipeToggle(label));

  row.before(wrapper);
  content.append(row, touchSurface, toggle);
  wrapper.append(rail, content);
}

function enhanceAllRows() {
  for (const [kind, config] of Object.entries(ENTITY_CONFIG)) {
    const container = document.querySelector(config.container);
    if (!container) continue;
    container.querySelectorAll(config.row).forEach(row => enhanceRow(row, kind, config));
  }
}

function visible(element) {
  return element instanceof HTMLElement && !element.hidden && getComputedStyle(element).display !== 'none';
}

function waitForVisible(selector) {
  const existing = document.querySelector(selector);
  if (visible(existing)) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const candidate = document.querySelector(selector);
      if (!visible(candidate)) return;
      clearTimeout(timeout);
      observer.disconnect();
      resolve(candidate);
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timed out waiting for ${selector}`));
    }, ACTION_WAIT_MS);
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
  });
}

function wrapperFor(kind, id) {
  return [...document.querySelectorAll('.inventory-entity-swipe')].find(wrapper => (
    wrapper.dataset.swipeKind === kind && wrapper.dataset.swipeId === id
  ));
}

function reportActionFailure(kind, error) {
  const statusSelector = ENTITY_CONFIG[kind]?.status;
  const status = statusSelector ? document.querySelector(statusSelector) : null;
  if (!(status instanceof HTMLElement)) return;
  const message = error instanceof Error ? error.message : String(error);
  status.textContent = `No se pudo abrir la acción: ${message}`;
}

async function activateRowAction(wrapper, action) {
  const kind = wrapper?.dataset.swipeKind;
  const config = ENTITY_CONFIG[kind];
  if (!config || (action !== 'edit' && action !== 'delete')) return;
  const row = wrapper.querySelector(config.row);
  if (!(row instanceof HTMLButtonElement)) return;
  if (action === 'delete' && config.deleteBlocked?.(row) === true) return;

  row.click();
  await waitForVisible(config.detail);
  const trigger = document.querySelector(config[action]);
  if (trigger instanceof HTMLButtonElement && !trigger.disabled) trigger.click();
}

function runRowAction(wrapper, action) {
  const kind = String(wrapper?.dataset.swipeKind || '');
  void activateRowAction(wrapper, action).catch(error => reportActionFailure(kind, error));
}

function bindTouchSurface() {
  document.addEventListener('pointerdown', event => {
    const surface = event.target.closest?.('[data-inventory-touch-surface]');
    if (!(surface instanceof HTMLElement)) return;
    touchGesture = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dragged: false,
      wrapper: surface.closest('.inventory-entity-swipe'),
    };
  }, true);

  document.addEventListener('pointermove', event => {
    if (!touchGesture || event.pointerId !== touchGesture.pointerId) return;
    const deltaX = event.clientX - touchGesture.x;
    const deltaY = event.clientY - touchGesture.y;
    if (Math.abs(deltaX) >= DRAG_THRESHOLD_PX || Math.abs(deltaY) >= DRAG_THRESHOLD_PX) touchGesture.dragged = true;
  }, true);

  const finishGesture = event => {
    if (!touchGesture || event.pointerId !== touchGesture.pointerId) return;
    const { wrapper, dragged } = touchGesture;
    touchGesture = undefined;
    if (wrapper instanceof HTMLElement) wrapper.dataset.inventorySuppressTap = String(dragged);
  };
  document.addEventListener('pointerup', finishGesture, true);
  document.addEventListener('pointercancel', finishGesture, true);

  document.addEventListener('click', event => {
    const surface = event.target.closest?.('[data-inventory-touch-surface]');
    if (!(surface instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const wrapper = surface.closest('.inventory-entity-swipe');
    if (!(wrapper instanceof HTMLElement)) return;
    const suppressTap = wrapper.dataset.inventorySuppressTap === 'true';
    delete wrapper.dataset.inventorySuppressTap;
    if (suppressTap) return;
    const config = ENTITY_CONFIG[wrapper.dataset.swipeKind];
    const row = config ? wrapper.querySelector(config.row) : null;
    if (row instanceof HTMLButtonElement) row.click();
  }, true);
}

function bindActions() {
  bindTouchSurface();

  document.addEventListener('click', event => {
    const actionButton = event.target.closest?.('[data-inventory-row-action]');
    if (!(actionButton instanceof HTMLButtonElement) || actionButton.disabled) return;
    const wrapper = actionButton.closest('.inventory-entity-swipe');
    if (!wrapper) return;
    event.preventDefault();
    event.stopPropagation();
    runRowAction(wrapper, actionButton.dataset.inventoryRowAction);
  });

  document.addEventListener('basketra:swipe-action', event => {
    const kind = String(event.detail?.kind || '');
    const id = String(event.detail?.id || '');
    if (!ENTITY_CONFIG[kind] || event.detail?.action !== 'delete' || !id) return;
    const wrapper = wrapperFor(kind, id);
    if (wrapper) runRowAction(wrapper, 'delete');
  });
}

function initializeInventorySwipeEnhancement() {
  if (document.documentElement.dataset.inventorySwipeInitialized === 'true') return;
  document.documentElement.dataset.inventorySwipeInitialized = 'true';
  bindActions();
  enhanceAllRows();

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      enhanceAllRows();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeInventorySwipeEnhancement, { once: true });
} else {
  initializeInventorySwipeEnhancement();
}
