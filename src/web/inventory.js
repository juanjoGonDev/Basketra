import { api, setBusy } from './api.js';
import { escapeHtml, formatEuroMinor, hydrateIcons } from './ui.js';

const STORE_PAGE_SIZE = 12;
const SEARCH_DELAY_MS = 250;
const DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' });
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
const OVERVIEW_DESTINATIONS = ['catalog', 'categories', 'stores'] as const;

const $ = selector => document.querySelector(selector);

const state = {
  initialized: false,
  overview: { productCount: 0, categoryCount: 0, storeCount: 0, latestCatalogValueMinor: 0 },
  overviewLoadGeneration: 0,
  overviewLoadController: null,
  stores: { stores: [], total: 0, offset: 0, limit: STORE_PAGE_SIZE, hasMore: false },
  storePage: 1,
  storeQuery: '',
  storeRetailer: '',
  storeSort: 'name',
  selectedStore: null,
  searchTimer: null,
  storeLoadGeneration: 0,
  storeLoadController: null,
  statisticsPeriod: '30d',
  statistics: null,
  statisticsLoadGeneration: 0,
  statisticsLoadController: null,
};

function injectStylesheet() {
  if (document.querySelector('link[href="/inventory.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/inventory.css';
  document.head.append(link);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : DATE_FORMATTER.format(date);
}

function formatDateTime(value) {
  if (!value) return 'Sin actividad';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : DATE_TIME_FORMATTER.format(date);
}

function installOverviewView() {
  const view = document.querySelector('.view[data-view="inventory"]');
  if (!view || view.dataset.inventoryOverviewEnhanced === 'true') return;
  view.dataset.inventoryOverviewEnhanced = 'true';
  view.innerHTML = `
    <section class="inventory-overview-shell" aria-labelledby="inventory-overview-title">
      <header class="inventory-entity-header inventory-overview-header">
        <div><p class="eyebrow">Inventario</p><h1 id="inventory-overview-title">Inventario</h1><p>Gestiona productos, categorías y tiendas desde un único punto y revisa métricas derivadas de datos persistidos.</p></div>
        <button id="inventory-overview-new-product" class="button primary" type="button"><span data-icon="plus"></span>Nuevo producto</button>
      </header>
      <nav class="task-tablist inventory-overview-tabs" aria-label="Secciones de inventario">
        <button class="task-tab" type="button" data-inventory-destination="catalog">Productos</button>
        <button class="task-tab" type="button" data-inventory-destination="categories">Categorías</button>
        <button class="task-tab" type="button" data-inventory-destination="stores">Tiendas</button>
        <button class="task-tab" type="button" data-inventory-destination="inventory-statistics">Estadísticas</button>
      </nav>
      <p id="inventory-overview-state" class="inline-status" role="status" aria-live="polite"></p>
      <section class="inventory-kpi-grid inventory-overview-kpis" aria-label="Resumen del inventario">
        <article class="surface inventory-kpi"><span>Productos</span><strong id="inventory-overview-products">—</strong><small>Variantes persistidas en el catálogo.</small></article>
        <article class="surface inventory-kpi"><span>Categorías</span><strong id="inventory-overview-categories">—</strong><small>Categorías disponibles en la jerarquía.</small></article>
        <article class="surface inventory-kpi"><span>Tiendas</span><strong id="inventory-overview-stores">—</strong><small>Ubicaciones físicas guardadas.</small></article>
        <article class="surface inventory-kpi"><span>Valor catálogo reciente</span><strong id="inventory-overview-value">—</strong><small>Último precio conocido por producto; no representa stock.</small></article>
      </section>
      <form id="inventory-overview-search-form" class="surface inventory-overview-query" aria-label="Buscar en inventario">
        <label class="field inventory-overview-search"><span>Buscar</span><input id="inventory-overview-search" type="search" maxlength="160" autocomplete="off" placeholder="Producto, categoría o tienda"></label>
        <label class="field"><span>Buscar en</span><select id="inventory-overview-scope"><option value="catalog">Productos</option><option value="categories">Categorías</option><option value="stores">Tiendas</option></select></label>
        <label class="field"><span>Orden</span><select id="inventory-overview-sort"><option value="recent">Recientes</option><option value="name">Nombre A-Z</option></select></label>
        <div class="inventory-overview-query-actions"><button class="button primary" type="submit"><span data-icon="search"></span>Buscar</button><button id="inventory-overview-open-filters" class="button secondary" type="button">Abrir filtros</button></div>
        <div class="inventory-overview-chips" aria-label="Búsqueda rápida por tipo">
          <button class="button secondary" type="button" data-inventory-scope="catalog" aria-pressed="true">Productos</button>
          <button class="button secondary" type="button" data-inventory-scope="categories" aria-pressed="false">Categorías</button>
          <button class="button secondary" type="button" data-inventory-scope="stores" aria-pressed="false">Tiendas</button>
        </div>
      </form>
      <section class="surface inventory-overview-sections" aria-labelledby="inventory-sections-title">
        <div class="section-header"><div><p class="eyebrow">Gestión</p><h2 id="inventory-sections-title">Explora el inventario</h2></div></div>
        <div class="dashboard-grid inventory-overview-cards">
          <button class="dashboard-card" type="button" data-inventory-destination="catalog"><span data-icon="store"></span><strong>Productos</strong><small>Buscar, filtrar y abrir fichas</small></button>
          <button class="dashboard-card" type="button" data-inventory-destination="categories"><span data-icon="list"></span><strong>Categorías</strong><small>Jerarquía, detalle y nuevas categorías</small></button>
          <button class="dashboard-card" type="button" data-inventory-destination="stores"><span data-icon="store"></span><strong>Tiendas</strong><small>Listado, detalle y actividad</small></button>
          <button class="dashboard-card" type="button" data-inventory-destination="inventory-statistics"><span data-icon="prices"></span><strong>Estadísticas</strong><small>KPIs, categorías y tiendas</small></button>
        </div>
      </section>
      <aside class="surface inventory-overview-guidance" role="note"><span data-icon="info"></span><div><strong>Datos canónicos, sin inventar stock</strong><p>Los importes y recuentos proceden del servidor. Basketra no muestra valoración ni alertas de stock mientras no exista una cantidad de stock canónica.</p></div></aside>
    </section>`;
  hydrateIcons(view);
}

function installStoreView() {
  const view = document.querySelector('.view[data-view="stores"]');
  if (!view || view.dataset.inventoryEnhanced === 'true') return;
  view.dataset.inventoryEnhanced = 'true';
  view.innerHTML = `
    <section id="store-list-screen" class="inventory-list-screen" aria-labelledby="stores-page-title">
      <header class="inventory-entity-header">
        <div><p class="eyebrow">Inventario · Tiendas</p><h1 id="stores-page-title">Tiendas</h1><p>Gestiona ubicaciones físicas y revisa la actividad realmente asociada a cada tienda.</p></div>
        <div class="inventory-header-actions"><button id="stores-back-inventory" class="button secondary" type="button"><span data-icon="chevronUp" class="icon-rotate-left"></span>Inventario</button><button id="store-new" class="button primary" type="button"><span data-icon="plus"></span>Nueva tienda</button></div>
      </header>
      <section class="surface inventory-toolbar" aria-label="Filtros de tiendas">
        <label class="field inventory-search-field"><span>Buscar</span><input id="store-search" type="search" maxlength="160" autocomplete="off" placeholder="Tienda, cadena, dirección o región"></label>
        <label class="field"><span>Cadena</span><input id="store-retailer-filter" maxlength="160" autocomplete="organization" placeholder="Todas"></label>
        <label class="field"><span>Orden</span><select id="store-sort"><option value="name">Nombre A-Z</option><option value="activity">Actividad reciente</option><option value="recent">Creación reciente</option></select></label>
        <button id="store-clear-filters" class="button secondary" type="button">Limpiar filtros</button>
      </section>
      <p id="store-state" class="inline-status" role="status" aria-live="polite"></p>
      <section class="surface inventory-list-surface" aria-label="Listado de tiendas">
        <div class="inventory-list-heading inventory-store-grid" aria-hidden="true"><span>Tienda</span><span>Ubicación</span><span>Productos</span><span>Tickets</span><span>Última actividad</span><span></span></div>
        <div id="store-list" class="inventory-store-list" aria-live="polite"></div>
        <footer class="inventory-pagination" aria-label="Paginación de tiendas"><span id="store-range">0 resultados</span><div><button id="store-prev" class="button secondary" type="button">Anterior</button><span id="store-page" class="count-badge">1</span><button id="store-next" class="button secondary" type="button">Siguiente</button></div></footer>
      </section>
    </section>

    <section id="store-detail-screen" class="inventory-detail-screen" aria-labelledby="store-detail-title" hidden>
      <header class="inventory-detail-header">
        <button id="stores-back-list" class="button secondary" type="button"><span data-icon="chevronUp" class="icon-rotate-left"></span>Tiendas</button>
        <div class="inventory-detail-header__copy"><p class="eyebrow">Tienda</p><h1 id="store-detail-title">Detalle de tienda</h1><p id="store-detail-subtitle"></p></div>
        <div class="inventory-header-actions"><button id="store-edit" class="button secondary" type="button"><span data-icon="edit"></span>Editar</button><button id="store-delete" class="button danger" type="button"><span data-icon="trash"></span>Eliminar</button></div>
      </header>
      <div class="inventory-detail-grid">
        <section class="surface inventory-detail-primary">
          <div class="inventory-product-identity"><span class="inventory-product-avatar" data-icon="store"></span><div><p class="eyebrow">Información general</p><h2 id="store-detail-name">—</h2><p id="store-detail-retailer">—</p></div></div>
          <dl class="inventory-definition-grid"><div><dt>Región</dt><dd id="store-detail-region">—</dd></div><div><dt>Dirección</dt><dd id="store-detail-address">—</dd></div><div><dt>Creada</dt><dd id="store-detail-created">—</dd></div><div><dt>Última actividad</dt><dd id="store-detail-activity">—</dd></div></dl>
        </section>
        <aside class="inventory-detail-aside">
          <section class="surface"><p class="eyebrow">Productos</p><h2 id="store-detail-products">0</h2><p>Productos con observaciones de precio vinculadas a esta tienda.</p></section>
          <section class="surface"><p class="eyebrow">Tickets</p><h2 id="store-detail-tickets">0</h2><p>Tickets históricos asignados explícitamente a esta ubicación.</p></section>
          <section class="surface"><p class="eyebrow">Precios</p><h2 id="store-detail-prices">0</h2><p>Observaciones de precio conservadas como evidencia histórica.</p></section>
        </aside>
      </div>
      <section id="store-editor" class="surface inventory-editor" aria-labelledby="store-editor-title" hidden>
        <div class="section-header"><div><p class="eyebrow">Edición</p><h2 id="store-editor-title">Editar tienda</h2></div><span id="store-editor-status" class="status-pill">Guardada</span></div>
        <form id="store-form" class="catalog-form">
          <label class="field"><span>Cadena o comercio</span><input id="store-retailer" maxlength="160" autocomplete="organization" required></label>
          <label class="field"><span>Nombre de la tienda</span><input id="store-name" maxlength="160" autocomplete="organization" required></label>
          <div class="quantity-row"><label class="field"><span>Región</span><input id="store-region" maxlength="160" autocomplete="address-level1"></label><label class="field"><span>Dirección</span><input id="store-address" maxlength="240" autocomplete="street-address"></label></div>
          <details class="progressive-options"><summary>Ubicación y OpenStreetMap</summary><div class="details-body">
            <div class="quantity-row"><label class="field"><span>Latitud</span><input id="store-latitude" type="number" step="0.000001" min="-90" max="90" inputmode="decimal"></label><label class="field"><span>Longitud</span><input id="store-longitude" type="number" step="0.000001" min="-180" max="180" inputmode="decimal"></label></div>
            <div class="quantity-row"><label class="field"><span>Tipo OSM</span><select id="store-osm-type"><option value="">Sin identidad OSM</option><option value="node">Nodo</option><option value="way">Vía</option><option value="relation">Relación</option></select></label><label class="field"><span>ID OSM</span><input id="store-osm-id" maxlength="40"></label></div>
          </div></details>
          <div class="dialog-actions"><button id="store-cancel-edit" class="button secondary" type="button">Cancelar</button><button id="store-save" class="button primary" type="submit"><span data-icon="check"></span>Guardar tienda</button></div>
          <p id="store-form-state" class="inline-status" role="status"></p>
        </form>
      </section>
      <dialog id="store-delete-dialog" class="confirm-dialog" aria-labelledby="store-delete-title"><div class="dialog-content"><span class="dialog-icon" data-icon="alert"></span><h2 id="store-delete-title">Eliminar tienda</h2><p id="store-delete-impact">Comprobando dependencias…</p><p id="store-delete-state" class="inline-status" role="status"></p><div class="dialog-actions"><button id="store-delete-cancel" class="button secondary" type="button">Cancelar</button><button id="store-delete-confirm" class="button danger" type="button" disabled>Eliminar tienda</button></div></div></dialog>
    </section>`;
  hydrateIcons(view);
}

function installStatisticsView() {
  const view = document.querySelector('.view[data-view="inventory-statistics"]');
  if (!view || view.dataset.inventoryEnhanced === 'true') return;
  view.dataset.inventoryEnhanced = 'true';
  view.innerHTML = `
    <section class="inventory-list-screen" aria-labelledby="statistics-page-title">
      <header class="inventory-entity-header"><div><p class="eyebrow">Inventario · Estadísticas</p><h1 id="statistics-page-title">Estadísticas</h1><p>Indicadores derivados de productos, precios y tickets persistidos. No se infiere stock que no exista en el modelo.</p></div><div class="inventory-header-actions"><button id="statistics-back-inventory" class="button secondary" type="button"><span data-icon="chevronUp" class="icon-rotate-left"></span>Inventario</button><label class="inventory-period-control"><span>Periodo</span><select id="statistics-period"><option value="30d">30 días</option><option value="90d">90 días</option><option value="year">1 año</option><option value="all">Todo</option></select></label></div></header>
      <p id="statistics-state" class="inline-status" role="status" aria-live="polite"></p>
      <section id="statistics-kpis" class="inventory-kpi-grid" aria-label="Indicadores principales"></section>
      <div class="inventory-statistics-grid">
        <section class="surface inventory-stat-card" aria-labelledby="statistics-categories-title"><div class="section-header"><div><p class="eyebrow">Categorías</p><h2 id="statistics-categories-title">Actividad por categoría</h2></div></div><div id="statistics-categories-bars" class="inventory-bars" aria-hidden="true"></div><div class="inventory-table-wrap"><table class="inventory-data-table"><thead><tr><th>Categoría</th><th>Productos</th><th>Tickets</th><th>Importe</th></tr></thead><tbody id="statistics-categories-table"></tbody></table></div></section>
        <section class="surface inventory-stat-card" aria-labelledby="statistics-stores-title"><div class="section-header"><div><p class="eyebrow">Tiendas</p><h2 id="statistics-stores-title">Actividad por tienda</h2></div></div><div id="statistics-stores-bars" class="inventory-bars" aria-hidden="true"></div><div class="inventory-table-wrap"><table class="inventory-data-table"><thead><tr><th>Tienda</th><th>Productos</th><th>Tickets</th><th>Importe</th></tr></thead><tbody id="statistics-stores-table"></tbody></table></div></section>
      </div>
      <section class="surface inventory-stat-card" aria-labelledby="statistics-trend-title"><div class="section-header"><div><p class="eyebrow">Tickets</p><h2 id="statistics-trend-title">Evolución del periodo</h2></div></div><div id="statistics-trend-bars" class="inventory-trend" aria-hidden="true"></div><div class="inventory-table-wrap"><table class="inventory-data-table"><thead><tr><th>Fecha</th><th>Tickets</th><th>Importe</th></tr></thead><tbody id="statistics-trend-table"></tbody></table></div></section>
      <aside id="statistics-model-note" class="surface catalog-shared-note" role="note"></aside>
    </section>`;
  hydrateIcons(view);
}

function activateView(viewName, { dispatch = true } = {}) {
  const target = document.querySelector(`.view[data-view="${CSS.escape(viewName)}"]`);
  if (!target) return false;
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view === target));
  document.querySelectorAll('.bottom-nav [data-nav]').forEach(button => button.removeAttribute('aria-current'));
  document.querySelector('.bottom-nav [data-nav="inventory"]')?.setAttribute('aria-current', 'page');
  history.replaceState(null, '', `#${viewName}`);
  if (dispatch) document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: viewName } }));
  window.scrollTo(0, 0);
  $('#main')?.focus({ preventScroll: true });
  return true;
}

function goInventory() {
  const button = document.querySelector('.bottom-nav [data-nav="inventory"]');
  if (button instanceof HTMLButtonElement) button.click();
  else activateView('inventory');
}

function overviewDestination(value) {
  return OVERVIEW_DESTINATIONS.includes(value) ? value : 'catalog';
}

function overviewTarget(destination) {
  if (destination === 'categories') return { search: '#category-search', filter: '#category-filter', sort: null };
  if (destination === 'stores') return { search: '#store-search', filter: '#store-retailer-filter', sort: '#store-sort' };
  return { search: '#catalog-search', filter: '#catalog-filter-category', sort: '#catalog-sort' };
}

function syncOverviewScope() {
  const scope = overviewDestination($('#inventory-overview-scope')?.value);
  const sort = $('#inventory-overview-sort');
  if (sort instanceof HTMLSelectElement) {
    sort.disabled = scope === 'categories';
    if (sort.disabled) sort.value = 'name';
  }
  document.querySelectorAll('[data-inventory-scope]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.inventoryScope === scope));
  });
}

function transferOverviewQuery({ focusFilters = false } = {}) {
  const scope = overviewDestination($('#inventory-overview-scope')?.value);
  const query = $('#inventory-overview-search')?.value.trim() || '';
  const requestedSort = $('#inventory-overview-sort')?.value === 'name' ? 'name' : 'recent';
  if (!activateView(scope)) return;

  requestAnimationFrame(() => {
    const target = overviewTarget(scope);
    const search = $(target.search);
    if (search instanceof HTMLInputElement) search.value = query;

    if (target.sort) {
      const sort = $(target.sort);
      if (sort instanceof HTMLSelectElement) {
        sort.value = requestedSort;
        sort.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (search instanceof HTMLInputElement) {
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (focusFilters) {
      requestAnimationFrame(() => $(target.filter)?.focus({ preventScroll: false }));
    } else {
      requestAnimationFrame(() => search?.focus({ preventScroll: false }));
    }
  });
}

function renderOverview(overview) {
  state.overview = {
    productCount: Number(overview.productCount || 0),
    categoryCount: Number(overview.categoryCount || 0),
    storeCount: Number(overview.storeCount || 0),
    latestCatalogValueMinor: Number(overview.latestCatalogValueMinor || 0),
  };
  $('#inventory-overview-products').textContent = String(state.overview.productCount);
  $('#inventory-overview-categories').textContent = String(state.overview.categoryCount);
  $('#inventory-overview-stores').textContent = String(state.overview.storeCount);
  $('#inventory-overview-value').textContent = formatEuroMinor(Math.max(0, state.overview.latestCatalogValueMinor));
}

async function loadOverview() {
  const generation = ++state.overviewLoadGeneration;
  state.overviewLoadController?.abort();
  const controller = new AbortController();
  state.overviewLoadController = controller;
  $('#inventory-overview-state').textContent = 'Actualizando resumen…';
  try {
    const result = await api('/api/v1/inventory/overview', { signal: controller.signal });
    if (generation !== state.overviewLoadGeneration) return;
    renderOverview(result.overview || {});
    $('#inventory-overview-state').textContent = 'Resumen actualizado con datos persistidos.';
  } catch (error) {
    if (error?.name === 'AbortError' || generation !== state.overviewLoadGeneration) return;
    $('#inventory-overview-state').textContent = `No se pudo cargar el resumen: ${error.message}`;
  } finally {
    if (generation === state.overviewLoadGeneration) state.overviewLoadController = null;
  }
}

function openOverviewDestination(destination) {
  const target = String(destination || '');
  if (target === 'inventory-statistics' || OVERVIEW_DESTINATIONS.includes(target)) activateView(target);
}

function storeQueryString() {
  const params = new URLSearchParams({
    q: state.storeQuery,
    retailer: state.storeRetailer,
    sort: state.storeSort,
    limit: String(STORE_PAGE_SIZE),
    offset: String((state.storePage - 1) * STORE_PAGE_SIZE),
  });
  return params.toString();
}

function renderStoreList() {
  const container = $('#store-list');
  if (!container) return;
  const stores = state.stores.stores || [];
  container.replaceChildren();
  if (!stores.length) {
    const empty = document.createElement('div');
    empty.className = 'catalog-empty';
    empty.innerHTML = '<strong>No hay tiendas para estos filtros.</strong><span>Prueba otra búsqueda o crea una tienda nueva.</span>';
    container.append(empty);
  }
  for (const store of stores) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'inventory-store-row inventory-store-grid';
    row.dataset.storeId = store.id;
    const location = [store.address, store.region].filter(Boolean).join(' · ') || 'Sin ubicación';
    row.innerHTML = `<span class="inventory-product-cell inventory-product-cell--name"><strong>${escapeHtml(store.name)}</strong><small>${escapeHtml(store.retailerName)}</small></span><span>${escapeHtml(location)}</span><strong>${Number(store.productCount || 0)}</strong><strong>${Number(store.ticketCount || 0)}</strong><span>${escapeHtml(formatDateTime(store.lastActivityAt))}</span><span class="inventory-row-action">Ver detalle</span>`;
    row.addEventListener('click', () => void openStoreDetail(store.id));
    container.append(row);
  }
  const total = Number(state.stores.total || 0);
  const offset = Number(state.stores.offset || 0);
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + stores.length, total);
  const pageCount = Math.max(1, Math.ceil(total / STORE_PAGE_SIZE));
  $('#store-range').textContent = `${from}-${to} de ${total}`;
  $('#store-page').textContent = `${state.storePage} / ${pageCount}`;
  $('#store-prev').disabled = state.storePage <= 1;
  $('#store-next').disabled = !state.stores.hasMore;
}

async function loadStores({ resetPage = false } = {}) {
  const generation = ++state.storeLoadGeneration;
  state.storeLoadController?.abort();
  const controller = new AbortController();
  state.storeLoadController = controller;
  if (resetPage) state.storePage = 1;
  state.storeQuery = $('#store-search')?.value.trim() || '';
  state.storeRetailer = $('#store-retailer-filter')?.value.trim() || '';
  $('#store-state').textContent = 'Cargando tiendas…';
  try {
    const result = await api(`/api/v1/inventory/stores?${storeQueryString()}`, { signal: controller.signal });
    if (generation !== state.storeLoadGeneration) return;
    state.stores = result || { stores: [], total: 0, offset: 0, limit: STORE_PAGE_SIZE, hasMore: false };
    renderStoreList();
    $('#store-state').textContent = `${Number(state.stores.total || 0)} tiendas encontradas.`;
  } catch (error) {
    if (error?.name === 'AbortError' || generation !== state.storeLoadGeneration) return;
    $('#store-state').textContent = `No se pudieron cargar las tiendas: ${error.message}`;
  } finally {
    if (generation === state.storeLoadGeneration) state.storeLoadController = null;
  }
}

function renderStoreDetail(store, { creating = false } = {}) {
  state.selectedStore = store || null;
  const title = creating ? 'Nueva tienda' : store.name;
  $('#store-detail-title').textContent = title;
  $('#store-detail-name').textContent = title;
  $('#store-detail-subtitle').textContent = creating ? 'Crea una ubicación física reutilizable.' : store.retailerName;
  $('#store-detail-retailer').textContent = store?.retailerName || 'Pendiente';
  $('#store-detail-region').textContent = store?.region || '—';
  $('#store-detail-address').textContent = store?.address || '—';
  $('#store-detail-created').textContent = creating ? 'Sin guardar' : formatDate(store.createdAt);
  $('#store-detail-activity').textContent = creating ? 'Sin actividad' : formatDateTime(store.lastActivityAt);
  $('#store-detail-products').textContent = String(Number(store?.productCount || 0));
  $('#store-detail-tickets').textContent = String(Number(store?.ticketCount || 0));
  $('#store-detail-prices').textContent = String(Number(store?.priceObservationCount || 0));
  $('#store-edit').hidden = creating;
  $('#store-delete').hidden = creating;
  populateStoreForm(store, { creating });
}

function microdegreesToInput(value) {
  return Number.isSafeInteger(value) ? String(value / 1_000_000) : '';
}

function populateStoreForm(store, { creating = false } = {}) {
  $('#store-editor-title').textContent = creating ? 'Nueva tienda' : 'Editar tienda';
  $('#store-editor-status').textContent = creating ? 'Nueva' : 'Guardada';
  $('#store-retailer').value = store?.retailerName || '';
  $('#store-name').value = store?.name || '';
  $('#store-region').value = store?.region || '';
  $('#store-address').value = store?.address || '';
  $('#store-latitude').value = microdegreesToInput(store?.latitudeMicrodegrees);
  $('#store-longitude').value = microdegreesToInput(store?.longitudeMicrodegrees);
  $('#store-osm-type').value = store?.osmType || '';
  $('#store-osm-id').value = store?.osmId || '';
  $('#store-form-state').textContent = '';
}

async function openStoreDetail(storeId, { edit = false } = {}) {
  const result = await api(`/api/v1/inventory/stores/${encodeURIComponent(storeId)}`);
  $('#store-list-screen').hidden = true;
  $('#store-detail-screen').hidden = false;
  renderStoreDetail(result.store);
  showStoreEditor(edit);
  history.replaceState(null, '', `#stores:${encodeURIComponent(storeId)}`);
  window.scrollTo(0, 0);
}

function startCreateStore() {
  $('#store-list-screen').hidden = true;
  $('#store-detail-screen').hidden = false;
  renderStoreDetail(null, { creating: true });
  showStoreEditor(true);
  history.replaceState(null, '', '#stores:new');
  requestAnimationFrame(() => $('#store-retailer')?.focus());
}

function closeStoreDetail() {
  state.selectedStore = null;
  $('#store-detail-screen').hidden = true;
  $('#store-list-screen').hidden = false;
  $('#store-edit').hidden = false;
  $('#store-delete').hidden = false;
  history.replaceState(null, '', '#stores');
  window.scrollTo(0, 0);
  void loadStores();
}

function showStoreEditor(visible) {
  $('#store-editor').hidden = !visible;
  if (visible) $('#store-editor').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function optionalText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function coordinateMicrodegrees(value, minimum, maximum, label) {
  const normalized = String(value || '').trim().replace(',', '.');
  if (!normalized) return null;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${label} no es válida.`);
  const microdegrees = Math.round(number * 1_000_000);
  if (!Number.isSafeInteger(microdegrees)) throw new Error(`${label} no es válida.`);
  return microdegrees;
}

function storePayload() {
  const retailerName = $('#store-retailer').value.trim();
  const name = $('#store-name').value.trim();
  if (!retailerName || !name) throw new Error('La cadena y el nombre de la tienda son obligatorios.');
  const latitudeMicrodegrees = coordinateMicrodegrees($('#store-latitude').value, -90, 90, 'La latitud');
  const longitudeMicrodegrees = coordinateMicrodegrees($('#store-longitude').value, -180, 180, 'La longitud');
  if ((latitudeMicrodegrees === null) !== (longitudeMicrodegrees === null)) throw new Error('Indica latitud y longitud juntas.');
  const osmType = optionalText($('#store-osm-type').value);
  const osmId = optionalText($('#store-osm-id').value);
  if ((osmType === null) !== (osmId === null)) throw new Error('Indica tipo e ID de OpenStreetMap juntos.');
  return {
    retailerName,
    name,
    region: optionalText($('#store-region').value),
    address: optionalText($('#store-address').value),
    latitudeMicrodegrees,
    longitudeMicrodegrees,
    osmType,
    osmId,
  };
}

async function saveStore(button) {
  const current = state.selectedStore;
  setBusy(button, true);
  $('#store-editor-status').textContent = current ? 'Guardando…' : 'Creando…';
  try {
    const result = await api(current ? `/api/v1/inventory/stores/${encodeURIComponent(current.id)}` : '/api/v1/inventory/stores', {
      method: current ? 'PATCH' : 'POST',
      body: JSON.stringify(storePayload()),
    });
    state.selectedStore = result.store;
    renderStoreDetail(result.store);
    showStoreEditor(false);
    $('#store-editor-status').textContent = 'Guardada';
    $('#store-form-state').textContent = current ? 'Tienda actualizada.' : 'Tienda creada.';
    history.replaceState(null, '', `#stores:${encodeURIComponent(result.store.id)}`);
    void loadStores();
  } catch (error) {
    $('#store-editor-status').textContent = 'Revisar';
    $('#store-form-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function openStoreDeleteDialog() {
  const store = state.selectedStore;
  if (!store) return;
  const dialog = $('#store-delete-dialog');
  const confirm = $('#store-delete-confirm');
  confirm.disabled = true;
  $('#store-delete-impact').textContent = 'Comprobando precios y tickets históricos…';
  $('#store-delete-state').textContent = '';
  dialog.showModal();
  try {
    const { impact } = await api(`/api/v1/inventory/stores/${encodeURIComponent(store.id)}/delete-impact`);
    $('#store-delete-impact').textContent = `${store.name} tiene ${Number(impact.linkedProducts || 0)} productos vinculados, ${Number(impact.priceObservations || 0)} observaciones de precio y ${Number(impact.historicalTickets || 0)} tickets históricos.`;
    $('#store-delete-state').textContent = impact.canDelete ? 'La tienda no tiene dependencias históricas y se puede eliminar.' : 'El borrado está bloqueado para conservar la historia de precios o tickets.';
    confirm.disabled = !impact.canDelete;
  } catch (error) {
    $('#store-delete-state').textContent = error.message;
  }
}

async function confirmStoreDelete(button) {
  const store = state.selectedStore;
  if (!store) return;
  setBusy(button, true);
  try {
    await api(`/api/v1/inventory/stores/${encodeURIComponent(store.id)}`, { method: 'DELETE' });
    $('#store-delete-dialog').close();
    closeStoreDetail();
    $('#store-state').textContent = 'Tienda eliminada.';
  } catch (error) {
    $('#store-delete-state').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function statisticsKpi(label, value, description) {
  return `<article class="surface inventory-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(description)}</small></article>`;
}

function renderBars(container, rows, label, value) {
  if (!container) return;
  container.replaceChildren();
  const maximum = Math.max(0, ...rows.map(value));
  for (const row of rows.slice(0, 8)) {
    const amount = value(row);
    const item = document.createElement('div');
    item.className = 'inventory-bar-row';
    item.innerHTML = `<span>${escapeHtml(label(row))}</span><span class="inventory-bar-track"><span class="inventory-bar-fill" style="--inventory-bar:${maximum ? Math.max(3, Math.round((amount / maximum) * 100)) : 0}%"></span></span><strong>${escapeHtml(formatEuroMinor(Math.max(0, Number(amount) || 0)))}</strong>`;
    container.append(item);
  }
}

function renderStatistics(statistics) {
  state.statistics = statistics;
  const summary = statistics.summary || {};
  $('#statistics-kpis').innerHTML = [
    statisticsKpi('Valor de catálogo reciente', formatEuroMinor(Math.max(0, Number(summary.latestCatalogValueMinor || 0))), 'Último precio conocido por producto; no representa stock.'),
    statisticsKpi('Productos activos', String(Number(summary.activeProducts || 0)), 'Variantes persistidas en el catálogo.'),
    statisticsKpi('Tickets procesados', String(Number(summary.ticketsProcessed || 0)), 'Tickets del periodo, incluidos cancelados en el recuento.'),
    statisticsKpi('Valor de entradas', formatEuroMinor(Math.max(0, Number(summary.entriesValueMinor || 0))), 'Suma de líneas de ticket del periodo.'),
  ].join('');

  const categories = Array.isArray(statistics.categoryStats) ? statistics.categoryStats : [];
  renderBars($('#statistics-categories-bars'), categories, row => row.name, row => Number(row.spentMinor || 0));
  $('#statistics-categories-table').innerHTML = categories.map(row => `<tr><th scope="row">${escapeHtml(row.name)}</th><td>${Number(row.productCount || 0)}</td><td>${Number(row.ticketCount || 0)}</td><td>${escapeHtml(formatEuroMinor(Math.max(0, Number(row.spentMinor || 0))))}</td></tr>`).join('') || '<tr><td colspan="4">Sin actividad de categorías en el periodo.</td></tr>';

  const stores = Array.isArray(statistics.storeStats) ? statistics.storeStats : [];
  renderBars($('#statistics-stores-bars'), stores, row => `${row.retailerName} · ${row.name}`, row => Number(row.spentMinor || 0));
  $('#statistics-stores-table').innerHTML = stores.map(row => `<tr><th scope="row">${escapeHtml(`${row.retailerName} · ${row.name}`)}</th><td>${Number(row.productCount || 0)}</td><td>${Number(row.ticketCount || 0)}</td><td>${escapeHtml(formatEuroMinor(Math.max(0, Number(row.spentMinor || 0))))}</td></tr>`).join('') || '<tr><td colspan="4">Sin actividad de tiendas en el periodo.</td></tr>';

  const trend = Array.isArray(statistics.ticketTrend) ? statistics.ticketTrend : [];
  renderBars($('#statistics-trend-bars'), trend, row => formatDate(row.date), row => Number(row.spentMinor || 0));
  $('#statistics-trend-table').innerHTML = trend.map(row => `<tr><th scope="row">${escapeHtml(formatDate(row.date))}</th><td>${Number(row.ticketCount || 0)}</td><td>${escapeHtml(formatEuroMinor(Math.max(0, Number(row.spentMinor || 0))))}</td></tr>`).join('') || '<tr><td colspan="3">Sin tickets en el periodo.</td></tr>';

  $('#statistics-model-note').innerHTML = `<strong>Modelo de datos</strong><span>${escapeHtml(summary.lowStockUnavailableReason || 'Los indicadores se derivan exclusivamente de datos persistidos.')}</span>`;
}

async function loadStatistics() {
  const generation = ++state.statisticsLoadGeneration;
  state.statisticsLoadController?.abort();
  const controller = new AbortController();
  state.statisticsLoadController = controller;
  const period = state.statisticsPeriod;
  $('#statistics-state').textContent = 'Calculando estadísticas…';
  try {
    const result = await api(`/api/v1/inventory/statistics?period=${encodeURIComponent(period)}`, { signal: controller.signal });
    if (generation !== state.statisticsLoadGeneration || period !== state.statisticsPeriod) return;
    renderStatistics(result.statistics || {});
    $('#statistics-state').textContent = 'Estadísticas actualizadas con datos persistidos.';
  } catch (error) {
    if (error?.name === 'AbortError' || generation !== state.statisticsLoadGeneration) return;
    $('#statistics-state').textContent = `No se pudieron cargar las estadísticas: ${error.message}`;
  } finally {
    if (generation === state.statisticsLoadGeneration) state.statisticsLoadController = null;
  }
}

async function openRequestedStore(requested) {
  if (requested === 'stores:new') {
    startCreateStore();
    return;
  }
  if (!requested.startsWith('stores:')) return;
  try {
    await openStoreDetail(decodeURIComponent(requested.slice('stores:'.length)));
  } catch (error) {
    $('#store-state').textContent = `No se pudo abrir la tienda: ${error.message}`;
  }
}

async function activateStores(requested = 'stores') {
  activateView('stores', { dispatch: false });
  await loadStores({ resetPage: true });
  await openRequestedStore(requested);
}

async function activateStatistics() {
  activateView('inventory-statistics', { dispatch: false });
  await loadStatistics();
}

function bindOverviewInteractions() {
  $('#inventory-overview-new-product').addEventListener('click', () => {
    if (!activateView('catalog')) return;
    requestAnimationFrame(() => $('#catalog-new-product')?.click());
  });
  document.querySelectorAll('[data-inventory-destination]').forEach(button => {
    button.addEventListener('click', () => openOverviewDestination(button.dataset.inventoryDestination));
  });
  $('#inventory-overview-scope').addEventListener('change', syncOverviewScope);
  document.querySelectorAll('[data-inventory-scope]').forEach(button => {
    button.addEventListener('click', () => {
      $('#inventory-overview-scope').value = overviewDestination(button.dataset.inventoryScope);
      syncOverviewScope();
      $('#inventory-overview-search').focus();
    });
  });
  $('#inventory-overview-search-form').addEventListener('submit', event => {
    event.preventDefault();
    transferOverviewQuery();
  });
  $('#inventory-overview-open-filters').addEventListener('click', () => transferOverviewQuery({ focusFilters: true }));
  syncOverviewScope();
}

function bindInteractions() {
  bindOverviewInteractions();
  $('#stores-back-inventory').addEventListener('click', goInventory);
  $('#statistics-back-inventory').addEventListener('click', goInventory);
  $('#stores-back-list').addEventListener('click', closeStoreDetail);
  $('#store-new').addEventListener('click', startCreateStore);
  $('#store-edit').addEventListener('click', () => showStoreEditor(true));
  $('#store-cancel-edit').addEventListener('click', () => state.selectedStore ? showStoreEditor(false) : closeStoreDetail());
  $('#store-form').addEventListener('submit', event => { event.preventDefault(); void saveStore($('#store-save')); });
  $('#store-delete').addEventListener('click', () => void openStoreDeleteDialog());
  $('#store-delete-cancel').addEventListener('click', () => $('#store-delete-dialog').close());
  $('#store-delete-confirm').addEventListener('click', event => void confirmStoreDelete(event.currentTarget));
  $('#store-search').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => void loadStores({ resetPage: true }), SEARCH_DELAY_MS); });
  $('#store-retailer-filter').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => void loadStores({ resetPage: true }), SEARCH_DELAY_MS); });
  $('#store-sort').addEventListener('change', event => { state.storeSort = event.currentTarget.value; void loadStores({ resetPage: true }); });
  $('#store-clear-filters').addEventListener('click', () => {
    $('#store-search').value = '';
    $('#store-retailer-filter').value = '';
    $('#store-sort').value = 'name';
    state.storeQuery = '';
    state.storeRetailer = '';
    state.storeSort = 'name';
    void loadStores({ resetPage: true });
  });
  $('#store-prev').addEventListener('click', () => { if (state.storePage > 1) state.storePage -= 1; void loadStores(); window.scrollTo(0, 0); });
  $('#store-next').addEventListener('click', () => { if (state.stores.hasMore) state.storePage += 1; void loadStores(); window.scrollTo(0, 0); });
  $('#statistics-period').addEventListener('change', event => { state.statisticsPeriod = event.currentTarget.value; void loadStatistics(); });
}

function handleViewChanged(event) {
  const view = String(event.detail?.view || '');
  if (view === 'inventory') void loadOverview();
  else state.overviewLoadController?.abort();
  if (view === 'stores') void loadStores({ resetPage: true });
  else state.storeLoadController?.abort();
  if (view === 'inventory-statistics') void loadStatistics();
  else state.statisticsLoadController?.abort();
  if (view === 'inventory' || view === 'catalog' || view === 'categories' || view === 'stores' || view === 'inventory-statistics') {
    document.querySelector('.bottom-nav [data-nav="inventory"]')?.setAttribute('aria-current', 'page');
  }
}

export function initializeInventoryFeature({ activateOverviewView = false, activateStoreView = false, activateStatisticsView = false } = {}) {
  if (!state.initialized) {
    state.initialized = true;
    injectStylesheet();
    installOverviewView();
    installStoreView();
    installStatisticsView();
    bindInteractions();
    document.addEventListener('basketra:view-changed', handleViewChanged);
  }
  if (activateOverviewView) void loadOverview();
  if (activateStoreView) void activateStores(location.hash.slice(1));
  else if (activateStatisticsView) void activateStatistics();
}

function autoInitializeInventoryFeature() {
  const requested = location.hash.slice(1);
  initializeInventoryFeature({
    activateOverviewView: requested === 'inventory',
    activateStoreView: requested === 'stores' || requested.startsWith('stores:'),
    activateStatisticsView: requested === 'inventory-statistics',
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInitializeInventoryFeature, { once: true });
else autoInitializeInventoryFeature();
