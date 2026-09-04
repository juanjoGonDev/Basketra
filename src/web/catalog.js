import { api, setBusy } from './api.js';
import { breadcrumb, escapeHtml, formatEuroMinor, hydrateIcons, setFieldFeedback } from './ui.js';
import { createPagedSelection, syncPagedSelectionDom } from './entity-selection.js';
import {
  readApplicationLocation,
  readRouteEnum,
  readRoutePage,
  readRouteText,
  writeApplicationLocation,
} from './routes.js';

const PRODUCT_PAGE_SIZE = 12;
const CATEGORY_PAGE_SIZE = 12;
const SEARCH_DELAY_MS = 250;
const PRODUCT_PRICE_FILTERS = ['all', 'with-price', 'without-price'];
const PRODUCT_SORTS = ['name', 'recent', 'price-desc', 'price-asc'];
const CATEGORY_FILTERS = ['all', 'roots', 'without-products', 'with-children'];
const UNKNOWN_CATEGORY_NAME = 'desconocido';
const DEFAULT_CATEGORY_COLOR = '#64748B';
const DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' });

const $ = selector => document.querySelector(selector);

const state = {
  initialized: false,
  catalog: { products: [], parents: [], total: 0, offset: 0, limit: PRODUCT_PAGE_SIZE, hasMore: false },
  categoryInventory: { categories: [], total: 0, offset: 0, limit: CATEGORY_PAGE_SIZE, hasMore: false },
  categories: [],
  units: [],
  productPage: 1,
  categoryPage: 1,
  productDetail: null,
  selectedCategoryId: '',
  categoryCreateParentId: '',
  productQuery: '',
  productCategoryId: '',
  productPriceFilter: 'all',
  productSort: 'name',
  categoryQuery: '',
  categoryFilter: 'all',
  searchTimer: null,
  categorySearchTimer: null,
  loadController: null,
  loadGeneration: 0,
  categoryLoadController: null,
  categoryLoadGeneration: 0,
  productSelection: createPagedSelection(),
  categorySelection: createPagedSelection(),
  bulkProductDeleteIds: [],
};

function injectStylesheet() {
  if (document.querySelector('link[href="/catalog.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/catalog.css';
  document.head.append(link);
}

function inventoryBackButton() {
  return '<button class="button secondary" type="button" data-catalog-nav="inventory"><span data-icon="chevronUp" class="icon-rotate-left"></span>Inventario</button>';
}

function installCatalogView() {
  if (document.querySelector('.view[data-view="catalog"]')) return;
  const main = $('#main');
  if (!main) return;
  const view = document.createElement('section');
  view.className = 'view catalog-view inventory-entity-view';
  view.dataset.view = 'catalog';
  view.innerHTML = `
    <section id="catalog-list-screen" class="inventory-list-screen" aria-labelledby="catalog-page-title">
      <header class="inventory-entity-header">
        <div><p class="eyebrow">Inventario · Productos</p><h1 id="catalog-page-title">Productos</h1><p>Consulta, filtra y abre cada ficha sin mezclar el listado con el editor.</p></div>
        <div class="inventory-header-actions">${inventoryBackButton()}<button id="catalog-new-product" class="button primary" type="button"><span data-icon="plus"></span>Nuevo producto</button></div>
      </header>
      <section class="surface inventory-toolbar" aria-label="Filtros del catálogo">
        <label class="field inventory-search-field"><span>Buscar</span><input id="catalog-search" type="search" maxlength="160" autocomplete="off" placeholder="Nombre, marca, alias o comercio"></label>
        <label class="field"><span>Categoría</span><select id="catalog-filter-category"><option value="">Todas</option></select></label>
        <label class="field"><span>Precio</span><select id="catalog-filter-price"><option value="all">Todos</option><option value="with-price">Con precio</option><option value="without-price">Sin precio</option></select></label>
        <label class="field"><span>Orden</span><select id="catalog-sort"><option value="name">Nombre A-Z</option><option value="recent">Actualizados recientemente</option><option value="price-desc">Precio más alto</option><option value="price-asc">Precio más bajo</option></select></label>
        <button id="catalog-clear-filters" class="button secondary" type="button"><span data-icon="refresh"></span>Limpiar filtros</button>
      </section>
      <p id="catalog-state" class="inline-status" role="status" aria-live="polite"></p>
      <div id="catalog-selection-bar" class="entity-selection-bar" hidden><span class="entity-selection-bar__copy"><strong id="catalog-selection-count">0 seleccionados</strong><small id="catalog-selection-context">Selección explícita</small></span><button id="catalog-selection-clear" class="button secondary" type="button">Limpiar selección</button><button id="catalog-selection-delete" class="button danger" type="button"><span data-icon="trash"></span>Eliminar seleccionados</button></div>
      <section class="surface inventory-list-surface" aria-label="Listado de productos">
        <div class="entity-selection-heading"><label class="entity-selection-cell"><input id="catalog-select-page" type="checkbox" aria-label="Seleccionar productos de esta página"></label><div class="inventory-list-heading inventory-product-grid" aria-hidden="true"><span>Producto</span><span>Categoría</span><span>Comercios</span><span>Precio reciente</span><span>Actualizado</span><span></span></div></div>
        <div id="catalog-products" class="inventory-product-list" aria-live="polite"></div>
        <footer class="inventory-pagination" aria-label="Paginación de productos"><span id="catalog-range">0 resultados</span><div><button id="catalog-prev" class="button secondary" type="button">Anterior</button><span id="catalog-page" class="count-badge">1</span><button id="catalog-next" class="button secondary" type="button">Siguiente</button></div></footer>
      </section>
    </section>

    <section id="catalog-detail" class="inventory-detail-screen" aria-labelledby="catalog-detail-title" hidden>
      ${breadcrumb([{ label: 'Inventario', route: 'inventory' }, { label: 'Productos', route: 'catalog' }, { label: 'Ficha' }])}
      <header class="inventory-detail-header">
        <button id="catalog-back-list" class="button secondary" type="button"><span data-icon="chevronUp" class="icon-rotate-left"></span>Productos</button>
        <div class="inventory-detail-header__copy"><p class="eyebrow">Producto</p><h1 id="catalog-detail-title">Detalle de producto</h1><p id="catalog-detail-meta"></p></div>
        <div class="inventory-header-actions"><button id="catalog-edit-product" class="button secondary" type="button"><span data-icon="edit"></span>Editar</button><button id="catalog-delete-product" class="button danger" type="button"><span data-icon="trash"></span>Eliminar</button></div>
      </header>
      <div class="inventory-detail-grid">
        <section class="surface inventory-detail-primary">
          <div class="inventory-product-identity"><span class="inventory-product-avatar" data-icon="store"></span><div><p class="eyebrow">Ficha reutilizable</p><h2 id="catalog-detail-name">—</h2><p id="catalog-detail-category">Sin categoría</p></div></div>
          <dl class="inventory-definition-grid"><div><dt>Marca</dt><dd id="catalog-detail-brand">—</dd></div><div><dt>EAN/GTIN</dt><dd id="catalog-detail-ean">—</dd></div><div><dt>Formato</dt><dd id="catalog-detail-package">—</dd></div><div><dt>Actualizado</dt><dd id="catalog-detail-updated">—</dd></div></dl>
          <section><p class="eyebrow">Descripción</p><p id="catalog-detail-description">Sin descripción.</p></section>
        </section>
        <aside class="inventory-detail-aside">
          <section class="surface"><div class="section-header"><div><p class="eyebrow">Producto padre</p><h2 id="catalog-parent-name">—</h2></div></div><p>Las variantes comparten nombre canónico, categoría y descripción.</p></section>
          <section class="surface"><div class="section-header"><div><p class="eyebrow">Precios</p><h2>Últimas observaciones</h2></div></div><div id="catalog-latest-prices" class="catalog-retailer-names" aria-live="polite"></div></section>
          <section class="surface"><div class="section-header"><div><p class="eyebrow">Comercios</p><h2>Nombres asociados</h2></div></div><div id="catalog-retailer-names" class="catalog-retailer-names" aria-live="polite"></div></section>
        </aside>
      </div>
      <section class="surface catalog-price-history" aria-labelledby="catalog-price-history-title">
        <div class="section-header"><div><p class="eyebrow">Evolución</p><h2 id="catalog-price-history-title">Histórico de precios</h2></div><span id="catalog-price-history-count" class="count-badge">0</span></div>
        <p id="catalog-price-history-state" class="inline-status" role="status" aria-live="polite">Sin observaciones.</p>
        <div id="catalog-price-history-content" class="catalog-price-history__content" hidden>
          <figure class="catalog-price-chart">
            <svg id="catalog-price-history-chart" viewBox="0 0 720 220" role="img" aria-label="Histórico de precios">
              <line class="catalog-price-chart__axis" x1="28" y1="190" x2="700" y2="190"></line>
              <line class="catalog-price-chart__axis" x1="28" y1="18" x2="28" y2="190"></line>
              <polyline id="catalog-price-history-line" class="catalog-price-chart__line" points=""></polyline>
            </svg>
            <figcaption>La gráfica representa las observaciones cronológicas; la tabla ofrece los mismos datos.</figcaption>
          </figure>
          <div class="catalog-price-history__table-wrap">
            <table id="catalog-price-history-table">
              <thead><tr><th scope="col">Fecha</th><th scope="col">Comercio / tienda</th><th scope="col">Precio</th></tr></thead>
              <tbody id="catalog-price-history-body"></tbody>
            </table>
          </div>
        </div>
      </section>
      <section id="catalog-ticket-history" class="surface catalog-ticket-history" aria-labelledby="catalog-ticket-history-title">
        <div class="section-header"><div><h2 id="catalog-ticket-history-title">Histórico de tickets</h2></div><span id="catalog-ticket-history-count" class="count-badge">0</span></div>
        <p id="catalog-ticket-history-state" class="inline-status" role="status" aria-live="polite">Sin tickets confirmados.</p>
        <div id="catalog-ticket-history-content" class="catalog-ticket-history__table-wrap" hidden>
          <table id="catalog-ticket-history-table">
            <thead><tr><th scope="col">Fecha</th><th scope="col">Comercio / tienda</th><th scope="col">Cantidad</th><th scope="col">Importe</th><th scope="col"><span class="sr-only">Acción</span></th></tr></thead>
            <tbody id="catalog-ticket-history-body"></tbody>
          </table>
        </div>
      </section>
      <section id="catalog-editor" class="surface inventory-editor" aria-labelledby="catalog-editor-title" hidden>
        <div class="section-header"><div><p class="eyebrow">Edición</p><h2 id="catalog-editor-title">Editar producto</h2></div><span id="catalog-product-status" class="status-pill">Guardado</span></div>
        <form id="catalog-product-form" class="catalog-form" novalidate>
          <p class="field-help">Los campos marcados con asterisco son necesarios para guardar la ficha.</p>
          <label class="field"><span>Nombre can\u00f3nico <span class="field-required" aria-hidden="true">*</span><strong>Obligatorio</strong></span><input id="catalog-canonical-name" maxlength="160" required aria-describedby="catalog-canonical-name-error"><small id="catalog-canonical-name-error" class="field-error"></small></label>
          <label class="field"><span>Nombre de esta variante <span class="field-required" aria-hidden="true">*</span><strong>Obligatorio</strong></span><input id="catalog-variant-name" maxlength="160" required aria-describedby="catalog-variant-name-error"><small id="catalog-variant-name-error" class="field-error"></small></label>
          <div class="quantity-row"><label class="field"><span>Marca <em>Opcional</em></span><input id="catalog-brand" maxlength="120" aria-describedby="catalog-brand-error"><small id="catalog-brand-error" class="field-error"></small></label><label class="field"><span>EAN/GTIN <em>Opcional</em></span><input id="catalog-ean" maxlength="14" inputmode="numeric" aria-describedby="catalog-ean-error"><small id="catalog-ean-error" class="field-error"></small></label></div>
          <label class="field"><span>Categor\u00eda <em>Opcional</em></span><select id="catalog-category" aria-describedby="catalog-category-error"><option value="">Sin categor\u00eda</option></select><small id="catalog-category-error" class="field-error"></small></label>
          <label class="field"><span>Descripci\u00f3n <em>Opcional</em></span><textarea id="catalog-description" maxlength="500" rows="3" aria-describedby="catalog-description-error"></textarea><small id="catalog-description-error" class="field-error"></small></label>
          <label class="field"><span>Alias de b\u00fasqueda, uno por l\u00ednea <em>Opcional</em></span><textarea id="catalog-aliases" maxlength="1000" rows="3" aria-describedby="catalog-aliases-error"></textarea><small id="catalog-aliases-error" class="field-error"></small></label>
          <div class="quantity-row"><label class="field"><span>Cantidad del formato <em>Opcional</em></span><input id="catalog-package-minor" type="number" min="1" max="100000000" inputmode="numeric" aria-describedby="catalog-package-minor-error"><small id="catalog-package-minor-error" class="field-error"></small></label><label class="field"><span>Unidad <em>Opcional</em></span><select id="catalog-package-unit" aria-describedby="catalog-package-unit-error"><option value="">Sin formato</option></select><small id="catalog-package-unit-error" class="field-error"></small></label></div>
          <div class="dialog-actions"><button id="catalog-cancel-edit" class="button secondary" type="button">Cancelar</button><button id="catalog-save-product" class="button primary" type="submit"><span data-icon="check"></span>Guardar ficha</button></div>
          <p id="catalog-product-form-state" class="inline-status" role="alert" aria-live="assertive"></p>
        </form>
        <hr>
        <div id="catalog-existing-relations" class="inventory-editor-columns">
          <fieldset class="flow-group"><legend>Producto padre</legend><label class="field"><span>Padre existente</span><select id="catalog-parent-select"><option value="">Selecciona un producto padre</option></select></label><button id="catalog-link-parent" class="button secondary full" type="button">Relacionar con el padre elegido</button><label class="field"><span>Nuevo padre</span><input id="catalog-new-parent-name" maxlength="160" autocomplete="off"></label><button id="catalog-create-parent" class="button secondary full" type="button"><span data-icon="plus"></span>Crear padre y relacionar</button><p id="catalog-parent-state" class="inline-status" role="status"></p></fieldset>
          <fieldset class="flow-group"><legend>Nombre por comercio</legend><label class="field"><span>Comercio</span><input id="catalog-retailer-name" maxlength="160" autocomplete="organization"></label><label class="field"><span>Nombre en comercio</span><input id="catalog-retailer-title" maxlength="240"></label><button id="catalog-save-retailer-name" class="button secondary full" type="button">Guardar nombre del comercio</button><p id="catalog-retailer-state" class="inline-status" role="status"></p></fieldset>
        </div>
      </section>
    </section>
    <dialog id="catalog-delete-dialog" class="confirm-dialog" aria-labelledby="catalog-delete-title"><div class="dialog-content"><span class="dialog-icon" data-icon="alert"></span><h2 id="catalog-delete-title">Eliminar producto</h2><p id="catalog-delete-impact">Comprobando dependencias…</p><p class="inline-status" role="status" id="catalog-delete-state"></p><div class="dialog-actions"><button id="catalog-delete-cancel" class="button secondary" type="button">Cancelar</button><button id="catalog-delete-confirm" class="button danger" type="button" disabled>Eliminar producto</button></div></div></dialog>`;
  main.append(view);
  hydrateIcons(view);
}

function installCategoryView() {
  if (document.querySelector('.view[data-view="categories"]')) return;
  const main = $('#main');
  if (!main) return;
  const view = document.createElement('section');
  view.className = 'view catalog-view category-view inventory-entity-view';
  view.dataset.view = 'categories';
  view.innerHTML = `
    <section id="category-list-screen" class="inventory-list-screen" aria-labelledby="categories-page-title">
      <header class="inventory-entity-header"><div><p class="eyebrow">Inventario · Categorías</p><h1 id="categories-page-title">Categorías</h1><p>Gestiona una jerarquía reutilizable sin mezclar el listado con el formulario.</p></div><div class="inventory-header-actions">${inventoryBackButton()}<button id="category-new" class="button primary" type="button"><span data-icon="plus"></span>Nueva categoría</button></div></header>
      <section class="surface inventory-toolbar"><label class="field inventory-search-field"><span>Buscar</span><input id="category-search" type="search" maxlength="120" placeholder="Nombre o descripción"></label><label class="field"><span>Vista</span><select id="category-filter"><option value="all">Todas</option><option value="roots">Raíz</option><option value="without-products">Sin productos</option><option value="with-children">Con subcategorías</option></select></label><button id="category-clear-filters" class="button secondary" type="button">Limpiar filtros</button></section>
      <p id="category-state" class="inline-status" role="status" aria-live="polite"></p>
      <div id="category-selection-bar" class="entity-selection-bar" hidden><span class="entity-selection-bar__copy"><strong id="category-selection-count">0 seleccionadas</strong><small id="category-selection-context">Selección explícita</small></span><button id="category-selection-clear" class="button secondary" type="button">Limpiar selección</button></div>
      <section class="surface inventory-list-surface"><div class="entity-selection-heading"><label class="entity-selection-cell"><input id="category-select-page" type="checkbox" aria-label="Seleccionar categorías de esta página"></label><div class="inventory-list-heading category-list-grid" aria-hidden="true"><span>Nombre</span><span>Productos</span><span>Subcategorías</span><span>Padre</span><span></span></div></div><div id="category-tree" class="category-tree" aria-live="polite"></div><footer class="inventory-pagination"><span id="category-range">0 resultados</span><div><button id="category-prev" class="button secondary" type="button">Anterior</button><span id="category-page" class="count-badge">1</span><button id="category-next" class="button secondary" type="button">Siguiente</button></div></footer></section>
    </section>
    <section id="category-detail" class="inventory-detail-screen" aria-labelledby="category-form-title" hidden>
      ${breadcrumb([{ label: 'Inventario', route: 'inventory' }, { label: 'Categor\u00edas', route: 'categories' }, { label: 'Ficha' }])}
      <header class="inventory-detail-header"><button id="categories-back-list" class="button secondary" type="button"><span data-icon="chevronUp" class="icon-rotate-left"></span>Categorías</button><div class="inventory-detail-header__copy"><p class="eyebrow">Categoría</p><h1 id="category-form-title">Nueva categoría</h1><p id="category-detail-hierarchy">Categoría raíz</p></div><div class="inventory-header-actions"><button id="category-edit" class="button secondary" type="button"><span data-icon="edit"></span>Editar</button><button id="category-delete" class="button danger" type="button"><span data-icon="trash"></span>Eliminar</button></div></header>
      <div class="inventory-detail-grid"><section class="surface inventory-detail-primary"><div class="inventory-category-identity"><svg id="category-detail-swatch" class="category-swatch" viewBox="0 0 1 1" aria-hidden="true" focusable="false"><rect width="1" height="1" rx=".22" fill="${DEFAULT_CATEGORY_COLOR}"></rect></svg><div><p class="eyebrow">Información general</p><h2 id="category-detail-name">Nueva categoría</h2><p id="category-detail-description">Sin descripción.</p></div></div><dl class="inventory-definition-grid"><div><dt>Productos directos</dt><dd id="category-detail-products">0</dd></div><div><dt>Subcategorías</dt><dd id="category-detail-children">0</dd></div><div><dt>Padre</dt><dd id="category-detail-parent">Raíz</dd></div><div><dt>Estado</dt><dd id="category-detail-status">Activa</dd></div></dl><div id="category-protected-note" class="catalog-shared-note" role="note" hidden><strong>Categoría protegida</strong><span>desconocido es el fallback canónico y no puede eliminarse ni moverse.</span></div></section></div>
      <section id="category-editor" class="surface inventory-editor" aria-labelledby="category-editor-title" hidden><div class="section-header"><div><p class="eyebrow">Edición</p><h2 id="category-editor-title">Editar categoría</h2></div><span id="category-form-status" class="status-pill">Guardada</span></div><form id="category-form" class="category-form"><label class="field"><span>Nombre</span><input id="category-name" maxlength="120" autocomplete="off" required></label><label class="field"><span>Categoría padre</span><select id="category-parent"><option value="">Sin padre · categoría raíz</option></select></label><label class="field category-color-field"><span>Color</span><span class="category-color-control"><input id="category-color" type="color" value="${DEFAULT_CATEGORY_COLOR}" aria-label="Color de la categoría"><output id="category-color-value">${DEFAULT_CATEGORY_COLOR}</output></span></label><label class="field"><span>Descripción opcional</span><textarea id="category-description" maxlength="500" rows="4"></textarea></label><div class="dialog-actions"><button id="category-cancel-edit" class="button secondary" type="button">Cancelar</button><button id="category-save" class="button primary" type="submit"><span data-icon="check"></span>Guardar categoría</button></div><button id="category-add-child" class="button secondary full" type="button" hidden><span data-icon="plus"></span>Añadir subcategoría</button><p id="category-form-state" class="inline-status" role="status"></p></form></section>
      <dialog id="category-delete-dialog" class="confirm-dialog" aria-labelledby="category-delete-title"><div class="dialog-content"><span class="dialog-icon" data-icon="alert"></span><h2 id="category-delete-title">Eliminar categoría</h2><p id="category-delete-impact">Comprobando productos y subcategorías…</p><p id="category-delete-state" class="inline-status" role="status"></p><div class="dialog-actions"><button id="category-delete-cancel" class="button secondary" type="button">Cancelar</button><button id="category-delete-confirm" class="button danger" type="button" disabled>Eliminar categoría</button></div></div></dialog>
    </section>`;
  main.append(view);
  hydrateIcons(view);
}

function activateFeatureView(viewName, { dispatch = true } = {}) {
  const view = document.querySelector(`.view[data-view="${CSS.escape(viewName)}"]`);
  if (!view) return false;
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element === view));
  document.querySelectorAll('.bottom-nav [data-nav]').forEach(element => element.removeAttribute('aria-current'));
  document.querySelector('.bottom-nav [data-nav="inventory"]')?.setAttribute('aria-current', 'page');
  if (dispatch) document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: viewName, route: viewName, searchParams: new URLSearchParams() } }));
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo(0, 0);
  $('#main')?.focus({ preventScroll: true });
  return true;
}

function goInventory() {
  const button = document.querySelector('.bottom-nav [data-nav="inventory"]');
  if (button instanceof HTMLButtonElement) button.click();
}

function selectedCategory() {
  return state.categories.find(category => category.id === state.selectedCategoryId);
}

function normalizedCategoryColor(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/u.test(normalized) ? normalized : DEFAULT_CATEGORY_COLOR;
}

function categorySwatchMarkup(color) {
  const fill = escapeHtml(normalizedCategoryColor(color));
  return `<svg class="category-swatch" viewBox="0 0 1 1" aria-hidden="true" focusable="false"><rect width="1" height="1" rx=".22" fill="${fill}"></rect></svg>`;
}

function categoryIndentMarkup(depth) {
  return '<span class="category-indent-step" aria-hidden="true"></span>'.repeat(Math.max(0, depth));
}

function sortedCategories(categories = state.categories) {
  return [...categories].sort((left, right) => left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }) || left.id.localeCompare(right.id));
}

function categoryMaps() {
  const byId = new Map(state.categories.map(category => [category.id, category]));
  const children = new Map();
  for (const category of state.categories) {
    if (!category.parentId) continue;
    const values = children.get(category.parentId) || [];
    values.push(category);
    children.set(category.parentId, values);
  }
  return { byId, children };
}

function categoryTreeEntries(categories = state.categories) {
  const { byId, children } = categoryMaps();
  const allowed = new Set(categories.map(category => category.id));
  const roots = categories.filter(category => !category.parentId || !byId.has(category.parentId) || !allowed.has(category.parentId));
  const entries = [];
  const visited = new Set();
  const visit = (category, depth) => {
    if (visited.has(category.id) || !allowed.has(category.id)) return;
    visited.add(category.id);
    entries.push({ category, depth });
    for (const child of sortedCategories(children.get(category.id) || [])) visit(child, depth + 1);
  };
  for (const root of sortedCategories(roots)) visit(root, 0);
  for (const category of sortedCategories(categories)) if (!visited.has(category.id)) visit(category, 0);
  return entries;
}

function categoryDepth(categoryId) {
  const { byId } = categoryMaps();
  let depth = 0;
  let current = byId.get(categoryId);
  const visited = new Set();
  while (current?.parentId && byId.has(current.parentId) && !visited.has(current.parentId)) {
    visited.add(current.id);
    depth += 1;
    current = byId.get(current.parentId);
  }
  return depth;
}

function descendantCategoryIds(categoryId) {
  const { children } = categoryMaps();
  const result = new Set();
  const pending = [...(children.get(categoryId) || [])];
  while (pending.length) {
    const category = pending.pop();
    if (!category || result.has(category.id)) continue;
    result.add(category.id);
    pending.push(...(children.get(category.id) || []));
  }
  return result;
}

function renderCategoryOptions() {
  const filter = $('#catalog-filter-category');
  const editor = $('#catalog-category');
  const options = categoryTreeEntries().map(({ category, depth }) => ({ value: category.id, label: `${'  '.repeat(depth)}${depth ? '↳ ' : ''}${category.name}` }));
  if (filter) {
    const current = state.productCategoryId;
    filter.replaceChildren(new Option('Todas', ''));
    for (const option of options) filter.append(new Option(option.label, option.value));
    filter.value = current;
  }
  if (editor) {
    const current = editor.value;
    editor.replaceChildren(new Option('Sin categoría', ''));
    for (const option of options) editor.append(new Option(option.label, option.value));
    editor.value = current;
  }
}

function renderCategoryParentOptions(category = selectedCategory(), presetParentId = state.categoryCreateParentId) {
  const select = $('#category-parent');
  if (!select) return;
  const excluded = category ? descendantCategoryIds(category.id) : new Set();
  if (category) excluded.add(category.id);
  select.replaceChildren(new Option('Sin padre · categoría raíz', ''));
  for (const { category: candidate, depth } of categoryTreeEntries()) {
    if (excluded.has(candidate.id)) continue;
    select.append(new Option(`${'  '.repeat(depth)}${depth ? '↳ ' : ''}${candidate.name}`, candidate.id));
  }
  select.value = category ? (category.parentId || '') : presetParentId;
}

function renderUnitOptions() {
  const select = $('#catalog-package-unit');
  if (!select) return;
  const current = select.value;
  select.replaceChildren(new Option('Sin formato', ''));
  for (const unit of state.units) select.append(new Option(unit, unit));
  select.value = current;
}

function latestPrice(product) {
  return product.latestPrices?.[0] || null;
}

function syncSelectionControls(selection, pageIds, {
  pageCheckboxId,
  barId,
  countId,
  contextId,
  noun,
}) {
  const pageState = syncPagedSelectionDom(selection, pageIds, {
    pageCheckbox: $(`#${pageCheckboxId}`),
  });
  const bar = $(`#${barId}`);
  if (bar) bar.hidden = selection.size === 0;
  const count = $(`#${countId}`);
  if (count) count.textContent = `${selection.size} ${noun}`;
  const context = $(`#${contextId}`);
  if (context) context.textContent = pageState.selectedOutsidePage
    ? `${pageState.selectedOnPage} en esta página · ${pageState.selectedOutsidePage} en otras páginas`
    : `${pageState.selectedOnPage} en esta página`;
}

function selectionCell(selection, id, label, sync) {
  const cell = document.createElement('label');
  cell.className = 'entity-selection-cell';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = selection.has(id);
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => {
    selection.set(id, input.checked);
    sync();
  });
  cell.append(input);
  return cell;
}

function syncProductSelection() {
  const ids = (state.catalog.products || []).map(product => product.id);
  syncSelectionControls(state.productSelection, ids, {
    pageCheckboxId: 'catalog-select-page',
    barId: 'catalog-selection-bar',
    countId: 'catalog-selection-count',
    contextId: 'catalog-selection-context',
    noun: 'productos seleccionados',
  });
  syncPagedSelectionDom(state.productSelection, ids, { root: $('#catalog-products') });
}

function syncCategorySelection() {
  const ids = (state.categoryInventory.categories || []).map(category => category.id);
  syncSelectionControls(state.categorySelection, ids, {
    pageCheckboxId: 'category-select-page',
    barId: 'category-selection-bar',
    countId: 'category-selection-count',
    contextId: 'category-selection-context',
    noun: 'categorías seleccionadas',
  });
  syncPagedSelectionDom(state.categorySelection, ids, { root: $('#category-tree') });
}

function renderProductList() {
  const container = $('#catalog-products');
  if (!container) return;
  const products = state.catalog.products || [];
  container.replaceChildren();
  if (!products.length) {
    const empty = document.createElement('div');
    empty.className = 'catalog-empty';
    empty.innerHTML = '<strong>No hay productos para estos filtros.</strong><span>Prueba otra búsqueda, categoría o filtro de precio.</span>';
    container.append(empty);
  }
  for (const product of products) {
    const price = latestPrice(product);
    const wrapper = document.createElement('div');
    wrapper.className = 'entity-selection-row';
    wrapper.dataset.selectionId = product.id;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'inventory-product-row inventory-product-grid';
    row.dataset.catalogProductId = product.id;
    const retailers = product.retailerNames?.length || product.latestPrices?.length || 0;
    const updated = Number.isNaN(Date.parse(product.updatedAt)) ? product.updatedAt : DATE_FORMATTER.format(new Date(product.updatedAt));
    row.innerHTML = `<span class="inventory-product-cell inventory-product-cell--name"><strong>${escapeHtml(product.variantName)}</strong><small>${escapeHtml(product.canonicalName)}</small></span><span>${escapeHtml(product.categoryName || 'Sin categoría')}</span><span>${retailers}</span><strong>${price ? escapeHtml(formatEuroMinor(price.priceMinor)) : '—'}</strong><span>${escapeHtml(updated)}</span><span class="inventory-row-action">Ver ficha</span>`;
    row.addEventListener('click', () => void openProductDetail(product.id));
    wrapper.append(selectionCell(state.productSelection, product.id, `Seleccionar ${product.variantName}`, syncProductSelection), row);
    container.append(wrapper);
  }
  const total = Number(state.catalog.total || 0);
  const from = total ? state.catalog.offset + 1 : 0;
  const to = Math.min(state.catalog.offset + products.length, total);
  const pageCount = Math.max(1, Math.ceil(total / PRODUCT_PAGE_SIZE));
  $('#catalog-range').textContent = `${from}-${to} de ${total}`;
  $('#catalog-page').textContent = `${state.productPage} / ${pageCount}`;
  $('#catalog-prev').disabled = state.productPage <= 1;
  $('#catalog-next').disabled = !state.catalog.hasMore;
  syncProductSelection();
}

function renderCategoryList() {
  const container = $('#category-tree');
  if (!container) return;
  const categories = state.categoryInventory.categories || [];
  container.replaceChildren();
  if (!categories.length) {
    const empty = document.createElement('div');
    empty.className = 'catalog-empty';
    empty.innerHTML = '<strong>No hay categorías para estos filtros.</strong><span>Prueba otra búsqueda o crea una nueva categoría.</span>';
    container.append(empty);
  }
  for (const category of categories) {
    const wrapper = document.createElement('div');
    wrapper.className = 'entity-selection-row';
    wrapper.dataset.selectionId = category.id;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'category-row category-list-grid';
    row.dataset.categoryId = category.id;
    const depth = categoryDepth(category.id);
    row.innerHTML = `<span class="category-name-cell">${categoryIndentMarkup(depth)}${categorySwatchMarkup(category.color)}<span><strong>${escapeHtml(category.name)}</strong><small>${escapeHtml(category.description || (category.parentId ? 'Subcategoría' : 'Categoría raíz'))}</small></span></span><strong>${category.productCount}</strong><strong>${category.childCount}</strong><span>${escapeHtml(category.parentName || 'Raíz')}</span><span class="inventory-row-action">Ver detalle</span>`;
    row.addEventListener('click', () => openCategoryDetail(category.id));
    wrapper.append(selectionCell(state.categorySelection, category.id, `Seleccionar categoría ${category.name}`, syncCategorySelection), row);
    container.append(wrapper);
  }
  const total = Number(state.categoryInventory.total || 0);
  const from = total ? state.categoryInventory.offset + 1 : 0;
  const to = Math.min(state.categoryInventory.offset + categories.length, total);
  const pageCount = Math.max(1, Math.ceil(total / CATEGORY_PAGE_SIZE));
  $('#category-range').textContent = `${from}-${to} de ${total}`;
  $('#category-page').textContent = `${state.categoryPage} / ${pageCount}`;
  $('#category-prev').disabled = state.categoryPage <= 1;
  $('#category-next').disabled = !state.categoryInventory.hasMore;
  syncCategorySelection();
}

function renderLatestPrices(product) {
  const container = $('#catalog-latest-prices');
  if (!container) return;
  container.replaceChildren();
  if (!product?.latestPrices?.length) {
    container.innerHTML = '<p class="field-help">Todavía no hay precios confirmados.</p>';
    return;
  }
  for (const entry of product.latestPrices) {
    const row = document.createElement('div');
    row.className = 'catalog-retailer-row';
    const location = entry.storeName ? `${entry.retailerName} · ${entry.storeName}` : entry.retailerName;
    const date = Number.isNaN(Date.parse(entry.observedAt)) ? entry.observedAt : DATE_FORMATTER.format(new Date(entry.observedAt));
    row.innerHTML = `<span><strong>${escapeHtml(location)}</strong><small>${escapeHtml(date)}</small></span><strong>${escapeHtml(formatEuroMinor(entry.priceMinor))}</strong>`;
    container.append(row);
  }
}

function renderPriceHistory(product) {
  const history = Array.isArray(product?.priceHistory) ? product.priceHistory : [];
  const stateElement = $('#catalog-price-history-state');
  const content = $('#catalog-price-history-content');
  const tableBody = $('#catalog-price-history-body');
  const chart = $('#catalog-price-history-chart');
  const line = $('#catalog-price-history-line');
  $('#catalog-price-history-count').textContent = String(history.length);
  tableBody?.replaceChildren();

  if (!history.length) {
    stateElement.textContent = 'Todavía no hay observaciones históricas para este producto.';
    content.hidden = true;
    if (line) line.setAttribute('points', '');
    return;
  }

  const chronological = [...history].sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt) || String(left.id).localeCompare(String(right.id)));
  const values = chronological.map(entry => Number(entry.priceMinor));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(1, maximum - minimum);
  const width = 672;
  const height = 160;
  const points = chronological.map((entry, index) => {
    const x = chronological.length === 1 ? 364 : 28 + (index / (chronological.length - 1)) * width;
    const y = 18 + ((maximum - Number(entry.priceMinor)) / span) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  line?.setAttribute('points', points);
  chart?.setAttribute('aria-label', `Histórico de ${history.length} precios, de ${formatEuroMinor(minimum)} a ${formatEuroMinor(maximum)}`);

  for (const entry of history) {
    const row = document.createElement('tr');
    const observed = Number.isNaN(Date.parse(entry.observedAt)) ? entry.observedAt : DATE_FORMATTER.format(new Date(entry.observedAt));
    const location = entry.storeName
      ? `${entry.retailerName} · ${entry.storeName}`
      : (entry.retailerName || 'Comercio sin nombre');
    row.innerHTML = `<td>${escapeHtml(observed)}</td><td>${escapeHtml(location)}</td><td><strong>${escapeHtml(formatEuroMinor(entry.priceMinor))}</strong></td>`;
    tableBody?.append(row);
  }

  stateElement.textContent = `${history.length} observaciones, de la más reciente a la más antigua.`;
  content.hidden = false;
}

function ticketHistoryLocation(entry) {
  if (entry.storeName && entry.retailerName) return `${entry.retailerName} · ${entry.storeName}`;
  return entry.storeName || entry.retailerName || 'Sin comercio ni tienda';
}

function ticketHistoryDate(value) {
  return Number.isNaN(Date.parse(value)) ? value : DATE_FORMATTER.format(new Date(value));
}

function renderTicketHistory(product) {
  const history = Array.isArray(product?.ticketHistory) ? product.ticketHistory : [];
  const stateElement = $('#catalog-ticket-history-state');
  const content = $('#catalog-ticket-history-content');
  const tableBody = $('#catalog-ticket-history-body');
  $('#catalog-ticket-history-count').textContent = String(history.length);
  tableBody?.replaceChildren();
  if (!history.length) {
    stateElement.textContent = 'Todavía no hay tickets confirmados que contengan este producto.';
    content.hidden = true;
    return;
  }
  for (const entry of history) {
    const row = document.createElement('tr');
    const date = ticketHistoryDate(entry.purchasedAt);
    const location = ticketHistoryLocation(entry);
    const quantity = `${Number(entry.quantity)} ${entry.unit || 'unit'}`;
    const ticketUrl = `/tickets/history/${encodeURIComponent(entry.receiptId)}`;
    row.innerHTML = `<td>${escapeHtml(date)}</td><td>${escapeHtml(location)}</td><td>${escapeHtml(quantity)}</td><td><strong>${escapeHtml(formatEuroMinor(entry.lineTotalMinor))}</strong></td><td><a class="button secondary catalog-ticket-history__open" href="${ticketUrl}" aria-label="Abrir ticket del ${escapeHtml(date)}">Abrir ticket</a></td>`;
    tableBody?.append(row);
  }
  stateElement.textContent = `${history.length} ticket${history.length === 1 ? '' : 's'} confirmado${history.length === 1 ? '' : 's'} con este producto.`;
  content.hidden = false;
}

function renderRetailerNames(product) {
  const container = $('#catalog-retailer-names');
  if (!container) return;
  container.replaceChildren();
  if (!product?.retailerNames?.length) {
    container.innerHTML = '<p class="field-help">Sin nombres específicos por comercio.</p>';
    return;
  }
  for (const entry of product.retailerNames) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'catalog-retailer-row';
    row.innerHTML = `<span><strong>${escapeHtml(entry.retailerName)}</strong><small>${escapeHtml(entry.title)}</small></span><span>Editar</span>`;
    row.addEventListener('click', () => {
      $('#catalog-retailer-name').value = entry.retailerName;
      $('#catalog-retailer-title').value = entry.title;
      showProductEditor(true);
      $('#catalog-retailer-title').focus();
    });
    container.append(row);
  }
}

function renderParents(product) {
  const select = $('#catalog-parent-select');
  if (!select) return;
  select.replaceChildren(new Option('Selecciona un producto padre', ''));
  for (const parent of state.catalog.parents || []) select.append(new Option(`${parent.name} (${parent.variantCount})`, parent.id));
  select.value = product?.canonicalProductId || '';
}

function populateProductForm(product, { creating = false } = {}) {
  $('#catalog-canonical-name').value = product?.canonicalName || '';
  $('#catalog-variant-name').value = product?.variantName || '';
  $('#catalog-brand').value = product?.brand || '';
  $('#catalog-ean').value = product?.ean || '';
  $('#catalog-description').value = product?.description || '';
  $('#catalog-aliases').value = (product?.aliases || []).join('\n');
  $('#catalog-package-minor').value = product?.packageMinor ?? '';
  $('#catalog-package-unit').value = product?.packageUnit || '';
  $('#catalog-category').value = product?.categoryId || '';
  $('#catalog-product-status').textContent = creating ? 'Nuevo' : 'Guardado';
  $('#catalog-product-form-state').textContent = '';
  $('#catalog-parent-state').textContent = '';
  $('#catalog-retailer-state').textContent = '';
  $('#catalog-new-parent-name').value = '';
  $('#catalog-retailer-name').value = '';
  $('#catalog-retailer-title').value = '';
  renderParents(product);
  $('#catalog-existing-relations').hidden = creating;
}

function renderProductDetail(product, { creating = false } = {}) {
  state.productDetail = product || null;
  const title = creating ? 'Nuevo producto' : product.variantName;
  $('#catalog-detail-title').textContent = title;
  $('#catalog-detail-name').textContent = title;
  $('#catalog-detail-meta').textContent = creating ? 'Crea una ficha canónica reutilizable.' : product.canonicalName;
  $('#catalog-detail-category').textContent = product?.categoryName || 'Sin categoría';
  $('#catalog-detail-brand').textContent = product?.brand || '—';
  $('#catalog-detail-ean').textContent = product?.ean || '—';
  $('#catalog-detail-package').textContent = product?.packageMinor ? `${product.packageMinor} ${product.packageUnit || ''}`.trim() : '—';
  $('#catalog-detail-updated').textContent = creating ? 'Sin guardar' : (Number.isNaN(Date.parse(product.updatedAt)) ? product.updatedAt : DATE_FORMATTER.format(new Date(product.updatedAt)));
  $('#catalog-detail-description').textContent = product?.description || 'Sin descripción.';
  $('#catalog-parent-name').textContent = product?.canonicalName || 'Pendiente';
  renderLatestPrices(product);
  renderPriceHistory(product);
  renderTicketHistory(product);
  renderRetailerNames(product);
  populateProductForm(product, { creating });
  $('#catalog-edit-product').hidden = creating;
  $('#catalog-delete-product').hidden = creating;
}

function productFromCanonicalRecord(record, priceHistory = [], ticketHistory = []) {
  return {
    ...record,
    retailerNames: record.retailerNames || [],
    latestPrices: record.latestPrices || [],
    priceHistory: Array.isArray(priceHistory) ? priceHistory : [],
    ticketHistory: Array.isArray(ticketHistory) ? ticketHistory : [],
  };
}

async function fetchProductDetail(productId) {
  const result = await api(`/api/v1/products/${encodeURIComponent(productId)}`);
  return productFromCanonicalRecord(result.product, result.priceHistory, result.ticketHistory);
}

async function openProductDetail(productOrId, { edit = false, historyMode = 'push' } = {}) {
  const productId = typeof productOrId === 'string' ? productOrId : productOrId?.id;
  if (!productId) return;
  $('#catalog-list-screen').hidden = true;
  $('#catalog-detail').hidden = false;
  $('#catalog-detail-title').textContent = 'Cargando producto…';
  $('#catalog-detail-meta').textContent = 'Consultando ficha e histórico.';
  $('#catalog-price-history-state').textContent = 'Cargando histórico…';
  $('#catalog-price-history-content').hidden = true;
  $('#catalog-ticket-history-state').textContent = 'Cargando historial de tickets…';
  $('#catalog-ticket-history-content').hidden = true;
  if (historyMode !== 'none') writeProductRoute(`catalog:${productId}`, { replace: historyMode === 'replace', edit });
  window.scrollTo(0, 0);
  try {
    const product = await fetchProductDetail(productId);
    renderProductDetail(product);
    showProductEditor(edit);
  } catch (error) {
    state.productDetail = null;
    $('#catalog-detail-title').textContent = 'No se pudo abrir el producto';
    $('#catalog-detail-meta').textContent = error.message;
    $('#catalog-price-history-state').textContent = `No se pudo cargar el histórico: ${error.message}`;
    $('#catalog-ticket-history-state').textContent = `No se pudo cargar el historial de tickets: ${error.message}`;
    showProductEditor(false);
  }
}

function startCreateProduct({ historyMode = 'push' } = {}) {
  $('#catalog-list-screen').hidden = true;
  $('#catalog-detail').hidden = false;
  renderProductDetail(null, { creating: true });
  showProductEditor(true);
  if (historyMode !== 'none') writeProductRoute('catalog:new', { replace: historyMode === 'replace' });
  requestAnimationFrame(() => $('#catalog-canonical-name')?.focus());
}

function closeProductDetail() {
  showProductListScreen();
  writeProductRoute('catalog', { replace: true });
  window.scrollTo(0, 0);
  void loadProducts();
}

function showProductEditor(visible) {
  const editor = $('#catalog-editor');
  if (editor) editor.hidden = !visible;
  if (visible) editor.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function populateCategoryForm(category) {
  const creating = !category;
  const protectedFallback = category?.name.toLocaleLowerCase('es-ES') === UNKNOWN_CATEGORY_NAME;
  $('#category-editor-title').textContent = creating ? 'Nueva categoría' : `Editar ${category.name}`;
  $('#category-form-title').textContent = creating ? 'Nueva categoría' : category.name;
  $('#category-name').value = category?.name || '';
  $('#category-name').disabled = protectedFallback;
  $('#category-color').value = normalizedCategoryColor(category?.color);
  $('#category-color-value').textContent = normalizedCategoryColor(category?.color);
  $('#category-description').value = category?.description || '';
  $('#category-parent').disabled = protectedFallback;
  $('#category-add-child').hidden = creating;
  $('#category-form-status').textContent = creating ? 'Nueva' : 'Guardada';
  $('#category-form-state').textContent = '';
  renderCategoryParentOptions(category);
}

async function refreshCategoryImpact(categoryId) {
  const result = await api(`/api/v1/categories/${encodeURIComponent(categoryId)}/delete-impact`);
  const impact = result.impact;
  if (state.selectedCategoryId !== categoryId) return impact;
  $('#category-detail-products').textContent = String(impact.productCount);
  $('#category-detail-children').textContent = String(impact.childCount);
  return impact;
}

function renderCategoryDetail(category) {
  const { byId } = categoryMaps();
  const protectedFallback = category?.name.toLocaleLowerCase('es-ES') === UNKNOWN_CATEGORY_NAME;
  $('#category-form-title').textContent = category?.name || 'Nueva categoría';
  $('#category-detail-name').textContent = category?.name || 'Nueva categoría';
  $('#category-detail-description').textContent = category?.description || 'Sin descripción.';
  $('#category-detail-swatch rect')?.setAttribute('fill', normalizedCategoryColor(category?.color));
  $('#category-detail-products').textContent = '…';
  $('#category-detail-children').textContent = '…';
  $('#category-detail-parent').textContent = category?.parentId ? (byId.get(category.parentId)?.name || 'Categoría no disponible') : 'Raíz';
  $('#category-detail-hierarchy').textContent = category?.parentId ? `${byId.get(category.parentId)?.name || 'Raíz'} → ${category.name}` : 'Categoría raíz';
  $('#category-detail-status').textContent = protectedFallback ? 'Protegida' : 'Activa';
  $('#category-protected-note').hidden = !protectedFallback;
  $('#category-delete').disabled = protectedFallback;
  populateCategoryForm(category);
}

async function openCategoryDetail(categoryId, { edit = false, historyMode = 'push' } = {}) {
  state.selectedCategoryId = categoryId;
  state.categoryCreateParentId = '';
  const category = selectedCategory();
  if (!category) return;
  $('#category-list-screen').hidden = true;
  $('#category-detail').hidden = false;
  $('#category-edit').hidden = false;
  $('#category-delete').hidden = false;
  renderCategoryDetail(category);
  showCategoryEditor(edit);
  if (historyMode !== 'none') writeCategoryRoute(`categories:${categoryId}`, { replace: historyMode === 'replace', edit });
  window.scrollTo(0, 0);
  try {
    await refreshCategoryImpact(categoryId);
  } catch (error) {
    $('#category-detail-products').textContent = '—';
    $('#category-detail-children').textContent = '—';
    $('#category-state').textContent = `No se pudo comprobar el impacto: ${error.message}`;
  }
}

function startCreateCategory(parentId = '', { historyMode = 'push' } = {}) {
  state.selectedCategoryId = '';
  state.categoryCreateParentId = parentId;
  $('#category-list-screen').hidden = true;
  $('#category-detail').hidden = false;
  renderCategoryDetail(undefined);
  populateCategoryForm(undefined);
  showCategoryEditor(true);
  if (parentId) $('#category-parent').value = parentId;
  $('#category-edit').hidden = true;
  $('#category-delete').hidden = true;
  $('#category-detail-products').textContent = '0';
  $('#category-detail-children').textContent = '0';
  if (historyMode !== 'none') writeCategoryRoute('categories:new', { replace: historyMode === 'replace', parentId });
  requestAnimationFrame(() => $('#category-name')?.focus());
}

function closeCategoryDetail() {
  showCategoryListScreen();
  writeCategoryRoute('categories', { replace: true });
  window.scrollTo(0, 0);
  void loadCategoryInventory();
}

function showCategoryEditor(visible) {
  const editor = $('#category-editor');
  if (editor) editor.hidden = !visible;
  if (visible) editor.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function loadCategoryMetadata({ force = false } = {}) {
  if (!force && state.categories.length) return;
  const result = await api('/api/v1/categories');
  state.categories = Array.isArray(result.categories) ? result.categories : [];
  renderCategoryOptions();
}

async function ensureMetadata() {
  const tasks = [];
  if (!state.categories.length) tasks.push(loadCategoryMetadata());
  if (!state.units.length) tasks.push(api('/api/v1/meta').then(result => { state.units = Array.isArray(result.units) ? result.units : []; renderUnitOptions(); }));
  await Promise.all(tasks);
  renderCategoryOptions();
  renderUnitOptions();
}

function productRouteSearchParams({ edit = false } = {}) {
  const params = new URLSearchParams();
  if (state.productQuery) params.set('q', state.productQuery);
  if (state.productCategoryId) params.set('category', state.productCategoryId);
  if (state.productPriceFilter !== 'all') params.set('price', state.productPriceFilter);
  if (state.productSort !== 'name') params.set('sort', state.productSort);
  if (state.productPage > 1) params.set('page', String(state.productPage));
  if (edit) params.set('mode', 'edit');
  return params;
}

function categoryRouteSearchParams({ edit = false, parentId = '' } = {}) {
  const params = new URLSearchParams();
  if (state.categoryQuery) params.set('q', state.categoryQuery);
  if (state.categoryFilter !== 'all') params.set('view', state.categoryFilter);
  if (state.categoryPage > 1) params.set('page', String(state.categoryPage));
  if (edit) params.set('mode', 'edit');
  if (parentId) params.set('parent', parentId);
  return params;
}

function applyProductRouteState(searchParams) {
  state.productPage = readRoutePage(searchParams);
  state.productQuery = readRouteText(searchParams, 'q', { maxLength: 160 });
  state.productCategoryId = readRouteText(searchParams, 'category', { maxLength: 128 });
  state.productPriceFilter = readRouteEnum(searchParams, 'price', PRODUCT_PRICE_FILTERS, 'all');
  state.productSort = readRouteEnum(searchParams, 'sort', PRODUCT_SORTS, 'name');
  if ($('#catalog-search')) $('#catalog-search').value = state.productQuery;
  if ($('#catalog-filter-category')) $('#catalog-filter-category').value = state.productCategoryId;
  if ($('#catalog-filter-price')) $('#catalog-filter-price').value = state.productPriceFilter;
  if ($('#catalog-sort')) $('#catalog-sort').value = state.productSort;
}

function applyCategoryRouteState(searchParams) {
  state.categoryPage = readRoutePage(searchParams);
  state.categoryQuery = readRouteText(searchParams, 'q', { maxLength: 120 });
  state.categoryFilter = readRouteEnum(searchParams, 'view', CATEGORY_FILTERS, 'all');
  if ($('#category-search')) $('#category-search').value = state.categoryQuery;
  if ($('#category-filter')) $('#category-filter').value = state.categoryFilter;
}

function writeProductRoute(route = 'catalog', { replace = false, edit = false } = {}) {
  writeApplicationLocation(route, productRouteSearchParams({ edit }), { replace });
}

function writeCategoryRoute(route = 'categories', { replace = false, edit = false, parentId = '' } = {}) {
  writeApplicationLocation(route, categoryRouteSearchParams({ edit, parentId }), { replace });
}

function showProductListScreen() {
  state.productDetail = null;
  $('#catalog-detail').hidden = true;
  $('#catalog-list-screen').hidden = false;
  $('#catalog-edit-product').hidden = false;
  $('#catalog-delete-product').hidden = false;
  $('#catalog-existing-relations').hidden = false;
}

function showCategoryListScreen() {
  state.selectedCategoryId = '';
  state.categoryCreateParentId = '';
  $('#category-detail').hidden = true;
  $('#category-list-screen').hidden = false;
  $('#category-edit').hidden = false;
  $('#category-delete').hidden = false;
}

function productQueryString() {
  const params = new URLSearchParams({
    q: state.productQuery,
    price: state.productPriceFilter,
    sort: state.productSort,
    limit: String(PRODUCT_PAGE_SIZE),
    offset: String((state.productPage - 1) * PRODUCT_PAGE_SIZE),
  });
  if (state.productCategoryId) params.set('categoryId', state.productCategoryId);
  return params.toString();
}

async function loadProducts({ resetPage = false } = {}) {
  const generation = ++state.loadGeneration;
  state.loadController?.abort();
  const controller = new AbortController();
  state.loadController = controller;
  const searchInput = $('#catalog-search');
  if (searchInput) state.productQuery = searchInput.value.trim();
  if (resetPage) state.productPage = 1;
  $('#catalog-state').textContent = 'Cargando productos…';
  try {
    await ensureMetadata();
    const result = await api(`/api/v1/catalog?${productQueryString()}`, { signal: controller.signal });
    if (generation !== state.loadGeneration) return;
    state.catalog = result.catalog || { products: [], parents: [], total: 0, offset: 0, limit: PRODUCT_PAGE_SIZE, hasMore: false };
    renderProductList();
    $('#catalog-state').textContent = `${state.catalog.total || 0} productos encontrados.`;
  } catch (error) {
    if (error?.name === 'AbortError' || generation !== state.loadGeneration) return;
    $('#catalog-state').textContent = `No se pudieron cargar los productos: ${error.message}`;
  } finally {
    if (generation === state.loadGeneration) state.loadController = null;
  }
}

function categoryQueryString() {
  return new URLSearchParams({
    mode: 'inventory',
    q: state.categoryQuery,
    view: state.categoryFilter,
    limit: String(CATEGORY_PAGE_SIZE),
    offset: String((state.categoryPage - 1) * CATEGORY_PAGE_SIZE),
  }).toString();
}

async function loadCategoryInventory({ resetPage = false } = {}) {
  const generation = ++state.categoryLoadGeneration;
  state.categoryLoadController?.abort();
  const controller = new AbortController();
  state.categoryLoadController = controller;
  if (resetPage) state.categoryPage = 1;
  const searchInput = $('#category-search');
  if (searchInput) state.categoryQuery = searchInput.value.trim();
  $('#category-state').textContent = 'Cargando categorías…';
  try {
    await loadCategoryMetadata();
    const result = await api(`/api/v1/categories?${categoryQueryString()}`, { signal: controller.signal });
    if (generation !== state.categoryLoadGeneration) return;
    state.categoryInventory = result.inventory || { categories: [], total: 0, offset: 0, limit: CATEGORY_PAGE_SIZE, hasMore: false };
    renderCategoryList();
    $('#category-state').textContent = `${state.categoryInventory.total || 0} categorías encontradas.`;
  } catch (error) {
    if (error?.name === 'AbortError' || generation !== state.categoryLoadGeneration) return;
    $('#category-state').textContent = `No se pudieron cargar las categorías: ${error.message}`;
  } finally {
    if (generation === state.categoryLoadGeneration) state.categoryLoadController = null;
  }
}

function optionalText(value) {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function clearProductFieldErrors() {
  for (const fieldId of ['catalog-canonical-name', 'catalog-variant-name', 'catalog-brand', 'catalog-ean', 'catalog-category', 'catalog-description', 'catalog-aliases', 'catalog-package-minor', 'catalog-package-unit']) setFieldFeedback(fieldId, '');
}

function invalidProductPayload(errors) {
  const first = Object.keys(errors)[0];
  for (const [fieldId, message] of Object.entries(errors)) setFieldFeedback(fieldId, message);
  $('#catalog-product-form-state').textContent = 'Revisa los campos marcados antes de guardar.';
  $(`#${first}`)?.focus();
  return undefined;
}

function productPayload() {
  clearProductFieldErrors();
  const canonicalName = $('#catalog-canonical-name').value.trim();
  const variantName = $('#catalog-variant-name').value.trim();
  const ean = optionalText($('#catalog-ean').value);
  const packageRaw = $('#catalog-package-minor').value.trim();
  const packageUnit = optionalText($('#catalog-package-unit').value);
  const errors = {};
  if (!canonicalName) errors['catalog-canonical-name'] = 'Indica el nombre can\u00f3nico.';
  if (!variantName) errors['catalog-variant-name'] = 'Indica el nombre de esta variante.';
  if (ean && !/^\d{8,14}$/u.test(ean)) errors['catalog-ean'] = 'El EAN/GTIN debe contener entre 8 y 14 d\u00edgitos.';
  const packageMinor = packageRaw ? Number(packageRaw) : undefined;
  if (packageRaw && (!Number.isSafeInteger(packageMinor) || packageMinor < 1)) errors['catalog-package-minor'] = 'La cantidad debe ser un entero positivo.';
  if (packageMinor !== undefined && !packageUnit) errors['catalog-package-unit'] = 'Indica la unidad del formato.';
  if (packageUnit && packageMinor === undefined) errors['catalog-package-minor'] = 'Indica la cantidad del formato.';
  if (Object.keys(errors).length) return invalidProductPayload(errors);
  const categoryId = optionalText($('#catalog-category').value);
  const description = optionalText($('#catalog-description').value);
  const brand = optionalText($('#catalog-brand').value);
  return {
    canonicalName,
    variantName,
    ...(categoryId ? { categoryId } : {}),
    ...(description ? { description } : {}),
    ...(brand ? { brand } : {}),
    ...(ean ? { ean } : {}),
    ...(packageMinor !== undefined ? { packageMinor, packageUnit } : {}),
    aliases: $('#catalog-aliases').value.split('\n').map(value => value.trim()).filter(Boolean),
  };
}

function catalogFieldIdFromValidationDetails(details) {
  const candidates = [];
  const collect = value => {
    if (typeof value === 'string') candidates.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      for (const key of ['path', 'field', 'details', 'errors']) collect(value[key]);
    }
  };
  collect(details);
  const fields = {
    canonicalName: 'catalog-canonical-name', variantName: 'catalog-variant-name', brand: 'catalog-brand', ean: 'catalog-ean',
    categoryId: 'catalog-category', description: 'catalog-description', aliases: 'catalog-aliases', packageMinor: 'catalog-package-minor', packageUnit: 'catalog-package-unit',
  };
  for (const candidate of candidates) {
    const field = String(candidate).split(/[.[]/u).filter(Boolean).at(-1)?.replace(/\]/gu, '');
    if (field && fields[field]) return fields[field];
  }
  return undefined;
}

async function saveProduct(button) {
  const current = state.productDetail;
  setBusy(button, true);
  $('#catalog-product-status').textContent = current ? 'Guardando…' : 'Creando…';
  try {
    const payload = productPayload();
    if (!payload) {
      $('#catalog-product-status').textContent = 'Revisar';
      return;
    }
    const result = await api(current ? `/api/v1/products/${encodeURIComponent(current.id)}` : '/api/v1/products', {
      method: current ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });
    const saved = productFromCanonicalRecord(result.product, current?.priceHistory ?? []);
    state.productDetail = saved;
    $('#catalog-product-form-state').textContent = current ? 'Ficha guardada.' : 'Producto creado.';
    $('#catalog-product-status').textContent = 'Guardado';
    renderProductDetail(saved);
    showProductEditor(false);
    writeProductRoute(`catalog:${saved.id}`, { replace: true });
    void loadProducts();
  } catch (error) {
    const fieldId = catalogFieldIdFromValidationDetails(error?.details);
    if (fieldId) {
      setFieldFeedback(fieldId, error.message || 'Revisa este campo.');
      $(`#${fieldId}`)?.focus();
      $('#catalog-product-form-state').textContent = 'Revisa el campo marcado antes de guardar.';
    } else {
      $('#catalog-product-form-state').textContent = 'No se pudo guardar la ficha. Revisa los campos e int\u00e9ntalo de nuevo.';
    }
    $('#catalog-product-status').textContent = 'Revisar';
  } finally {
    setBusy(button, false);
  }
}

async function saveCategory(button) {
  const current = selectedCategory();
  const saveRoute = `${location.pathname}${location.search}`;
  const name = $('#category-name').value.trim();
  const parentId = $('#category-parent').value || null;
  const color = normalizedCategoryColor($('#category-color').value);
  const description = optionalText($('#category-description').value);
  if (!name) {
    $('#category-form-state').textContent = 'El nombre es obligatorio.';
    $('#category-name').focus();
    return;
  }
  setBusy(button, true);
  $('#category-form-status').textContent = 'Guardando…';
  try {
    const result = await api(current ? `/api/v1/categories/${encodeURIComponent(current.id)}` : '/api/v1/categories', {
      method: current ? 'PATCH' : 'POST',
      body: JSON.stringify({ name, parentId, color, description }),
    });
    const savedId = result.category?.id;
    await loadCategoryMetadata({ force: true });
    await loadCategoryInventory();
    if (`${location.pathname}${location.search}` !== saveRoute) return;
    if (savedId) await openCategoryDetail(savedId, { historyMode: 'replace' });
    $('#category-form-status').textContent = 'Guardada';
    $('#category-form-state').textContent = current ? 'Categoría actualizada.' : 'Categoría creada.';
    showCategoryEditor(false);
  } catch (error) {
    $('#category-form-status').textContent = 'Revisar';
    $('#category-form-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function linkSelectedParent(button) {
  const product = state.productDetail;
  const canonicalProductId = $('#catalog-parent-select').value;
  if (!product || !canonicalProductId) {
    $('#catalog-parent-state').textContent = 'Selecciona un producto padre.';
    return;
  }
  setBusy(button, true);
  try {
    await api(`/api/v1/catalog/products/${encodeURIComponent(product.id)}/parent`, { method: 'PUT', body: JSON.stringify({ canonicalProductId }) });
    const parent = state.catalog.parents.find(candidate => candidate.id === canonicalProductId);
    state.productDetail = { ...product, canonicalProductId, ...(parent?.name ? { canonicalName: parent.name } : {}) };
    $('#catalog-parent-state').textContent = 'Producto padre actualizado.';
    renderProductDetail(state.productDetail);
    showProductEditor(true);
    void loadProducts();
  } catch (error) {
    $('#catalog-parent-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function createParentForSelected(button) {
  const product = state.productDetail;
  const newParentName = $('#catalog-new-parent-name').value.trim();
  if (!product || !newParentName) {
    $('#catalog-parent-state').textContent = 'Escribe el nombre del nuevo producto padre.';
    return;
  }
  setBusy(button, true);
  try {
    const result = await api(`/api/v1/catalog/products/${encodeURIComponent(product.id)}/parent`, { method: 'PUT', body: JSON.stringify({ newParentName }) });
    state.productDetail = { ...product, canonicalProductId: result.relation.canonicalProductId, canonicalName: newParentName };
    $('#catalog-parent-state').textContent = 'Producto padre creado y relacionado.';
    renderProductDetail(state.productDetail);
    showProductEditor(true);
    void loadProducts();
  } catch (error) {
    $('#catalog-parent-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function saveRetailerName(button) {
  const product = state.productDetail;
  const retailerName = $('#catalog-retailer-name').value.trim();
  const title = $('#catalog-retailer-title').value.trim();
  if (!product || !retailerName || !title) {
    $('#catalog-retailer-state').textContent = 'Indica el comercio y el nombre usado allí.';
    return;
  }
  setBusy(button, true);
  try {
    const result = await api(`/api/v1/catalog/products/${encodeURIComponent(product.id)}/retailer-name`, { method: 'PUT', body: JSON.stringify({ retailerName, title }) });
    const existing = (product.retailerNames || []).filter(entry => entry.retailerId !== result.retailerName.retailerId);
    state.productDetail = { ...product, retailerNames: [...existing, result.retailerName] };
    $('#catalog-retailer-state').textContent = 'Nombre del comercio guardado.';
    renderRetailerNames(state.productDetail);
    showProductEditor(true);
    void loadProducts();
  } catch (error) {
    $('#catalog-retailer-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function openProductDeleteDialog() {
  state.bulkProductDeleteIds = [];
  const product = state.productDetail;
  if (!product) return;
  const dialog = $('#catalog-delete-dialog');
  const confirm = $('#catalog-delete-confirm');
  confirm.disabled = true;
  $('#catalog-delete-impact').textContent = 'Comprobando tickets, listas y precios…';
  $('#catalog-delete-state').textContent = '';
  dialog.showModal();
  try {
    const { impact } = await api(`/api/v1/catalog/products/${encodeURIComponent(product.id)}/delete-impact`);
    $('#catalog-delete-impact').textContent = `${product.variantName} tiene ${impact.receiptItems} líneas de ticket, ${impact.shoppingListItems} líneas en listas, ${impact.priceObservations} precios históricos y ${impact.linkedStores} tiendas enlazadas.`;
    $('#catalog-delete-state').textContent = impact.canDelete ? 'No hay dependencias históricas que bloqueen el borrado.' : 'El producto no se puede eliminar mientras tenga dependencias históricas o activas.';
    confirm.disabled = !impact.canDelete;
  } catch (error) {
    $('#catalog-delete-state').textContent = error.message;
  }
}

async function openProductBulkDeleteDialog() {
  const ids = state.productSelection.values();
  if (!ids.length) return;
  state.bulkProductDeleteIds = ids;
  const dialog = $('#catalog-delete-dialog');
  const confirm = $('#catalog-delete-confirm');
  confirm.disabled = true;
  $('#catalog-delete-impact').textContent = `Comprobando ${ids.length} productos seleccionados…`;
  $('#catalog-delete-state').textContent = '';
  dialog.showModal();
  try {
    const { impact } = await api('/api/v1/catalog/products/bulk-delete-impact', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
    if (impact.canDelete) {
      $('#catalog-delete-impact').textContent = `${ids.length} productos no tienen tickets, listas ni precios históricos dependientes.`;
      $('#catalog-delete-state').textContent = 'El lote se eliminará en una sola transacción.';
      confirm.disabled = false;
      return;
    }
    const blockedIds = (impact.blocked || []).map(entry => entry.id);
    $('#catalog-delete-impact').textContent = `${blockedIds.length} de ${ids.length} productos están bloqueados por dependencias históricas o activas.`;
    $('#catalog-delete-state').textContent = `Bloqueados: ${blockedIds.join(', ')}. Ningún producto se eliminará hasta resolver todas las dependencias.`;
  } catch (error) {
    $('#catalog-delete-state').textContent = error.message;
  }
}

async function confirmProductDelete(button) {
  const bulkIds = state.bulkProductDeleteIds;
  const product = state.productDetail;
  if (!bulkIds.length && !product) return;
  setBusy(button, true);
  try {
    if (bulkIds.length) {
      const result = await api('/api/v1/catalog/products/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: bulkIds }),
      });
      for (const id of result.deletedIds || bulkIds) state.productSelection.set(id, false);
      state.bulkProductDeleteIds = [];
      $('#catalog-delete-dialog').close();
      await loadProducts();
      syncProductSelection();
      $('#catalog-state').textContent = `${bulkIds.length} productos eliminados.`;
      return;
    }
    await api(`/api/v1/catalog/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' });
    $('#catalog-delete-dialog').close();
    closeProductDetail();
    $('#catalog-state').textContent = 'Producto eliminado.';
  } catch (error) {
    $('#catalog-delete-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function openCategoryDeleteDialog() {
  const category = selectedCategory();
  if (!category) return;
  const dialog = $('#category-delete-dialog');
  const confirm = $('#category-delete-confirm');
  confirm.disabled = true;
  $('#category-delete-impact').textContent = 'Comprobando productos y subcategorías…';
  $('#category-delete-state').textContent = '';
  dialog.showModal();
  try {
    const { impact } = await api(`/api/v1/categories/${encodeURIComponent(category.id)}/delete-impact`);
    $('#category-delete-impact').textContent = `${category.name} tiene ${impact.productCount} productos directos, ${impact.childCount} subcategorías directas, ${impact.descendantCategoryCount} descendientes y ${impact.descendantProductCount} productos dentro de descendientes.`;
    $('#category-delete-state').textContent = impact.protected ? 'La categoría desconocido está protegida.' : impact.canDelete ? 'La categoría está vacía y se puede eliminar.' : 'Mueve o elimina primero los productos y subcategorías dependientes.';
    confirm.disabled = !impact.canDelete;
  } catch (error) {
    $('#category-delete-state').textContent = error.message;
  }
}

async function confirmCategoryDelete(button) {
  const category = selectedCategory();
  if (!category) return;
  setBusy(button, true);
  try {
    await api(`/api/v1/categories/${encodeURIComponent(category.id)}`, { method: 'DELETE' });
    $('#category-delete-dialog').close();
    closeCategoryDetail();
    await loadCategoryMetadata({ force: true });
    await loadCategoryInventory();
    $('#category-state').textContent = 'Categoría eliminada.';
  } catch (error) {
    $('#category-delete-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function bindInteractions() {
  document.querySelectorAll('[data-catalog-nav="inventory"]').forEach(button => button.addEventListener('click', goInventory));
  $('#catalog-back-list').addEventListener('click', closeProductDetail);
  $('#categories-back-list').addEventListener('click', closeCategoryDetail);
  $('#catalog-edit-product').addEventListener('click', () => {
    showProductEditor(true);
    if (state.productDetail) writeProductRoute(`catalog:${state.productDetail.id}`, { edit: true });
  });
  $('#catalog-cancel-edit').addEventListener('click', () => {
    if (!state.productDetail) return closeProductDetail();
    showProductEditor(false);
    writeProductRoute(`catalog:${state.productDetail.id}`, { replace: true });
  });
  $('#catalog-delete-product').addEventListener('click', () => void openProductDeleteDialog());
  $('#catalog-delete-cancel').addEventListener('click', () => $('#catalog-delete-dialog').close());
  $('#catalog-delete-confirm').addEventListener('click', event => void confirmProductDelete(event.currentTarget));
  $('#category-edit').addEventListener('click', () => {
    const category = selectedCategory();
    if (!category) return;
    showCategoryEditor(true);
    writeCategoryRoute(`categories:${category.id}`, { edit: true });
  });
  $('#category-cancel-edit').addEventListener('click', () => {
    const category = selectedCategory();
    if (!category) return closeCategoryDetail();
    showCategoryEditor(false);
    writeCategoryRoute(`categories:${category.id}`, { replace: true });
  });
  $('#category-delete').addEventListener('click', () => void openCategoryDeleteDialog());
  $('#category-delete-cancel').addEventListener('click', () => $('#category-delete-dialog').close());
  $('#category-delete-confirm').addEventListener('click', event => void confirmCategoryDelete(event.currentTarget));
  $('#category-new').addEventListener('click', () => startCreateCategory());
  $('#category-add-child').addEventListener('click', () => { const category = selectedCategory(); if (category) startCreateCategory(category.id); });
  $('#catalog-new-product').addEventListener('click', startCreateProduct);
  $('#catalog-product-form').addEventListener('submit', event => { event.preventDefault(); void saveProduct($('#catalog-save-product')); });
  $('#catalog-product-form').addEventListener('input', event => {
    const fieldId = event.target?.id;
    if (fieldId) setFieldFeedback(fieldId, '');
    $('#catalog-product-form-state').textContent = '';
  });
  $('#category-form').addEventListener('submit', event => { event.preventDefault(); void saveCategory($('#category-save')); });
  $('#catalog-link-parent').addEventListener('click', event => void linkSelectedParent(event.currentTarget));
  $('#catalog-create-parent').addEventListener('click', event => void createParentForSelected(event.currentTarget));
  $('#catalog-save-retailer-name').addEventListener('click', event => void saveRetailerName(event.currentTarget));
  $('#category-color').addEventListener('input', event => { $('#category-color-value').textContent = normalizedCategoryColor(event.currentTarget.value); });
  $('#catalog-search').addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      state.productQuery = $('#catalog-search').value.trim();
      state.productPage = 1;
      writeProductRoute('catalog', { replace: true });
      void loadProducts();
    }, SEARCH_DELAY_MS);
  });
  $('#catalog-filter-category').addEventListener('change', event => {
    state.productCategoryId = event.currentTarget.value;
    state.productPage = 1;
    writeProductRoute();
    void loadProducts();
  });
  $('#catalog-filter-price').addEventListener('change', event => {
    state.productPriceFilter = event.currentTarget.value;
    state.productPage = 1;
    writeProductRoute();
    void loadProducts();
  });
  $('#catalog-sort').addEventListener('change', event => {
    state.productSort = event.currentTarget.value;
    state.productPage = 1;
    writeProductRoute();
    void loadProducts();
  });
  $('#catalog-clear-filters').addEventListener('click', () => {
    $('#catalog-search').value = '';
    $('#catalog-filter-category').value = '';
    $('#catalog-filter-price').value = 'all';
    $('#catalog-sort').value = 'name';
    state.productQuery = '';
    state.productCategoryId = '';
    state.productPriceFilter = 'all';
    state.productSort = 'name';
    state.productPage = 1;
    writeProductRoute();
    void loadProducts();
  });
  $('#catalog-select-page').addEventListener('change', event => {
    state.productSelection.setPage((state.catalog.products || []).map(product => product.id), event.currentTarget.checked);
    syncProductSelection();
  });
  $('#catalog-selection-clear').addEventListener('click', () => {
    state.productSelection.clear();
    syncProductSelection();
  });
  $('#catalog-selection-delete').addEventListener('click', () => void openProductBulkDeleteDialog());
  $('#catalog-prev').addEventListener('click', () => {
    if (state.productPage <= 1) return;
    state.productPage -= 1;
    writeProductRoute();
    void loadProducts();
    window.scrollTo(0, 0);
  });
  $('#catalog-next').addEventListener('click', () => {
    if (!state.catalog.hasMore) return;
    state.productPage += 1;
    writeProductRoute();
    void loadProducts();
    window.scrollTo(0, 0);
  });
  $('#category-search').addEventListener('input', () => {
    clearTimeout(state.categorySearchTimer);
    state.categorySearchTimer = setTimeout(() => {
      state.categoryQuery = $('#category-search').value.trim();
      state.categoryPage = 1;
      writeCategoryRoute('categories', { replace: true });
      void loadCategoryInventory();
    }, SEARCH_DELAY_MS);
  });
  $('#category-filter').addEventListener('change', event => {
    state.categoryFilter = event.currentTarget.value;
    state.categoryPage = 1;
    writeCategoryRoute();
    void loadCategoryInventory();
  });
  $('#category-clear-filters').addEventListener('click', () => {
    $('#category-search').value = '';
    $('#category-filter').value = 'all';
    state.categoryQuery = '';
    state.categoryFilter = 'all';
    state.categoryPage = 1;
    writeCategoryRoute();
    void loadCategoryInventory();
  });
  $('#category-select-page').addEventListener('change', event => {
    state.categorySelection.setPage((state.categoryInventory.categories || []).map(category => category.id), event.currentTarget.checked);
    syncCategorySelection();
  });
  $('#category-selection-clear').addEventListener('click', () => {
    state.categorySelection.clear();
    syncCategorySelection();
  });
  $('#category-prev').addEventListener('click', () => {
    if (state.categoryPage <= 1) return;
    state.categoryPage -= 1;
    writeCategoryRoute();
    void loadCategoryInventory();
    window.scrollTo(0, 0);
  });
  $('#category-next').addEventListener('click', () => {
    if (!state.categoryInventory.hasMore) return;
    state.categoryPage += 1;
    writeCategoryRoute();
    void loadCategoryInventory();
    window.scrollTo(0, 0);
  });
}

async function openRequestedProduct(requested, searchParams) {
  if (requested === 'catalog:new') {
    startCreateProduct({ historyMode: 'none' });
    return;
  }
  if (!requested.startsWith('catalog:')) return;
  const productId = requested.slice('catalog:'.length);
  try {
    await openProductDetail(productId, {
      edit: searchParams.get('mode') === 'edit',
      historyMode: 'none',
    });
  } catch (error) {
    $('#catalog-state').textContent = `No se pudo abrir el producto: ${error.message}`;
  }
}

async function openRequestedCategory(requested, searchParams) {
  if (requested === 'categories:new') {
    const parentId = readRouteText(searchParams, 'parent', { maxLength: 128 });
    startCreateCategory(parentId, { historyMode: 'none' });
    return;
  }
  if (!requested.startsWith('categories:')) return;
  try {
    await openCategoryDetail(requested.slice('categories:'.length), {
      edit: searchParams.get('mode') === 'edit',
      historyMode: 'none',
    });
  } catch (error) {
    $('#category-state').textContent = `No se pudo abrir la categoría: ${error.message}`;
  }
}

async function activateCatalog(requested = 'catalog', searchParams = new URLSearchParams()) {
  if (!activateFeatureView('catalog', { dispatch: false })) return;
  applyProductRouteState(searchParams);
  showProductListScreen();
  await loadProducts();
  await openRequestedProduct(requested, searchParams);
}

async function activateCategories(requested = 'categories', searchParams = new URLSearchParams()) {
  if (!activateFeatureView('categories', { dispatch: false })) return;
  applyCategoryRouteState(searchParams);
  showCategoryListScreen();
  await loadCategoryInventory();
  await openRequestedCategory(requested, searchParams);
}

function handleViewChanged(event) {
  const view = String(event.detail?.view || '');
  const route = String(event.detail?.route || view);
  const searchParams = event.detail?.searchParams instanceof URLSearchParams
    ? event.detail.searchParams
    : new URLSearchParams();
  if (view === 'catalog') void activateCatalog(route, searchParams);
  else state.loadController?.abort();
  if (view === 'categories') void activateCategories(route, searchParams);
  else state.categoryLoadController?.abort();
  if (view === 'catalog' || view === 'categories') document.querySelector('.bottom-nav [data-nav="inventory"]')?.setAttribute('aria-current', 'page');
}

export function initializeCatalogFeature({ activate = false, activateCategoryView = false } = {}) {
  if (!state.initialized) {
    state.initialized = true;
    injectStylesheet();
    installCatalogView();
    installCategoryView();
    bindInteractions();
    document.addEventListener('basketra:view-changed', handleViewChanged);
  }
  const current = readApplicationLocation();
  if (activateCategoryView) void activateCategories(current.route, current.searchParams);
  else if (activate) void activateCatalog(current.route, current.searchParams);
}

function autoInitializeCatalogFeature() {
  const current = readApplicationLocation();
  initializeCatalogFeature({
    activate: current.route === 'catalog' || current.route.startsWith('catalog:'),
    activateCategoryView: current.route === 'categories' || current.route.startsWith('categories:'),
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInitializeCatalogFeature, { once: true });
else autoInitializeCatalogFeature();
