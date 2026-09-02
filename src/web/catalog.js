import { api, setBusy } from './api.js';
import { escapeHtml, formatEuroMinor, hydrateIcons } from './ui.js';

const CATALOG_PAGE_SIZE = 50;
const CATALOG_SEARCH_DELAY_MS = 250;
const CATALOG_DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' });
const UNKNOWN_CATEGORY_NAME = 'desconocido';
const DEFAULT_CATEGORY_COLOR = '#64748B';

const $ = selector => document.querySelector(selector);

const state = {
  initialized: false,
  catalog: { products: [], parents: [], hasMore: false, offset: 0, limit: CATALOG_PAGE_SIZE },
  categories: [],
  units: [],
  selectedProductId: '',
  selectedCategoryId: '',
  categoryCreateParentId: '',
  searchTimer: null,
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

function installCatalogView() {
  if (document.querySelector('.view[data-view="catalog"]')) return;
  const main = $('#main');
  if (!main) return;
  const view = document.createElement('section');
  view.className = 'view catalog-view';
  view.dataset.view = 'catalog';
  view.innerHTML = `
    <div class="page-header catalog-page-header">
      <div>
        <p class="eyebrow">Catálogo</p>
        <h1>Catálogo de productos</h1>
        <p>Tus tickets alimentan este catálogo. Agrupa variantes y consulta cómo se llama y cuánto cuesta cada producto en cada comercio.</p>
      </div>
      <button id="catalog-home" class="button secondary" type="button"><span data-icon="home"></span>Inicio</button>
    </div>
    <section class="surface catalog-toolbar" aria-labelledby="catalog-search-title">
      <div>
        <h2 id="catalog-search-title">Buscar en el catálogo</h2>
        <p class="field-help">Busca por producto, variante, marca, alias o nombre de comercio.</p>
      </div>
      <label class="field catalog-search-field">
        <span>Buscar productos</span>
        <input id="catalog-search" type="search" maxlength="160" autocomplete="off" placeholder="Ej. leche, arroz o Mercadona">
      </label>
      <p id="catalog-state" class="inline-status" role="status" aria-live="polite"></p>
    </section>
    <div class="catalog-layout">
      <section class="surface catalog-browser" aria-labelledby="catalog-products-title">
        <div class="section-header">
          <div><p class="eyebrow">Productos</p><h2 id="catalog-products-title">Variantes y precios</h2></div>
          <span id="catalog-product-count" class="count-badge">0</span>
        </div>
        <div id="catalog-products" class="catalog-product-list" aria-live="polite"></div>
        <button id="catalog-load-more" class="button secondary full" type="button" hidden>Cargar más</button>
      </section>
      <section id="catalog-detail" class="surface catalog-detail" aria-labelledby="catalog-detail-title" hidden>
        <div class="section-header">
          <div><p class="eyebrow">Ficha reutilizable</p><h2 id="catalog-detail-title">Editar producto</h2></div>
          <span id="catalog-product-status" class="status-pill">Guardado</span>
        </div>
        <form id="catalog-product-form" class="catalog-form">
          <div class="catalog-shared-note" role="note">
            <strong>Datos del producto padre</strong>
            <span>El nombre canónico, la categoría y la descripción se comparten con todas las variantes relacionadas.</span>
          </div>
          <label class="field"><span>Nombre canónico</span><input id="catalog-canonical-name" maxlength="160" required></label>
          <label class="field"><span>Nombre de esta variante</span><input id="catalog-variant-name" maxlength="160" required></label>
          <div class="quantity-row">
            <label class="field"><span>Marca</span><input id="catalog-brand" maxlength="120"></label>
            <label class="field"><span>EAN/GTIN</span><input id="catalog-ean" maxlength="14" inputmode="numeric"></label>
          </div>
          <label class="field"><span>Categoría</span><select id="catalog-category"><option value="">Sin categoría</option></select></label>
          <label class="field"><span>Descripción</span><textarea id="catalog-description" maxlength="500" rows="3"></textarea></label>
          <label class="field"><span>Alias de búsqueda, uno por línea</span><textarea id="catalog-aliases" maxlength="1000" rows="3"></textarea></label>
          <div class="quantity-row">
            <label class="field"><span>Cantidad del formato</span><input id="catalog-package-minor" type="number" min="1" max="100000000" inputmode="numeric"></label>
            <label class="field"><span>Unidad del formato</span><select id="catalog-package-unit"><option value="">Sin formato</option></select></label>
          </div>
          <button id="catalog-save-product" class="button primary full" type="submit"><span data-icon="check"></span>Guardar ficha</button>
          <p id="catalog-product-form-state" class="inline-status" role="status"></p>
        </form>

        <fieldset class="flow-group catalog-price-group">
          <legend>Últimos precios confirmados</legend>
          <p class="field-help">Se muestra la observación más reciente por comercio o tienda. El historial completo se conserva sin sobrescribir precios anteriores.</p>
          <div id="catalog-latest-prices" class="catalog-retailer-names" aria-live="polite"></div>
        </fieldset>

        <fieldset class="flow-group catalog-relation-group">
          <legend>Producto padre</legend>
          <p class="field-help">Relacionar esta variante hace que comparta nombre canónico, categoría y descripción con el padre elegido. No borra tickets ni precios históricos.</p>
          <label class="field"><span>Relacionar con un padre existente</span><select id="catalog-parent-select"><option value="">Selecciona un producto padre</option></select></label>
          <button id="catalog-link-parent" class="button secondary full" type="button">Relacionar con el padre elegido</button>
          <div class="catalog-or" aria-hidden="true">o</div>
          <label class="field"><span>Crear un nuevo padre</span><input id="catalog-new-parent-name" maxlength="160" autocomplete="off" placeholder="Nombre común del producto"></label>
          <button id="catalog-create-parent" class="button secondary full" type="button"><span data-icon="plus"></span>Crear padre y relacionar</button>
          <p id="catalog-parent-state" class="inline-status" role="status"></p>
        </fieldset>

        <fieldset class="flow-group catalog-retailer-group">
          <legend>Nombres por comercio</legend>
          <p class="field-help">Guarda el nombre con el que este producto aparece en una cadena o comercio. La tienda física concreta sigue perteneciendo al historial de precios.</p>
          <div id="catalog-retailer-names" class="catalog-retailer-names" aria-live="polite"></div>
          <label class="field"><span>Comercio</span><input id="catalog-retailer-name" maxlength="160" autocomplete="organization" placeholder="Ej. Mercadona"></label>
          <label class="field"><span>Nombre en ese comercio</span><input id="catalog-retailer-title" maxlength="240" autocomplete="off" placeholder="Nombre mostrado en tienda"></label>
          <button id="catalog-save-retailer-name" class="button secondary full" type="button">Guardar nombre del comercio</button>
          <p id="catalog-retailer-state" class="inline-status" role="status"></p>
        </fieldset>
      </section>
    </div>`;
  main.append(view);
  document.dispatchEvent(new CustomEvent('basketra:hydrate-icons', { detail: { root: view } }));
}

function installCategoryView() {
  if (document.querySelector('.view[data-view="categories"]')) return;
  const main = $('#main');
  if (!main) return;
  const view = document.createElement('section');
  view.className = 'view catalog-view category-view';
  view.dataset.view = 'categories';
  view.innerHTML = `
    <div class="page-header catalog-page-header">
      <div>
        <p class="eyebrow">Clasificación</p>
        <h1>Categorías</h1>
        <p>Organiza un inventario reutilizable con tantos niveles como necesites. La IA recibe este árbol al analizar tickets y reutiliza sus identificadores.</p>
      </div>
      <button id="categories-home" class="button secondary" type="button"><span data-icon="home"></span>Inicio</button>
    </div>
    <section class="surface category-toolbar" aria-labelledby="category-inventory-title">
      <div>
        <h2 id="category-inventory-title">Inventario de categorías</h2>
        <p class="field-help">La categoría desconocido es el fallback protegido para artículos que no se pueden clasificar con seguridad.</p>
      </div>
      <button id="category-new" class="button primary" type="button"><span data-icon="plus"></span>Nueva categoría</button>
      <p id="category-state" class="inline-status" role="status" aria-live="polite"></p>
    </section>
    <div class="category-layout">
      <section class="surface category-browser" aria-labelledby="category-tree-title">
        <div class="section-header">
          <div><p class="eyebrow">Jerarquía</p><h2 id="category-tree-title">Árbol de categorías</h2></div>
          <span id="category-count" class="count-badge">0</span>
        </div>
        <div id="category-tree" class="category-tree" aria-live="polite"></div>
      </section>
      <section id="category-detail" class="surface category-detail" aria-labelledby="category-form-title">
        <div class="section-header">
          <div><p class="eyebrow">Ficha</p><h2 id="category-form-title">Nueva categoría</h2></div>
          <span id="category-form-status" class="status-pill">Nueva</span>
        </div>
        <form id="category-form" class="category-form">
          <div id="category-protected-note" class="catalog-shared-note" role="note" hidden>
            <strong>Categoría de respaldo</strong>
            <span>desconocido debe conservar su nombre y permanecer en la raíz. Puedes ajustar su color o descripción.</span>
          </div>
          <label class="field"><span>Nombre</span><input id="category-name" maxlength="120" autocomplete="off" required></label>
          <label class="field"><span>Categoría padre</span><select id="category-parent"><option value="">Sin padre · categoría raíz</option></select></label>
          <label class="field category-color-field">
            <span>Color</span>
            <span class="category-color-control"><input id="category-color" type="color" value="${DEFAULT_CATEGORY_COLOR}" aria-label="Color de la categoría"><output id="category-color-value">${DEFAULT_CATEGORY_COLOR}</output></span>
          </label>
          <label class="field"><span>Descripción opcional</span><textarea id="category-description" maxlength="500" rows="4" placeholder="Ayuda a distinguir el alcance de esta categoría"></textarea></label>
          <button id="category-save" class="button primary full" type="submit"><span data-icon="check"></span>Guardar categoría</button>
          <button id="category-add-child" class="button secondary full" type="button" hidden><span data-icon="plus"></span>Añadir subcategoría</button>
          <p id="category-form-state" class="inline-status" role="status"></p>
        </form>
      </section>
    </div>`;
  main.append(view);
  document.dispatchEvent(new CustomEvent('basketra:hydrate-icons', { detail: { root: view } }));
}

function installHomeEntries() {
  const grid = document.querySelector('.view[data-view="home"] .dashboard-grid');
  if (!grid) return;
  if (!grid.querySelector('[data-catalog-entry]')) {
    const catalogButton = document.createElement('button');
    catalogButton.type = 'button';
    catalogButton.className = 'dashboard-card';
    catalogButton.dataset.catalogEntry = 'true';
    catalogButton.innerHTML = '<span data-icon="store"></span><strong>Catálogo de productos</strong><small>Variantes y precios por comercio</small>';
    catalogButton.addEventListener('click', () => void activateCatalog());
    grid.append(catalogButton);
    document.dispatchEvent(new CustomEvent('basketra:hydrate-icons', { detail: { root: catalogButton } }));
  }
  if (!grid.querySelector('[data-categories-entry]')) {
    const categoryButton = document.createElement('button');
    categoryButton.type = 'button';
    categoryButton.className = 'dashboard-card';
    categoryButton.dataset.categoriesEntry = 'true';
    categoryButton.innerHTML = '<span data-icon="list"></span><strong>Categorías</strong><small>Árbol, colores y clasificación IA</small>';
    categoryButton.addEventListener('click', () => void activateCategories());
    grid.append(categoryButton);
    document.dispatchEvent(new CustomEvent('basketra:hydrate-icons', { detail: { root: categoryButton } }));
  }
}

function activateFeatureView(viewName) {
  const view = document.querySelector(`.view[data-view="${CSS.escape(viewName)}"]`);
  if (!view) return false;
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element === view));
  document.querySelectorAll('.bottom-nav [data-nav]').forEach(element => element.removeAttribute('aria-current'));
  history.replaceState(null, '', `#${viewName}`);
  document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: viewName } }));
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo(0, 0);
  $('#main')?.focus({ preventScroll: true });
  return true;
}

function activateCatalog() {
  if (!activateFeatureView('catalog')) return Promise.resolve();
  return loadCatalog({ reset: true });
}

function activateCategories() {
  if (!activateFeatureView('categories')) return Promise.resolve();
  return loadCategories({ force: true });
}

function setCatalogStatus(message, stateName = '') {
  const element = $('#catalog-state');
  if (!element) return;
  element.textContent = message;
  if (stateName) element.dataset.state = stateName;
  else delete element.dataset.state;
}

function setCategoryStatus(message, stateName = '') {
  const element = $('#category-state');
  if (!element) return;
  element.textContent = message;
  if (stateName) element.dataset.state = stateName;
  else delete element.dataset.state;
}

function selectedProduct() {
  return state.catalog.products.find(product => product.id === state.selectedProductId);
}

function selectedCategory() {
  return state.categories.find(category => category.id === state.selectedCategoryId);
}

function normalizedCategoryColor(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/u.test(normalized) ? normalized : DEFAULT_CATEGORY_COLOR;
}

function sortedCategories(categories) {
  return [...categories].sort((left, right) => left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }) || left.id.localeCompare(right.id));
}

function categoryTreeEntries(categories = state.categories) {
  const byId = new Map(categories.map(category => [category.id, category]));
  const children = new Map();
  const roots = [];
  for (const category of categories) {
    if (category.parentId && byId.has(category.parentId)) {
      const siblings = children.get(category.parentId) || [];
      siblings.push(category);
      children.set(category.parentId, siblings);
    } else {
      roots.push(category);
    }
  }
  const entries = [];
  const visited = new Set();
  const visit = (category, depth) => {
    if (visited.has(category.id)) return;
    visited.add(category.id);
    entries.push({ category, depth });
    for (const child of sortedCategories(children.get(category.id) || [])) visit(child, depth + 1);
  };
  for (const root of sortedCategories(roots)) visit(root, 0);
  for (const category of sortedCategories(categories)) {
    if (!visited.has(category.id)) visit(category, 0);
  }
  return entries;
}

function categoryLabel(category, depth) {
  const indent = depth > 0 ? `${'  '.repeat(depth)}↳ ` : '';
  return `${indent}${category.name}`;
}

function descendantCategoryIds(categoryId) {
  const children = new Map();
  for (const category of state.categories) {
    if (!category.parentId) continue;
    const ids = children.get(category.parentId) || [];
    ids.push(category.id);
    children.set(category.parentId, ids);
  }
  const descendants = new Set();
  const pending = [...(children.get(categoryId) || [])];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || descendants.has(id)) continue;
    descendants.add(id);
    pending.push(...(children.get(id) || []));
  }
  return descendants;
}

function renderCategoryOptions() {
  const select = $('#catalog-category');
  if (!select) return;
  const current = select.value;
  select.replaceChildren(new Option('Sin categoría', ''));
  for (const { category, depth } of categoryTreeEntries()) {
    select.append(new Option(categoryLabel(category, depth), category.id));
  }
  select.value = current;
}

function renderCategoryParentOptions(category = selectedCategory(), presetParentId = state.categoryCreateParentId) {
  const select = $('#category-parent');
  if (!select) return;
  const current = category ? (category.parentId || '') : presetParentId;
  const excluded = category ? descendantCategoryIds(category.id) : new Set();
  if (category) excluded.add(category.id);
  select.replaceChildren(new Option('Sin padre · categoría raíz', ''));
  for (const { category: candidate, depth } of categoryTreeEntries()) {
    if (excluded.has(candidate.id)) continue;
    select.append(new Option(categoryLabel(candidate, depth), candidate.id));
  }
  select.value = current;
}

function renderUnitOptions() {
  const select = $('#catalog-package-unit');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Sin formato</option>' + state.units
    .map(unit => `<option value="${escapeHtml(unit)}">${escapeHtml(unit)}</option>`)
    .join('');
  select.value = current;
}

function renderParents(product) {
  const select = $('#catalog-parent-select');
  if (!select) return;
  select.innerHTML = '<option value="">Selecciona un producto padre</option>' + state.catalog.parents
    .map(parent => `<option value="${escapeHtml(parent.id)}">${escapeHtml(parent.name)} (${parent.variantCount})</option>`)
    .join('');
  select.value = product?.canonicalProductId || '';
}

function retailerSummary(product) {
  if (!product.retailerNames?.length) return 'Sin nombres de comercio';
  return product.retailerNames.slice(0, 2).map(entry => `${entry.retailerName}: ${entry.title}`).join(' · ');
}

function latestPriceSummary(product) {
  if (!product.latestPrices?.length) return 'Sin precios confirmados';
  return product.latestPrices.slice(0, 2).map(entry => {
    const location = entry.storeName || entry.retailerName;
    return `${location}: ${formatEuroMinor(entry.priceMinor)}`;
  }).join(' · ');
}

function renderCatalogProducts({ append = false } = {}) {
  const container = $('#catalog-products');
  if (!container) return;
  const products = state.catalog.products;
  if (!append) container.replaceChildren();
  if (products.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'catalog-empty';
    empty.innerHTML = '<strong>No hay productos que mostrar.</strong><span>Los productos confirmados en tus tickets y los que vincules desde listas aparecerán aquí.</span>';
    container.replaceChildren(empty);
  } else {
    const existingIds = new Set([...container.querySelectorAll('[data-catalog-product-id]')].map(element => element.dataset.catalogProductId));
    for (const product of products) {
      if (existingIds.has(product.id)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'catalog-product-row';
      button.dataset.catalogProductId = product.id;
      button.setAttribute('aria-pressed', String(product.id === state.selectedProductId));
      button.innerHTML = `
        <span class="catalog-product-row__copy">
          <strong>${escapeHtml(product.variantName)}</strong>
          <small>${escapeHtml(product.canonicalName)}${product.categoryName ? ` · ${escapeHtml(product.categoryName)}` : ''}</small>
          <small>${escapeHtml(retailerSummary(product))}</small>
          <small>${escapeHtml(latestPriceSummary(product))}</small>
        </span>
        <span class="catalog-product-row__action">Ver ficha</span>`;
      button.addEventListener('click', () => selectCatalogProduct(product.id));
      container.append(button);
    }
  }
  $('#catalog-product-count').textContent = String(products.length);
  const loadMore = $('#catalog-load-more');
  if (loadMore) loadMore.hidden = !state.catalog.hasMore;
}

function renderCategoryTree() {
  const container = $('#category-tree');
  if (!container) return;
  container.replaceChildren();
  if (state.categories.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'catalog-empty';
    empty.innerHTML = '<strong>No hay categorías disponibles.</strong><span>Crea una categoría para empezar el inventario.</span>';
    container.append(empty);
  } else {
    for (const { category, depth } of categoryTreeEntries()) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'category-row';
      row.dataset.categoryId = category.id;
      row.style.setProperty('--category-depth', String(depth));
      row.setAttribute('aria-pressed', String(category.id === state.selectedCategoryId));
      const swatch = document.createElement('span');
      swatch.className = 'category-swatch';
      swatch.style.backgroundColor = normalizedCategoryColor(category.color);
      swatch.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      copy.className = 'category-row__copy';
      const name = document.createElement('strong');
      name.textContent = category.name;
      const meta = document.createElement('small');
      meta.textContent = category.parentId ? 'Subcategoría' : 'Categoría raíz';
      copy.append(name, meta);
      const action = document.createElement('span');
      action.className = 'catalog-product-row__action';
      action.textContent = 'Editar';
      row.append(swatch, copy, action);
      row.addEventListener('click', () => selectCategory(category.id));
      container.append(row);
    }
  }
  $('#category-count').textContent = String(state.categories.length);
}

function renderRetailerNames(product) {
  const container = $('#catalog-retailer-names');
  if (!container) return;
  container.replaceChildren();
  if (!product?.retailerNames?.length) {
    const empty = document.createElement('p');
    empty.className = 'field-help';
    empty.textContent = 'Todavía no hay nombres específicos por comercio.';
    container.append(empty);
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
      $('#catalog-retailer-title').focus();
    });
    container.append(row);
  }
}

function renderLatestPrices(product) {
  const container = $('#catalog-latest-prices');
  if (!container) return;
  container.replaceChildren();
  if (!product?.latestPrices?.length) {
    const empty = document.createElement('p');
    empty.className = 'field-help';
    empty.textContent = 'Todavía no hay precios confirmados con comercio para esta variante.';
    container.append(empty);
    return;
  }
  for (const entry of product.latestPrices) {
    const row = document.createElement('div');
    row.className = 'catalog-retailer-row';
    const location = entry.storeName ? `${entry.retailerName} · ${entry.storeName}` : entry.retailerName;
    const observed = Number.isNaN(Date.parse(entry.observedAt)) ? entry.observedAt : CATALOG_DATE_FORMATTER.format(new Date(entry.observedAt));
    row.innerHTML = `<span><strong>${escapeHtml(location)}</strong><small>Observado ${escapeHtml(observed)}</small></span><span>${escapeHtml(formatEuroMinor(entry.priceMinor))}</span>`;
    container.append(row);
  }
}

function populateProductForm(product) {
  const detail = $('#catalog-detail');
  if (!detail) return;
  detail.hidden = !product;
  if (!product) return;
  $('#catalog-detail-title').textContent = product.variantName;
  $('#catalog-canonical-name').value = product.canonicalName || '';
  $('#catalog-variant-name').value = product.variantName || '';
  $('#catalog-brand').value = product.brand || '';
  $('#catalog-ean').value = product.ean || '';
  $('#catalog-description').value = product.description || '';
  $('#catalog-aliases').value = (product.aliases || []).join('\n');
  $('#catalog-package-minor').value = product.packageMinor ?? '';
  $('#catalog-category').value = product.categoryId || '';
  $('#catalog-package-unit').value = product.packageUnit || '';
  $('#catalog-product-status').textContent = 'Guardado';
  $('#catalog-product-form-state').textContent = '';
  $('#catalog-parent-state').textContent = '';
  $('#catalog-retailer-state').textContent = '';
  $('#catalog-new-parent-name').value = '';
  $('#catalog-retailer-name').value = '';
  $('#catalog-retailer-title').value = '';
  renderParents(product);
  renderRetailerNames(product);
  renderLatestPrices(product);
}

function populateCategoryForm(category) {
  const creating = !category;
  const protectedFallback = category?.name.toLocaleLowerCase('es-ES') === UNKNOWN_CATEGORY_NAME;
  $('#category-form-title').textContent = creating ? 'Nueva categoría' : category.name;
  $('#category-form-status').textContent = creating ? 'Nueva' : 'Guardada';
  $('#category-name').value = category?.name || '';
  $('#category-name').disabled = protectedFallback;
  $('#category-color').value = normalizedCategoryColor(category?.color);
  $('#category-color-value').textContent = normalizedCategoryColor(category?.color);
  $('#category-description').value = category?.description || '';
  $('#category-parent').disabled = protectedFallback;
  $('#category-protected-note').hidden = !protectedFallback;
  $('#category-add-child').hidden = creating;
  $('#category-form-state').textContent = '';
  renderCategoryParentOptions(category);
}

function selectCatalogProduct(productId) {
  state.selectedProductId = productId;
  document.querySelectorAll('[data-catalog-product-id]').forEach(element => {
    element.setAttribute('aria-pressed', String(element.dataset.catalogProductId === productId));
  });
  populateProductForm(selectedProduct());
  if (matchMedia('(max-width: 51.99rem)').matches) $('#catalog-detail')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function selectCategory(categoryId) {
  state.selectedCategoryId = categoryId;
  state.categoryCreateParentId = '';
  document.querySelectorAll('[data-category-id]').forEach(element => {
    element.setAttribute('aria-pressed', String(element.dataset.categoryId === categoryId));
  });
  populateCategoryForm(selectedCategory());
  if (matchMedia('(max-width: 51.99rem)').matches) $('#category-detail')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function startCreateCategory(parentId = '') {
  state.selectedCategoryId = '';
  state.categoryCreateParentId = parentId;
  document.querySelectorAll('[data-category-id]').forEach(element => element.setAttribute('aria-pressed', 'false'));
  populateCategoryForm(undefined);
  $('#category-name')?.focus();
}

async function loadCategories({ force = false } = {}) {
  if (!force && state.categories.length > 0) return state.categories;
  setCategoryStatus('Cargando categorías…');
  try {
    const result = await api('/api/v1/categories');
    state.categories = Array.isArray(result.categories) ? result.categories : [];
    renderCategoryTree();
    renderCategoryOptions();
    if (state.selectedCategoryId && !selectedCategory()) startCreateCategory();
    else populateCategoryForm(selectedCategory());
    setCategoryStatus(`${state.categories.length} categorías disponibles.`, 'success');
    return state.categories;
  } catch (error) {
    setCategoryStatus(`No se pudieron cargar las categorías: ${error.message}`, 'error');
    throw error;
  }
}

async function ensureCatalogMetadata() {
  if (state.categories.length > 0 && state.units.length > 0) return;
  const [categoriesResult, metadata] = await Promise.all([
    state.categories.length > 0 ? { categories: state.categories } : api('/api/v1/categories'),
    state.units.length > 0 ? { units: state.units } : api('/api/v1/meta'),
  ]);
  state.categories = categoriesResult.categories || [];
  state.units = metadata.units || [];
  renderCategoryTree();
  renderCategoryOptions();
  renderUnitOptions();
}

async function loadCatalog({ reset = false } = {}) {
  const generation = ++state.loadGeneration;
  state.loadController?.abort();
  const controller = new AbortController();
  state.loadController = controller;
  const query = $('#catalog-search')?.value.trim() || '';
  const offset = reset ? 0 : state.catalog.products.length;
  setCatalogStatus(reset ? 'Cargando catálogo…' : 'Cargando más productos…');
  try {
    await ensureCatalogMetadata();
    const result = await api(`/api/v1/catalog?q=${encodeURIComponent(query)}&limit=${CATALOG_PAGE_SIZE}&offset=${offset}`, { signal: controller.signal });
    if (generation !== state.loadGeneration) return;
    const next = result.catalog || { products: [], parents: [], hasMore: false, offset, limit: CATALOG_PAGE_SIZE };
    state.catalog = {
      ...next,
      products: reset ? (next.products || []) : [...state.catalog.products, ...(next.products || [])],
    };
    if (reset && state.selectedProductId && !state.catalog.products.some(product => product.id === state.selectedProductId)) {
      state.selectedProductId = '';
      populateProductForm(undefined);
    }
    renderCatalogProducts({ append: !reset });
    if (state.selectedProductId) populateProductForm(selectedProduct());
    setCatalogStatus(state.catalog.products.length === 0 ? 'No hay productos para este filtro.' : `${state.catalog.products.length} productos cargados.`, 'success');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    setCatalogStatus(`No se pudo cargar el catálogo: ${error.message}`, 'error');
  } finally {
    if (generation === state.loadGeneration) state.loadController = null;
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
  $('#catalog-product-form-state').textContent = '';
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
    if (!payload.canonicalName || !payload.variantName) throw new Error('El nombre canónico y el nombre de variante son obligatorios.');
    await api(`/api/v1/products/${encodeURIComponent(product.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
    $('#catalog-product-form-state').textContent = 'Ficha guardada.';
    $('#catalog-product-status').textContent = 'Guardado';
    await loadCatalog({ reset: true });
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
    $('#category-form-state').textContent = 'El nombre de la categoría es obligatorio.';
    $('#category-name').focus();
    return;
  }
  setBusy(button, true);
  $('#category-form-status').textContent = 'Guardando…';
  $('#category-form-state').textContent = '';
  try {
    const result = await api(current ? `/api/v1/categories/${encodeURIComponent(current.id)}` : '/api/v1/categories', {
      method: current ? 'PATCH' : 'POST',
      body: JSON.stringify({ name, parentId, color, description }),
    });
    const savedId = result.category?.id;
    await loadCategories({ force: true });
    if (savedId) selectCategory(savedId);
    $('#category-form-status').textContent = 'Guardada';
    $('#category-form-state').textContent = current ? 'Categoría actualizada.' : 'Categoría creada.';
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
  if (canonicalProductId === product.canonicalProductId) {
    $('#catalog-parent-state').textContent = 'Esta variante ya pertenece a ese producto padre.';
    return;
  }
  setBusy(button, true);
  try {
    await api(`/api/v1/catalog/products/${encodeURIComponent(product.id)}/parent`, {
      method: 'PUT',
      body: JSON.stringify({ canonicalProductId }),
    });
    $('#catalog-parent-state').textContent = 'Variante relacionada con el producto padre.';
    await loadCatalog({ reset: true });
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
    await api(`/api/v1/catalog/products/${encodeURIComponent(product.id)}/parent`, {
      method: 'PUT',
      body: JSON.stringify({ newParentName }),
    });
    $('#catalog-parent-state').textContent = 'Producto padre creado y relacionado.';
    await loadCatalog({ reset: true });
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
    $('#catalog-retailer-state').textContent = 'Indica el comercio y el nombre que usa para el producto.';
    return;
  }
  setBusy(button, true);
  try {
    await api(`/api/v1/catalog/products/${encodeURIComponent(product.id)}/retailer-name`, {
      method: 'PUT',
      body: JSON.stringify({ retailerName, title }),
    });
    $('#catalog-retailer-state').textContent = 'Nombre del comercio guardado.';
    await loadCatalog({ reset: true });
  } catch (error) {
    $('#catalog-retailer-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function goHome() {
  document.querySelector('.bottom-nav [data-nav="home"]')?.click();
}

function installCatalogInteractions() {
  $('#catalog-home')?.addEventListener('click', goHome);
  $('#categories-home')?.addEventListener('click', goHome);
  $('#catalog-product-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void saveSelectedProduct($('#catalog-save-product'));
  });
  $('#category-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void saveCategory($('#category-save'));
  });
  $('#category-new')?.addEventListener('click', () => startCreateCategory());
  $('#category-add-child')?.addEventListener('click', () => {
    const current = selectedCategory();
    if (current) startCreateCategory(current.id);
  });
  $('#category-color')?.addEventListener('input', event => {
    $('#category-color-value').textContent = normalizedCategoryColor(event.currentTarget.value);
  });
  $('#catalog-link-parent')?.addEventListener('click', event => void linkSelectedParent(event.currentTarget));
  $('#catalog-create-parent')?.addEventListener('click', event => void createParentForSelected(event.currentTarget));
  $('#catalog-save-retailer-name')?.addEventListener('click', event => void saveRetailerName(event.currentTarget));
  $('#catalog-load-more')?.addEventListener('click', event => {
    setBusy(event.currentTarget, true);
    void loadCatalog({ reset: false }).finally(() => setBusy(event.currentTarget, false));
  });
  $('#catalog-search')?.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => void loadCatalog({ reset: true }), CATALOG_SEARCH_DELAY_MS);
  });
}

export function initializeCatalogFeature({ activate = false, activateCategories = false } = {}) {
  if (state.initialized) {
    if (activateCategories) void activateCategories();
    else if (activate) void activateCatalog();
    return;
  }
  state.initialized = true;
  injectStylesheet();
  installCatalogView();
  installCategoryView();
  installHomeEntries();
  installCatalogInteractions();
  hydrateIcons(document.querySelector('.view[data-view="catalog"]') || document);
  hydrateIcons(document.querySelector('.view[data-view="categories"]') || document);
  if (activateCategories) void activateCategories();
  else if (activate) void activateCatalog();
}

function autoInitializeCatalogFeature() {
  const requested = location.hash.slice(1);
  initializeCatalogFeature({
    activate: requested === 'catalog',
    activateCategories: requested === 'categories',
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInitializeCatalogFeature, { once: true });
} else {
  autoInitializeCatalogFeature();
}
