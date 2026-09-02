import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AIExecutionDispatcherV1,
  AIRouterV1,
  PromptArchitectV1,
  PromptTemplateLibraryV1,
  type AIExecutionEndpointV1,
  type PromptArchitectInputV1,
  type PromptOutcomeV1,
} from '../packages/ai-runtime-v1/src/index.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function endpoint(overrides: Partial<AIExecutionEndpointV1> = {}): AIExecutionEndpointV1 {
  return {
    endpointId: 'PHONE-GEMINI', employeeId: 'EMP-PHONE', provider: 'gemini', model: 'gemini-device',
    location: 'employee-device', credentialOwner: 'employee-device', billingMode: 'free-tier-proven',
    kinds: ['general', 'coding', 'analysis', 'research'], roles: ['executor', 'reviewer', 'judge'], capabilities: ['code'],
    quotaState: 'available', capabilityScore: 90, stabilityScore: 92, speedScore: 88, historicalQualityScore: 91, costRank: 0,
    ...overrides,
  };
}

function input(): PromptArchitectInputV1 {
  return {
    jobId: 'JOB-001', goal: 'Build the JOB-001 integration candidate.',
    context: 'Use TigerIQ V1 contracts. Do not claim physical runtime evidence.',
    employee: { employeeId: 'EMP-PHONE', role: 'AI Employee', capabilities: ['coding'] },
    target: { provider: 'gemini', model: 'gemini-device', endpointId: 'PHONE-GEMINI' },
    kind: 'coding', risk: 'high',
    acceptanceCriteria: ['Build succeeds', 'Relevant tests pass', 'No credential is exposed'],
  };
}

function outcome(overrides: Partial<PromptOutcomeV1> = {}): PromptOutcomeV1 {
  return {
    decision: 'PASS', evaluatorRole: 'reviewer', evaluatorBackendIdentity: 'claude/reviewer',
    outputSha256: digest('result'), latencyMs: 1000, feedback: 'Meets criteria.', ...overrides,
  };
}

describe('AI Runtime V1', () => {
  it('routes across PC01 and device endpoints using quality/health/quota/speed/cost while failing closed on paid or exhausted routes', () => {
    const router = new AIRouterV1([
      endpoint(),
      endpoint({ endpointId: 'PC01-LOCAL', employeeId: 'EMP-PC01', provider: 'ollama', model: 'local', location: 'pc01-local', credentialOwner: 'none', billingMode: 'local-zero-cost', capabilityScore: 82, stabilityScore: 99, speedScore: 70, historicalQualityScore: 80 }),
      endpoint({ endpointId: 'PAID', provider: 'anthropic', model: 'paid', billingMode: 'paid', capabilityScore: 100, stabilityScore: 100, speedScore: 100, historicalQualityScore: 100 }),
      endpoint({ endpointId: 'EMPTY', provider: 'openrouter', model: 'openrouter/free', quotaState: 'exhausted' }),
    ]);
    const ranked = router.rank({ kind: 'coding', risk: 'high', role: 'executor', requiredCapabilities: ['code'], zeroCostOnly: true });
    expect(ranked.map((item) => item.endpoint.endpointId)).toEqual(['PHONE-GEMINI', 'PC01-LOCAL']);
    expect(ranked[0]?.endpoint.credentialOwner).toBe('employee-device');
  });

  it('keeps executor reviewer judge backend identities independent', () => {
    const router = new AIRouterV1([
      endpoint({ endpointId: 'G', provider: 'gemini', model: 'g' }),
      endpoint({ endpointId: 'C', provider: 'claude', model: 'c', billingMode: 'subscription-proven' }),
      endpoint({ endpointId: 'O', provider: 'ollama', model: 'o', location: 'pc01-local', credentialOwner: 'none', billingMode: 'local-zero-cost' }),
    ]);
    const executor = router.select({ kind: 'coding', risk: 'high', role: 'executor', zeroCostOnly: true })!;
    const reviewer = router.select({ kind: 'coding', risk: 'high', role: 'reviewer', zeroCostOnly: true, excludedBackendIdentities: [`${executor.provider}/${executor.model}`] })!;
    const judge = router.select({ kind: 'coding', risk: 'high', role: 'judge', zeroCostOnly: true, excludedBackendIdentities: [`${executor.provider}/${executor.model}`, `${reviewer.provider}/${reviewer.model}`] })!;
    expect(new Set([`${executor.provider}/${executor.model}`, `${reviewer.provider}/${reviewer.model}`, `${judge.provider}/${judge.model}`]).size).toBe(3);
  });

  it('dispatches JOB-001 to a device-owned execution adapter and validates standardized evidence', async () => {
    const target = endpoint();
    const dispatcher = new AIExecutionDispatcherV1([{ endpointId: target.endpointId, execute: async (request) => ({
      contractVersion: 'TIGERIQ_JOB_EXECUTION_V1', jobId: request.jobId, promptId: request.promptId, promptVersion: request.promptVersion,
      employeeId: request.employeeId, endpointId: request.endpointId, provider: target.provider, model: target.model, output: 'device-result',
      startedAt: '2026-09-02T02:00:00.000Z', completedAt: '2026-09-02T02:00:02.000Z', attempts: 1, failoverCount: 0,
      errors: [], evidence: [{ kind: 'output-sha256', ref: digest('device-result') }], credentialExposure: false,
    }) }]);
    const result = await dispatcher.execute(target, {
      contractVersion: 'TIGERIQ_JOB_EXECUTION_V1', jobId: 'JOB-001', promptId: 'PROMPT-X', promptVersion: 1,
      employeeId: target.employeeId, endpointId: target.endpointId, role: 'executor', idempotencyKey: 'JOB-001:executor:1',
      prompt: 'work', createdAt: '2026-09-02T02:00:00.000Z',
    });
    expect(result.output).toBe('device-result');
    expect(result.credentialExposure).toBe(false);
  });
});

describe('Prompt Architect V1', () => {
  it('creates PROMPT-ID/version/template/history and model-specific prompt text', () => {
    const architect = new PromptArchitectV1('ollama/prompt-architect');
    const artifact = architect.create(input());
    expect(artifact.promptId).toMatch(/^PROMPT-[A-F0-9]{16}$/);
    expect(artifact.version).toBe(1);
    expect(artifact.templateId).toBe('gemini-v1');
    expect(artifact.history).toHaveLength(1);
    expect(artifact.renderedPrompt).toContain('TARGET_AI: gemini/gemini-device');
  });

  it('forbids the architect from reviewer/judge self-evaluation', () => {
    const architect = new PromptArchitectV1('ollama/prompt-architect');
    const artifact = architect.create(input());
    expect(() => architect.applyIndependentOutcome(artifact, outcome({ evaluatorBackendIdentity: 'ollama/prompt-architect' }))).toThrow('prompt architect cannot review or judge its own prompt outcome');
  });

  it('tracks FAIL and bounded repair versions', () => {
    const architect = new PromptArchitectV1('ollama/prompt-architect', undefined, 1);
    const artifact = architect.create(input());
    const fail = outcome({ decision: 'FAIL', feedback: 'Missing reboot recovery evidence.' });
    const failed = architect.applyIndependentOutcome(artifact, fail);
    expect(failed.status).toBe('failed');
    const repaired = architect.repair(failed, input(), fail);
    expect(repaired.promptId).toBe(artifact.promptId);
    expect(repaired.version).toBe(2);
    expect(repaired.repairCount).toBe(1);
    expect(() => architect.repair(repaired, input(), fail)).toThrow('prompt repair limit exhausted');
  });

  it('improves template selection from independent observed PASS/FAIL history', () => {
    const library = new PromptTemplateLibraryV1();
    for (let i = 0; i < 10; i += 1) {
      library.record('gemini-v1', 1, outcome({ decision: 'FAIL', outputSha256: digest(`g-${i}`) }));
      library.record('generic-v1', 1, outcome({ decision: 'PASS', outputSha256: digest(`x-${i}`) }));
    }
    expect(library.select(input()).templateId).toBe('generic-v1');
  });
});
