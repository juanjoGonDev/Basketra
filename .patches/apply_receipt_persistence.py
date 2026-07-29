from pathlib import Path

path = Path('src/infrastructure/database.ts')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match, found {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)


record_end = """export type ShoppingListItemRecord = Readonly<{
  id: string;
  listId: string;
  text: string;
  quantityMinor: number;
  unit: string;
  exactRequired: boolean;
  substitutionAllowed: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}>;
"""
replace_once(record_end, record_end + """
export type ReceiptImportInput = Readonly<{
  importKey: string;
  declaredTotalMinor: number;
  originalText: string;
  provider: string;
  deterministic: unknown;
  ai?: unknown;
  captures?: readonly Readonly<{ storageKey: string; contentHash?: string; mimeType: string; originalName?: string }>[];
  items: readonly Readonly<{
    description: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    discountMinor?: number;
    status: string;
    confidence: number;
  }>[];
  corrections?: readonly Readonly<{ itemIndex: number; field: string; original: unknown; corrected: unknown }>[];
}>;
""")

old_method = """  importReceipt(input: Readonly<{ importKey: string; declaredTotalMinor: number; originalText: string; items: readonly Readonly<{ description: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; status: string; confidence: number }>[] }>): string {
    const existing = this.#database.prepare('SELECT id FROM receipts WHERE import_key = ?').get(input.importKey) as { id: string } | undefined;
    if (existing) return existing.id;
    const receiptId = createId('receipt');
    const timestamp = now();
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.#database.prepare('INSERT INTO receipts(id, status, currency, declared_total_minor, import_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(receiptId, 'confirmed', 'EUR', input.declaredTotalMinor, input.importKey, timestamp, timestamp);
      this.#database.prepare('INSERT INTO receipt_extractions(id, receipt_id, provider, original_text, deterministic_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(createId('extraction'), receiptId, 'manual-or-embedded', input.originalText, JSON.stringify(input.items), timestamp);
      for (const item of input.items) {
        this.#database.prepare(`INSERT INTO receipt_items(id, receipt_id, original_description, quantity, unit_price_minor, line_total_minor, status, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(createId('receiptitem'), receiptId, item.description, item.quantity, item.unitPriceMinor, item.lineTotalMinor, item.status, item.confidence, timestamp);
      }
      this.#database.exec('COMMIT');
      return receiptId;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }
"""
new_method = """  importReceipt(input: ReceiptImportInput): string {
    const existing = this.#database.prepare('SELECT id FROM receipts WHERE import_key = ?').get(input.importKey) as { id: string } | undefined;
    if (existing) return existing.id;
    const receiptId = createId('receipt');
    const timestamp = now();
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.#database.prepare('INSERT INTO receipts(id, status, currency, declared_total_minor, import_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(receiptId, 'confirmed', 'EUR', input.declaredTotalMinor, input.importKey, timestamp, timestamp);
      for (const [position, capture] of (input.captures ?? []).entries()) {
        this.#database.prepare('INSERT INTO receipt_captures(id, receipt_id, position, storage_key, content_hash, mime_type, original_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(createId('capture'), receiptId, position, capture.storageKey, capture.contentHash ?? null, capture.mimeType, capture.originalName ?? null, timestamp);
      }
      this.#database.prepare('INSERT INTO receipt_extractions(id, receipt_id, provider, original_text, deterministic_json, ai_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(createId('extraction'), receiptId, input.provider, input.originalText, JSON.stringify(input.deterministic), input.ai === undefined ? null : JSON.stringify(input.ai), timestamp);
      const itemIds: string[] = [];
      for (const item of input.items) {
        const itemId = createId('receiptitem');
        itemIds.push(itemId);
        this.#database.prepare(`INSERT INTO receipt_items(id, receipt_id, original_description, quantity, unit_price_minor, line_total_minor, discount_minor, status, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(itemId, receiptId, item.description, item.quantity, item.unitPriceMinor, item.lineTotalMinor, item.discountMinor ?? 0, item.status, item.confidence, timestamp);
      }
      for (const correction of input.corrections ?? []) {
        const itemId = itemIds[correction.itemIndex];
        if (!itemId) throw new RangeError('Receipt correction item index is invalid');
        this.#database.prepare('INSERT INTO receipt_corrections(id, receipt_item_id, field, original_json, corrected_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(createId('correction'), itemId, correction.field, JSON.stringify(correction.original), JSON.stringify(correction.corrected), timestamp);
      }
      this.#database.exec('COMMIT');
      return receiptId;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }
"""
replace_once(old_method, new_method)
path.write_text(text, encoding='utf-8')
