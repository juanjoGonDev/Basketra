import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileStore } from '../../src/infrastructure/files.ts';

function png(lastByte: number): string {
  return Buffer.from(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, lastByte])).toString('base64');
}

test('file storage removes stale temporaries, caps persistent bytes and leaves no failed-upload residue', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-file-retention-'));
  const permanentDir = join(root, 'files');
  const tempDir = join(root, 'tmp');
  try {
    writeFileSync(join(root, 'placeholder'), 'x');
    const initial = new FileStore(permanentDir, tempDir, 16, 5);
    writeFileSync(join(tempDir, 'stale.upload'), 'stale');
    const store = new FileStore(permanentDir, tempDir, 16, 5);
    assert.deepEqual(readdirSync(tempDir), []);
    const first = store.storeBase64({ base64: png(0), mimeType: 'image/png' });
    assert.equal(initial.read(first.storageKey).bytes.byteLength, 5);
    assert.throws(() => store.storeBase64({ base64: png(1), mimeType: 'image/png' }), /storage limit/);
    assert.deepEqual(readdirSync(tempDir), []);
    assert.equal(readdirSync(permanentDir).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
