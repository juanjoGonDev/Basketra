declare module 'node:child_process' {
  export interface ChildProcessError extends Error { code?: string }
  export interface ReadablePipe {
    on(event: 'data', listener: (chunk: Uint8Array) => void): this;
  }
  export interface WritablePipe {
    end(data?: Uint8Array): void;
  }
  export interface ChildProcessWithoutNullStreams {
    stdin: WritablePipe;
    stdout: ReadablePipe;
    stderr: ReadablePipe;
    once(event: 'error', listener: (error: ChildProcessError) => void): this;
    once(event: 'close', listener: (code: number | null, signal: string | null) => void): this;
    kill(signal?: string): boolean;
  }
  export function spawn(
    command: string,
    args: readonly string[],
    options: Readonly<{
      stdio: readonly ['pipe', 'pipe', 'pipe'];
      env: NodeJS.ProcessEnv;
    }>,
  ): ChildProcessWithoutNullStreams;
}
