import { handleInventoryManagementRequest as handleInventoryManagementCore } from './inventory-management-core.ts';
import { handleInventoryReadModelRequest } from './inventory-read-model.ts';

export * from './inventory-management-core.ts';

export async function handleInventoryManagementRequest(
  context: Parameters<typeof handleInventoryManagementCore>[0],
): Promise<boolean> {
  if (handleInventoryReadModelRequest(context)) return true;
  return await handleInventoryManagementCore(context);
}
