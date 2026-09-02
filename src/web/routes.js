const PRIMARY_NAVIGATION_BY_VIEW = Object.freeze({
  catalog: 'inventory',
  categories: 'inventory',
  stores: 'inventory',
  'inventory-statistics': 'inventory',
  'ticket-history': 'scan',
});

export function resolveApplicationRoute(requestedRoute, availableViews) {
  const route = String(requestedRoute || 'home');
  const views = availableViews instanceof Set ? availableViews : new Set(availableViews || []);
  if (views.has(route)) return { view: route, route };

  const separator = route.indexOf(':');
  if (separator > 0) {
    const baseView = route.slice(0, separator);
    if (views.has(baseView)) return { view: baseView, route };
  }
  return { view: 'home', route: 'home' };
}

export function primaryNavigationForView(view) {
  return PRIMARY_NAVIGATION_BY_VIEW[view] || view;
}
