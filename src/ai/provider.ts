export type AiCapabilities = Readonly<{
  structuredOutput: boolean;
  jsonObject: boolean;
  image: boolean;
  pdf: boolean;
  internetSearch: boolean;
}>;

export type AiMessageContentPart =
  | Readonly<{ type: 'text'; text: string }>
  | Readonly<{ type: 'image_url'; image_url: Readonly<{ url: string; detail?: 'auto' | 'low' | 'high' }> }>
  | Readonly<{ type: 'file'; file: Readonly<{ filename: string; file_data: string }> }>;

export type AiMessageContent = string | readonly AiMessageContentPart[];

export type AiStructuredInput = Readonly<{
  operation: string;
  systemPrompt: string;
  content: AiMessageContent;
  schemaName: string;
  jsonSchema: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}>;

export interface AiProvider {
  getCapabilities(): Promise<AiCapabilities>;
  testConnection(signal?: AbortSignal): Promise<Readonly<{ ok: boolean; model?: string }>>;
  executeStructured(input: AiStructuredInput): Promise<unknown>;
  dispose(): void;
}

const DEFAULT_CAPABILITIES: AiCapabilities = {
  structuredOutput: true,
  jsonObject: true,
  image: true,
  pdf: false,
  internetSearch: false,
};

export class OpenAiCompatibleProvider implements AiProvider {
  readonly config: Readonly<{
    baseUrl: URL;
    apiKey?: string;
    model: string;
    timeoutMs: number;
    capabilities?: Partial<AiCapabilities>;
  }>;
  readonly fetchImplementation: typeof fetch;
  constructor(
    config: Readonly<{
      baseUrl: URL;
      apiKey?: string;
      model: string;
      timeoutMs: number;
      capabilities?: Partial<AiCapabilities>;
    }>,
    fetchImplementation: typeof fetch = fetch,
  ) {
    this.config = config;
    this.fetchImplementation = fetchImplementation;
  }

  async getCapabilities(): Promise<AiCapabilities> {
    return { ...DEFAULT_CAPABILITIES, ...this.config.capabilities };
  }

  async testConnection(signal?: AbortSignal): Promise<Readonly<{ ok: boolean; model?: string }>> {
    const response = await this.fetchImplementation(new URL('models', ensureTrailingSlash(this.config.baseUrl)), {
      headers: this.headers(),
      ...(signal ? { signal } : {}),
    });
    return response.ok ? { ok: true, model: this.config.model } : { ok: false };
  }

  async executeStructured(input: AiStructuredInput): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('AI_TIMEOUT')), this.config.timeoutMs);
    timeout.unref();
    const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
    try {
      const response = await this.fetchImplementation(new URL('chat/completions', ensureTrailingSlash(this.config.baseUrl)), {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.content },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: input.schemaName, strict: true, schema: input.jsonSchema },
          },
        }),
        signal,
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'AI_AUTHENTICATION_FAILED' : `AI_HTTP_${response.status}`);
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error('AI_EMPTY_RESPONSE');
      return JSON.parse(content) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }

  dispose(): void {}

  private headers(): Record<string, string> {
    return this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {};
  }
}

function ensureTrailingSlash(url: URL): URL {
  return new URL(url.pathname.endsWith('/') ? url.href : `${url.href}/`);
}
