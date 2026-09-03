import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BasketraDatabase, CURRENT_SCHEMA_VERSION } from '../../src/infrastructure/database.ts';
import {
  DEFAULT_RUNTIME_SETTINGS,
  RuntimeSettingsStore,
  toPublicRuntimeSettings,
} from '../../src/infrastructure/runtime-settings.ts';

const TEST_API_CREDENTIAL = ['fixture', 'credential', '1234'].join('-');
const RUNTIME_SETTINGS_MIGRATION_VERSION = 8;

test('runtime settings migrate with the main database and expose deterministic defaults', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-runtime-settings-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath);
  database.close();
  const store = new RuntimeSettingsStore(databasePath);
  try {
    assert.ok(CURRENT_SCHEMA_VERSION >= RUNTIME_SETTINGS_MIGRATION_VERSION);
    assert.deepEqual(
      { ...store.read(), updatedAt: '<timestamp>' },
      {
        ...DEFAULT_RUNTIME_SETTINGS,
        updatedAt: '<timestamp>',
      },
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime settings persist provider identity and secret without exposing the secret publicly', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-runtime-settings-persist-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath);
  database.close();

  let store = new RuntimeSettingsStore(databasePath);
  try {
    const updated = store.update({
      aiBaseUrl: 'http://webapi:3000/v1/',
      aiApiKey: TEST_API_CREDENTIAL,
      aiModel: 'default',
      aiMaxRetries: 3,
      overpassBaseUrl: 'https://overpass.kumi.systems/api/',
      maxBodyBytes: 48 * 1024 * 1024,
      idleHibernateAfterMs: 120_000,
    });
    assert.equal(updated.aiApiKey, TEST_API_CREDENTIAL);
    assert.deepEqual(toPublicRuntimeSettings(updated).ai, {
      configured: true,
      baseUrl: 'http://webapi:3000/v1/',
      model: 'default',
      maxRetries: 3,
      apiKeyConfigured: true,
      apiKeyMask: '••••1234',
    });
  } finally {
    store.close();
  }

  store = new RuntimeSettingsStore(databasePath);
  try {
    const reopened = store.read();
    assert.equal(reopened.aiBaseUrl, 'http://webapi:3000/v1/');
    assert.equal(reopened.aiApiKey, TEST_API_CREDENTIAL);
    assert.equal(reopened.aiModel, 'default');
    assert.equal(reopened.aiMaxRetries, 3);
    assert.equal(reopened.maxBodyBytes, 48 * 1024 * 1024);

    store.update({ aiModel: 'next-model' });
    assert.equal(store.read().aiApiKey, TEST_API_CREDENTIAL);
    store.update({ aiApiKey: null });
    assert.equal(store.read().aiApiKey, undefined);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime settings reject unknown, malformed and out-of-range input before persistence', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-runtime-settings-invalid-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath);
  database.close();
  const store = new RuntimeSettingsStore(databasePath);
  try {
    const before = store.read();
    assert.throws(() => store.update({ unexpected: true }), /Unknown runtime setting/);
    assert.throws(() => store.update({ aiBaseUrl: 'file:///tmp/provider' }), /HTTP or HTTPS/);
    assert.throws(() => store.update({ maxBodyBytes: 1 }), /Local request limit/);
    assert.throws(() => store.update({ aiMaxRetries: 11 }), /AI max retries/);
    assert.deepEqual(store.read(), before);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
