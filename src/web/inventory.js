import { hydrateIcons } from './ui.js';

const INVENTORY_CHILD_VIEWS = new Set(['inventory', 'catalog', 'categories', 'stores', 'inventory-statistics']);

const $ = selector => document.querySelector(selector);

function ensureStylesheet() {
  if (document.querySelector('link[href="/inventory.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/inventory.css';
  document.head.append(link);
}

function activateExistingFeature(entrySelector) {
  const entry = document.querySelector(entrySelector);
  if (entry instanceof HTMLButtonElement) {
    entry.click();
    return true;
  }
  return false;
}

function renderInventoryHub() {
  const view = $('.view[data-view="inventory"]');
  if (!(view instanceof HTMLElement)) return;
  view.className = 'view inventory-view';
  view.innerHTML = `
    <div class="inventory-hub">
      <header class="inventory-hero">
        <div>
          <p class="eyebrow">Inventario</p>
          <h1>Inventario</h1>
          <p>Gestiona productos, categorías y tiendas, y revisa estadísticas de tu inventario.</p>
        </div>
        <button class="button primary inventory-create-product" type="button" data-inventory-action="new-product">
          <span data-icon="plus"></span>Nuevo producto
        </button>
      </header>

      <nav class="inventory-tabs" aria-label="Secciones de inventario">
        <button type="button" aria-current="page" data-inventory-section="products">Productos</button>
        <button type="button" data-inventory-section="categories">Categorías</button>
        <button type="button" data-inventory-section="stores">Tiendas</button>
        <button type="button" data-inventory-section="statistics">Estadísticas</button>
      </nav>

      <section class="inventory-metrics" aria-label="Resumen del inventario">
        <article class="inventory-metric"><span class="inventory-metric__icon" data-icon="store"></span><div><small>Productos</small><strong data-inventory-metric="products">—</strong><span>Catálogo activo</span></div></article>
        <article class="inventory-metric"><span class="inventory-metric__icon" data-icon="list"></span><div><small>Categorías</small><strong data-inventory-metric="categories">—</strong><span>Jerarquía reutilizable</span></div></article>
        <article class="inventory-metric"><span class="inventory-metric__icon" data-icon="store"></span><div><small>Tiendas</small><strong data-inventory-metric="stores">—</strong><span>Ubicaciones guardadas</span></div></article>
        <article class="inventory-metric"><span class="inventory-metric__icon" data-icon="prices"></span><div><small>Valor observado</small><strong data-inventory-metric="value">—</strong><span>Basado en evidencia</span></div></article>
      </section>

      <section class="inventory-query" aria-label="Buscar en inventario">
        <label class="inventory-search">
          <span class="sr-only">Buscar en inventario</span>
          <span data-icon="scan" aria-hidden="true"></span>
          <input type="search" maxlength="160" placeholder="Buscar productos, categorías o tiendas…" data-inventory-search>
        </label>
        <button class="button secondary" type="button" data-inventory-action="filters"><span data-icon="settings"></span>Filtros</button>
        <button class="button secondary" type="button" data-inventory-action="sort">Ordenar por: Recientes</button>
      </section>

      <section class="inventory-section-grid" aria-label="Gestión de inventario">
        <button class="inventory-section-card" type="button" data-open-inventory="products">
          <span class="inventory-section-card__icon" data-icon="store"></span>
          <span class="inventory-section-card__copy"><strong>Productos</strong><span>Administra tu catálogo de productos, precios, stock y variantes.</span><small>Buscar, filtrar y revisar fichas</small></span>
          <span class="inventory-section-card__cta">Ir a productos <span aria-hidden="true">→</span></span>
        </button>
        <button class="inventory-section-card" type="button" data-open-inventory="categories">
          <span class="inventory-section-card__icon inventory-section-card__icon--category" data-icon="list"></span>
          <span class="inventory-section-card__copy"><strong>Categorías</strong><span>Organiza el inventario con categorías jerárquicas y colores.</span><small>Árbol, detalle y clasificación</small></span>
          <span class="inventory-section-card__cta">Ir a categorías <span aria-hidden="true">→</span></span>
        </button>
        <button class="inventory-section-card" type="button" data-open-inventory="stores">
          <span class="inventory-section-card__icon inventory-section-card__icon--store" data-icon="store"></span>
          <span class="inventory-section-card__copy"><strong>Tiendas</strong><span>Gestiona tus tiendas y el inventario disponible en cada ubicación.</span><small>Listado, detalle y actividad</small></span>
          <span class="inventory-section-card__cta">Ir a tiendas <span aria-hidden="true">→</span></span>
        </button>
        <button class="inventory-section-card" type="button" data-open-inventory="statistics">
          <span class="inventory-section-card__icon inventory-section-card__icon--stats" data-icon="prices"></span>
          <span class="inventory-section-card__copy"><strong>Estadísticas</strong><span>Analiza el rendimiento, movimientos y rotación del inventario.</span><small>KPIs y tendencias verificables</small></span>
          <span class="inventory-section-card__cta">Ver estadísticas <span aria-hidden="true">→</span></span>
        </button>
      </section>

      <aside class="inventory-guidance" role="note">
        <span data-icon="info"></span>
        <div><strong>Inventario profesional</strong><p>Productos, categorías, tiendas y estadísticas comparten la misma navegación y mantienen el contexto al volver.</p></div>
      </aside>
      <p class="inline-status" role="status" data-inventory-state></p>
    </div>`;
  hydrateIcons(view);
}

function setInventoryCurrent(viewName) {
  const nav = document.querySelector('.bottom-nav [data-nav="inventory"]');
  if (!(nav instanceof HTMLElement)) return;
  if (INVENTORY_CHILD_VIEWS.has(viewName)) nav.setAttribute('aria-current', 'page');
  else nav.removeAttribute('aria-current');
}

function showPendingSection(label) {
  const state = $('[data-inventory-state]');
  if (state) state.textContent = `${label} tendrá listado, detalle, edición y borrado seguro en esta misma sección de Inventario.`;
}

function openSection(section) {
  if (section === 'products') {
    if (!activateExistingFeature('[data-catalog-entry]')) showPendingSection('Productos');
    return;
  }
  if (section === 'categories') {
    if (!activateExistingFeature('[data-categories-entry]')) showPendingSection('Categorías');
    return;
  }
  showPendingSection(section === 'stores' ? 'Tiendas' : 'Estadísticas');
}

function bindInventoryActions() {
  document.querySelectorAll('[data-open-inventory]').forEach(button => {
    button.addEventListener('click', () => openSection(button.dataset.openInventory));
  });
  document.querySelectorAll('[data-inventory-section]').forEach(button => {
    button.addEventListener('click', () => openSection(button.dataset.inventorySection));
  });
  $('[data-inventory-action="new-product"]')?.addEventListener('click', () => openSection('products'));
}

function initializeInventory() {
  ensureStylesheet();
  renderInventoryHub();
  bindInventoryActions();
  setInventoryCurrent(location.hash.slice(1) || 'home');
  document.addEventListener('basketra:view-changed', event => setInventoryCurrent(String(event.detail?.view || '')));
}

initializeInventory();
