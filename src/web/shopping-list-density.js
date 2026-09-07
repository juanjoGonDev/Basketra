const STYLESHEET_ID = 'shopping-list-density-styles';
const expandedItemIds = new Set();
let panelSequence = 0;

function ensureStylesheet() {
  if (document.getElementById(STYLESHEET_ID)) return;
  const link = document.createElement('link');
  link.id = STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = '/shopping-list-density.css';
  document.head.append(link);
}

function itemIdentity(row) {
  return row.querySelector('.ticket-item__identity-copy');
}

function itemName(row) {
  return itemIdentity(row)?.querySelector('strong')?.textContent?.trim() || 'producto';
}

function itemKey(row) {
  return row.closest('[data-swipe-id]')?.dataset.swipeId || '';
}

function summaryText(controls) {
  const quantity = controls.querySelector('.quantity-chip')?.textContent?.trim() || '';
  const unit = controls.querySelector('[data-item-control="unit"]')?.selectedOptions?.[0]?.textContent?.trim() || '';
  return [quantity, unit].filter(Boolean).join(' ');
}

function syncCompactSummary(row, controls) {
  const identity = itemIdentity(row);
  if (!identity) return;
  let summary = identity.querySelector('[data-shopping-item-summary]');
  if (!summary) {
    summary = document.createElement('small');
    summary.className = 'shopping-item-compact-summary';
    summary.dataset.shoppingItemSummary = 'true';
    const category = identity.querySelector('.ticket-item__category');
    if (category) category.insertAdjacentElement('afterend', summary);
    else identity.querySelector('strong')?.insertAdjacentElement('afterend', summary);
  }
  summary.textContent = summaryText(controls);
}

function syncDisclosure(row, controls, toggle, open) {
  controls.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  const label = `${open ? 'Ocultar' : 'Mostrar'} opciones de ${itemName(row)}`;
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
  const icon = toggle.querySelector('[data-icon]');
  if (icon) icon.dataset.icon = open ? 'chevronUp' : 'chevronDown';
}

function enhanceRow(row) {
  if (!(row instanceof HTMLElement) || row.dataset.shoppingDensity === 'compact') return;
  const controls = row.querySelector('.ticket-item__controls');
  const key = itemKey(row);
  if (!(controls instanceof HTMLElement) || !key) return;

  row.dataset.shoppingDensity = 'compact';
  controls.classList.add('shopping-item-disclosure__panel');
  controls.dataset.shoppingItemOptions = 'true';
  controls.id = `shopping-item-options-${++panelSequence}`;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'icon-button shopping-item-disclosure__toggle';
  toggle.dataset.shoppingItemToggle = 'true';
  toggle.dataset.shoppingItemId = key;
  toggle.setAttribute('aria-controls', controls.id);
  toggle.innerHTML = '<span data-icon="chevronDown" aria-hidden="true"></span>';
  row.append(toggle);

  syncCompactSummary(row, controls);
  syncDisclosure(row, controls, toggle, expandedItemIds.has(key));
  document.dispatchEvent(new CustomEvent('basketra:hydrate-icons', { detail: { root: toggle } }));
}

function enhanceRows(root = document) {
  root.querySelectorAll('.shopping-ticket-row .ticket-item[data-swipe-content]').forEach(enhanceRow);
}

function handleToggle(event) {
  const toggle = event.target.closest?.('[data-shopping-item-toggle]');
  if (!(toggle instanceof HTMLButtonElement)) return;
  const row = toggle.closest('.ticket-item');
  const controls = row?.querySelector('[data-shopping-item-options]');
  const key = toggle.dataset.shoppingItemId || '';
  if (!(row instanceof HTMLElement) || !(controls instanceof HTMLElement) || !key) return;

  const open = toggle.getAttribute('aria-expanded') !== 'true';
  if (open) expandedItemIds.add(key);
  else expandedItemIds.delete(key);
  syncDisclosure(row, controls, toggle, open);
  document.dispatchEvent(new CustomEvent('basketra:hydrate-icons', { detail: { root: toggle } }));
}

function handleControlChange(event) {
  const control = event.target.closest?.('[data-item-control="unit"]');
  if (!(control instanceof HTMLSelectElement)) return;
  const row = control.closest('.ticket-item');
  const controls = row?.querySelector('[data-shopping-item-options]');
  if (row instanceof HTMLElement && controls instanceof HTMLElement) syncCompactSummary(row, controls);
}

function install() {
  ensureStylesheet();
  enhanceRows();
  const pendingItems = document.querySelector('#pending-items');
  if (pendingItems) {
    const observer = new MutationObserver(() => enhanceRows(pendingItems));
    observer.observe(pendingItems, { childList: true, subtree: true });
  }
  document.addEventListener('click', handleToggle);
  document.addEventListener('change', handleControlChange);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
