/**
 * REA GH-4780 R04: immutable dry-run state machine, NEVER an installer.
 * No filesystem, network, subprocess, sandbox or Core calls.
 * A simulated gate pass never confers host permissions or an actual lease.
 */
export const R04_SOURCE = Object.freeze({
  package: 'rea-agents',
  version: '6.4.0',
  upstreamCommit: 'a56f7bb668ab23fec8d33f7af353ac7ed2fe1895',
  r03DesignCommit: 'd5941f26c68755c7e0f7fe47d4d7436e026d21ec',
});
export const R04_PHASES = Object.freeze([
  'VERIFY_PUBLISHED_SRI_AND_NATIVE_DIGEST',
  'VERIFY_R05_SCOPED_OWNER_LEASE_AND_DEVICE_AUTH',
  'CHECK_DISPOSABLE_VM_NETWORK_DENY_AND_QUOTAS',
  'CAPTURE_HOST_ALLOWLISTED_BASELINE',
  'BACKUP_ALLOWED_CONFIG_WITH_DIGEST',
  'VERIFY_ROLLBACK_ARTIFACT_IS_RESTORABLE',
  'STAGE_OFFLINE_INPUT_IN_EPHEMERAL_VM',
  'VERIFY_R06_PERMISSION_BEFORE_ANY_INSTALL',
  'INSTALL_IN_DISPOSABLE_VM_ONLY',
  'VERIFY_R07_TOOL_ALLOWLIST_BEFORE_MCP',
  'TEST_MCP_INSIDE_ISOLATED_VM_ONLY',
  'COMPARE_ALLOWLISTED_POSTSTATE_WITH_BASELINE',
  'REVOKE_EPHEMERAL_VM_AND_ACCESS',
  'VERIFY_HOST_POSTSTATE_UNCHANGED',
]);
const ROLLBACK = Object.freeze([
  'STOP_VM_PROCESSES_FROM_EXTERNAL_CONTROLLER',
  'REVOKE_VM_TOKENS_AND_DISCONNECT_VIRTUAL_NETWORK',
  'RESTORE_APPROVED_BACKUP_ONLY_WITH_DIGEST_CHECK',
  'DELETE_DISPOSABLE_VM_AFTER_OWNER_GATE',
  'VERIFY_HOST_ALLOWLISTED_POSTSTATE_EQUALS_BASELINE',
  'RETAIN_REDACTED_AUDIT_WITHOUT_PRIVATE_VALUES',
]);
const REQUIRED = Object.freeze([
  'R02_OFFICIAL_ARTIFACT_DIGEST_READBACK',
  'R05_LIVE_ATOMIC_OWNER_LEASE_FENCING_HEARTBEAT',
  'R05_SCOPED_DEVICE_PERMISSION',
  'R06_AUTHORIZED_OFF_HOST_VM_CREATE_AND_INSTALL',
  'R07_AUTHORIZED_MCP_TOOL_RUNTIME_CHECKS',
  'EXTERNAL_NETWORK_EGRESS_DENIAL_PROOF',
  'BACKUP_RESTORE_TEST_ON_DISPOSABLE_FIXTURE',
  'HOST_PRE_POST_READBACK',
]);

/** A pure simulation. No input can turn this into a real executable plan. */
export function simulateR04DryRun(input = {}) {
  const fail = (code) => ({
    status: 'DRY_RUN_INVALID', error: code,
    executed: false, host_verified: false, release_authorized: false,
    steps: [], rollback: [], outstanding_gates: [...REQUIRED],
  });
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return fail('OPTIONS_OBJECT_REQUIRED');
  const keys = Object.keys(input);
  if (keys.some(x => x !== 'failureAt')) return fail('UNSUPPORTED_OPTION');
  const chosen = input.failureAt === undefined ? null : input.failureAt;
  if (chosen !== null && !R04_PHASES.includes(chosen))
    return fail('UNRECOGNIZED_FAILURE_POINT');
  const steps = [];
  for (const step of R04_PHASES) {
    steps.push({ phase: step, simulated: true, outcome: step === chosen ? 'INJECTED_FAILURE' : 'SIMULATED_PASS' });
    if (step === chosen) {
      return {
        status: 'DRY_RUN_ABORT_ROLLBACK_SIMULATED',
        source: R04_SOURCE,
        executed: false, host_verified: false, release_authorized: false,
        steps,
        rollback: ROLLBACK.map(phase => ({ phase, simulated: true })),
        outstanding_gates: [...REQUIRED],
      };
    }
  }
  return {
    status: 'DRY_RUN_FINISHED_NOT_DEPLOYED',
    source: R04_SOURCE,
    executed: false, host_verified: false, release_authorized: false,
    steps,
    rollback: ROLLBACK.map(phase => ({ phase, simulated: true })),
    outstanding_gates: [...REQUIRED],
  };
}

function cli(argv) {
  if (argv.length !== 1 && argv.length !== 2) {
    return { code: 2, result: simulateR04DryRun({ invalid: true }) };
  }
  if (argv[0] !== '--dry-run') {
    return { code: 2, result: simulateR04DryRun({ invalid: true }) };
  }
  if (argv.length === 1) return { code: 0, result: simulateR04DryRun() };
  if (!argv[1].startsWith('--failure=')) {
    return { code: 2, result: simulateR04DryRun({ invalid: true }) };
  }
  const result = simulateR04DryRun({ failureAt: argv[1].slice('--failure='.length) });
  return { code: result.status === 'DRY_RUN_INVALID' ? 2 : 0, result };
}

if (process.argv[1] && /[/\\]r04-deployment-dry-run\.mjs$/.test(process.argv[1])) {
  const response = cli(process.argv.slice(2));
  process.stdout.write(JSON.stringify(response.result) + '\n');
  process.exitCode = response.code;
}
