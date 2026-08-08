import 'node:http';

declare module 'node:http' {
  interface IncomingMessage {
    destroyed: boolean;
    destroy(error?: Error): this;
  }

  interface ServerResponse {
    destroyed: boolean;
    writableEnded: boolean;
    once(event: 'close', listener: () => void): this;
    off(event: 'close', listener: () => void): this;
  }

  interface ClientRequest {
    destroyed: boolean;
    destroy(error?: Error): this;
  }
}
