import { handleCatalogManagementRequest as handleCatalogCore } from './catalog-management-core.ts';
import { handleInventoryManagementRequest } from './inventory-management.ts';

export * from './catalog-management-core.ts';

export async function handleCatalogManagementRequest(
  context: Parameters<typeof handleCatalogCore>[0],
): Promise<boolean> {
  if (await handleInventoryManagementRequest(context)) return true;
  return await handleCatalogCore(context);
}
