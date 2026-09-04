import { escapeHtml, icon } from './ui.js';

const ENHANCED_ATTR = 'inventorySwipeEnhanced';
const ACTION_WAIT_MS = 5_000;
const DRAG_THRESHOLD_PX = 8;
const REVEAL_RATIO = 0.18;
const DELETE_RATIO = 0.55;
const COMMIT_DELAY_MS = 150;

const ENTITY_CONFIG = {
  'inventory-product': {
    container: '#catalog-products',
    row: '.inventory-product-row',
    id: row => row.dataset.catalogProductId,
    detail: '#catalog-detail',
    ready: '#catalog-detail-title',
    edit: '#catalog-edit-product',
    delete: '#catalog-delete-product',
    status: '#catalog-state',
  },
  'inventory-category': {
    container: '#category-tree',
    row: '.category-row',
    id: row => row.dataset.categoryId,
    detail: '#category-detail',
    ready: '#category-detail-name',
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
    ready: '#store-detail-name',
    edit: '#store-edit',
    delete: '#store-delete',
    status: '#store-state',
  },
};

let gesture;

function injectStylesheet() {
  if (document.querySelector('link[href="/inventory-swipe.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/inventory-swipe.css';
  document.head.append(link);
}

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

function setActionsAccessible(wrapper, accessible) {
  const actions = wrapper.querySelector('[data-swipe-actions]');
  actions?.setAttribute('aria-hidden', String(!accessible));
  actions?.querySelectorAll('button').forEach(button => {
    button.tabIndex = accessible ? 0 : -1;
  });
  wrapper.querySelector('[data-swipe-toggle]')?.setAttribute('aria-expanded', String(accessible));
}

function closeRow(wrapper) {
  if (!(wrapper instanceof HTMLElement)) return;
  wrapper.dataset.swipeOpen = 'false';
  wrapper.dataset.swipeDeleteArmed = 'false';
  wrapper.dataset.inventorySwipePosition = 'closed';
  setActionsAccessible(wrapper, false);
}

function closeRows(except) {
  document.querySelectorAll('.inventory-entity-swipe').forEach(wrapper => {
    if (wrapper !== except) closeRow(wrapper);
  });
}

function openRow(wrapper) {
  if (!(wrapper instanceof HTMLElement)) return;
  closeRows(wrapper);
  wrapper.dataset.swipeOpen = 'true';
  wrapper.dataset.swipeDeleteArmed = 'false';
  wrapper.dataset.inventorySwipePosition = 'reveal';
  setActionsAccessible(wrapper, true);
}

function enhanceRow(row, kind, config) {
  if (!(row instanceof HTMLButtonElement) || row.closest('.inventory-entity-swipe')) return;
  const id = config.id(row);
  if (!id) return;
  const label = rowLabel(row);
  const deleteBlocked = config.deleteBlocked?.(row) === true;
  const wrapper = document.createElement('article');
  wrapper.className = 'swipe-shell inventory-entity-swipe';
  wrapper.dataset.swipeKind = kind;
  wrapper.dataset.swipeId = String(id);
  wrapper.dataset.swipeOpen = 'false';
  wrapper.dataset.swipeDeleteArmed = 'false';
  wrapper.dataset.inventorySwipePosition = 'closed';
  wrapper.dataset[ENHANCED_ATTR] = 'true';
  if (!deleteBlocked) wrapper.dataset.swipeEndAction = 'delete';

  const rail = fragment(inventorySwipeRail(kind, id, label, { deleteDisabled: deleteBlocked }));
  const content = document.createElement('div');
  content.className = 'inventory-entity-swipe__content swipe-content';
  const toggle = fragment(inventorySwipeToggle(label));
  row.dataset.inventorySwipeSurface = '';

  row.before(wrapper);
  content.append(row, toggle);
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

function waitForText(selector, expected) {
  const matches = () => {
    const candidate = document.querySelector(selector);
    return visible(candidate) && candidate.textContent?.trim() === expected;
  };
  if (matches()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!matches()) return;
      clearTimeout(timeout);
      observer.disconnect();
      resolve();
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timed out waiting for ${selector} to show ${expected}`));
    }, ACTION_WAIT_MS);
    observer.observe(document.body, { attributes: true, childList: true, characterData: true, subtree: true });
  });
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

  const label = rowLabel(row);
  closeRow(wrapper);
  row.click();
  await waitForVisible(config.detail);
  await waitForText(config.ready, label);
  const trigger = document.querySelector(config[action]);
  if (trigger instanceof HTMLButtonElement && !trigger.disabled) trigger.click();
}

function runRowAction(wrapper, action) {
  const kind = String(wrapper?.dataset.swipeKind || '');
  void activateRowAction(wrapper, action).catch(error => reportActionFailure(kind, error));
}

function bindPointerGestures() {
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const surface = event.target.closest?.('[data-inventory-swipe-surface]');
    if (!(surface instanceof HTMLButtonElement)) return;
    const wrapper = surface.closest('.inventory-entity-swipe');
    if (!(wrapper instanceof HTMLElement)) return;
    closeRows(wrapper);
    gesture = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      horizontal: false,
      wrapper,
    };
  }, true);

  document.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const deltaX = event.clientX - gesture.x;
    const deltaY = event.clientY - gesture.y;
    if (!gesture.horizontal) {
      if (Math.abs(deltaX) < DRAG_THRESHOLD_PX && Math.abs(deltaY) < DRAG_THRESHOLD_PX) return;
      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        gesture = undefined;
        return;
      }
      gesture.horizontal = true;
    }
    event.preventDefault();
    const ratio = Math.abs(deltaX) / Math.max(gesture.wrapper.clientWidth, 1);
    if (deltaX < 0 && ratio >= REVEAL_RATIO) {
      gesture.wrapper.dataset.inventorySwipePosition = 'reveal';
      gesture.wrapper.dataset.swipeDeleteArmed = String(
        ratio >= DELETE_RATIO && Boolean(gesture.wrapper.dataset.swipeEndAction),
      );
    } else {
      gesture.wrapper.dataset.inventorySwipePosition = 'closed';
      gesture.wrapper.dataset.swipeDeleteArmed = 'false';
    }
  }, { capture: true, passive: false });

  const finish = event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const current = gesture;
    gesture = undefined;
    if (!current.horizontal) return;
    const deltaX = event.clientX - current.x;
    const ratio = Math.abs(deltaX) / Math.max(current.wrapper.clientWidth, 1);
    current.wrapper.dataset.inventorySuppressTap = 'true';
    if (deltaX < 0 && ratio >= DELETE_RATIO && current.wrapper.dataset.swipeEndAction === 'delete') {
      current.wrapper.dataset.inventorySwipePosition = 'commit';
      current.wrapper.dataset.swipeDeleteArmed = 'true';
      const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : COMMIT_DELAY_MS;
      setTimeout(() => runRowAction(current.wrapper, 'delete'), delay);
      return;
    }
    if (deltaX < 0 && ratio >= REVEAL_RATIO) {
      openRow(current.wrapper);
      return;
    }
    closeRow(current.wrapper);
  };
  document.addEventListener('pointerup', finish, true);
  document.addEventListener('pointercancel', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const wrapper = gesture.wrapper;
    gesture = undefined;
    closeRow(wrapper);
  }, true);

  document.addEventListener('click', event => {
    const surface = event.target.closest?.('[data-inventory-swipe-surface]');
    if (!(surface instanceof HTMLButtonElement)) return;
    const wrapper = surface.closest('.inventory-entity-swipe');
    if (!(wrapper instanceof HTMLElement) || wrapper.dataset.inventorySuppressTap !== 'true') return;
    delete wrapper.dataset.inventorySuppressTap;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

function bindActions() {
  bindPointerGestures();

  document.addEventListener('click', event => {
    const toggle = event.target.closest?.('.inventory-entity-swipe [data-swipe-toggle]');
    if (toggle instanceof HTMLButtonElement) {
      const wrapper = toggle.closest('.inventory-entity-swipe');
      if (!(wrapper instanceof HTMLElement)) return;
      event.preventDefault();
      event.stopPropagation();
      if (wrapper.dataset.swipeOpen === 'true') closeRow(wrapper);
      else openRow(wrapper);
      return;
    }

    const actionButton = event.target.closest?.('[data-inventory-row-action]');
    if (actionButton instanceof HTMLButtonElement && !actionButton.disabled) {
      const wrapper = actionButton.closest('.inventory-entity-swipe');
      if (!wrapper) return;
      event.preventDefault();
      event.stopPropagation();
      runRowAction(wrapper, actionButton.dataset.inventoryRowAction);
      return;
    }

    if (!event.target.closest?.('.inventory-entity-swipe')) closeRows();
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const wrapper = event.target.closest?.('.inventory-entity-swipe');
    if (wrapper) closeRow(wrapper);
  });
}

function initializeInventorySwipeEnhancement() {
  if (document.documentElement.dataset.inventorySwipeInitialized === 'true') return;
  document.documentElement.dataset.inventorySwipeInitialized = 'true';
  injectStylesheet();
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
