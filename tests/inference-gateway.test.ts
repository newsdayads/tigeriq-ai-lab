import { describe, expect, it } from 'vitest';
import {
  BackendRequestError,
  DeviceSessionService,
  InferenceGateway,
  InferenceGatewayError,
  createGeminiBackendAdapter,
  createGroqBackendAdapter,
  createOpenRouterBackendAdapter,
  defaultServerTargets,
  type BackendAdapter,
  type BackendTarget,
  type GatewayProvider,
  type InferenceRequest,
} from '../packages/inference-gateway/src/index.js';

const targets: BackendTarget[] = [
  {
    provider: 'gemini', model: 'gemini-test', tier: 'primary', costRank: 0, qualityRank: 4,
    kinds: ['general', 'coding', 'analysis', 'research'],
  },
  {
    provider: 'groq', model: 'groq-test', tier: 'primary', costRank: 0, qualityRank: 4,
    kinds: ['general', 'coding', 'analysis', 'research'],
  },
  {
    provider: 'openrouter', model: 'openrouter-test', tier: 'fallback', costRank: 1, qualityRank: 4,
    kinds: ['general', 'coding', 'analysis', 'research'],
  },
];

function adapter(provider: GatewayProvider, execute: BackendAdapter['execute']): BackendAdapter {
  return { provider, execute };
}

function request(overrides: Partial<InferenceRequest> = {}): InferenceRequest {
  return {
    requestId: 'REQ-1',
    employeeId: 'EMP-001',
    workId: 'WO-T',
    role: 'executor',
    task: {
      kind: 'general',
      risk: 'low',
      prompt: 'Do the task.',
      acceptanceCriteria: ['correct'],
    },
    routing: { requiredDistinctFrom: [], maxAttempts: 3 },
    budgetClass: 'free-first',
    ...overrides,
  };
}

describe('WO-047 inference gateway core', () => {
  it('falls back from Gemini 429 quota to healthy Groq and records sanitized evidence', async () => {
    const gateway = new InferenceGateway([
      adapter('gemini', async () => {
        throw new BackendRequestError('gemini', 'quota', 'raw upstream detail must not escape', 5_000);
      }),
      adapter('groq', async () => 'groq result'),
      adapter('openrouter', async () => 'openrouter result'),
    ], { targets, cooldownMs: 1_000 });

    const result = await gateway.infer(request());

    expect(result.selectedBackendIdentity).toBe('groq/groq-test');
    expect(result.attempts).toEqual([
      { sequence: 1, backendIdentity: 'gemini/gemini-test', outcome: 'failure', failureKind: 'quota' },
      { sequence: 2, backendIdentity: 'groq/groq-test', outcome: 'success', failureKind: null },
    ]);
    expect(JSON.stringify(result)).not.toContain('raw upstream detail');
    const geminiHealth = gateway.health().find((item) => item.provider === 'gemini');
    expect(geminiHealth?.health).toBe('cooling_down');
  });

  it('falls back on provider outage', async () => {
    const gateway = new InferenceGateway([
      adapter('gemini', async () => { throw new BackendRequestError('gemini', 'outage', 'down'); }),
      adapter('groq', async () => 'recovered'),
      adapter('openrouter', async () => 'fallback'),
    ], { targets });

    const result = await gateway.infer(request());
    expect(result.selectedBackendIdentity).toBe('groq/groq-test');
    expect(result.attempts[0]).toMatchObject({ outcome: 'failure', failureKind: 'outage' });
  });

  it('enforces a hard maximum of three and honors a lower requested retry cap', async () => {
    let openRouterCalls = 0;
    const gateway = new InferenceGateway([
      adapter('gemini', async () => { throw new BackendRequestError('gemini', 'outage', 'down'); }),
      adapter('groq', async () => { throw new BackendRequestError('groq', 'timeout', 'slow'); }),
      adapter('openrouter', async () => { openRouterCalls += 1; return 'must-not-run'; }),
    ], { targets, maxAttempts: 3 });

    let caught: unknown;
    try {
      await gateway.infer(request({ routing: { requiredDistinctFrom: [], maxAttempts: 2 } }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InferenceGatewayError);
    const gatewayError = caught as InferenceGatewayError;
    expect(gatewayError.code).toBe('ROUTES_EXHAUSTED');
    expect(gatewayError.attempts).toHaveLength(2);
    expect(openRouterCalls).toBe(0);
  });

  it('fails with explicit gateway budget exhaustion before sending a provider request', async () => {
    let calls = 0;
    const gateway = new InferenceGateway([
      adapter('gemini', async () => { calls += 1; return 'x'; }),
      adapter('groq', async () => { calls += 1; return 'x'; }),
      adapter('openrouter', async () => { calls += 1; return 'x'; }),
    ], { targets, budgets: { gemini: 0, groq: 0, openrouter: 0 } });

    await expect(gateway.infer(request())).rejects.toMatchObject({
      code: 'GATEWAY_BUDGET_EXHAUSTED',
      status: 429,
    });
    expect(calls).toBe(0);
  });

  it('uses three distinct backend identities for high-risk executor -> reviewer -> judge', async () => {
    const gateway = new InferenceGateway([
      adapter('gemini', async () => 'executor output'),
      adapter('groq', async () => 'PASS reviewer output'),
      adapter('openrouter', async () => 'PASS judge output'),
    ], { targets });

    const executor = await gateway.infer(request({
      requestId: 'REQ-E',
      task: { kind: 'coding', risk: 'high', prompt: 'code' },
    }));
    const reviewer = await gateway.infer(request({
      requestId: 'REQ-R',
      role: 'reviewer',
      task: { kind: 'coding', risk: 'high', prompt: 'review prior output' },
      routing: { requiredDistinctFrom: [executor.selectedBackendIdentity], maxAttempts: 3 },
    }));
    const judge = await gateway.infer(request({
      requestId: 'REQ-J',
      role: 'judge',
      task: { kind: 'coding', risk: 'high', prompt: 'judge prior evidence' },
      routing: { requiredDistinctFrom: [executor.selectedBackendIdentity, reviewer.selectedBackendIdentity], maxAttempts: 3 },
    }));

    expect(executor.selectedBackendIdentity).toBe('gemini/gemini-test');
    expect(reviewer.selectedBackendIdentity).toBe('groq/groq-test');
    expect(judge.selectedBackendIdentity).toBe('openrouter/openrouter-test');
    expect(new Set([
      executor.selectedBackendIdentity,
      reviewer.selectedBackendIdentity,
      judge.selectedBackendIdentity,
    ]).size).toBe(3);
    expect(reviewer.decision).toBe('PASS');
    expect(judge.decision).toBe('PASS');
  });

  it('fails closed when no independent reviewer backend exists', async () => {
    const gateway = new InferenceGateway([
      adapter('gemini', async () => 'PASS'),
    ], { targets: [targets[0]] });

    await expect(gateway.infer(request({
      role: 'reviewer',
      routing: { requiredDistinctFrom: ['gemini/gemini-test'], maxAttempts: 3 },
    }))).rejects.toMatchObject({
      code: 'INDEPENDENT_BACKEND_UNAVAILABLE',
      status: 409,
    });
  });

  it('requires prior backend identity evidence for reviewer and high-risk judge', async () => {
    const gateway = new InferenceGateway([
      adapter('gemini', async () => 'PASS'),
      adapter('groq', async () => 'PASS'),
      adapter('openrouter', async () => 'PASS'),
    ], { targets });

    await expect(gateway.infer(request({ role: 'reviewer' }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(gateway.infer(request({
      role: 'judge',
      task: { kind: 'coding', risk: 'high', prompt: 'judge' },
      routing: { requiredDistinctFrom: ['gemini/gemini-test'] },
    }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('WO-047 short-lived TigerIQ device sessions', () => {
  it('mints a TigerIQ token bound to employee/node and verifies expiry/scope without provider secrets', async () => {
    let now = 1_000;
    const sessions = new DeviceSessionService('s'.repeat(48), {
      async authenticate(input) {
        if (input.credentialId !== 'cred-1' || input.bearerToken !== 'device-secret') return undefined;
        return { employeeId: 'EMP-001', nodeId: 'NODE-1', deviceId: 'DEV-1', scopes: ['inference:invoke'] };
      },
    }, { ttlSeconds: 60, now: () => now });

    const minted = await sessions.mint({
      employeeId: 'EMP-001',
      nodeId: 'NODE-1',
      deviceId: 'DEV-1',
      requestedScopes: ['inference:invoke'],
      client: { name: 'mock-device', version: '1.0.0' },
    }, { credentialId: 'cred-1', bearerToken: 'device-secret' });

    const claims = sessions.verify(minted.accessToken);
    expect(claims.sub).toBe('EMP-001');
    expect(claims.nodeId).toBe('NODE-1');
    expect(minted.accessToken).not.toContain('device-secret');
    expect(JSON.stringify(claims)).not.toContain('GEMINI_API_KEY');

    now = 1_061;
    expect(() => sessions.verify(minted.accessToken)).toThrowError(InferenceGatewayError);
    try {
      sessions.verify(minted.accessToken);
    } catch (error) {
      expect(error).toMatchObject({ code: 'TOKEN_EXPIRED' });
    }
  });
});

describe('WO-047 server-only provider adapters', () => {
  it('classifies real HTTP 429 as quota with retry-after and keeps the key outside the response object', async () => {
    const seen: Array<{ url: string; auth: string; body: string }> = [];
    const groq = createGroqBackendAdapter({
      apiKey: 'groq-provider-secret',
      freeTierVerified: true,
      fetchImpl: async (input, init) => {
        seen.push({
          url: String(input),
          auth: String((init?.headers as Record<string, string>)?.authorization ?? ''),
          body: String(init?.body ?? ''),
        });
        return new Response('{}', { status: 429, headers: { 'retry-after': '2' } });
      },
    });

    let caught: unknown;
    try {
      await groq.execute({ ...targets[1], model: 'openai/gpt-oss-120b' }, { prompt: 'test' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BackendRequestError);
    expect(caught).toMatchObject({ kind: 'quota', retryAfterMs: 2000 });
    expect(seen[0]?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(seen[0]?.auth).toBe('Bearer groq-provider-secret');
    expect(JSON.parse(seen[0]?.body ?? '{}')).toMatchObject({ model: 'openai/gpt-oss-120b', service_tier: 'on_demand' });
    expect(JSON.stringify(caught)).not.toContain('groq-provider-secret');
  });

  it('fails closed before network when Groq free-tier proof or allowlisted model is missing', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'unexpected' } }] }), { status: 200 });
    };
    const safeTarget = { ...targets[1], model: 'openai/gpt-oss-120b' };
    const missingProof = createGroqBackendAdapter({ apiKey: 'secret', fetchImpl });
    await expect(missingProof.execute(safeTarget, { prompt: 'x' })).rejects.toMatchObject({ kind: 'configuration' });
    expect(calls).toBe(0);
    const wrongModel = createGroqBackendAdapter({ apiKey: 'secret', freeTierVerified: true, fetchImpl });
    await expect(wrongModel.execute({ ...safeTarget, model: 'openai/gpt-oss-20b' }, { prompt: 'x' })).rejects.toMatchObject({ kind: 'configuration' });
    expect(calls).toBe(0);
  });

  it('fails closed before network when Gemini Free Tier proof or allowlisted model is missing', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => { calls += 1; return new Response('{}', { status: 200 }); };
    const safeTarget = { ...targets[0], model: 'gemini-2.5-flash' };
    const missingProof = createGeminiBackendAdapter({ apiKey: 'secret', fetchImpl });
    await expect(missingProof.execute(safeTarget, { prompt: 'x' })).rejects.toMatchObject({ kind: 'configuration' });
    expect(calls).toBe(0);
    const wrongModel = createGeminiBackendAdapter({ apiKey: 'secret', freeTierVerified: true, fetchImpl });
    await expect(wrongModel.execute({ ...safeTarget, model: 'gemini-3.7-flash' }, { prompt: 'x' })).rejects.toMatchObject({ kind: 'configuration' });
    expect(calls).toBe(0);
  });

  it('uses official Gemini and OpenRouter HTTP shapes with server-side authorization', async () => {
    const calls: string[] = [];
    const gemini = createGeminiBackendAdapter({
      apiKey: 'gemini-provider-secret',
      freeTierVerified: true,
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini ok' }] } }] }), { status: 200 });
      },
    });
    const openrouter = createOpenRouterBackendAdapter({
      apiKey: 'openrouter-provider-secret',
      fetchImpl: async (input, init) => {
        calls.push(String(input));
        const sent = JSON.parse(String(init?.body ?? '{}')) as { model?: string; usage?: { include?: boolean } };
        expect(sent.model).toBe('openrouter/free');
        expect(sent.usage?.include).toBe(true);
        return new Response(JSON.stringify({
          model: 'meta-llama/example:free',
          choices: [{ message: { content: 'openrouter ok' } }],
          usage: { cost: 0 },
        }), { status: 200 });
      },
    });

    await expect(gemini.execute({ ...targets[0], model: 'gemini-2.5-flash' }, { prompt: 'x' })).resolves.toBe('gemini ok');
    await expect(openrouter.execute({ ...targets[2], model: 'openrouter/free' }, { prompt: 'x' })).resolves.toBe('openrouter ok');
    expect(calls[0]).toContain('/models/gemini-2.5-flash:generateContent');
    expect(calls[1]).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('fails closed for OpenRouter unless the routed model is free and response cost is proven zero', async () => {
    let calls = 0;
    const responseBody = { model: 'meta-llama/example:free', choices: [{ message: { content: 'ok' } }], usage: { cost: 0 } };
    const openrouter = createOpenRouterBackendAdapter({
      apiKey: 'secret',
      fetchImpl: async () => { calls += 1; return new Response(JSON.stringify(responseBody), { status: 200 }); },
    });
    await expect(openrouter.execute({ ...targets[2], model: 'paid/model' }, { prompt: 'x' })).rejects.toMatchObject({ kind: 'configuration' });
    expect(calls).toBe(0);
    responseBody.usage = {} as { cost: number };
    await expect(openrouter.execute({ ...targets[2], model: 'openrouter/free' }, { prompt: 'x' })).rejects.toMatchObject({ kind: 'invalid_response' });
    responseBody.usage = { cost: 0.01 };
    await expect(openrouter.execute({ ...targets[2], model: 'openrouter/free' }, { prompt: 'x' })).rejects.toMatchObject({ kind: 'invalid_response' });
    responseBody.usage = { cost: 0 };
    responseBody.model = 'paid/model';
    await expect(openrouter.execute({ ...targets[2], model: 'openrouter/free' }, { prompt: 'x' })).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('builds zero-cost-safe default server targets without trusting unsafe model overrides', () => {
    const defaults = defaultServerTargets({
      GEMINI_API_KEY: 'gemini',
      TIGERIQ_GEMINI_FREE_TIER_VERIFIED: 'true',
      TIGERIQ_GEMINI_MODEL: 'unsafe/override',
      GROQ_API_KEY: 'groq',
      TIGERIQ_GROQ_FREE_TIER_VERIFIED: 'true',
      TIGERIQ_GROQ_MODEL: 'unsafe/override',
      OPENROUTER_API_KEY: 'openrouter',
      TIGERIQ_OPENROUTER_MODEL: 'unsafe/override',
    });
    expect(defaults.find((item) => item.provider === 'gemini')).toMatchObject({ model: 'gemini-2.5-flash', enabled: true });
    expect(defaults.find((item) => item.provider === 'groq')).toMatchObject({ model: 'openai/gpt-oss-120b', enabled: true });
    expect(defaults.find((item) => item.provider === 'openrouter')).toMatchObject({ model: 'openrouter/free', enabled: true });
  });
});