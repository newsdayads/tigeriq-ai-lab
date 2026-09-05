import { afterEach, describe, expect, it } from 'vitest';
import { startInferenceGatewayServer } from '../apps/inference-gateway/src/server.js';
import {
  DeviceSessionService,
  InferenceGateway,
  createGeminiBackendAdapter,
  type BackendTarget,
} from '../packages/inference-gateway/src/index.js';

const active: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (active.length) await active.pop()?.();
});

describe('WO-047 mock-device E2E', () => {
  it('mints a short-lived TigerIQ device session then performs inference without exposing provider credentials', async () => {
    const providerSecret = 'GEMINI_SERVER_ONLY_SECRET_123';
    let providerCalls = 0;
    const target: BackendTarget = {
      provider: 'gemini',
      model: 'gemini-mock',
      tier: 'primary',
      costRank: 0,
      qualityRank: 4,
      kinds: ['general', 'coding', 'analysis', 'research'],
    };
    const gemini = createGeminiBackendAdapter({
      apiKey: providerSecret,
      fetchImpl: async (_input, init) => {
        providerCalls += 1;
        expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe(providerSecret);
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'mock device inference result' }] } }],
        }), { status: 200 });
      },
    });
    const gateway = new InferenceGateway([gemini], { targets: [target], budgets: { gemini: 5 } });
    const sessions = new DeviceSessionService('TIGERIQ_SESSION_SECRET_FOR_TESTS_0123456789', {
      async authenticate(input) {
        if (input.credentialId !== 'NODE-CRED-1' || input.bearerToken !== 'node-bootstrap-secret') return undefined;
        return {
          employeeId: 'EMP-001',
          nodeId: 'NODE-ANDROID-001',
          deviceId: 'PHONE-001',
          scopes: ['inference:invoke'],
        };
      },
    }, { ttlSeconds: 300 });
    const server = await startInferenceGatewayServer({ gateway, sessions });
    active.push(server.close);

    const sessionResponse = await fetch(`${server.baseUrl}/v1/inference/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer node-bootstrap-secret',
        'x-tigeriq-credential-id': 'NODE-CRED-1',
      },
      body: JSON.stringify({
        employeeId: 'EMP-001',
        nodeId: 'NODE-ANDROID-001',
        deviceId: 'PHONE-001',
        requestedScopes: ['inference:invoke'],
        client: { name: 'mock-android-app', version: '1.0.0' },
      }),
    });
    expect(sessionResponse.status).toBe(201);
    const sessionBody = await sessionResponse.json() as {
      ok: boolean;
      session: { accessToken: string; employeeId: string; nodeId: string };
    };
    expect(sessionBody.ok).toBe(true);
    expect(sessionBody.session.employeeId).toBe('EMP-001');
    expect(sessionBody.session.nodeId).toBe('NODE-ANDROID-001');
    expect(JSON.stringify(sessionBody)).not.toContain(providerSecret);
    expect(JSON.stringify(sessionBody)).not.toContain('node-bootstrap-secret');

    const inferencePayload = {
      requestId: 'REQ-DEVICE-1',
      employeeId: 'EMP-001',
      workId: 'WO-MOCK',
      role: 'executor',
      task: { kind: 'general', risk: 'low', prompt: 'Give a bounded test response.' },
      routing: { requiredDistinctFrom: [], maxAttempts: 3 },
      budgetClass: 'free-first',
    };
    const invoke = () => fetch(`${server.baseUrl}/v1/inference`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sessionBody.session.accessToken}`,
        'idempotency-key': 'IDEMP-DEVICE-1',
      },
      body: JSON.stringify(inferencePayload),
    });

    const inferenceResponse = await invoke();
    expect(inferenceResponse.status).toBe(200);
    const inferenceBody = await inferenceResponse.json() as Record<string, unknown>;
    const serialized = JSON.stringify(inferenceBody);
    expect(serialized).toContain('mock device inference result');
    expect(serialized).toContain('gemini/gemini-mock');
    expect(serialized).not.toContain(providerSecret);
    expect(serialized).not.toContain('node-bootstrap-secret');
    expect(providerCalls).toBe(1);

    const replayResponse = await invoke();
    expect(replayResponse.status).toBe(200);
    expect(providerCalls).toBe(1);

    const healthResponse = await fetch(`${server.baseUrl}/v1/inference/health`, {
      headers: { authorization: `Bearer ${sessionBody.session.accessToken}` },
    });
    expect(healthResponse.status).toBe(200);
    const healthText = await healthResponse.text();
    expect(healthText).toContain('gemini/gemini-mock');
    expect(healthText).not.toContain(providerSecret);
  });

  it('rejects an inference request whose TigerIQ employee identity does not match the short-lived session', async () => {
    const target: BackendTarget = {
      provider: 'gemini', model: 'gemini-mock', tier: 'primary', costRank: 0, qualityRank: 4,
      kinds: ['general'],
    };
    const gateway = new InferenceGateway([{
      provider: 'gemini',
      async execute() { return 'should not run'; },
    }], { targets: [target] });
    const sessions = new DeviceSessionService('TIGERIQ_SESSION_SECRET_FOR_TESTS_ABCDEFGHIJ', {
      async authenticate() {
        return { employeeId: 'EMP-001', nodeId: 'NODE-1', scopes: ['inference:invoke'] };
      },
    });
    const server = await startInferenceGatewayServer({ gateway, sessions });
    active.push(server.close);

    const sessionResponse = await fetch(`${server.baseUrl}/v1/inference/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer bootstrap',
        'x-tigeriq-credential-id': 'cred',
      },
      body: JSON.stringify({
        employeeId: 'EMP-001', nodeId: 'NODE-1', requestedScopes: ['inference:invoke'],
        client: { name: 'mock', version: '1' },
      }),
    });
    const session = await sessionResponse.json() as { session: { accessToken: string } };
    const response = await fetch(`${server.baseUrl}/v1/inference`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.session.accessToken}`,
        'idempotency-key': 'mismatch-1',
      },
      body: JSON.stringify({
        requestId: 'REQ-X', employeeId: 'EMP-OTHER', role: 'executor',
        task: { kind: 'general', risk: 'low', prompt: 'x' },
        routing: { requiredDistinctFrom: [] }, budgetClass: 'free-first',
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'IDENTITY_MISMATCH' } });
  });
});