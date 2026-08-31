import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FileStore } from '../../src/infrastructure/files.ts';

test('file store does not treat the HTTP transport bound as a per-file policy', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-file-store-limit-'));
  const permanentDir = join(root, 'files');
  const temporaryDir = join(root, 'tmp');
  const transportMaxBytes = 4;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);
  const store = new FileStore(
    permanentDir,
    temporaryDir,
    transportMaxBytes,
    1024 * 1024,
  );

  try {
    const stored = store.storeBase64({
      base64: png.toString('base64'),
      mimeType: 'image/png',
      originalName: 'larger-than-transport.png',
    });

    assert.equal(stored.bytes, png.byteLength);
    assert.ok(stored.bytes > transportMaxBytes);
    assert.deepEqual(Buffer.from(store.read(stored.storageKey).bytes), png);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
