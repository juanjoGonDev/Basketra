import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), 'utf8');
}

test('inventory management keeps one owner per ticket and statistics boundary', () => {
  const router = source('src/api/inventory-management.ts');
  const core = source('src/api/inventory-management-core.ts');
  const reads = source('src/api/inventory-read-model.ts');
  const tickets = source('src/api/inventory-ticket-management.ts');

  assert.match(router, /handleInventoryReadModelRequest/u);
  assert.match(router, /handleInventoryTicketManagementRequest/u);
  assert.match(router, /handleInventoryManagementCore/u);

  assert.doesNotMatch(core, /\/api\/v1\/inventory\/statistics/u);
  assert.doesNotMatch(core, /\/api\/v1\/inventory\/tickets/u);
  assert.doesNotMatch(core, /DELETE FROM receipt_items/u);
  assert.doesNotMatch(core, /UPDATE price_observations/u);
  assert.doesNotMatch(core, /DELETE FROM price_observations/u);

  assert.match(reads, /pathname === '\/api\/v1\/inventory\/statistics'/u);
  assert.match(reads, /pathname === '\/api\/v1\/inventory\/tickets'/u);
  assert.match(tickets, /\/api\/v1\/inventory\/tickets/u);
  assert.match(tickets, /status = 'deleted'/u);
});
