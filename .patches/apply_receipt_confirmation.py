from pathlib import Path

path = Path('src/api/server.ts')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match, found {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)


replace_once(
    "import { ReceiptExtractionService } from '../receipts/service.ts';\n",
    "import { ReceiptExtractionService } from '../receipts/service.ts';\nimport { parseReceiptConfirmation } from '../receipts/import.ts';\n",
)
old = """  private async confirmReceipt(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = asRecord(await this.readJson(request));
    const lines = this.parseReceiptLines(body['items']);
    const declaredTotalMinor = asSafeInteger(body['declaredTotalMinor'], '$.declaredTotalMinor', { min: 0 });
    const originalText = asString(body['originalText'], '$.originalText', { min: 1, max: 500_000 });
    const importKey = asString(body['importKey'], '$.importKey', { min: 8, max: 128 });
    const total = validateReceiptTotal(lines, declaredTotalMinor);
    if (!total.valid) throw new ApiError(409, 'RECEIPT_TOTAL_MISMATCH', 'Receipt total must be reviewed before confirmation');
    const receiptId = this.#database.importReceipt({
      importKey,
      declaredTotalMinor,
      originalText,
      items: lines.map((line) => ({ ...line, status: validateReceiptLine(line).status, confidence: validateReceiptLine(line).status === 'confirmed' ? 1 : 0.5 })),
    });
    this.json(response, 201, { receiptId });
  }
"""
new = """  private async confirmReceipt(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const { input, total } = parseReceiptConfirmation(await this.readJson(request));
    if (!total.valid) throw new ApiError(409, 'RECEIPT_TOTAL_MISMATCH', 'Receipt total must be reviewed before confirmation');
    const receiptId = this.#database.importReceipt(input);
    this.json(response, 201, { receiptId });
  }
"""
replace_once(old, new)
path.write_text(text, encoding='utf-8')
