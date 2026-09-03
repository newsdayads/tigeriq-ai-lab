export type Provider = 'gemini' | 'openrouter' | 'ollama' | 'openai' | 'anthropic' | 'xai' | 'deepseek';

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

export const defaultRoutingPolicy: RoutingPolicy = {
  primary: { provider: 'gemini', model: 'gemini-default' },
  fallbacks: [
    { provider: 'openrouter', model: 'openrouter/free' },
    { provider: 'ollama', model: 'local-coder', local: true }
  ]
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

  /** Executes through the canonical adapter/circuit-breaker stack. A request may supply a scored policy from AI Gateway without creating a second router implementation. */
  async execute(request: ModelRequest, policyOverride?: RoutingPolicy): Promise<RoutedResult> {
    if (!request.prompt.trim()) throw new Error('prompt is required');
    const attempts: RoutingAttempt[] = [];

    for (const target of routeCandidates(policyOverride ?? this.policy)) {
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
        if (!text.trim()) throw new Error('empty model response');
        this.circuits.delete(target.provider);
        attempts.push({ target, ok: true });
        return { text, target, attempts };
      } catch (error) {
        const priorFailures = circuit?.failures ?? 0;
        const failures = priorFailures + 1;
        this.circuits.set(target.provider, {
          failures,
          openUntil: failures >= this.failureThreshold ? this.now() + this.cooldownMs : 0,
        });
        attempts.push({ target, ok: false, error: error instanceof Error ? error.message : 'provider failure' });
      }
    }

    throw new RoutingExhaustedError(attempts);
  }
}

export interface OllamaAdapterOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createOllamaAdapter(options: OllamaAdapterOptions = {}): ProviderAdapter {
  const baseUrl = (options.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  const timeoutMs = Math.max(1, options.timeoutMs ?? 120_000);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    provider: 'ollama',
    async execute(target, request) {
      const configuredModel = options.model ?? process.env.TIGERIQ_OLLAMA_MODEL;
      const model = target.model === 'local-coder' ? configuredModel : target.model;
      if (!model) throw new Error('ollama model not configured');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      request.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        const response = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: request.prompt }],
            stream: false,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`ollama http ${response.status}`);
        const body = await response.json() as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = body.choices?.[0]?.message?.content;
        if (!text?.trim()) throw new Error('empty ollama response');
        return text;
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
