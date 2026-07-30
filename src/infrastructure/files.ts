import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

export const SUPPORTED_FILE_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type SupportedFileMimeType = typeof SUPPORTED_FILE_MIME_TYPES[number];

export type StoredFile = Readonly<{ storageKey: string; hash: string; mimeType: SupportedFileMimeType; bytes: number }>;
export type StoredFileContent = Readonly<{ storageKey: string; mimeType: SupportedFileMimeType; bytes: Uint8Array }>;

export const DEFAULT_FILE_STORAGE_MAX_BYTES = 512 * 1024 * 1024;

const MAGIC: Readonly<Record<SupportedFileMimeType, readonly number[]>> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
};

function hasMagic(buffer: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => buffer[index] === value);
}

function isSupportedMimeType(value: string): value is SupportedFileMimeType {
  return SUPPORTED_FILE_MIME_TYPES.includes(value as SupportedFileMimeType);
}

function mimeTypeForStorageKey(storageKey: string): SupportedFileMimeType {
  const extension = extname(storageKey).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.pdf') return 'application/pdf';
  throw new RangeError('Unsupported stored file extension');
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

export class FileStore {
  readonly #permanentDir: string;
  readonly #tempDir: string;
  readonly #maxStoredBytes: number;
  readonly maxBytes: number;

  constructor(permanentDir: string, tempDir: string, maxBytes: number, maxStoredBytes = DEFAULT_FILE_STORAGE_MAX_BYTES) {
    this.maxBytes = assertPositiveInteger(maxBytes, 'maxBytes');
    this.#maxStoredBytes = assertPositiveInteger(maxStoredBytes, 'maxStoredBytes');
    this.#permanentDir = resolve(permanentDir);
    this.#tempDir = resolve(tempDir);
    mkdirSync(this.#permanentDir, { recursive: true });
    this.cleanupTemporary();
    if (this.storedBytes() > this.#maxStoredBytes) {
      throw new RangeError('Persistent file storage already exceeds the configured limit');
    }
  }

  private storedBytes(): number {
    return readdirSync(this.#permanentDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .reduce((total, entry) => total + statSync(join(this.#permanentDir, entry.name)).size, 0);
  }

  storeBase64(input: Readonly<{ base64: string; mimeType: string; originalName?: string }>): StoredFile {
    if (!isSupportedMimeType(input.mimeType)) throw new RangeError('Unsupported file type');
    const magic = MAGIC[input.mimeType];
    const buffer = Buffer.from(input.base64, 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > this.maxBytes) throw new RangeError('File size is outside allowed limits');
    if (!hasMagic(buffer, magic)) throw new RangeError('File signature does not match MIME type');
    const hash = createHash('sha256').update(buffer).digest('hex');
    const extension = input.mimeType === 'image/jpeg' ? '.jpg' : input.mimeType === 'image/png' ? '.png' : '.pdf';
    const storageKey = `${hash}${extension}`;
    const target = this.resolveKey(storageKey);
    if (!existsSync(target)) {
      if (this.storedBytes() + buffer.byteLength > this.#maxStoredBytes) {
        throw new RangeError('Persistent file storage limit would be exceeded');
      }
      const temporary = join(this.#tempDir, `${hash}-${randomUUID()}.upload`);
      try {
        writeFileSync(temporary, buffer, { flag: 'wx' });
        renameSync(temporary, target);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    return { storageKey, hash, mimeType: input.mimeType, bytes: buffer.byteLength };
  }

  read(storageKey: string): StoredFileContent {
    const target = this.resolveKey(storageKey);
    if (!existsSync(target)) throw new RangeError('Stored file does not exist');
    const mimeType = mimeTypeForStorageKey(storageKey);
    const expected = MAGIC[mimeType];
    const bytes = readFileSync(target);
    if (bytes.byteLength === 0 || bytes.byteLength > this.maxBytes) throw new RangeError('Stored file size is outside allowed limits');
    if (!hasMagic(bytes, expected)) throw new RangeError('Stored file signature does not match its extension');
    return { storageKey, mimeType, bytes };
  }

  resolveKey(storageKey: string): string {
    if (storageKey.includes('/') || storageKey.includes('\\') || extname(storageKey) === '') throw new RangeError('Invalid storage key');
    const target = resolve(this.#permanentDir, storageKey);
    if (!target.startsWith(`${this.#permanentDir}${sep}`)) throw new RangeError('Storage path escapes the data directory');
    return target;
  }

  cleanupTemporary(): void {
    mkdirSync(this.#tempDir, { recursive: true });
    for (const entry of readdirSync(this.#tempDir, { withFileTypes: true })) {
      rmSync(join(this.#tempDir, entry.name), { recursive: true, force: true });
    }
  }
}
