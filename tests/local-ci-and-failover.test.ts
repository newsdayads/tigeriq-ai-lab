// @ts-nocheck
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { runLocalCiGate, LOCAL_CI_SCHEMA } from '../apps/tigeriq-coding-lane/local-ci-gate.mjs';
import { verifyCodingFunctionalChecks, CODING_STEP_PACKET_VERSION } from '../apps/tigeriq-coding-lane/step-contract.mjs';
import { resolveQuotaFailoverChain, createHandoffCheckpoint } from '../apps/tigeriq-core/work-routing-policy.mjs';
import { parseCodingIssue } from '../apps/tigeriq-core/github-coding-intake.mjs';

function withGitFixture(fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'tigeriq-ci-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'CI Fixture');
    git('config', 'user.email', 'ci-fixture@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(cwd, 'tracked.txt'), 'fixture');
    git('add', 'tracked.txt');
    git('commit', '-qm', 'fixture');
    return fn(cwd, git('rev-parse', 'HEAD'));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

describe('Local CI Gate & Zero-Drop AI Failover', () => {
  it('has completely removed .github/workflows', () => {
    expect(existsSync(new URL('../.github/workflows', import.meta.url))).toBe(false);
  });

  it('runs the MCP regression suite for direct MCP changes', () => {
    const calls = [];
    withGitFixture((cwd, head) => runLocalCiGate({ cwd, sourceHeadSha: head, changedPaths: ['apps/tigeriq-core/pc-operator-mcp.mjs'], runner: (cmd) => { calls.push(cmd); return 'PASS'; } }));
    expect(calls).toEqual(['npm run typecheck && npx vitest run tests/pc-operator-mcp.test.mjs && npm run build']);
  });

  it('produces an exact-head Local CI receipt accepted by verifyCodingFunctionalChecks', () => {
    withGitFixture((cwd, head) => {
    const receipt = runLocalCiGate({
      cwd, sourceHeadSha: head,
      commands: [{ name: 'CI Verify', command: 'echo ok' }],
      runner: () => 'PASS',
    });
    expect(receipt.schema).toBe(LOCAL_CI_SCHEMA);
    expect(receipt.pass).toBe(true);
    expect(receipt.logSha256).toMatch(/^[a-f0-9]{64}$/);
    const verified = verifyCodingFunctionalChecks({
      packet: { schema: CODING_STEP_PACKET_VERSION, required_checks: ['CI Verify'] },
      checkRuns: receipt.checkRuns,
      sourceHeadSha: head,
      repositoryFullName: 'newsdayads/tigeriq-ai-lab',
    });
    expect(verified).toEqual({ pass: true, code: 'CODING_FUNCTIONAL_CHECKS_PASSED', missing: [] });
    });
  });

  it('rejects wrong HEAD before executing CI', () => {
    withGitFixture((cwd) => {
      let ran = false;
      expect(() => runLocalCiGate({ cwd, sourceHeadSha: '0'.repeat(40), runner: () => { ran = true; } })).toThrow('LOCAL_CI_HEAD_MISMATCH');
      expect(ran).toBe(false);
    });
  });

  it('rejects dirty tracked source before executing CI', () => {
    withGitFixture((cwd, head) => {
      writeFileSync(join(cwd, 'tracked.txt'), 'changed');
      expect(() => runLocalCiGate({ cwd, sourceHeadSha: head, runner: () => 'PASS' })).toThrow('LOCAL_CI_TRACKED_SOURCE_DIRTY');
    });
  });

  it('rejects a source change during CI instead of emitting PASS', () => {
    withGitFixture((cwd, head) => {
      expect(() => runLocalCiGate({ cwd, sourceHeadSha: head, runner: () => {
        writeFileSync(join(cwd, 'tracked.txt'), 'changed during test');
        return 'PASS';
      } })).toThrow('LOCAL_CI_TRACKED_SOURCE_DIRTY');
    });
  });

  it('fails over from blocked/rate-limited NV02 to NV09 Ollama with handoff checkpoint', () => {
    const route = resolveQuotaFailoverChain({
      capability: 'coding',
      failedWorker: 'NV02',
      workerStates: { NV02: { status: 'BLOCKED_SUSPICIOUS_ACTIVITY' }, NV09: { status: 'READY' } },
    });
    expect(route.nextWorker).toBe('NV09');
    expect(route.exhausted).toBe(false);

    const cp = createHandoffCheckpoint({
      jobId: 'GH-5777',
      branch: 'feat/test',
      commitSha: 'b'.repeat(40),
      failedWorker: 'NV02',
      failureReason: 'BLOCKED_SUSPICIOUS_ACTIVITY',
      nextWorker: route.nextWorker,
      completedSteps: ['spec', 'edit'],
      remainingPrompt: 'Run local CI and merge',
    });
    expect(cp.schema).toBe('TIGERIQ_AI_HANDOFF_CHECKPOINT_V1');
    expect(cp.nextWorker).toBe('NV09');
    expect(cp.completedSteps).toEqual(['spec', 'edit']);
  });

  it('accepts OWNER_DIRECT auto-resume P1-P5 issues without requiring 12 legacy flags', () => {
    const parsed = parseCodingIssue({
      number: 5611,
      state: 'open',
      title: '[P1][TIGERIQ NEWS][EDITORIAL V2] Auto resume test',
      html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/5611',
      body: 'OWNER_DIRECT=true\nRESUME_POLICY=CONDITIONAL_AUTO_AFTER_VERIFIED_CORE_RECOVERY\n',
    });
    expect(parsed).not.toBeNull();
    expect(parsed.number).toBe(5611);
  });
});
