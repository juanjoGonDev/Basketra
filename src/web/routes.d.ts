export function applicationPathForRoute(requestedRoute: string): string;
export function applicationRouteForPath(pathname: string): string | null;
export function isApplicationPath(pathname: string): boolean;
export function legacyHashRoute(hash: string): string | null;
export function readApplicationLocation(locationLike?: { pathname?: string; search?: string; hash?: string }): {
  route: string;
  searchParams: URLSearchParams;
  legacy: boolean;
};
export function applicationUrl(route: string, searchParams?: URLSearchParams | string): string;
export function writeApplicationLocation(
  route: string,
  searchParams?: URLSearchParams | string,
  options?: { replace?: boolean; state?: unknown },
): boolean;
export function readRouteText(
  searchParams: URLSearchParams,
  key: string,
  options?: { maxLength?: number; fallback?: string },
): string;
export function readRoutePage(searchParams: URLSearchParams, key?: string): number;
export function readRouteEnum<T extends string>(
  searchParams: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T;
export function resolveApplicationRoute(
  requestedRoute: string,
  availableViews: Set<string> | readonly string[],
): { view: string; route: string };
export function primaryNavigationForView(view: string): string;
