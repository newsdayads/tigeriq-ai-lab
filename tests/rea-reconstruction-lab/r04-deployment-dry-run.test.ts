import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
// @ts-ignore Standalone ESM R04 simulator intentionally has no declaration file.
import { R04_SOURCE, R04_PHASES, simulateR04DryRun } from '../../projects/rea-reconstruction-lab/r04-deployment-dry-run.mjs';

const file = resolve('projects/rea-reconstruction-lab/r04-deployment-dry-run.mjs');
const run = (...args: string[]) => spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', timeout: 3000 });

it('uses pinned REA release and exact upstream commit', () => {
  expect(R04_SOURCE.version).toBe('6.4.0');
  expect(R04_SOURCE.upstreamCommit).toBe('a56f7bb668ab23fec8d33f7af353ac7ed2fe1895');
  expect(R04_SOURCE.r03DesignCommit).toBe('d5941f26c68755c7e0f7fe47d4d7436e026d21ec');
});
it('normal dry-run never grants lease or claims host execution', () => {
  const x = simulateR04DryRun();
  expect(x.status).toBe('DRY_RUN_FINISHED_NOT_DEPLOYED');
  expect(x.executed).toBe(false);
  expect(x.host_verified).toBe(false);
  expect(x.release_authorized).toBe(false);
  expect(x.steps.map((s: any) => s.phase)).toEqual(R04_PHASES);
  expect(x.steps.every((s: any) => s.simulated === true)).toBe(true);
});
it('audit gate is required before installation stage', () => {
  expect(R04_PHASES.indexOf('VERIFY_R05_SCOPED_OWNER_LEASE_AND_DEVICE_AUTH'))
    .toBeLessThan(R04_PHASES.indexOf('INSTALL_IN_DISPOSABLE_VM_ONLY'));
  expect(R04_PHASES.indexOf('VERIFY_R06_PERMISSION_BEFORE_ANY_INSTALL'))
    .toBeLessThan(R04_PHASES.indexOf('INSTALL_IN_DISPOSABLE_VM_ONLY'));
});
it('backup and restorability precede staged install', () => {
  expect(R04_PHASES.indexOf('BACKUP_ALLOWED_CONFIG_WITH_DIGEST'))
    .toBeLessThan(R04_PHASES.indexOf('INSTALL_IN_DISPOSABLE_VM_ONLY'));
  expect(R04_PHASES.indexOf('VERIFY_ROLLBACK_ARTIFACT_IS_RESTORABLE'))
    .toBeLessThan(R04_PHASES.indexOf('INSTALL_IN_DISPOSABLE_VM_ONLY'));
});
it('MCP tool authorization precedes MCP test', () => {
  expect(R04_PHASES.indexOf('VERIFY_R07_TOOL_ALLOWLIST_BEFORE_MCP'))
    .toBeLessThan(R04_PHASES.indexOf('TEST_MCP_INSIDE_ISOLATED_VM_ONLY'));
});
it('final phase verifies unchanged host poststate', () => {
  expect(R04_PHASES.at(-1)).toBe('VERIFY_HOST_POSTSTATE_UNCHANGED');
  const x = simulateR04DryRun();
  expect(x.rollback.some((s: any) => s.phase === 'VERIFY_HOST_ALLOWLISTED_POSTSTATE_EQUALS_BASELINE')).toBe(true);
});
it('always lists outstanding real-world gates', () => {
  const x = simulateR04DryRun();
  expect(x.outstanding_gates).toContain('R05_LIVE_ATOMIC_OWNER_LEASE_FENCING_HEARTBEAT');
  expect(x.outstanding_gates).toContain('BACKUP_RESTORE_TEST_ON_DISPOSABLE_FIXTURE');
});
it('fails closed on null, arrays and primitive inputs', () => {
  for (const input of [null, [], 'abc', 123, false]) {
    const x = simulateR04DryRun(input as any);
    expect(x.status).toBe('DRY_RUN_INVALID');
    expect(x.executed).toBe(false);
  }
});
it('fails closed on unknown options without echoing their names or values', () => {
  const x = simulateR04DryRun({ token_SECRET_VALUE: 'SENSITIVE_DATA' });
  expect(x.status).toBe('DRY_RUN_INVALID');
  expect(JSON.stringify(x)).not.toContain('token_SECRET_VALUE');
  expect(JSON.stringify(x)).not.toContain('SENSITIVE_DATA');
});
it('rejects unknown injection point, no caller output echoed', () => {
  const x = simulateR04DryRun({ failureAt: 'SENSITIVE_PERSONAL_PATH' });
  expect(x.status).toBe('DRY_RUN_INVALID');
  expect(JSON.stringify(x)).not.toContain('SENSITIVE_PERSONAL_PATH');
});
it('stops at an injected failure and emits ordered rollback steps', () => {
  const x = simulateR04DryRun({ failureAt: 'BACKUP_ALLOWED_CONFIG_WITH_DIGEST' });
  expect(x.status).toBe('DRY_RUN_ABORT_ROLLBACK_SIMULATED');
  expect(x.steps.at(-1)?.outcome).toBe('INJECTED_FAILURE');
  expect(x.steps.some((s: any) => s.phase === 'INSTALL_IN_DISPOSABLE_VM_ONLY')).toBe(false);
  expect(x.rollback[0]?.phase).toBe('STOP_VM_PROCESSES_FROM_EXTERNAL_CONTROLLER');
  expect(x.release_authorized).toBe(false);
});
for (const phase of R04_PHASES) {
  it('rollback simulation covers failure at ' + phase, () => {
    const x = simulateR04DryRun({ failureAt: phase });
    expect(x.status).toBe('DRY_RUN_ABORT_ROLLBACK_SIMULATED');
    expect(x.steps.at(-1)?.phase).toBe(phase);
    expect(x.steps.at(-1)?.outcome).toBe('INJECTED_FAILURE');
    expect(x.steps.length).toBe(R04_PHASES.indexOf(phase) + 1);
    expect(x.rollback.length).toBe(6);
    expect(x.executed).toBe(false);
    expect(x.host_verified).toBe(false);
  });
}
it('CLI dry-run produces a real read-only Node subprocess receipt', () => {
  const r = run('--dry-run');
  expect(r.error).toBeUndefined();
  expect(r.status).toBe(0);
  expect(r.stderr).toBe('');
  const x = JSON.parse(r.stdout);
  expect(x.status).toBe('DRY_RUN_FINISHED_NOT_DEPLOYED');
  expect(x.steps).toHaveLength(14);
  expect(x.executed).toBe(false);
});
it('CLI failure injection produces rollback receipt without executing stages', () => {
  const r = run('--dry-run', '--failure=VERIFY_R06_PERMISSION_BEFORE_ANY_INSTALL');
  expect(r.error).toBeUndefined();
  expect(r.status).toBe(0);
  const x = JSON.parse(r.stdout);
  expect(x.status).toBe('DRY_RUN_ABORT_ROLLBACK_SIMULATED');
  expect(x.steps.at(-1).phase).toBe('VERIFY_R06_PERMISSION_BEFORE_ANY_INSTALL');
  expect(x.steps.some((s: any) => s.phase === 'INSTALL_IN_DISPOSABLE_VM_ONLY')).toBe(false);
});
it('CLI refuses extra commands and sanitizes invalid inputs', () => {
  const r = run('--dry-run', '--failure=SENSITIVE_PRIVATE_TOKEN');
  expect(r.status).toBe(2);
  expect(r.stdout).not.toContain('SENSITIVE_PRIVATE_TOKEN');
  expect(JSON.parse(r.stdout).status).toBe('DRY_RUN_INVALID');
});
it('CLI refuses invocations lacking explicit dry-run', () => {
  const r = run();
  expect(r.status).toBe(2);
  expect(JSON.parse(r.stdout).release_authorized).toBe(false);
});
