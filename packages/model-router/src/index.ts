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
