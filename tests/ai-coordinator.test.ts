import { describe, expect, it } from 'vitest';
import {
  AICoordinator,
  InMemoryCheckpointStore,
  fingerprintWorkItem,
  type AIWorkItem,
  type CoordinatorCheckpoint,
  type ModelProfile,
} from '../packages/ai-coordinator/src/index.js';
import { ProviderRequestError, type ProviderAdapter } from '../packages/model-router/src/index.js';

function adapter(provider: ProviderAdapter['provider'], run: ProviderAdapter['execute']): ProviderAdapter {
  return { provider, execute: run };
}

const profiles: ModelProfile[] = [
  { target: { provider: 'ollama', model: 'local', local: true }, costRank: 0, qualityRank: 2, kinds: ['general', 'coding', 'analysis'] },
  { target: { provider: 'gemini', model: 'gemini' }, costRank: 1, qualityRank: 4, kinds: ['general', 'coding', 'analysis', 'research'] },
  { target: { provider: 'openai', model: 'openai' }, costRank: 2, qualityRank: 4, kinds: ['general', 'coding', 'analysis', 'research'] },
  { target: { provider: 'anthropic', model: 'claude' }, costRank: 2, qualityRank: 4, kinds: ['general', 'coding', 'analysis', 'research'] },
];

function work(overrides: Partial<AIWorkItem> = {}): AIWorkItem {
  return {
    id: 'WO-T',
    prompt: 'Produce the requested result.',
    kind: 'general',
    risk: 'low',
    acceptanceCriteria: ['correct', 'complete'],
    ...overrides,
  };
}

describe('WO-043 AI coordinator', () => {
  it('uses the lowest-cost capable executor plus distinct reviewer and judge', async () => {
    const store = new InMemoryCheckpointStore();
    const coordinator = new AICoordinator([
      adapter('ollama', async () => 'local executor result'),
      adapter('gemini', async () => 'PASS independent check'),
      adapter('anthropic', async () => 'PASS independent judgment'),
    ], store, { profiles });

    const result = await coordinator.run(work());
    const identities = [result.executor, result.reviewer, result.judge]
      .map((stage) => `${stage?.target.provider}/${stage?.target.model}`);

    expect(result.status).toBe('verified');
    expect(result.executor?.target.provider).toBe('ollama');
    expect(result.reviewer?.target.provider).toBe('gemini');
    expect(result.judge?.target.provider).toBe('anthropic');
    expect(new Set(identities).size).toBe(3);
    expect(result.judge?.decision).toBe('PASS');
  });

  it('requires three distinct model identities for coding/high-impact work', async () => {
    const store = new InMemoryCheckpointStore();
    const coordinator = new AICoordinator([
      adapter('gemini', async () => 'executor result'),
      adapter('openai', async () => 'PASS judge result'),
      adapter('anthropic', async () => 'PASS reviewer result'),
    ], store, { profiles });

    const result = await coordinator.run(work({ kind: 'coding', risk: 'high' }));
    const identities = [result.executor, result.reviewer, result.judge]
      .map((stage) => `${stage?.target.provider}/${stage?.target.model}`);

    expect(result.status).toBe('verified');
    expect(new Set(identities).size).toBe(3);
    expect(result.executor?.target.provider).toBe('gemini');
  });

  it('fails over on quota/timeout without losing the work item', async () => {
    const store = new InMemoryCheckpointStore();
    const coordinator = new AICoordinator([
      adapter('ollama', async () => {
        throw new ProviderRequestError('ollama', 'timeout', 'local timeout');
      }),
      adapter('gemini', async () => 'cloud executor result'),
      adapter('openai', async () => 'PASS independent result'),
      adapter('anthropic', async () => 'PASS independent result'),
    ], store, { profiles, maxAttemptsPerStage: 3 });

    const result = await coordinator.run(work({ risk: 'medium' }));
    const executorAttempts = result.attempts.filter((attempt) => attempt.role === 'executor');

    expect(result.status).toBe('verified');
    expect(executorAttempts[0]).toMatchObject({ ok: false, failureKind: 'timeout' });
    expect(executorAttempts[1]).toMatchObject({ ok: true, target: { provider: 'gemini' } });
  });

  it('stops after the configured bounded attempt limit', async () => {
    const store = new InMemoryCheckpointStore();
    const coordinator = new AICoordinator([
      adapter('ollama', async () => { throw new Error('boom'); }),
      adapter('gemini', async () => { throw new Error('boom'); }),
      adapter('openai', async () => 'should-not-run'),
    ], store, { profiles, maxAttemptsPerStage: 2 });

    const result = await coordinator.run(work({ risk: 'medium' }));
    const executorAttempts = result.attempts.filter((attempt) => attempt.role === 'executor');

    expect(result.status).toBe('blocked');
    expect(result.blocker).toContain('routes exhausted');
    expect(executorAttempts).toHaveLength(2);
    expect(executorAttempts.every((attempt) => attempt.failureKind === 'unknown')).toBe(true);
  });

  it('resumes from a persisted executor checkpoint instead of repeating completed work', async () => {
    const item = work({ id: 'WO-RESUME' });
    const store = new InMemoryCheckpointStore();
    const saved: CoordinatorCheckpoint = {
      workItemId: item.id,
      fingerprint: fingerprintWorkItem(item),
      status: 'reviewing',
      attempts: [{
        sequence: 1,
        role: 'executor',
        target: { provider: 'ollama', model: 'local', local: true },
        ok: true,
        timestamp: '2026-08-31T00:00:00.000Z',
      }],
      executor: {
        role: 'executor',
        target: { provider: 'ollama', model: 'local', local: true },
        text: 'persisted executor output',
        completedAt: '2026-08-31T00:00:00.000Z',
      },
      updatedAt: '2026-08-31T00:00:00.000Z',
    };
    await store.save(saved);
    let executorCalls = 0;
    const coordinator = new AICoordinator([
      adapter('ollama', async () => { executorCalls += 1; return 'duplicate'; }),
      adapter('gemini', async () => 'PASS resumed verification'),
      adapter('anthropic', async () => 'PASS resumed judgment'),
    ], store, { profiles });

    const result = await coordinator.run(item);

    expect(result.status).toBe('verified');
    expect(executorCalls).toBe(0);
    expect(result.executor?.text).toBe('persisted executor output');
    expect(new Set([
      `${result.executor?.target.provider}/${result.executor?.target.model}`,
      `${result.reviewer?.target.provider}/${result.reviewer?.target.model}`,
      `${result.judge?.target.provider}/${result.judge?.target.model}`,
    ]).size).toBe(3);
  });

  it('fails closed when three-way independence cannot be satisfied even for low-risk work', async () => {
    const store = new InMemoryCheckpointStore();
    const limitedProfiles = profiles.filter((profile) => ['gemini', 'openai'].includes(profile.target.provider));
    const coordinator = new AICoordinator([
      adapter('gemini', async () => 'executor result'),
      adapter('openai', async () => 'PASS review'),
    ], store, { profiles: limitedProfiles });

    const result = await coordinator.run(work({ id: 'WO-INDEP' }));

    expect(result.status).toBe('blocked');
    expect(result.blocker).toBe('judge has no eligible independent model');
  });

  it('emits bounded evidence without raw prompts, outputs or secret-like error messages', async () => {
    const store = new InMemoryCheckpointStore();
    const item = work({ id: 'WO-EVIDENCE', prompt: 'private task text' });
    const coordinator = new AICoordinator([
      adapter('ollama', async () => { throw new Error('secret-token-123'); }),
      adapter('gemini', async () => 'executor output private'),
      adapter('openai', async () => 'PASS review private'),
      adapter('anthropic', async () => 'PASS judge private'),
    ], store, { profiles });

    const result = await coordinator.run(item);
    const evidence = coordinator.evidence(result);
    const serialized = JSON.stringify(evidence);

    expect(result.status).toBe('verified');
    expect(serialized).not.toContain('private task text');
    expect(serialized).not.toContain('executor output private');
    expect(serialized).not.toContain('secret-token-123');
    expect(evidence.stages.every((stage) => stage.outputSha256.length === 64)).toBe(true);
    expect(evidence.attempts.some((attempt) => attempt.failureKind === 'unknown')).toBe(true);
  });
});
