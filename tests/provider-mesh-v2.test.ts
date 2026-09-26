import { describe, expect, it } from 'vitest';
import {
  ModelRouter,
  ProviderRequestError,
  createAnthropicAdapter,
  createGeminiAdapter,
  createOpenAIAdapter,
  createProviderMesh,
  defaultRoutingPolicy,
  routeCandidates,
  type ProviderAdapter,
} from '../packages/model-router/src/index.js';

function adapter(provider: ProviderAdapter['provider'], run: ProviderAdapter['execute']): ProviderAdapter {
  return { provider, execute: run };
}

describe('WO-019 provider mesh v2', () => {
  it('uses cloud-first OpenAI -> Anthropic -> Gemini -> Ollama ordering', () => {
    expect(routeCandidates(defaultRoutingPolicy).map((target) => target.provider)).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'ollama',
    ]);
  });

  it('uses the OpenAI Responses API without placing credentials in the URL/body', async () => {
    const openai = createOpenAIAdapter({
      apiKey: 'test-openai-key',
      model: 'configured-openai-model',
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe('https://api.openai.com/v1/responses');
        expect(String(input)).not.toContain('test-openai-key');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-openai-key');
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({ model: 'configured-openai-model', input: 'work' });
        return new Response(JSON.stringify({
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'openai-ok' }] }],
        }), { status: 200 });
      },
    });

    await expect(openai.execute(
      { provider: 'openai', model: 'openai-default' },
      { prompt: 'work' },
    )).resolves.toBe('openai-ok');
  });

  it('supports Anthropic Messages and Gemini generateContent response shapes', async () => {
    const anthropic = createAnthropicAdapter({
      apiKey: 'anthropic-key',
      model: 'configured-claude',
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe('https://api.anthropic.com/v1/messages');
        expect(new Headers(init?.headers).get('x-api-key')).toBe('anthropic-key');
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe('configured-claude');
        return new Response(JSON.stringify({ content: [{ type: 'text', text: 'claude-ok' }] }), { status: 200 });
      },
    });
    const gemini = createGeminiAdapter({
      apiKey: 'gemini-key',
      model: 'configured-gemini',
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe('https://generativelanguage.googleapis.com/v1beta/models/configured-gemini:generateContent');
        expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('gemini-key');
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'gemini-ok' }] } }],
        }), { status: 200 });
      },
    });

    await expect(anthropic.execute(
      { provider: 'anthropic', model: 'anthropic-default' },
      { prompt: 'work' },
    )).resolves.toBe('claude-ok');
    await expect(gemini.execute(
      { provider: 'gemini', model: 'gemini-default' },
      { prompt: 'work' },
    )).resolves.toBe('gemini-ok');
  });

  it('classifies quota and immediately suppresses the failed cloud route', async () => {
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

  it('classifies provider HTTP 5xx as outage and continues to local fallback', async () => {
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
    expect(result.attempts[0]).toMatchObject({
      ok: false,
      failureKind: 'outage',
      error: 'openai http 503',
    });
    expect(result.text).toBe('local-ok');
  });

  it('does not include configured credentials in routing failure evidence', async () => {
    const secret = 'super-secret-provider-token';
    const router = new ModelRouter([
      createOpenAIAdapter({
        apiKey: secret,
        model: 'model',
        fetchImpl: async () => new Response('unavailable', { status: 503 }),
      }),
      adapter('ollama', async () => 'local-ok'),
    ], {
      primary: { provider: 'openai', model: 'openai-default' },
      fallbacks: [{ provider: 'ollama', model: 'local', local: true }],
    });

    const result = await router.execute({ prompt: 'work' });
    expect(result.target.provider).toBe('ollama');
    expect(JSON.stringify(result.attempts)).not.toContain(secret);
  });

  it('falls through missing cloud configuration and reaches Ollama', async () => {
    const old = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
    };
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const router = createProviderMesh({
        openai: { model: 'openai-test' },
        anthropic: { model: 'anthropic-test' },
        gemini: { model: 'gemini-test' },
        ollama: {
          model: 'local-test',
          fetchImpl: async () => new Response(JSON.stringify({
            choices: [{ message: { content: 'local-no-cloud-key' } }],
          }), { status: 200 }),
        },
      });
      const result = await router.execute({ prompt: 'work' });
      expect(result.target.provider).toBe('ollama');
      expect(result.text).toBe('local-no-cloud-key');
      expect(result.attempts.slice(0, 3).map((x) => x.failureKind)).toEqual([
        'configuration',
        'configuration',
        'configuration',
      ]);
    } finally {
      if (old.openai === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = old.openai;
      if (old.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = old.anthropic;
      if (old.gemini === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = old.gemini;
    }
  });

  it('does not silently fail over after caller cancellation', async () => {
    const controller = new AbortController();
    let localCalls = 0;
    const router = new ModelRouter([
      adapter('openai', async () => {
        controller.abort();
        throw new Error('cancelled');
      }),
      adapter('ollama', async () => {
        localCalls += 1;
        return 'should-not-run';
      }),
    ], {
      primary: { provider: 'openai', model: 'o' },
      fallbacks: [{ provider: 'ollama', model: 'l', local: true }],
    });

    await expect(router.execute({ prompt: 'work', signal: controller.signal })).rejects.toThrow('model request aborted');
    expect(localCalls).toBe(0);
  });
});
