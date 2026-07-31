declare function setTimeout(callback: (...args: unknown[]) => void, delay?: number): NodeJS.Timeout;
declare function clearTimeout(timeout: NodeJS.Timeout | number): void;
declare namespace NodeJS {
  interface ProcessEnv { [key: string]: string | undefined }
  interface MemoryUsage { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers: number }
  interface Timeout { unref(): this }
}

declare const process: {
  env: NodeJS.ProcessEnv;
  stderr: { write(value: string): boolean };
  memoryUsage(): NodeJS.MemoryUsage;
  once(event: 'SIGTERM' | 'SIGINT', listener: () => void): void;
  exit(code?: number): never;
  exitCode?: number;
};

declare const Buffer: {
  from(value: string | Uint8Array, encoding?: string): Uint8Array & { toString(encoding?: string): string };
  concat(values: readonly Uint8Array[]): Uint8Array & { toString(encoding?: string): string };
};

declare module 'node:crypto' {
  export function randomUUID(): string;
  export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean;
  export function createHash(algorithm: string): { update(value: string | Uint8Array): { digest(encoding: 'hex'): string }; digest(encoding: 'hex'): string };
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string): string;
  export function extname(path: string): string;
  export function join(...paths: string[]): string;
  export const sep: string;
}

declare module 'node:fs' {
  export interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
  }
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function copyFileSync(source: string, destination: string): void;
  export function statSync(path: string): { size: number; mtimeMs: number; mode: number; dev: number };
  export function readFileSync(path: string): Uint8Array;
  export function writeFileSync(path: string, data: Uint8Array | string, options?: { flag?: string; mode?: number }): void;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  export function readdirSync(path: string): string[];
  export function renameSync(oldPath: string, newPath: string): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module 'node:sqlite' {
  export interface StatementSync {
    run(...values: readonly unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...values: readonly unknown[]): unknown;
    all(...values: readonly unknown[]): unknown[];
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

declare module 'node:http' {
  export interface IncomingHttpHeaders { host?: string; authorization?: string }
  export interface IncomingMessage extends AsyncIterable<Uint8Array | string> {
    method?: string;
    url?: string;
    headers: IncomingHttpHeaders;
    once(event: 'aborted', listener: () => void): this;
    off(event: 'aborted', listener: () => void): this;
  }
  export interface ServerResponse {
    headersSent: boolean;
    setHeader(name: string, value: string): void;
    writeHead(statusCode: number, headers?: Record<string, string>): this;
    end(data?: string | Uint8Array): void;
  }
  export interface AddressInfo { address: string; port: number }
  export interface Server {
    once(event: 'error', listener: (error: Error) => void): this;
    off(event: 'error', listener: (error: Error) => void): this;
    listen(port: number, host: string, callback: () => void): this;
    close(callback: (error?: Error) => void): this;
    address(): AddressInfo | string | null;
  }
  export function createServer(listener: (request: IncomingMessage, response: ServerResponse) => void): Server;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
