import { escapeHtml, icon } from './ui.js';

const ENHANCED_ATTR = 'inventorySwipeEnhanced';
const STYLE_ID = 'inventory-swipe-styles';
const ACTION_WAIT_MS = 5_000;

const ENTITY_CONFIG = {
  'inventory-product': {
    container: '#catalog-products',
    row: '.inventory-product-row',
    id: row => row.dataset.catalogProductId,
    detail: '#catalog-detail',
    edit: '#catalog-edit-product',
    delete: '#catalog-delete-product',
  },
  'inventory-category': {
    container: '#category-tree',
    row: '.category-row',
    id: row => row.dataset.categoryId,
    detail: '#category-detail',
    edit: '#category-edit',
    delete: '#category-delete',
    deleteBlocked: row => row.dataset.categoryId === 'category_unknown',
  },
  'inventory-store': {
    container: '#store-list',
    row: '.inventory-store-row',
    id: row => row.dataset.storeId,
    detail: '#store-detail-screen',
    edit: '#store-edit',
    delete: '#store-delete',
  },
};

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

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .inventory-entity-swipe {
      border-radius: 0;
    }

    .inventory-entity-swipe__content {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: stretch;
      background: var(--surface);
    }

    .inventory-entity-swipe .inventory-row-more {
      display: none;
      align-self: center;
      margin-inline-end: var(--space-2);
    }

    .inventory-entity-swipe .inventory-product-row,
    .inventory-entity-swipe .category-row,
    .inventory-entity-swipe .inventory-store-row {
      width: 100%;
      margin: 0;
    }

    @media (max-width: 70rem) {
      .inventory-entity-swipe {
        width: calc(100% - 1.3rem);
        margin: .4rem .65rem;
        border-radius: var(--radius-md, .75rem);
      }

      .inventory-entity-swipe__content {
        border: 1px solid var(--border);
        border-radius: var(--radius-md, .75rem);
        overflow: hidden;
      }

      .inventory-entity-swipe .inventory-product-row,
      .inventory-entity-swipe .category-row,
      .inventory-entity-swipe .inventory-store-row {
        width: 100%;
        margin: 0;
        border: 0;
        border-radius: 0;
      }

      .inventory-entity-swipe .inventory-row-more {
        display: grid;
      }
    }
  `;
  document.head.append(style);
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
  const toggle = fragment(inventorySwipeToggle(label));

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

function wrapperFor(kind, id) {
  return [...document.querySelectorAll('.inventory-entity-swipe')].find(wrapper => (
    wrapper.dataset.swipeKind === kind && wrapper.dataset.swipeId === id
  ));
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

function bindActions() {
  document.addEventListener('click', event => {
    const actionButton = event.target.closest?.('[data-inventory-row-action]');
    if (!(actionButton instanceof HTMLButtonElement) || actionButton.disabled) return;
    const wrapper = actionButton.closest('.inventory-entity-swipe');
    if (!wrapper) return;
    event.preventDefault();
    event.stopPropagation();
    void activateRowAction(wrapper, actionButton.dataset.inventoryRowAction).catch(() => {});
  });

  document.addEventListener('basketra:swipe-action', event => {
    const kind = String(event.detail?.kind || '');
    const id = String(event.detail?.id || '');
    if (!ENTITY_CONFIG[kind] || event.detail?.action !== 'delete' || !id) return;
    const wrapper = wrapperFor(kind, id);
    if (wrapper) void activateRowAction(wrapper, 'delete').catch(() => {});
  });
}

function initializeInventorySwipeEnhancement() {
  if (document.documentElement.dataset.inventorySwipeInitialized === 'true') return;
  document.documentElement.dataset.inventorySwipeInitialized = 'true';
  injectStyles();
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
