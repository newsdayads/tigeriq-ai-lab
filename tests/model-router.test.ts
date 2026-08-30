import { describe, expect, it } from 'vitest';
import {
  ModelRouter,
  RoutingExhaustedError,
  createOllamaAdapter,
  type ProviderAdapter,
  type RoutingPolicy,
} from '../packages/model-router/src/index.js';

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

  it('falls through cloud failures to the Ollama OpenAI-compatible adapter', async () => {
    const local = createOllamaAdapter({
      model: 'test-local-model',
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe('http://127.0.0.1:11434/v1/chat/completions');
        const request = JSON.parse(String(init?.body));
        expect(request.model).toBe('l');
        expect(request.messages[0].content).toBe('work locally');
        return new Response(JSON.stringify({ choices: [{ message: { content: 'local result' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const router = new ModelRouter([
      adapter('gemini', async () => { throw new Error('quota'); }),
      adapter('openrouter', async () => { throw new Error('rate-limit'); }),
      local,
    ], policy);

    const result = await router.execute({ prompt: 'work locally' });
    expect(result.target.provider).toBe('ollama');
    expect(result.text).toBe('local result');
    expect(result.attempts.map((attempt) => [attempt.target.provider, attempt.ok])).toEqual([
      ['gemini', false], ['openrouter', false], ['ollama', true],
    ]);
  });

  it('opens a provider circuit after repeated failure and still falls back', async () => {
    let now = 1000;
    let primaryCalls = 0;
    const p: RoutingPolicy = {
      primary: { provider: 'gemini', model: 'g' },
      fallbacks: [{ provider: 'ollama', model: 'l', local: true }],
    };
    const router = new ModelRouter([
      adapter('gemini', async () => { primaryCalls += 1; throw new Error('outage'); }),
      adapter('ollama', async () => 'local'),
    ], p, { failureThreshold: 2, cooldownMs: 100, now: () => now });

    await router.execute({ prompt: 'one' });
    await router.execute({ prompt: 'two' });
    const third = await router.execute({ prompt: 'three' });
    expect(primaryCalls).toBe(2);
    expect(third.attempts[0]).toMatchObject({ ok: false, circuitOpen: true, error: 'circuit open' });
    expect(third.target.provider).toBe('ollama');

    now += 101;
    await router.execute({ prompt: 'four' });
    expect(primaryCalls).toBe(3);
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
