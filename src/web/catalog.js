import { api, setBusy } from './api.js';
import { escapeHtml, formatEuroMinor, hydrateIcons } from './ui.js';

const API_PAGE_SIZE = 100;
const UI_PAGE_SIZE = 12;
const CATEGORY_PAGE_SIZE = 12;
const SEARCH_DELAY_MS = 250;
const UNKNOWN_CATEGORY_NAME = 'desconocido';
const DEFAULT_CATEGORY_COLOR = '#64748B';
const DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' });

const $ = selector => document.querySelector(selector);

const state = {
  initialized: false,
  allProducts: [],
  parents: [],
  categories: [],
  units: [],
  productPage: 1,
  categoryPage: 1,
  selectedProductId: '',
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
        <div>
          <p class="eyebrow">Inventario · Productos</p>
          <h1 id="catalog-page-title">Productos</h1>
          <p>Consulta, filtra y abre cada ficha sin mezclar el listado con el editor.</p>
        </div>
        <div class="inventory-header-actions">${inventoryBackButton()}<button id="catalog-new-product" class="button primary" type="button"><span data-icon="plus"></span>Nuevo producto</button></div>
      </header>

      <section class="surface inventory-toolbar" aria-label="Filtros del catálogo">
        <label class="field inventory-search-field"><span>Buscar</span><input id="catalog-search" type="search" maxlength="160" autocomplete="off" placeholder="Nombre, marca, alias o comercio"></label>
        <label class="field"><span>Categoría</span><select id="catalog-filter-category"><option value="">Todas</option></select></label>
        <label class="field"><span>Precio</span><select id="catalog-filter-price"><option value="all">Todos</option><option value="with-price">Con precio</option><option value="without-price">Sin precio</option></select></label>
        <label class="field"><span>Orden</span><select id="catalog-sort"><option value="name">Nombre A-Z</option><option value="recent">Actualizados recientemente</option><option value="price-desc">Precio más alto</option><option value="price-asc">Precio más bajo</option></select></label>
        <button id="catalog-clear-filters" class="button secondary" type="button">Limpiar filtros</button>
      </section>

      <p id="catalog-state" class="inline-status" role="status" aria-live="polite"></p>
      <section class="surface inventory-list-surface" aria-label="Listado de productos">
        <div class="inventory-list-heading inventory-product-grid" aria-hidden="true">
          <span>Producto</span><span>Categoría</span><span>Comercios</span><span>Precio reciente</span><span>Actualizado</span><span></span>
        </div>
        <div id="catalog-products" class="inventory-product-list" aria-live="polite"></div>
        <footer class="inventory-pagination" aria-label="Paginación de productos">
          <span id="catalog-range">0 resultados</span>
          <div><button id="catalog-prev" class="button secondary" type="button">Anterior</button><span id="catalog-page" class="count-badge">1</span><button id="catalog-next" class="button secondary" type="button">Siguiente</button></div>
        </footer>
      </section>
    </section>

    <section id="catalog-detail" class="inventory-detail-screen" aria-labelledby="catalog-detail-title" hidden>
      <header class="inventory-detail-header">
        <button id="catalog-back-list" class="button secondary" type="button"><span data-icon="chevronUp" class="icon-rotate-left"></span>Productos</button>
        <div class="inventory-detail-header__copy"><p class="eyebrow">Producto</p><h1 id="catalog-detail-title">Detalle de producto</h1><p id="catalog-detail-meta"></p></div>
        <div class="inventory-header-actions"><button id="catalog-edit-product" class="button secondary" type="button"><span data-icon="edit"></span>Editar</button><button id="catalog-delete-product" class="button danger" type="button"><span data-icon="trash"></span>Eliminar</button></div>
      </header>

      <div class="inventory-detail-grid">
        <section class="surface inventory-detail-primary">
          <div class="inventory-product-identity"><span class="inventory-product-avatar" data-icon="store"></span><div><p class="eyebrow">Ficha reutilizable</p><h2 id="catalog-detail-name">—</h2><p id="catalog-detail-category">Sin categoría</p></div></div>
          <dl class="inventory-definition-grid">
            <div><dt>Marca</dt><dd id="catalog-detail-brand">—</dd></div>
            <div><dt>EAN/GTIN</dt><dd id="catalog-detail-ean">—</dd></div>
            <div><dt>Formato</dt><dd id="catalog-detail-package">—</dd></div>
            <div><dt>Actualizado</dt><dd id="catalog-detail-updated">—</dd></div>
          </dl>
          <section><p class="eyebrow">Descripción</p><p id="catalog-detail-description">Sin descripción.</p></section>
        </section>

        <aside class="inventory-detail-aside">
          <section class="surface"><div class="section-header"><div><p class="eyebrow">Producto padre</p><h2 id="catalog-parent-name">—</h2></div></div><p>Las variantes comparten nombre canónico, categoría y descripción.</p></section>
          <section class="surface"><div class="section-header"><div><p class="eyebrow">Precios</p><h2>Últimas observaciones</h2></div></div><div id="catalog-latest-prices" class="catalog-retailer-names" aria-live="polite"></div></section>
          <section class="surface"><div class="section-header"><div><p class="eyebrow">Comercios</p><h2>Nombres asociados</h2></div></div><div id="catalog-retailer-names" class="catalog-retailer-names" aria-live="polite"></div></section>
        </aside>
      </div>

      <section id="catalog-editor" class="surface inventory-editor" aria-labelledby="catalog-editor-title" hidden>
        <div class="section-header"><div><p class="eyebrow">Edición</p><h2 id="catalog-editor-title">Editar producto</h2></div><span id="catalog-product-status" class="status-pill">Guardado</span></div>
        <form id="catalog-product-form" class="catalog-form">
          <label class="field"><span>Nombre canónico</span><input id="catalog-canonical-name" maxlength="160" required></label>
          <label class="field"><span>Nombre de esta variante</span><input id="catalog-variant-name" maxlength="160" required></label>
          <div class="quantity-row"><label class="field"><span>Marca</span><input id="catalog-brand" maxlength="120"></label><label class="field"><span>EAN/GTIN</span><input id="catalog-ean" maxlength="14" inputmode="numeric"></label></div>
          <label class="field"><span>Categoría</span><select id="catalog-category"><option value="">Sin categoría</option></select></label>
          <label class="field"><span>Descripción</span><textarea id="catalog-description" maxlength="500" rows="3"></textarea></label>
          <label class="field"><span>Alias de búsqueda, uno por línea</span><textarea id="catalog-aliases" maxlength="1000" rows="3"></textarea></label>
          <div class="quantity-row"><label class="field"><span>Cantidad del formato</span><input id="catalog-package-minor" type="number" min="1" max="100000000" inputmode="numeric"></label><label class="field"><span>Unidad</span><select id="catalog-package-unit"><option value="">Sin formato</option></select></label></div>
          <div class="dialog-actions"><button id="catalog-cancel-edit" class="button secondary" type="button">Cancelar</button><button id="catalog-save-product" class="button primary" type="submit"><span data-icon="check"></span>Guardar ficha</button></div>
          <p id="catalog-product-form-state" class="inline-status" role="status"></p>
        </form>
        <hr>
        <div class="inventory-editor-columns">
          <fieldset class="flow-group"><legend>Producto padre</legend><label class="field"><span>Padre existente</span><select id="catalog-parent-select"><option value="">Selecciona un producto padre</option></select></label><button id="catalog-link-parent" class="button secondary full" type="button">Relacionar con el padre elegido</button><label class="field"><span>Nuevo padre</span><input id="catalog-new-parent-name" maxlength="160" autocomplete="off"></label><button id="catalog-create-parent" class="button secondary full" type="button"><span data-icon="plus"></span>Crear padre y relacionar</button><p id="catalog-parent-state" class="inline-status" role="status"></p></fieldset>
          <fieldset class="flow-group"><legend>Nombre por comercio</legend><label class="field"><span>Comercio</span><input id="catalog-retailer-name" maxlength="160" autocomplete="organization"></label><label class="field"><span>Nombre en comercio</span><input id="catalog-retailer-title" maxlength="240"></label><button id="catalog-save-retailer-name" class="button secondary full" type="button">Guardar nombre del comercio</button><p id="catalog-retailer-state" class="inline-status" role="status"></p></fieldset>
        </div>
      </section>

      <dialog id="catalog-delete-dialog" class="confirm-dialog" aria-labelledby="catalog-delete-title">
        <div class="dialog-content"><span class="dialog-icon" data-icon="alert"></span><h2 id="catalog-delete-title">Eliminar producto</h2><p id="catalog-delete-impact">Comprobando dependencias…</p><p class="inline-status" role="status" id="catalog-delete-state"></p><div class="dialog-actions"><button id="catalog-delete-cancel" class="button secondary" type="button">Cancelar</button><button id="catalog-delete-confirm" class="button danger" type="button" disabled>Eliminar producto</button></div></div>
      </dialog>
    </section>`;
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
      <section class="surface inventory-list-surface"><div class="inventory-list-heading category-list-grid" aria-hidden="true"><span>Nombre</span><span>Productos</span><span>Subcategorías</span><span>Padre</span><span></span></div><div id="category-tree" class="category-tree" aria-live="polite"></div><footer class="inventory-pagination"><span id="category-range">0 resultados</span><div><button id="category-prev" class="button secondary" type="button">Anterior</button><span id="category-page" class="count-badge">1</span><button id="category-next" class="button secondary" type="button">Siguiente</button></div></footer></section>
    </section>

    <section id="category-detail" class="inventory-detail-screen" aria-labelledby="category-form-title" hidden>
      <header class="inventory-detail-header"><button id="categories-back-list" class="button secondary" type="button"><span data-icon="chevronUp" class="icon-rotate-left"></span>Categorías</button><div class="inventory-detail-header__copy"><p class="eyebrow">Categoría</p><h1 id="category-form-title">Nueva categoría</h1><p id="category-detail-hierarchy">Categoría raíz</p></div><div class="inventory-header-actions"><button id="category-edit" class="button secondary" type="button"><span data-icon="edit"></span>Editar</button><button id="category-delete" class="button danger" type="button"><span data-icon="trash"></span>Eliminar</button></div></header>
      <div class="inventory-detail-grid"><section class="surface inventory-detail-primary"><div class="inventory-category-identity"><span id="category-detail-swatch" class="category-swatch" aria-hidden="true"></span><div><p class="eyebrow">Información general</p><h2 id="category-detail-name">Nueva categoría</h2><p id="category-detail-description">Sin descripción.</p></div></div><dl class="inventory-definition-grid"><div><dt>Productos directos</dt><dd id="category-detail-products">0</dd></div><div><dt>Subcategorías</dt><dd id="category-detail-children">0</dd></div><div><dt>Padre</dt><dd id="category-detail-parent">Raíz</dd></div><div><dt>Estado</dt><dd id="category-detail-status">Activa</dd></div></dl><div id="category-protected-note" class="catalog-shared-note" role="note" hidden><strong>Categoría protegida</strong><span>desconocido es el fallback canónico y no puede eliminarse ni moverse.</span></div></section></div>
      <section id="category-editor" class="surface inventory-editor" aria-labelledby="category-editor-title" hidden><div class="section-header"><div><p class="eyebrow">Edición</p><h2 id="category-editor-title">Editar categoría</h2></div><span id="category-form-status" class="status-pill">Guardada</span></div><form id="category-form" class="category-form"><label class="field"><span>Nombre</span><input id="category-name" maxlength="120" autocomplete="off" required></label><label class="field"><span>Categoría padre</span><select id="category-parent"><option value="">Sin padre · categoría raíz</option></select></label><label class="field category-color-field"><span>Color</span><span class="category-color-control"><input id="category-color" type="color" value="${DEFAULT_CATEGORY_COLOR}" aria-label="Color de la categoría"><output id="category-color-value">${DEFAULT_CATEGORY_COLOR}</output></span></label><label class="field"><span>Descripción opcional</span><textarea id="category-description" maxlength="500" rows="4"></textarea></label><div class="dialog-actions"><button id="category-cancel-edit" class="button secondary" type="button">Cancelar</button><button id="category-save" class="button primary" type="submit"><span data-icon="check"></span>Guardar categoría</button></div><button id="category-add-child" class="button secondary full" type="button" hidden><span data-icon="plus"></span>Añadir subcategoría</button><p id="category-form-state" class="inline-status" role="status"></p></form></section>
      <dialog id="category-delete-dialog" class="confirm-dialog" aria-labelledby="category-delete-title"><div class="dialog-content"><span class="dialog-icon" data-icon="alert"></span><h2 id="category-delete-title">Eliminar categoría</h2><p id="category-delete-impact">Comprobando productos y subcategorías…</p><p id="category-delete-state" class="inline-status" role="status"></p><div class="dialog-actions"><button id="category-delete-cancel" class="button secondary" type="button">Cancelar</button><button id="category-delete-confirm" class="button danger" type="button" disabled>Eliminar categoría</button></div></div></dialog>
    </section>`;
  main.append(view);
  hydrateIcons(view);
}

function activateFeatureView(viewName) {
  const view = document.querySelector(`.view[data-view="${CSS.escape(viewName)}"]`);
  if (!view) return false;
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element === view));
  document.querySelectorAll('.bottom-nav [data-nav]').forEach(element => element.removeAttribute('aria-current'));
  document.querySelector('.bottom-nav [data-nav="inventory"]')?.setAttribute('aria-current', 'page');
  history.replaceState(null, '', `#${viewName}`);
  document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: viewName } }));
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

function selectedProduct() {
  return state.allProducts.find(product => product.id === state.selectedProductId);
}

function selectedCategory() {
  return state.categories.find(category => category.id === state.selectedCategoryId);
}

function normalizedCategoryColor(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/u.test(normalized) ? normalized : DEFAULT_CATEGORY_COLOR;
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
  const roots = categories.filter(category => !category.parentId || !byId.has(category.parentId));
  const entries = [];
  const visited = new Set();
  const visit = (category, depth) => {
    if (visited.has(category.id) || !categories.some(candidate => candidate.id === category.id)) return;
    visited.add(category.id);
    entries.push({ category, depth });
    for (const child of sortedCategories(children.get(category.id) || [])) visit(child, depth + 1);
  };
  for (const root of sortedCategories(roots)) visit(root, 0);
  for (const category of sortedCategories(categories)) if (!visited.has(category.id)) visit(category, 0);
  return entries;
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

function productCategoryCounts() {
  const counts = new Map();
  for (const product of state.allProducts) {
    if (!product.categoryId) continue;
    counts.set(product.categoryId, (counts.get(product.categoryId) || 0) + 1);
  }
  return counts;
}

function renderCategoryOptions() {
  const filter = $('#catalog-filter-category');
  const editor = $('#catalog-category');
  const options = categoryTreeEntries().map(({ category, depth }) => ({ value: category.id, label: `${'  '.repeat(depth)}${depth ? '↳ ' : ''}${category.name}` }));
  if (filter) {
    const current = filter.value;
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

function filteredProducts() {
  let products = [...state.allProducts];
  if (state.productCategoryId) products = products.filter(product => product.categoryId === state.productCategoryId);
  if (state.productPriceFilter === 'with-price') products = products.filter(product => (product.latestPrices?.length || 0) > 0);
  if (state.productPriceFilter === 'without-price') products = products.filter(product => (product.latestPrices?.length || 0) === 0);
  if (state.productSort === 'recent') products.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)) || left.variantName.localeCompare(right.variantName, 'es'));
  else if (state.productSort === 'price-desc') products.sort((left, right) => (latestPrice(right)?.priceMinor ?? -1) - (latestPrice(left)?.priceMinor ?? -1) || left.variantName.localeCompare(right.variantName, 'es'));
  else if (state.productSort === 'price-asc') products.sort((left, right) => (latestPrice(left)?.priceMinor ?? Number.MAX_SAFE_INTEGER) - (latestPrice(right)?.priceMinor ?? Number.MAX_SAFE_INTEGER) || left.variantName.localeCompare(right.variantName, 'es'));
  else products.sort((left, right) => left.variantName.localeCompare(right.variantName, 'es', { sensitivity: 'base' }) || left.id.localeCompare(right.id));
  return products;
}

function paginate(items, page, pageSize) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const start = (safePage - 1) * pageSize;
  return { page: safePage, pageCount, start, items: items.slice(start, start + pageSize) };
}

function renderProductList() {
  const container = $('#catalog-products');
  if (!container) return;
  const products = filteredProducts();
  const paged = paginate(products, state.productPage, UI_PAGE_SIZE);
  state.productPage = paged.page;
  container.replaceChildren();
  if (!paged.items.length) {
    const empty = document.createElement('div');
    empty.className = 'catalog-empty';
    empty.innerHTML = '<strong>No hay productos para estos filtros.</strong><span>Prueba otra búsqueda, categoría o filtro de precio.</span>';
    container.append(empty);
  }
  for (const product of paged.items) {
    const price = latestPrice(product);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'inventory-product-row inventory-product-grid';
    row.dataset.catalogProductId = product.id;
    const retailers = product.retailerNames?.length || product.latestPrices?.length || 0;
    const updated = Number.isNaN(Date.parse(product.updatedAt)) ? product.updatedAt : DATE_FORMATTER.format(new Date(product.updatedAt));
    row.innerHTML = `<span class="inventory-product-cell inventory-product-cell--name"><strong>${escapeHtml(product.variantName)}</strong><small>${escapeHtml(product.canonicalName)}</small></span><span>${escapeHtml(product.categoryName || 'Sin categoría')}</span><span>${retailers}</span><strong>${price ? escapeHtml(formatEuroMinor(price.priceMinor)) : '—'}</strong><span>${escapeHtml(updated)}</span><span class="inventory-row-action">Ver ficha</span>`;
    row.addEventListener('click', () => openProductDetail(product.id));
    container.append(row);
  }
  const from = products.length ? paged.start + 1 : 0;
  const to = Math.min(paged.start + paged.items.length, products.length);
  $('#catalog-range').textContent = `${from}-${to} de ${products.length}`;
  $('#catalog-page').textContent = `${paged.page} / ${paged.pageCount}`;
  $('#catalog-prev').disabled = paged.page <= 1;
  $('#catalog-next').disabled = paged.page >= paged.pageCount;
}

function categoryDirectProductCount(categoryId) {
  return productCategoryCounts().get(categoryId) || 0;
}

function categoryChildCount(categoryId) {
  return state.categories.filter(category => category.parentId === categoryId).length;
}

function filteredCategories() {
  const query = state.categoryQuery.toLocaleLowerCase('es-ES');
  let categories = state.categories.filter(category => !query || category.name.toLocaleLowerCase('es-ES').includes(query) || String(category.description || '').toLocaleLowerCase('es-ES').includes(query));
  if (state.categoryFilter === 'roots') categories = categories.filter(category => !category.parentId);
  if (state.categoryFilter === 'without-products') categories = categories.filter(category => categoryDirectProductCount(category.id) === 0);
  if (state.categoryFilter === 'with-children') categories = categories.filter(category => categoryChildCount(category.id) > 0);
  return categories;
}

function renderCategoryList() {
  const container = $('#category-tree');
  if (!container) return;
  const categories = filteredCategories();
  const ordered = categoryTreeEntries(categories);
  const paged = paginate(ordered, state.categoryPage, CATEGORY_PAGE_SIZE);
  state.categoryPage = paged.page;
  container.replaceChildren();
  if (!paged.items.length) {
    const empty = document.createElement('div');
    empty.className = 'catalog-empty';
    empty.innerHTML = '<strong>No hay categorías para estos filtros.</strong><span>Prueba otra búsqueda o crea una nueva categoría.</span>';
    container.append(empty);
  }
  const { byId } = categoryMaps();
  for (const { category, depth } of paged.items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'category-row category-list-grid';
    row.dataset.categoryId = category.id;
    row.style.setProperty('--category-indent', `${depth * 1.1}rem`);
    const parent = category.parentId ? byId.get(category.parentId) : null;
    row.innerHTML = `<span class="category-name-cell"><span class="category-swatch" style="background:${escapeHtml(normalizedCategoryColor(category.color))}" aria-hidden="true"></span><span><strong>${escapeHtml(category.name)}</strong><small>${escapeHtml(category.description || (depth ? 'Subcategoría' : 'Categoría raíz'))}</small></span></span><strong>${categoryDirectProductCount(category.id)}</strong><strong>${categoryChildCount(category.id)}</strong><span>${escapeHtml(parent?.name || 'Raíz')}</span><span class="inventory-row-action">Ver detalle</span>`;
    row.addEventListener('click', () => openCategoryDetail(category.id));
    container.append(row);
  }
  const from = ordered.length ? paged.start + 1 : 0;
  const to = Math.min(paged.start + paged.items.length, ordered.length);
  $('#category-range').textContent = `${from}-${to} de ${ordered.length}`;
  $('#category-page').textContent = `${paged.page} / ${paged.pageCount}`;
  $('#category-prev').disabled = paged.page <= 1;
  $('#category-next').disabled = paged.page >= paged.pageCount;
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
    row.innerHTML = `<span><strong>${escapeHtml(location)}</strong><small>${escapeHtml(DATE_FORMATTER.format(new Date(entry.observedAt)))}</small></span><strong>${escapeHtml(formatEuroMinor(entry.priceMinor))}</strong>`;
    container.append(row);
  }
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

function populateProductForm(product) {
  if (!product) return;
  $('#catalog-canonical-name').value = product.canonicalName || '';
  $('#catalog-variant-name').value = product.variantName || '';
  $('#catalog-brand').value = product.brand || '';
  $('#catalog-ean').value = product.ean || '';
  $('#catalog-description').value = product.description || '';
  $('#catalog-aliases').value = (product.aliases || []).join('\n');
  $('#catalog-package-minor').value = product.packageMinor ?? '';
  $('#catalog-package-unit').value = product.packageUnit || '';
  $('#catalog-category').value = product.categoryId || '';
  $('#catalog-product-status').textContent = 'Guardado';
  $('#catalog-product-form-state').textContent = '';
  $('#catalog-parent-state').textContent = '';
  $('#catalog-retailer-state').textContent = '';
  $('#catalog-new-parent-name').value = '';
  $('#catalog-retailer-name').value = '';
  $('#catalog-retailer-title').value = '';
  const parentSelect = $('#catalog-parent-select');
  parentSelect.replaceChildren(new Option('Selecciona un producto padre', ''));
  for (const parent of state.parents) parentSelect.append(new Option(`${parent.name} (${parent.variantCount})`, parent.id));
  parentSelect.value = product.canonicalProductId || '';
}

function renderProductDetail(product) {
  if (!product) return;
  $('#catalog-detail-title').textContent = product.variantName;
  $('#catalog-detail-name').textContent = product.variantName;
  $('#catalog-detail-meta').textContent = product.canonicalName;
  $('#catalog-detail-category').textContent = product.categoryName || 'Sin categoría';
  $('#catalog-detail-brand').textContent = product.brand || '—';
  $('#catalog-detail-ean').textContent = product.ean || '—';
  $('#catalog-detail-package').textContent = product.packageMinor ? `${product.packageMinor} ${product.packageUnit || ''}`.trim() : '—';
  $('#catalog-detail-updated').textContent = Number.isNaN(Date.parse(product.updatedAt)) ? product.updatedAt : DATE_FORMATTER.format(new Date(product.updatedAt));
  $('#catalog-detail-description').textContent = product.description || 'Sin descripción.';
  $('#catalog-parent-name').textContent = product.canonicalName;
  renderLatestPrices(product);
  renderRetailerNames(product);
  populateProductForm(product);
}

function openProductDetail(productId, { edit = false } = {}) {
  state.selectedProductId = productId;
  const product = selectedProduct();
  if (!product) return;
  $('#catalog-list-screen').hidden = true;
  $('#catalog-detail').hidden = false;
  renderProductDetail(product);
  showProductEditor(edit);
  history.replaceState(null, '', `#catalog:${encodeURIComponent(productId)}`);
  window.scrollTo(0, 0);
}

function closeProductDetail() {
  state.selectedProductId = '';
  $('#catalog-detail').hidden = true;
  $('#catalog-list-screen').hidden = false;
  history.replaceState(null, '', '#catalog');
  window.scrollTo(0, 0);
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

function renderCategoryDetail(category) {
  const { byId } = categoryMaps();
  const protectedFallback = category?.name.toLocaleLowerCase('es-ES') === UNKNOWN_CATEGORY_NAME;
  $('#category-form-title').textContent = category?.name || 'Nueva categoría';
  $('#category-detail-name').textContent = category?.name || 'Nueva categoría';
  $('#category-detail-description').textContent = category?.description || 'Sin descripción.';
  $('#category-detail-swatch').style.backgroundColor = normalizedCategoryColor(category?.color);
  $('#category-detail-products').textContent = String(category ? categoryDirectProductCount(category.id) : 0);
  $('#category-detail-children').textContent = String(category ? categoryChildCount(category.id) : 0);
  $('#category-detail-parent').textContent = category?.parentId ? (byId.get(category.parentId)?.name || 'Categoría no disponible') : 'Raíz';
  $('#category-detail-hierarchy').textContent = category?.parentId ? `${byId.get(category.parentId)?.name || 'Raíz'} → ${category.name}` : 'Categoría raíz';
  $('#category-detail-status').textContent = protectedFallback ? 'Protegida' : 'Activa';
  $('#category-protected-note').hidden = !protectedFallback;
  $('#category-delete').disabled = protectedFallback;
  populateCategoryForm(category);
}

function openCategoryDetail(categoryId, { edit = false } = {}) {
  state.selectedCategoryId = categoryId;
  state.categoryCreateParentId = '';
  const category = selectedCategory();
  if (!category) return;
  $('#category-list-screen').hidden = true;
  $('#category-detail').hidden = false;
  renderCategoryDetail(category);
  showCategoryEditor(edit);
  history.replaceState(null, '', `#categories:${encodeURIComponent(categoryId)}`);
  window.scrollTo(0, 0);
}

function startCreateCategory(parentId = '') {
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
  history.replaceState(null, '', '#categories:new');
  requestAnimationFrame(() => $('#category-name')?.focus());
}

function closeCategoryDetail() {
  state.selectedCategoryId = '';
  state.categoryCreateParentId = '';
  $('#category-detail').hidden = true;
  $('#category-list-screen').hidden = false;
  $('#category-edit').hidden = false;
  $('#category-delete').hidden = false;
  history.replaceState(null, '', '#categories');
  window.scrollTo(0, 0);
}

function showCategoryEditor(visible) {
  const editor = $('#category-editor');
  if (editor) editor.hidden = !visible;
  if (visible) editor.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function ensureMetadata() {
  const [categoriesResult, metadata] = await Promise.all([
    state.categories.length ? { categories: state.categories } : api('/api/v1/categories'),
    state.units.length ? { units: state.units } : api('/api/v1/meta'),
  ]);
  state.categories = Array.isArray(categoriesResult.categories) ? categoriesResult.categories : [];
  state.units = Array.isArray(metadata.units) ? metadata.units : [];
  renderCategoryOptions();
  renderUnitOptions();
}

async function fetchAllProducts(query, signal) {
  const products = [];
  let parents = [];
  let offset = 0;
  for (;;) {
    const result = await api(`/api/v1/catalog?q=${encodeURIComponent(query)}&limit=${API_PAGE_SIZE}&offset=${offset}`, { signal });
    const catalog = result.catalog || {};
    const batch = Array.isArray(catalog.products) ? catalog.products : [];
    products.push(...batch);
    if (Array.isArray(catalog.parents)) parents = catalog.parents;
    if (!catalog.hasMore || batch.length === 0) break;
    offset += batch.length;
    if (offset >= 10_000) break;
  }
  return { products, parents };
}

async function loadProducts({ resetPage = false } = {}) {
  const generation = ++state.loadGeneration;
  state.loadController?.abort();
  const controller = new AbortController();
  state.loadController = controller;
  state.productQuery = $('#catalog-search')?.value.trim() || state.productQuery;
  if (resetPage) state.productPage = 1;
  $('#catalog-state').textContent = 'Cargando productos…';
  try {
    await ensureMetadata();
    const result = await fetchAllProducts(state.productQuery, controller.signal);
    if (generation !== state.loadGeneration) return;
    state.allProducts = result.products;
    state.parents = result.parents;
    renderProductList();
    renderCategoryList();
    $('#catalog-state').textContent = `${filteredProducts().length} productos encontrados.`;
  } catch (error) {
    if (error?.name === 'AbortError') return;
    $('#catalog-state').textContent = `No se pudieron cargar los productos: ${error.message}`;
  } finally {
    if (generation === state.loadGeneration) state.loadController = null;
  }
}

async function loadCategories({ force = false } = {}) {
  if (!force && state.categories.length) {
    renderCategoryList();
    return;
  }
  $('#category-state').textContent = 'Cargando categorías…';
  try {
    const result = await api('/api/v1/categories');
    state.categories = Array.isArray(result.categories) ? result.categories : [];
    renderCategoryOptions();
    renderCategoryList();
    if (!state.allProducts.length) await loadProducts();
    $('#category-state').textContent = `${filteredCategories().length} categorías encontradas.`;
  } catch (error) {
    $('#category-state').textContent = `No se pudieron cargar las categorías: ${error.message}`;
  }
}

function optionalText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

async function saveSelectedProduct(button) {
  const product = selectedProduct();
  if (!product) return;
  setBusy(button, true);
  $('#catalog-product-status').textContent = 'Guardando…';
  try {
    const ean = optionalText($('#catalog-ean').value);
    if (ean && !/^\d{8,14}$/u.test(ean)) throw new Error('El EAN/GTIN debe contener entre 8 y 14 dígitos.');
    const packageRaw = $('#catalog-package-minor').value.trim();
    const packageMinor = packageRaw ? Number(packageRaw) : null;
    if (packageMinor !== null && (!Number.isSafeInteger(packageMinor) || packageMinor < 1)) throw new Error('La cantidad del formato debe ser un entero positivo.');
    const payload = {
      canonicalName: $('#catalog-canonical-name').value.trim(),
      variantName: $('#catalog-variant-name').value.trim(),
      categoryId: optionalText($('#catalog-category').value),
      description: optionalText($('#catalog-description').value),
      brand: optionalText($('#catalog-brand').value),
      ean,
      packageMinor,
      packageUnit: packageMinor === null ? null : optionalText($('#catalog-package-unit').value),
      aliases: $('#catalog-aliases').value.split('\n').map(value => value.trim()).filter(Boolean),
    };
    if (!payload.canonicalName || !payload.variantName) throw new Error('El nombre canónico y la variante son obligatorios.');
    await api(`/api/v1/products/${encodeURIComponent(product.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
    $('#catalog-product-form-state').textContent = 'Ficha guardada.';
    $('#catalog-product-status').textContent = 'Guardado';
    await loadProducts();
    const refreshed = state.allProducts.find(candidate => candidate.id === product.id);
    if (refreshed) {
      state.selectedProductId = refreshed.id;
      renderProductDetail(refreshed);
    }
    showProductEditor(false);
  } catch (error) {
    $('#catalog-product-form-state').textContent = error.message;
    $('#catalog-product-status').textContent = 'Revisar';
  } finally {
    setBusy(button, false);
  }
}

async function saveCategory(button) {
  const current = selectedCategory();
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
    const result = await api(current ? `/api/v1/categories/${encodeURIComponent(current.id)}` : '/api/v1/categories', { method: current ? 'PATCH' : 'POST', body: JSON.stringify({ name, parentId, color, description }) });
    const savedId = result.category?.id;
    await loadCategories({ force: true });
    if (savedId) openCategoryDetail(savedId);
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
  const product = selectedProduct();
  const canonicalProductId = $('#catalog-parent-select').value;
  if (!product || !canonicalProductId) {
    $('#catalog-parent-state').textContent = 'Selecciona un producto padre.';
    return;
  }
  setBusy(button, true);
  try {
    await api(`/api/v1/catalog/products/${encodeURIComponent(product.id)}/parent`, { method: 'PUT', body: JSON.stringify({ canonicalProductId }) });
    $('#catalog-parent-state').textContent = 'Producto padre actualizado.';
    await loadProducts();
    const refreshed = state.allProducts.find(candidate => candidate.id === product.id);
    if (refreshed) renderProductDetail(refreshed);
  } catch (error) {
    $('#catalog-parent-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function createParentForSelected(button) {
  const product = selectedProduct();
  const newParentName = $('#catalog-new-parent-name').value.trim();
  if (!product || !newParentName) {
    $('#catalog-parent-state').textContent = 'Escribe el nombre del nuevo producto padre.';
    return;
  }
  setBusy(button, true);
  try {
    await api(`/api/v1/catalog/products/${encodeURIComponent(product.id)}/parent`, { method: 'PUT', body: JSON.stringify({ newParentName }) });
    $('#catalog-parent-state').textContent = 'Producto padre creado y relacionado.';
    await loadProducts();
  } catch (error) {
    $('#catalog-parent-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function saveRetailerName(button) {
  const product = selectedProduct();
  const retailerName = $('#catalog-retailer-name').value.trim();
  const title = $('#catalog-retailer-title').value.trim();
  if (!product || !retailerName || !title) {
    $('#catalog-retailer-state').textContent = 'Indica el comercio y el nombre usado allí.';
    return;
  }
  setBusy(button, true);
  try {
    await api(`/api/v1/catalog/products/${encodeURIComponent(product.id)}/retailer-name`, { method: 'PUT', body: JSON.stringify({ retailerName, title }) });
    $('#catalog-retailer-state').textContent = 'Nombre del comercio guardado.';
    await loadProducts();
    const refreshed = state.allProducts.find(candidate => candidate.id === product.id);
    if (refreshed) renderProductDetail(refreshed);
  } catch (error) {
    $('#catalog-retailer-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function showDeleteUnavailable(kind) {
  const stateElement = kind === 'product' ? $('#catalog-delete-state') : $('#category-delete-state');
  if (stateElement) stateElement.textContent = 'La eliminación segura requiere preflight transaccional del backend y se habilitará en el siguiente cambio de dominio.';
}

function openProductDeleteDialog() {
  const product = selectedProduct();
  if (!product) return;
  $('#catalog-delete-impact').textContent = `${product.variantName}: se comprobarán tickets, precios y relaciones antes de permitir el borrado.`;
  showDeleteUnavailable('product');
  $('#catalog-delete-dialog').showModal();
}

function openCategoryDeleteDialog() {
  const category = selectedCategory();
  if (!category) return;
  const descendants = descendantCategoryIds(category.id);
  const descendantProducts = [...descendants].reduce((total, id) => total + categoryDirectProductCount(id), 0);
  $('#category-delete-impact').textContent = `${category.name}: ${categoryDirectProductCount(category.id)} productos directos, ${categoryChildCount(category.id)} subcategorías directas y ${descendantProducts} productos en descendientes.`;
  showDeleteUnavailable('category');
  $('#category-delete-dialog').showModal();
}

function bindInteractions() {
  document.querySelectorAll('[data-catalog-nav="inventory"]').forEach(button => button.addEventListener('click', goInventory));
  $('#catalog-back-list').addEventListener('click', closeProductDetail);
  $('#categories-back-list').addEventListener('click', closeCategoryDetail);
  $('#catalog-edit-product').addEventListener('click', () => showProductEditor(true));
  $('#catalog-cancel-edit').addEventListener('click', () => showProductEditor(false));
  $('#catalog-delete-product').addEventListener('click', openProductDeleteDialog);
  $('#catalog-delete-cancel').addEventListener('click', () => $('#catalog-delete-dialog').close());
  $('#category-edit').addEventListener('click', () => showCategoryEditor(true));
  $('#category-cancel-edit').addEventListener('click', () => selectedCategory() ? showCategoryEditor(false) : closeCategoryDetail());
  $('#category-delete').addEventListener('click', openCategoryDeleteDialog);
  $('#category-delete-cancel').addEventListener('click', () => $('#category-delete-dialog').close());
  $('#category-new').addEventListener('click', () => startCreateCategory());
  $('#category-add-child').addEventListener('click', () => {
    const category = selectedCategory();
    if (category) startCreateCategory(category.id);
  });
  $('#catalog-new-product').addEventListener('click', () => {
    $('#catalog-state').textContent = 'La creación manual de producto usará el mismo contrato canónico que tickets/listas; se habilitará junto al endpoint dedicado.';
  });
  $('#catalog-product-form').addEventListener('submit', event => {
    event.preventDefault();
    void saveSelectedProduct($('#catalog-save-product'));
  });
  $('#category-form').addEventListener('submit', event => {
    event.preventDefault();
    void saveCategory($('#category-save'));
  });
  $('#catalog-link-parent').addEventListener('click', event => void linkSelectedParent(event.currentTarget));
  $('#catalog-create-parent').addEventListener('click', event => void createParentForSelected(event.currentTarget));
  $('#catalog-save-retailer-name').addEventListener('click', event => void saveRetailerName(event.currentTarget));
  $('#category-color').addEventListener('input', event => { $('#category-color-value').textContent = normalizedCategoryColor(event.currentTarget.value); });
  $('#catalog-search').addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => void loadProducts({ resetPage: true }), SEARCH_DELAY_MS);
  });
  $('#catalog-filter-category').addEventListener('change', event => { state.productCategoryId = event.currentTarget.value; state.productPage = 1; renderProductList(); });
  $('#catalog-filter-price').addEventListener('change', event => { state.productPriceFilter = event.currentTarget.value; state.productPage = 1; renderProductList(); });
  $('#catalog-sort').addEventListener('change', event => { state.productSort = event.currentTarget.value; state.productPage = 1; renderProductList(); });
  $('#catalog-clear-filters').addEventListener('click', () => {
    $('#catalog-search').value = '';
    $('#catalog-filter-category').value = '';
    $('#catalog-filter-price').value = 'all';
    $('#catalog-sort').value = 'name';
    state.productCategoryId = '';
    state.productPriceFilter = 'all';
    state.productSort = 'name';
    state.productQuery = '';
    void loadProducts({ resetPage: true });
  });
  $('#catalog-prev').addEventListener('click', () => { state.productPage -= 1; renderProductList(); window.scrollTo(0, 0); });
  $('#catalog-next').addEventListener('click', () => { state.productPage += 1; renderProductList(); window.scrollTo(0, 0); });
  $('#category-search').addEventListener('input', event => {
    clearTimeout(state.categorySearchTimer);
    state.categorySearchTimer = setTimeout(() => { state.categoryQuery = event.target.value.trim(); state.categoryPage = 1; renderCategoryList(); }, SEARCH_DELAY_MS);
  });
  $('#category-filter').addEventListener('change', event => { state.categoryFilter = event.currentTarget.value; state.categoryPage = 1; renderCategoryList(); });
  $('#category-clear-filters').addEventListener('click', () => { $('#category-search').value = ''; $('#category-filter').value = 'all'; state.categoryQuery = ''; state.categoryFilter = 'all'; state.categoryPage = 1; renderCategoryList(); });
  $('#category-prev').addEventListener('click', () => { state.categoryPage -= 1; renderCategoryList(); window.scrollTo(0, 0); });
  $('#category-next').addEventListener('click', () => { state.categoryPage += 1; renderCategoryList(); window.scrollTo(0, 0); });
}

function openRequestedDetail(requested) {
  if (requested.startsWith('catalog:')) {
    const id = decodeURIComponent(requested.slice('catalog:'.length));
    if (state.allProducts.some(product => product.id === id)) openProductDetail(id);
  }
  if (requested === 'categories:new') startCreateCategory();
  else if (requested.startsWith('categories:')) {
    const id = decodeURIComponent(requested.slice('categories:'.length));
    if (state.categories.some(category => category.id === id)) openCategoryDetail(id);
  }
}

async function activateCatalog(requested = 'catalog') {
  if (!activateFeatureView('catalog')) return;
  await loadProducts();
  openRequestedDetail(requested);
}

async function activateCategories(requested = 'categories') {
  if (!activateFeatureView('categories')) return;
  await loadCategories({ force: true });
  if (!state.allProducts.length) await loadProducts();
  openRequestedDetail(requested);
}

function handleViewChanged(event) {
  const view = String(event.detail?.view || '');
  if (view === 'catalog') void loadProducts({ resetPage: true });
  if (view === 'categories') void loadCategories({ force: true });
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
  if (activateCategoryView) void activateCategories(location.hash.slice(1));
  else if (activate) void activateCatalog(location.hash.slice(1));
}

function autoInitializeCatalogFeature() {
  const requested = location.hash.slice(1);
  initializeCatalogFeature({
    activate: requested === 'catalog' || requested.startsWith('catalog:'),
    activateCategoryView: requested === 'categories' || requested.startsWith('categories:'),
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInitializeCatalogFeature, { once: true });
else autoInitializeCatalogFeature();
