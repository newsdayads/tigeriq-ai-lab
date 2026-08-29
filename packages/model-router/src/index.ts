export type Provider = 'gemini' | 'openrouter' | 'ollama' | 'openai' | 'anthropic';

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
}

export interface RoutedResult extends ModelResponse {
  attempts: RoutingAttempt[];
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

  constructor(adapters: ProviderAdapter[], private readonly policy: RoutingPolicy = defaultRoutingPolicy) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.provider)) throw new Error(`duplicate adapter: ${adapter.provider}`);
      this.adapters.set(adapter.provider, adapter);
    }
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
      try {
        const text = await adapter.execute(target, request);
        if (!text.trim()) throw new Error('empty model response');
        attempts.push({ target, ok: true });
        return { text, target, attempts };
      } catch (error) {
        attempts.push({ target, ok: false, error: error instanceof Error ? error.message : 'provider failure' });
      }
    }

    throw new RoutingExhaustedError(attempts);
  }
}
