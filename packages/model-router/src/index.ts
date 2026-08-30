export type Provider = 'gemini' | 'openrouter' | 'ollama' | 'openai' | 'anthropic';

export type ProviderFailureKind =
  | 'quota'
  | 'outage'
  | 'timeout'
  | 'auth'
  | 'invalid_response'
  | 'configuration'
  | 'unknown';

export interface ModelTarget {
  provider: Provider;
  model: string;
  local?: boolean;
}

export interface RoutingPolicy {
  primary: ModelTarget;
  fallbacks: ModelTarget[];
}

export interface ModelRequest {
  prompt: string;
  signal?: AbortSignal;
}

export interface ModelResponse {
  text: string;
  target: ModelTarget;
}

export interface ProviderAdapter {
  provider: Provider;
  execute(target: ModelTarget, request: ModelRequest): Promise<string>;
}

export interface RoutingAttempt {
  target: ModelTarget;
  ok: boolean;
  error?: string;
  failureKind?: ProviderFailureKind;
  circuitOpen?: boolean;
}

export interface RoutedResult extends ModelResponse {
  attempts: RoutingAttempt[];
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

interface CircuitState {
  failures: number;
  openUntil: number;
}

export class RoutingExhaustedError extends Error {
  constructor(public readonly attempts: RoutingAttempt[]) {
    super('all configured model routes failed');
    this.name = 'RoutingExhaustedError';
  }
}

export class ProviderRequestError extends Error {
  constructor(
    public readonly provider: Provider,
    public readonly kind: ProviderFailureKind,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}

// Cloud-first route. Model IDs remain runtime configuration because provider model
// names and availability change independently from TigerIQ releases.
export const defaultRoutingPolicy: RoutingPolicy = {
  primary: { provider: 'openai', model: 'openai-default' },
  fallbacks: [
    { provider: 'anthropic', model: 'anthropic-default' },
    { provider: 'gemini', model: 'gemini-default' },
    { provider: 'ollama', model: 'local-coder', local: true },
  ],
};

export function routeCandidates(policy: RoutingPolicy = defaultRoutingPolicy): ModelTarget[] {
  return [policy.primary, ...policy.fallbacks];
}

export class ModelRouter {
  private readonly adapters = new Map<Provider, ProviderAdapter>();
  private readonly circuits = new Map<Provider, CircuitState>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(
    adapters: ProviderAdapter[],
    private readonly policy: RoutingPolicy = defaultRoutingPolicy,
    circuitBreaker: CircuitBreakerOptions = {},
  ) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.provider)) throw new Error(`duplicate adapter: ${adapter.provider}`);
      this.adapters.set(adapter.provider, adapter);
    }
    this.failureThreshold = Math.max(1, circuitBreaker.failureThreshold ?? 2);
    this.cooldownMs = Math.max(1, circuitBreaker.cooldownMs ?? 30_000);
    this.now = circuitBreaker.now ?? Date.now;
  }

  async execute(request: ModelRequest): Promise<RoutedResult> {
    if (!request.prompt.trim()) throw new Error('prompt is required');
    const attempts: RoutingAttempt[] = [];

    for (const target of routeCandidates(this.policy)) {
      if (request.signal?.aborted) throw new Error('model request aborted');
      const adapter = this.adapters.get(target.provider);
      if (!adapter) {
        attempts.push({ target, ok: false, error: 'adapter unavailable' });
        continue;
      }

      const circuit = this.circuits.get(target.provider);
      if (circuit && circuit.openUntil > this.now()) {
        attempts.push({ target, ok: false, error: 'circuit open', circuitOpen: true });
        continue;
      }

      try {
        const text = await adapter.execute(target, request);
        if (!text.trim()) {
          throw new ProviderRequestError(target.provider, 'invalid_response', `${target.provider} returned empty response`);
        }
        this.circuits.delete(target.provider);
        attempts.push({ target, ok: true });
        return { text, target, attempts };
      } catch (error) {
        if (request.signal?.aborted) throw new Error('model request aborted');
        const providerError = error instanceof ProviderRequestError ? error : undefined;
        const priorFailures = circuit?.failures ?? 0;
        const failures = priorFailures + 1;
        const immediateOpen = providerError
          ? ['quota', 'outage', 'timeout', 'auth', 'configuration'].includes(providerError.kind)
          : false;
        const shouldOpen = immediateOpen || failures >= this.failureThreshold;
        this.circuits.set(target.provider, {
          failures,
          openUntil: shouldOpen
            ? this.now() + Math.max(this.cooldownMs, providerError?.retryAfterMs ?? 0)
            : 0,
        });
        attempts.push({
          target,
          ok: false,
          error: error instanceof Error ? error.message : 'provider failure',
          failureKind: providerError?.kind,
        });
      }
    }

    throw new RoutingExhaustedError(attempts);
  }
}

interface HttpAdapterOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface OpenAIAdapterOptions extends HttpAdapterOptions {}
export interface AnthropicAdapterOptions extends HttpAdapterOptions {
  maxTokens?: number;
}
export interface GeminiAdapterOptions extends HttpAdapterOptions {}
export interface OllamaAdapterOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function resolveModel(target: ModelTarget, sentinel: string, configured?: string): string {
  const model = target.model === sentinel ? configured : target.model;
  if (!model?.trim()) {
    throw new ProviderRequestError(target.provider, 'configuration', `${target.provider} model not configured`);
  }
  return model;
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(raw);
  if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  return undefined;
}

function classifyStatus(status: number): ProviderFailureKind {
  if (status === 429) return 'quota';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'outage';
  return 'invalid_response';
}

async function providerFetch(
  provider: Provider,
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  request: ModelRequest,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  request.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch {
      if (request.signal?.aborted) throw new Error('model request aborted');
      if (controller.signal.aborted) {
        throw new ProviderRequestError(provider, 'timeout', `${provider} request timeout`);
      }
      throw new ProviderRequestError(provider, 'outage', `${provider} network failure`);
    }

    if (!response.ok) {
      throw new ProviderRequestError(
        provider,
        classifyStatus(response.status),
        `${provider} http ${response.status}`,
        retryAfterMs(response),
      );
    }
    return response;
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onAbort);
  }
}

function extractOpenAIText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const data = body as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' || part.type === 'text')
    .map((part) => part.text ?? '')
    .filter(Boolean)
    .join('\n');
}

export function createOpenAIAdapter(options: OpenAIAdapterOptions = {}): ProviderAdapter {
  const baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const timeoutMs = Math.max(1, options.timeoutMs ?? 120_000);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    provider: 'openai',
    async execute(target, request) {
      const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new ProviderRequestError('openai', 'configuration', 'openai api key not configured');
      }
      const model = resolveModel(target, 'openai-default', options.model ?? process.env.TIGERIQ_OPENAI_MODEL);
      const response = await providerFetch('openai', fetchImpl, `${baseUrl}/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: request.prompt }),
      }, request, timeoutMs);
      const text = extractOpenAIText(await response.json());
      if (!text.trim()) {
        throw new ProviderRequestError('openai', 'invalid_response', 'empty openai response');
      }
      return text;
    },
  };
}

export function createAnthropicAdapter(options: AnthropicAdapterOptions = {}): ProviderAdapter {
  const baseUrl = (options.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/$/, '');
  const timeoutMs = Math.max(1, options.timeoutMs ?? 120_000);
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxTokens = Math.max(1, options.maxTokens ?? 4096);

  return {
    provider: 'anthropic',
    async execute(target, request) {
      const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new ProviderRequestError('anthropic', 'configuration', 'anthropic api key not configured');
      }
      const model = resolveModel(target, 'anthropic-default', options.model ?? process.env.TIGERIQ_ANTHROPIC_MODEL);
      const response = await providerFetch('anthropic', fetchImpl, `${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: request.prompt }],
        }),
      }, request, timeoutMs);
      const body = await response.json() as { content?: Array<{ type?: string; text?: string }> };
      const text = body.content
        ?.filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('\n');
      if (!text?.trim()) {
        throw new ProviderRequestError('anthropic', 'invalid_response', 'empty anthropic response');
      }
      return text;
    },
  };
}

export function createGeminiAdapter(options: GeminiAdapterOptions = {}): ProviderAdapter {
  const baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  const timeoutMs = Math.max(1, options.timeoutMs ?? 120_000);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    provider: 'gemini',
    async execute(target, request) {
      const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new ProviderRequestError('gemini', 'configuration', 'gemini api key not configured');
      }
      const model = resolveModel(target, 'gemini-default', options.model ?? process.env.TIGERIQ_GEMINI_MODEL);
      const response = await providerFetch(
        'gemini',
        fetchImpl,
        `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          }),
        },
        request,
        timeoutMs,
      );
      const body = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = body.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('\n');
      if (!text?.trim()) {
        throw new ProviderRequestError('gemini', 'invalid_response', 'empty gemini response');
      }
      return text;
    },
  };
}

export function createOllamaAdapter(options: OllamaAdapterOptions = {}): ProviderAdapter {
  const baseUrl = (options.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  const timeoutMs = Math.max(1, options.timeoutMs ?? 120_000);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    provider: 'ollama',
    async execute(target, request) {
      const model = resolveModel(target, 'local-coder', options.model ?? process.env.TIGERIQ_OLLAMA_MODEL);
      const response = await providerFetch('ollama', fetchImpl, `${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: request.prompt }],
          stream: false,
        }),
      }, request, timeoutMs);
      const body = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = body.choices?.[0]?.message?.content;
      if (!text?.trim()) {
        throw new ProviderRequestError('ollama', 'invalid_response', 'empty ollama response');
      }
      return text;
    },
  };
}

export interface ProviderMeshOptions {
  openai?: OpenAIAdapterOptions;
  anthropic?: AnthropicAdapterOptions;
  gemini?: GeminiAdapterOptions;
  ollama?: OllamaAdapterOptions;
  policy?: RoutingPolicy;
  circuitBreaker?: CircuitBreakerOptions;
}

export function createProviderMesh(options: ProviderMeshOptions = {}): ModelRouter {
  return new ModelRouter([
    createOpenAIAdapter(options.openai),
    createAnthropicAdapter(options.anthropic),
    createGeminiAdapter(options.gemini),
    createOllamaAdapter(options.ollama),
  ], options.policy ?? defaultRoutingPolicy, options.circuitBreaker);
}
