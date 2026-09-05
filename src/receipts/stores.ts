import { DatabaseSync } from 'node:sqlite';

export type ReceiptStoreDescriptor = Readonly<{
  id: string;
  name: string;
  retailerId: string;
  retailerName: string;
}>;

export function loadReceiptStoreInventory(databasePath: string): readonly ReceiptStoreDescriptor[] {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare(`
      SELECT stores.id, stores.name, stores.retailer_id AS retailerId, retailers.name AS retailerName
      FROM stores
      JOIN retailers ON retailers.id = stores.retailer_id
      ORDER BY retailers.name COLLATE NOCASE, stores.name COLLATE NOCASE, stores.id
    `).all() as ReceiptStoreDescriptor[];
  } finally {
    database.close();
  }
}

export function buildReceiptStoreContext(stores: readonly ReceiptStoreDescriptor[]): string {
  return [
    'Available physical stores (id, name, retailerId, retailerName):',
    JSON.stringify(stores.map((store) => ({
      id: store.id,
      name: store.name,
      retailerId: store.retailerId,
      retailerName: store.retailerName,
    }))),
  ].join('\n');
}
