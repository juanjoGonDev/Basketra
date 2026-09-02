import { escapeHtml, icon } from './ui.js';

export function inventorySwipeRail(kind, id, label) {
  const safeKind = escapeHtml(String(kind));
  const safeId = escapeHtml(String(id));
  const safeLabel = escapeHtml(String(label));
  return `<div class="swipe-rail swipe-rail--end" data-swipe-actions aria-hidden="true">
    <button type="button" class="swipe-rail__action" data-inventory-row-action="edit" data-inventory-kind="${safeKind}" data-inventory-id="${safeId}" aria-label="Editar ${safeLabel}" tabindex="-1">${icon('edit')}<span>Editar</span></button>
    <button type="button" class="swipe-rail__action swipe-rail__action--danger" data-inventory-row-action="delete" data-inventory-kind="${safeKind}" data-inventory-id="${safeId}" aria-label="Eliminar ${safeLabel}" tabindex="-1">${icon('trash')}<span>Eliminar</span></button>
    <span class="swipe-rail__commit" aria-hidden="true">${icon('trash')}<strong>Suelta para eliminar</strong></span>
  </div>`;
}

export function inventorySwipeToggle(label) {
  const safeLabel = escapeHtml(String(label));
  return `<button type="button" class="icon-button inventory-row-more" data-swipe-toggle aria-expanded="false" aria-label="Mostrar acciones de ${safeLabel}">${icon('more')}</button>`;
}
