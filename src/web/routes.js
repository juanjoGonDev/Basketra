const PRIMARY_NAVIGATION_BY_VIEW = Object.freeze({
  catalog: 'inventory',
  categories: 'inventory',
  stores: 'inventory',
  'inventory-statistics': 'inventory',
  'ticket-history': 'scan',
});

const BASE_PATH_BY_ROUTE = Object.freeze({
  home: '/',
  lists: '/lists',
  scan: '/tickets',
  inventory: '/inventory',
  catalog: '/inventory/products',
  categories: '/inventory/categories',
  stores: '/inventory/stores',
  'inventory-statistics': '/inventory/statistics',
  'ticket-history': '/tickets/history',
  settings: '/settings',
});

const KNOWN_VIEW_ROUTES = new Set(Object.keys(BASE_PATH_BY_ROUTE));
const ENTITY_ROUTE_BASES = new Set(['lists', 'catalog', 'categories', 'stores', 'ticket-history']);

function normalizedPathname(pathname) {
  const value = String(pathname || '/').split('?')[0] || '/';
  if (value === '/index.html') return '/';
  if (value === '/') return '/';
  return value.replace(/\/+$/u, '') || '/';
}

function decodeRouteSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function routeParts(route) {
  const value = String(route || 'home');
  const separator = value.indexOf(':');
  if (separator < 0) return { base: value, entity: '' };
  return { base: value.slice(0, separator), entity: value.slice(separator + 1) };
}

export function applicationPathForRoute(requestedRoute) {
  const { base, entity } = routeParts(requestedRoute);
  const basePath = BASE_PATH_BY_ROUTE[base];
  if (!basePath) return '/';
  if (!entity || !ENTITY_ROUTE_BASES.has(base)) return basePath;
  return `${basePath}/${encodeURIComponent(entity)}`;
}

export function applicationRouteForPath(pathname) {
  const path = normalizedPathname(pathname);
  for (const [route, basePath] of Object.entries(BASE_PATH_BY_ROUTE)) {
    if (path === basePath) return route;
  }

  const entityPatterns = [
    ['catalog', /^\/inventory\/products\/([^/]+)$/u],
    ['categories', /^\/inventory\/categories\/([^/]+)$/u],
    ['stores', /^\/inventory\/stores\/([^/]+)$/u],
    ['ticket-history', /^\/tickets\/history\/([^/]+)$/u],
    ['lists', /^\/lists\/([^/]+)$/u],
  ];
  for (const [base, pattern] of entityPatterns) {
    const match = pattern.exec(path);
    if (!match?.[1]) continue;
    const entity = decodeRouteSegment(match[1]);
    if (!entity) return null;
    return `${base}:${entity}`;
  }
  return null;
}

export function isApplicationPath(pathname) {
  return applicationRouteForPath(pathname) !== null;
}

export function legacyHashRoute(hash) {
  const raw = String(hash || '').replace(/^#/u, '');
  if (!raw) return null;
  const { base, entity } = routeParts(raw);
  if (!KNOWN_VIEW_ROUTES.has(base)) return null;
  if (!entity) return base;
  if (!ENTITY_ROUTE_BASES.has(base)) return null;
  const decoded = decodeRouteSegment(entity);
  return decoded ? `${base}:${decoded}` : null;
}

export function readApplicationLocation(locationLike = globalThis.location) {
  const pathname = String(locationLike?.pathname || '/');
  const search = String(locationLike?.search || '');
  const hash = String(locationLike?.hash || '');
  const pathRoute = applicationRouteForPath(pathname);
  const legacy = normalizedPathname(pathname) === '/' ? legacyHashRoute(hash) : null;
  const route = legacy || pathRoute || 'home';
  return {
    route,
    searchParams: new URLSearchParams(search),
    legacy: legacy !== null,
  };
}

function normalizedSearchParams(searchParams) {
  const result = searchParams instanceof URLSearchParams
    ? new URLSearchParams(searchParams)
    : new URLSearchParams(searchParams || '');
  result.sort();
  return result;
}

export function applicationUrl(route, searchParams = new URLSearchParams()) {
  const params = normalizedSearchParams(searchParams);
  const query = params.toString();
  return `${applicationPathForRoute(route)}${query ? `?${query}` : ''}`;
}

export function writeApplicationLocation(route, searchParams = new URLSearchParams(), { replace = false, state = null } = {}) {
  const url = applicationUrl(route, searchParams);
  const current = globalThis.location
    ? `${globalThis.location.pathname}${globalThis.location.search}`
    : '';
  if (current === url && !globalThis.location?.hash) return false;
  const method = replace ? 'replaceState' : 'pushState';
  globalThis.history?.[method]?.(state, '', url);
  return true;
}

export function readRouteText(searchParams, key, { maxLength = 160, fallback = '' } = {}) {
  const raw = searchParams?.get?.(key);
  if (raw === null || raw === undefined) return fallback;
  const value = String(raw).trim();
  if (value.length > maxLength) return fallback;
  return value;
}

export function readRoutePage(searchParams, key = 'page') {
  const raw = searchParams?.get?.(key);
  if (raw === null || raw === undefined || raw === '') return 1;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 100_000 ? value : 1;
}

export function readRouteEnum(searchParams, key, allowed, fallback) {
  const value = searchParams?.get?.(key);
  return allowed.includes(value) ? value : fallback;
}

export function resolveApplicationRoute(requestedRoute, availableViews) {
  const route = String(requestedRoute || 'home');
  const views = availableViews instanceof Set ? availableViews : new Set(availableViews || []);
  const { base } = routeParts(route);
  if (KNOWN_VIEW_ROUTES.has(base)) return { view: base, route };
  if (views.has(route)) return { view: route, route };
  return { view: 'home', route: 'home' };
}

export function primaryNavigationForView(view) {
  return PRIMARY_NAVIGATION_BY_VIEW[view] || view;
}
