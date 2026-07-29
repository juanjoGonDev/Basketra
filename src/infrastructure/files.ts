import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

export type StoredFile = Readonly<{ storageKey: string; hash: string; mimeType: string; bytes: number }>;

const MAGIC: Readonly<Record<string, readonly number[]>> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
};

function hasMagic(buffer: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => buffer[index] === value);
}

export class FileStore {
  readonly #permanentDir: string;
  readonly #tempDir: string;
  readonly maxBytes: number;
  constructor(permanentDir: string, tempDir: string, maxBytes: number) {
    this.maxBytes = maxBytes;
    this.#permanentDir = resolve(permanentDir);
    this.#tempDir = resolve(tempDir);
    mkdirSync(this.#permanentDir, { recursive: true });
    mkdirSync(this.#tempDir, { recursive: true });
  }

  storeBase64(input: Readonly<{ base64: string; mimeType: string; originalName?: string }>): StoredFile {
    const magic = MAGIC[input.mimeType];
    if (!magic) throw new RangeError('Unsupported file type');
    const buffer = Buffer.from(input.base64, 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > this.maxBytes) throw new RangeError('File size is outside allowed limits');
    if (!hasMagic(buffer, magic)) throw new RangeError('File signature does not match MIME type');
    const hash = createHash('sha256').update(buffer).digest('hex');
    const extension = input.mimeType === 'image/jpeg' ? '.jpg' : input.mimeType === 'image/png' ? '.png' : '.pdf';
    const storageKey = `${hash}${extension}`;
    const target = this.resolveKey(storageKey);
    if (!existsSync(target)) {
      const temporary = join(this.#tempDir, `${hash}.upload`);
      writeFileSync(temporary, buffer, { flag: 'wx' });
      renameSync(temporary, target);
    }
    return { storageKey, hash, mimeType: input.mimeType, bytes: buffer.byteLength };
  }

  resolveKey(storageKey: string): string {
    if (storageKey.includes('/') || storageKey.includes('\\') || extname(storageKey) === '') throw new RangeError('Invalid storage key');
    const target = resolve(this.#permanentDir, storageKey);
    if (!target.startsWith(`${this.#permanentDir}${sep}`)) throw new RangeError('Storage path escapes the data directory');
    return target;
  }

  cleanupTemporary(): void {
    rmSync(this.#tempDir, { recursive: true, force: true });
    mkdirSync(this.#tempDir, { recursive: true });
  }
}
