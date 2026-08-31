import { api, setBusy } from './api.js';
import { escapeHtml, euroInputToMinor, hydrateIcons, minorToEuroInput } from './ui.js';

const CATALOG_PAGE_SIZE = 50;
const CATALOG_SEARCH_DELAY_MS = 250;
const RECEIPT_CALCULATION_DELAY_MS = 120;
const RECEIPT_CALCULATION_PATH = '/api/v1/receipts/calculate-line';
const receiptCalculationState = new WeakMap();

const $ = selector => document.querySelector(selector);

const state = {
  initialized: false,
  catalog: { products: [], parents: [], hasMore: false, offset: 0, limit: CATALOG_PAGE_SIZE },
  categories: [],
  units: [],
  selectedProductId: '',
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
        <h1>Productos guardados</h1>
        <p>Reutiliza una ficha, agrupa variantes bajo el mismo producto y guarda cómo se llama en cada comercio.</p>
      </div>
      <button id="catalog-home" class="button secondary" type="button"><span data-icon="home"></span>Inicio</button>
    </div>
    <section class="surface catalog-toolbar" aria-labelledby="catalog-search-title">
      <div>
        <h2 id="catalog-search-title">Buscar en el catálogo</h2>
        <p class="field-help">Busca por producto, variante, marca, alias o nombre de comercio.</p>
      </div>
      <label class="field catalog-search-field">
        <span>Buscar productos guardados</span>
        <input id="catalog-search" type="search" maxlength="160" autocomplete="off" placeholder="Ej. leche, arroz o Mercadona">
      </label>
      <p id="catalog-state" class="inline-status" role="status" aria-live="polite"></p>
    </section>
    <div class="catalog-layout">
      <section class="surface catalog-browser" aria-labelledby="catalog-products-title">
        <div class="section-header">
          <div><p class="eyebrow">Variantes</p><h2 id="catalog-products-title">Guardados</h2></div>
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

function installHomeEntry() {
  const grid = document.querySelector('.view[data-view="home"] .dashboard-grid');
  if (!grid || grid.querySelector('[data-catalog-entry]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dashboard-card';
  button.dataset.catalogEntry = 'true';
  button.innerHTML = '<span data-icon="store"></span><strong>Productos guardados</strong><small>Editar y relacionar catálogo</small>';
  button.addEventListener('click', () => void activateCatalog());
  grid.append(button);
  document.dispatchEvent(new CustomEvent('basketra:hydrate-icons', { detail: { root: button } }));
}

function activateCatalog() {
  const view = document.querySelector('.view[data-view="catalog"]');
  if (!view) return Promise.resolve();
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element === view));
  document.querySelectorAll('.bottom-nav [data-nav]').forEach(element => element.removeAttribute('aria-current'));
  history.replaceState(null, '', '#catalog');
  document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: 'catalog' } }));
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo(0, 0);
  $('#main')?.focus({ preventScroll: true });
  return loadCatalog({ reset: true });
}

function setCatalogStatus(message, stateName = '') {
  const element = $('#catalog-state');
  if (!element) return;
  element.textContent = message;
  if (stateName) element.dataset.state = stateName;
  else delete element.dataset.state;
}

function selectedProduct() {
  return state.catalog.products.find(product => product.id === state.selectedProductId);
}

function renderCategoryOptions() {
  const select = $('#catalog-category');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Sin categoría</option>' + state.categories
    .map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`)
    .join('');
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

function renderCatalogProducts({ append = false } = {}) {
  const container = $('#catalog-products');
  if (!container) return;
  const products = state.catalog.products;
  if (!append) container.replaceChildren();
  if (products.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'catalog-empty';
    empty.innerHTML = '<strong>No hay productos que mostrar.</strong><span>Los productos reutilizables que guardes desde tus listas aparecerán aquí.</span>';
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
        </span>
        <span class="catalog-product-row__action">Editar</span>`;
      button.addEventListener('click', () => selectCatalogProduct(product.id));
      container.append(button);
    }
  }
  $('#catalog-product-count').textContent = String(products.length);
  const loadMore = $('#catalog-load-more');
  if (loadMore) loadMore.hidden = !state.catalog.hasMore;
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
}

function selectCatalogProduct(productId) {
  state.selectedProductId = productId;
  document.querySelectorAll('[data-catalog-product-id]').forEach(element => {
    element.setAttribute('aria-pressed', String(element.dataset.catalogProductId === productId));
  });
  populateProductForm(selectedProduct());
  if (matchMedia('(max-width: 51.99rem)').matches) $('#catalog-detail')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function ensureCatalogMetadata() {
  if (state.categories.length > 0 && state.units.length > 0) return;
  const [categoriesResult, metadata] = await Promise.all([
    api('/api/v1/categories'),
    api('/api/v1/meta'),
  ]);
  state.categories = categoriesResult.categories || [];
  state.units = metadata.units || [];
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
  setCatalogStatus(reset ? 'Cargando productos guardados…' : 'Cargando más productos…');
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
    setCatalogStatus(state.catalog.products.length === 0 ? 'No hay productos guardados para este filtro.' : `${state.catalog.products.length} productos cargados.`, 'success');
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

function installCatalogInteractions() {
  $('#catalog-home')?.addEventListener('click', () => document.querySelector('.bottom-nav [data-nav="home"]')?.click());
  $('#catalog-product-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void saveSelectedProduct($('#catalog-save-product'));
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
  document.addEventListener('basketra:view-changed', event => {
    if (event.detail?.view === 'catalog') void loadCatalog({ reset: true });
  });
}

function receiptLineRoot(element) {
  return element.closest('.receipt-item, [data-receipt-line-editor]');
}

function receiptLineField(root, field) {
  return root?.querySelector(`[data-field="${field}"]`);
}

function markDerivedTotal(root) {
  const total = receiptLineField(root, 'lineTotalEuro');
  if (!(total instanceof HTMLInputElement)) return;
  total.readOnly = true;
  total.setAttribute('aria-readonly', 'true');
  total.dataset.derivedTotal = 'true';
  const label = total.closest('label');
  const labelText = label?.querySelector('span');
  if (labelText && !labelText.dataset.derivedLabel) {
    labelText.dataset.derivedLabel = 'true';
    labelText.textContent = 'Total calculado (€)';
  }
}

function readReceiptCalculationInput(root) {
  const quantityInput = receiptLineField(root, 'quantity');
  const unitPriceInput = receiptLineField(root, 'unitPriceEuro');
  const discountInput = receiptLineField(root, 'discountEuro');
  if (!(quantityInput instanceof HTMLInputElement) || !(unitPriceInput instanceof HTMLInputElement)) return undefined;
  const quantity = Number(quantityInput.value);
  if (!Number.isSafeInteger(quantity) || quantity < 0) return undefined;
  try {
    return {
      quantity,
      unitPriceMinor: euroInputToMinor(unitPriceInput.value),
      ...(discountInput instanceof HTMLInputElement && discountInput.value.trim()
        ? { discountMinor: euroInputToMinor(discountInput.value) }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function receiptCalculationStatus(root, message) {
  const status = root?.querySelector('.receipt-line-derived-state');
  if (status) status.textContent = message;
}

async function calculateReceiptLine(root) {
  const input = readReceiptCalculationInput(root);
  if (!input) return;
  const total = receiptLineField(root, 'lineTotalEuro');
  if (!(total instanceof HTMLInputElement)) return;
  let calculation = receiptCalculationState.get(root);
  if (!calculation) {
    calculation = { controller: null, timer: null, version: 0 };
    receiptCalculationState.set(root, calculation);
  }
  calculation.controller?.abort();
  const controller = new AbortController();
  calculation.controller = controller;
  const version = ++calculation.version;
  total.setAttribute('aria-busy', 'true');
  receiptCalculationStatus(root, 'Calculando total…');
  try {
    const result = await api(RECEIPT_CALCULATION_PATH, {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify(input),
    });
    if (version !== calculation.version || !root.isConnected) return;
    total.value = minorToEuroInput(result.lineTotalMinor);
    total.dispatchEvent(new Event('input', { bubbles: true }));
    receiptCalculationStatus(root, 'Total actualizado.');
  } catch (error) {
    if (error?.name === 'AbortError' || version !== calculation.version) return;
    receiptCalculationStatus(root, `No se pudo calcular el total: ${error.message}`);
  } finally {
    if (version === calculation.version) total.setAttribute('aria-busy', 'false');
  }
}

function scheduleReceiptLineCalculation(root, immediate = false) {
  if (!root) return;
  markDerivedTotal(root);
  let calculation = receiptCalculationState.get(root);
  if (!calculation) {
    calculation = { controller: null, timer: null, version: 0 };
    receiptCalculationState.set(root, calculation);
  }
  clearTimeout(calculation.timer);
  calculation.controller?.abort();
  const input = readReceiptCalculationInput(root);
  if (!input) {
    receiptCalculationStatus(root, 'Completa cantidad, precio y descuento para calcular el total.');
    return;
  }
  calculation.timer = setTimeout(() => void calculateReceiptLine(root), immediate ? 0 : RECEIPT_CALCULATION_DELAY_MS);
}

function enhanceReceiptLine(root) {
  if (!root) return;
  markDerivedTotal(root);
  if (!root.querySelector('.receipt-line-derived-state')) {
    const total = receiptLineField(root, 'lineTotalEuro');
    const label = total?.closest('label');
    if (label) {
      const status = document.createElement('small');
      status.className = 'receipt-line-derived-state field-help';
      status.setAttribute('aria-live', 'polite');
      status.textContent = 'Se actualiza al cambiar cantidad, precio o descuento.';
      label.append(status);
    }
  }
}

function installDerivedReceiptTotals() {
  const enhanceExisting = root => root.querySelectorAll?.('.receipt-item, [data-receipt-line-editor]').forEach(enhanceReceiptLine);
  enhanceExisting(document);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.receipt-item, [data-receipt-line-editor]')) enhanceReceiptLine(node);
        enhanceExisting(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const driverFields = new Set(['quantity', 'unitPriceEuro', 'discountEuro']);
  document.addEventListener('input', event => {
    if (!driverFields.has(event.target?.dataset?.field)) return;
    scheduleReceiptLineCalculation(receiptLineRoot(event.target), false);
  }, true);
  document.addEventListener('change', event => {
    if (!driverFields.has(event.target?.dataset?.field)) return;
    scheduleReceiptLineCalculation(receiptLineRoot(event.target), true);
  }, true);
}

export function initializeCatalogFeature({ activate = false } = {}) {
  if (state.initialized) {
    if (activate) void activateCatalog();
    return;
  }
  state.initialized = true;
  injectStylesheet();
  installCatalogView();
  installHomeEntry();
  installCatalogInteractions();
  installDerivedReceiptTotals();
  hydrateIcons(document.querySelector('.view[data-view="catalog"]') || document);
  if (activate) void activateCatalog();
}
