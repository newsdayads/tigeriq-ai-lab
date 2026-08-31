import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  BackendRequestError,
  InferenceGateway,
  type BackendAdapter,
  type BackendTarget,
  type GatewayProvider,
} from '../packages/inference-gateway/src/index.js';

const targets: BackendTarget[] = [
  { provider: 'gemini', model: 'gemini-gate130', tier: 'primary', costRank: 0, qualityRank: 4, kinds: ['general', 'coding', 'analysis', 'research'] },
  { provider: 'groq', model: 'groq-gate130', tier: 'primary', costRank: 0, qualityRank: 4, kinds: ['general', 'coding', 'analysis', 'research'] },
  { provider: 'openrouter', model: 'openrouter-gate130', tier: 'fallback', costRank: 1, qualityRank: 4, kinds: ['general', 'coding', 'analysis', 'research'] },
];

function adapter(provider: GatewayProvider, execute: BackendAdapter['execute']): BackendAdapter {
  return { provider, execute };
}

function request(role: 'executor' | 'reviewer' | 'judge', requestId: string, requiredDistinctFrom: string[] = []) {
  return {
    requestId,
    employeeId: 'EMP-010',
    workId: 'GATE-130',
    role,
    task: { kind: 'general' as const, risk: 'low' as const, prompt: `${role} Gate #130` },
    routing: { requiredDistinctFrom, maxAttempts: 3 },
    budgetClass: 'free-first' as const,
  };
}

describe('Gate #130 independent-review remediation', () => {
  it('proves executor -> reviewer -> judge use three distinct backend identities and expose metadata only', async () => {
    const gateway = new InferenceGateway([
      adapter('gemini', async () => 'executor result'),
      adapter('groq', async () => 'PASS reviewer result'),
      adapter('openrouter', async () => 'PASS judge result'),
    ], { targets });

    const executor = await gateway.infer(request('executor', 'REQ-EXEC-JUDGE'));
    const reviewer = await gateway.infer(request('reviewer', 'REQ-REVIEW-JUDGE', [executor.selectedBackendIdentity]));
    const judge = await gateway.infer(request('judge', 'REQ-JUDGE', [executor.selectedBackendIdentity, reviewer.selectedBackendIdentity]));

    expect(executor.selectedBackendIdentity).toBe('gemini/gemini-gate130');
    expect(reviewer.selectedBackendIdentity).toBe('groq/groq-gate130');
    expect(judge.selectedBackendIdentity).toBe('openrouter/openrouter-gate130');
    expect(new Set([executor.selectedBackendIdentity, reviewer.selectedBackendIdentity, judge.selectedBackendIdentity]).size).toBe(3);
    expect(judge.decision).toBe('PASS');

    const sharedMetadata = {
      executorBackendIdentity: executor.selectedBackendIdentity,
      reviewerBackendIdentity: reviewer.selectedBackendIdentity,
      judgeBackendIdentity: judge.selectedBackendIdentity,
      reviewerDecision: reviewer.decision,
      judgeDecision: judge.decision,
    };
    const serialized = JSON.stringify(sharedMetadata);
    expect(serialized).not.toMatch(/api[_-]?key|authorization|bearer|credential|secret|token/i);
  });

  it('fails closed when Judge excludes every available backend identity', async () => {
    const gateway = new InferenceGateway([
      adapter('gemini', async () => 'unused'),
      adapter('groq', async () => 'unused'),
      adapter('openrouter', async () => 'unused'),
    ], { targets });

    await expect(gateway.infer(request('judge', 'REQ-JUDGE-NO-BACKEND', [
      'gemini/gemini-gate130',
      'groq/groq-gate130',
      'openrouter/openrouter-gate130',
    ]))).rejects.toThrow();
  });

  it('proves injected provider secrets cannot cross error/evidence/schema/client-visible boundaries', async () => {
    const geminiSecret = 'GEMINI_GATE130_INJECTED_API_KEY';
    const groqSecret = 'GROQ_GATE130_INJECTED_API_KEY';
    const openrouterSecret = 'OPENROUTER_GATE130_INJECTED_API_KEY';
    const allSecrets = [geminiSecret, groqSecret, openrouterSecret];

    const gateway = new InferenceGateway([
      adapter('gemini', async () => {
        throw new BackendRequestError('gemini', 'quota', `quota response carried ${geminiSecret}`, 5_000);
      }),
      adapter('groq', async () => {
        if (groqSecret.length < 10) throw new Error('invalid provider credential fixture');
        return 'sanitized successful provider output';
      }),
      adapter('openrouter', async () => {
        if (openrouterSecret.length < 10) throw new Error('invalid provider credential fixture');
        return 'unused fallback output';
      }),
    ], { targets, cooldownMs: 1_000 });

    const result = await gateway.infer(request('executor', 'REQ-SECRET-BOUNDARY'));
    expect(result.selectedBackendIdentity).toBe('groq/groq-gate130');

    const resultEvidenceExport = JSON.stringify({
      result: result.text,
      selectedBackendIdentity: result.selectedBackendIdentity,
      attempts: result.attempts,
      outputSha256: result.outputSha256,
    });
    const clientContractFixture = JSON.stringify({
      employeeId: 'EMP-010',
      deviceId: 'DEV-010',
      workId: 'GATE-130',
      backendIdentity: result.selectedBackendIdentity,
      evidence: { attempts: result.attempts, outputSha256: result.outputSha256 },
    });
    const schemaText = await readFile('schemas/android-worker-v07.schema.json', 'utf8');

    for (const secret of allSecrets) {
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(resultEvidenceExport).not.toContain(secret);
      expect(clientContractFixture).not.toContain(secret);
      expect(schemaText).not.toContain(secret);
    }
    expect(resultEvidenceExport).not.toMatch(/api[_-]?key|authorization|bearer|credential/i);
    expect(clientContractFixture).not.toMatch(/api[_-]?key|authorization|bearer|credential/i);
  });
});
