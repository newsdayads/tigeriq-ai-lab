import { describe, expect, it } from 'vitest';
import { ModelRouter, RoutingExhaustedError, type ProviderAdapter, type RoutingPolicy } from '../packages/model-router/src/index.js';

const policy: RoutingPolicy = {
  primary: { provider: 'gemini', model: 'g' },
  fallbacks: [
    { provider: 'openrouter', model: 'o' },
    { provider: 'ollama', model: 'l', local: true },
  ],
};

function adapter(provider: ProviderAdapter['provider'], run: ProviderAdapter['execute']): ProviderAdapter {
  return { provider, execute: run };
}

describe('model router execution', () => {
  it('uses the primary provider when it succeeds', async () => {
    const router = new ModelRouter([adapter('gemini', async () => 'primary')], policy);
    const result = await router.execute({ prompt: 'work' });
    expect(result.text).toBe('primary');
    expect(result.target.provider).toBe('gemini');
    expect(result.attempts).toEqual([{ target: policy.primary, ok: true }]);
  });

  it('fails over in policy order and records bounded attempt evidence', async () => {
    const router = new ModelRouter([
      adapter('gemini', async () => { throw new Error('quota'); }),
      adapter('openrouter', async () => 'fallback'),
    ], policy);
    const result = await router.execute({ prompt: 'work' });
    expect(result.target.provider).toBe('openrouter');
    expect(result.attempts.map((attempt) => [attempt.target.provider, attempt.ok])).toEqual([
      ['gemini', false], ['openrouter', true],
    ]);
    expect(result.attempts[0]?.error).toBe('quota');
  });

  it('skips unavailable adapters and fails closed when every route fails', async () => {
    const router = new ModelRouter([adapter('gemini', async () => '')], policy);
    await expect(router.execute({ prompt: 'work' })).rejects.toBeInstanceOf(RoutingExhaustedError);
    try {
      await router.execute({ prompt: 'work' });
    } catch (error) {
      const attempts = (error as RoutingExhaustedError).attempts;
      expect(attempts).toHaveLength(3);
      expect(attempts[1]?.error).toBe('adapter unavailable');
      expect(attempts[2]?.error).toBe('adapter unavailable');
    }
  });

  it('rejects empty prompts and duplicate provider adapters', async () => {
    const gemini = adapter('gemini', async () => 'ok');
    expect(() => new ModelRouter([gemini, gemini], policy)).toThrow('duplicate adapter');
    const router = new ModelRouter([gemini], policy);
    await expect(router.execute({ prompt: '   ' })).rejects.toThrow('prompt is required');
  });
});
