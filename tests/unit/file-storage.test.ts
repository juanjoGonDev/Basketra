import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildUnexpectedErrorLog } from '../../src/api/errors.ts';
import { FileStore } from '../../src/infrastructure/files.ts';

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==', 'base64');

function createTemporaryFilesystem(root: string): Readonly<{ path: string; remove: () => void }> {
  if (process.platform === 'linux' && existsSync('/dev/shm')) {
    const path = mkdtempSync('/dev/shm/basketra-file-storage-');
    return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
  }
  const path = join(root, 'tmp');
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

test('file storage publishes atomically when temporary and persistent directories use different filesystems', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-file-storage-'));
  const permanentDir = join(root, 'files');
  mkdirSync(permanentDir, { recursive: true });
  writeFileSync(join(permanentDir, '.interrupted.upload'), validPng);
  const temporary = createTemporaryFilesystem(root);
  mkdirSync(temporary.path, { recursive: true });
  writeFileSync(join(temporary.path, 'abandoned.tmp'), validPng);

  try {
    const store = new FileStore(permanentDir, temporary.path, 16_384);
    if (process.env['CI'] === 'true' && process.platform === 'linux') {
      assert.notEqual(statSync(permanentDir).dev, statSync(temporary.path).dev);
    }
    assert.equal(existsSync(join(permanentDir, '.interrupted.upload')), false);
    assert.deepEqual(readdirSync(temporary.path), []);

    const first = store.storeBase64({ base64: validPng.toString('base64'), mimeType: 'image/png', originalName: 'receipt.png' });
    const duplicate = store.storeBase64({ base64: validPng.toString('base64'), mimeType: 'image/png', originalName: 'receipt-copy.png' });

    assert.equal(first.storageKey, duplicate.storageKey);
    assert.equal(first.bytes, validPng.byteLength);
    assert.deepEqual(readdirSync(permanentDir), [first.storageKey]);
    if (process.platform !== 'win32') {
      assert.equal(statSync(store.resolveKey(first.storageKey)).mode & 0o777, 0o600);
    }
    assert.deepEqual(Buffer.from(store.read(first.storageKey).bytes), validPng);
  } finally {
    temporary.remove();
    rmSync(root, { recursive: true, force: true });
  }
});

test('unexpected backend logs expose system diagnostics without paths or messages', () => {
  const error = Object.assign(new Error('rename /tmp/private-ticket to /data/private-ticket'), {
    code: 'EXDEV',
    syscall: 'rename',
    path: '/tmp/private-ticket',
    dest: '/data/private-ticket',
  });
  const event = buildUnexpectedErrorLog(error, 'incident-123', '2026-07-31T07:00:00.000Z');

  assert.deepEqual(event, {
    timestamp: '2026-07-31T07:00:00.000Z',
    level: 'error',
    event: 'http.unexpected_error',
    incidentId: 'incident-123',
    errorName: 'Error',
    systemCode: 'EXDEV',
    syscall: 'rename',
  });
  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes('/tmp/'), false);
  assert.equal(serialized.includes('/data/'), false);
  assert.equal(serialized.includes('private-ticket'), false);
});
