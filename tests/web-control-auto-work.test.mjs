import { afterEach, describe, expect, it, vi } from 'vitest';

function makeIssue({
  number = 1,
  state = 'open',
  priority = 'P1',
  source = 'vercel-explicit-dispatch',
  instruction = 'Tóm tắt kế hoạch',
  updatedAt = '2026-09-01T00:00:00Z',
  pc01Required = false,
  cloudExecutorAllowed = true,
  includeExecutionMarker = true,
} = {}) {
  const executor = includeExecutionMarker
    ? `vercel-serverless / bounded cloud executor / PC01_REQUIRED=${String(pc01Required)} / CLOUD_EXECUTOR_ALLOWED=${String(cloudExecutorAllowed)}`
    : 'vercel-serverless / bounded cloud executor';
  return {
    number,
    state,
    updated_at: updatedAt,
    created_at: '2026-09-01T00:00:00Z',
    title: `[${priority}] [TigerIQ AI] ${instruction}`,
    body: [
      'TIGERIQ_JOB_V1', '', '## Instruction', instruction, '', '## Priority', priority,
      '', '## Source', source, '', '## Fingerprint', 'abc123', '', '## Expected Evidence', 'Concrete result plus server gates.',
      '', '## Executor', executor,
    ].join('\n'),
  };
}

describe('Web Control autonomous backlog worker policy', () => {
  afterEach(() => { vi.resetModules(); });

  it('accepts only canonical Web Control cloud work with explicit PC01_REQUIRED=false', async () => {
    const { parseAutonomousCandidate } = await import('../api/auto-work.mjs');
    expect(parseAutonomousCandidate(makeIssue())).toEqual(expect.objectContaining({
      instruction: 'Tóm tắt kế hoạch', priority: 'P1', source: 'vercel-explicit-dispatch', fingerprint: 'abc123',
    }));
    expect(parseAutonomousCandidate(makeIssue({ source: 'pc01-recovery' }))).toBeNull();
    expect(parseAutonomousCandidate(makeIssue({ source: 'tigeriq-autonomy-feed' }))).toBeNull();
    expect(parseAutonomousCandidate(makeIssue({ pc01Required: true }))).toBeNull();
    expect(parseAutonomousCandidate(makeIssue({ cloudExecutorAllowed: false }))).toBeNull();
    expect(parseAutonomousCandidate(makeIssue({ includeExecutionMarker: false }))).toBeNull();
    expect(parseAutonomousCandidate({ ...makeIssue(), pull_request: { url: 'x' } })).toBeNull();
    expect(parseAutonomousCandidate(makeIssue({ state: 'closed' }))).toBeNull();
  });

  it('fails closed on contradictory execution markers', async () => {
    const { booleanExecutionMarker, parseAutonomousCandidate } = await import('../api/auto-work.mjs');
    const issue = makeIssue();
    issue.body += '\nPC01_REQUIRED=true';
    expect(booleanExecutionMarker(issue.body, 'PC01_REQUIRED')).toBeNull();
    expect(parseAutonomousCandidate(issue)).toBeNull();
  });

  it('orders P0 before P1 before P2 instead of letting low priority backlog starve urgent work', async () => {
    const { parseAutonomousCandidate, sortAutonomousCandidates } = await import('../api/auto-work.mjs');
    const rows = ['P2', 'P0', 'P1'].map((priority, index) => parseAutonomousCandidate(makeIssue({ number: index + 1, priority })));
    expect(sortAutonomousCandidates(rows).map((row) => row.priority)).toEqual(['P0', 'P1', 'P2']);
  });

  it('runs queued work, recovers only stale claims, and never loops ordinary non-retryable blocked work', async () => {
    const { autonomousStageDecision } = await import('../api/auto-work.mjs');
    const issue = makeIssue({ updatedAt: '2026-09-01T00:00:00Z' });
    expect(autonomousStageDecision(issue, [], Date.parse('2026-09-01T00:05:00Z'))).toEqual({ runnable: true, reason: 'queued' });

    const claimed = [{ body: 'TIGERIQ_JOB_CLAIMED\nRUN_ID x' }];
    expect(autonomousStageDecision(issue, claimed, Date.parse('2026-09-01T00:05:00Z')).runnable).toBe(false);
    expect(autonomousStageDecision(issue, claimed, Date.parse('2026-09-01T00:31:00Z'))).toEqual({ runnable: true, reason: 'stale_claim_recovery' });

    const blocked = [{ body: 'TIGERIQ_JOB_FAILED\nRUN_ID x\nFAILURE_KIND bounded_executor_blocked\nBLOCKER repository mutation required' }];
    expect(autonomousStageDecision(issue, blocked, Date.parse('2026-09-01T00:31:00Z'))).toEqual({ runnable: false, reason: 'non_retryable_failure' });
  });

  it('permits exactly one migration retry for the legacy model-side SHA256 blocker', async () => {
    const { autonomousStageDecision } = await import('../api/auto-work.mjs');
    const issue = makeIssue();
    const legacy = {
      body: [
        'TIGERIQ_JOB_FAILED',
        'RUN_ID legacy-1',
        'FAILURE_KIND bounded_executor_blocked',
        'BLOCKER Unable to generate a verifiable SHA256 hash bound to the result text as required for expectedEvidence; computing cryptographic hashes is not supported in this environment.',
      ].join('\n'),
    };
    expect(autonomousStageDecision(issue, [legacy])).toEqual({ runnable: true, reason: 'legacy_server_evidence_migration_retry' });
    expect(autonomousStageDecision(issue, [legacy, { ...legacy, body: legacy.body.replace('legacy-1', 'legacy-2') }])).toEqual({ runnable: false, reason: 'non_retryable_failure' });
  });

  it('allows only a bounded retry for transient cloud pipeline errors', async () => {
    const { autonomousStageDecision } = await import('../api/auto-work.mjs');
    const issue = makeIssue();
    const once = [{ body: 'TIGERIQ_JOB_FAILED\nFAILURE_KIND cloud_pipeline_error' }];
    expect(autonomousStageDecision(issue, once)).toEqual({ runnable: true, reason: 'bounded_transient_retry' });
    const twice = [...once, { body: 'TIGERIQ_JOB_FAILED\nFAILURE_KIND cloud_pipeline_error' }];
    expect(autonomousStageDecision(issue, twice)).toEqual({ runnable: false, reason: 'retry_limit_reached' });
  });
});
