import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==', 'base64');
const validJpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCKiiivjz74/9k=', 'base64');

function createTemporaryFilesystem(root: string): Readonly<{ path: string; remove: () => void }> {
  if (process.platform === 'linux' && existsSync('/dev/shm')) {
    const path = mkdtempSync('/dev/shm/basketra-photo-api-');
    return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
  }
  const path = join(root, 'tmp');
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

async function upload(baseUrl: string, bytes: Buffer, mimeType: 'image/jpeg' | 'image/png', originalName: string): Promise<Readonly<{ storageKey: string; bytes: number }>> {
  const response = await fetch(`${baseUrl}/api/v1/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ base64: bytes.toString('base64'), mimeType, originalName }),
  });
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  const body = JSON.parse(responseText) as { file: { storageKey: string; bytes: number } };
  return body.file;
}

test('photo API uploads and previews real images across the Docker filesystem boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-photo-api-'));
  const temporary = createTemporaryFilesystem(root);
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    dataDir: join(root, 'data'),
    tempDir: temporary.path,
    maxBodyBytes: 16_384,
    aiTimeoutMs: 1_000,
    aiMaxRetries: 1,
    aiImageCapability: true,
    aiPdfCapability: false,
    idleHibernateAfterMs: 0,
    idleExitAfterMs: 0,
  };
  const server = new BasketraServer(config);
  await server.listen();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    if (process.env['CI'] === 'true' && process.platform === 'linux') {
      assert.notEqual(statSync(config.dataDir).dev, statSync(temporary.path).dev);
    }

    const jpeg = await upload(baseUrl, validJpeg, 'image/jpeg', 'camera.jpg');
    const png = await upload(baseUrl, validPng, 'image/png', 'gallery.png');
    const duplicate = await upload(baseUrl, validPng, 'image/png', 'gallery-copy.png');

    assert.equal(jpeg.bytes, validJpeg.byteLength);
    assert.equal(png.bytes, validPng.byteLength);
    assert.equal(duplicate.storageKey, png.storageKey);

    for (const [file, expectedMimeType, expectedBytes] of [
      [jpeg, 'image/jpeg', validJpeg],
      [png, 'image/png', validPng],
    ] as const) {
      const preview = await fetch(`${baseUrl}/api/v1/files/${file.storageKey}`);
      assert.equal(preview.status, 200);
      assert.equal(preview.headers.get('content-type'), expectedMimeType);
      assert.match(preview.headers.get('cache-control') ?? '', /private, no-store/);
      assert.deepEqual(Buffer.from(await preview.arrayBuffer()), expectedBytes);
    }
  } finally {
    await server.close();
    temporary.remove();
    rmSync(root, { recursive: true, force: true });
  }
});
