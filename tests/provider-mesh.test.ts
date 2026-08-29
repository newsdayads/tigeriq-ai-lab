import { describe, expect, it } from 'vitest';
import {
  ModelRouter,
  ProviderRequestError,
  createAnthropicAdapter,
  createGeminiAdapter,
  createOpenAIAdapter,
  defaultRoutingPolicy,
  routeCandidates,
  type ProviderAdapter,
} from '../packages/model-router/src/index.js';

function adapter(provider: ProviderAdapter['provider'], run: ProviderAdapter['execute']): ProviderAdapter {
  return { provider, execute: run };
}

describe('multi-AI provider mesh', () => {
  it('uses cloud-first OpenAI -> Claude -> Gemini -> Ollama ordering', () => {
    expect(routeCandidates(defaultRoutingPolicy).map((target) => target.provider)).toEqual([
      'openai', 'anthropic', 'gemini', 'ollama',
    ]);
  });

  it('uses OpenAI credentials only in request headers and maps configured model', async () => {
    const openai = createOpenAIAdapter({
      apiKey: 'test-key',
      model: 'configured-openai',
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe('https://api.openai.com/v1/chat/completions');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key');
        expect(String(input)).not.toContain('test-key');
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe('configured-openai');
        return new Response(JSON.stringify({ choices: [{ message: { content: 'openai-ok' } }] }), { status: 200 });
      },
    });
    await expect(openai.execute({ provider: 'openai', model: 'openai-default' }, { prompt: 'work' })).resolves.toBe('openai-ok');
  });

  it('supports Anthropic/Claude and Gemini native response shapes', async () => {
    const anthropic = createAnthropicAdapter({
      apiKey: 'anthropic-key',
      model: 'configured-claude',
      fetchImpl: async (_input, init) => {
        expect(new Headers(init?.headers).get('x-api-key')).toBe('anthropic-key');
        return new Response(JSON.stringify({ content: [{ type: 'text', text: 'claude-ok' }] }), { status: 200 });
      },
    });
    const gemini = createGeminiAdapter({
      apiKey: 'gemini-key',
      model: 'configured-gemini',
      fetchImpl: async (input, init) => {
        expect(String(input)).toContain('/models/configured-gemini:generateContent');
        expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('gemini-key');
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini-ok' }] } }] }), { status: 200 });
      },
    });
    await expect(anthropic.execute({ provider: 'anthropic', model: 'anthropic-default' }, { prompt: 'work' })).resolves.toBe('claude-ok');
    await expect(gemini.execute({ provider: 'gemini', model: 'gemini-default' }, { prompt: 'work' })).resolves.toBe('gemini-ok');
  });

  it('classifies quota and immediately falls back to PC01/Ollama route', async () => {
    let openaiCalls = 0;
    const policy = {
      primary: { provider: 'openai' as const, model: 'o' },
      fallbacks: [{ provider: 'ollama' as const, model: 'l', local: true }],
    };
    const router = new ModelRouter([
      adapter('openai', async () => {
        openaiCalls += 1;
        throw new ProviderRequestError('openai', 'quota', 'openai http 429', 60_000);
      }),
      adapter('ollama', async () => 'pc01-ok'),
    ], policy, { cooldownMs: 100 });

    const first = await router.execute({ prompt: 'first' });
    expect(first.target.provider).toBe('ollama');
    expect(first.attempts[0]).toMatchObject({ ok: false, failureKind: 'quota' });

    const second = await router.execute({ prompt: 'second' });
    expect(openaiCalls).toBe(1);
    expect(second.attempts[0]).toMatchObject({ ok: false, circuitOpen: true });
    expect(second.target.provider).toBe('ollama');
  });

  it('classifies HTTP 5xx as outage and allows the router to continue', async () => {
    const openai = createOpenAIAdapter({
      apiKey: 'test-key',
      model: 'model',
      fetchImpl: async () => new Response('unavailable', { status: 503 }),
    });
    const router = new ModelRouter([
      openai,
      adapter('ollama', async () => 'local-ok'),
    ], {
      primary: { provider: 'openai', model: 'openai-default' },
      fallbacks: [{ provider: 'ollama', model: 'local', local: true }],
    });
    const result = await router.execute({ prompt: 'work' });
    expect(result.attempts[0]).toMatchObject({ ok: false, failureKind: 'outage', error: 'openai http 503' });
    expect(result.text).toBe('local-ok');
  });
});
