import { createHash, randomInt } from 'node:crypto';
import { execSync, execFileSync } from 'node:child_process';

export const LOCAL_CI_SCHEMA = 'TIGERIQ_LOCAL_CI_RECEIPT_V1';
export const QUEUE_HYGIENE_COMMAND = Object.freeze({ name: 'Queue Hygiene Verify', command: 'node --check api/control.mjs && node scripts/verify_queue_hygiene.mjs && node scripts/verify_work_board_ui.mjs' });
export const DEFAULT_LOCAL_CI_COMMANDS = Object.freeze([
  { name: 'CI Verify', command: 'npm run typecheck && npm run build' },
  QUEUE_HYGIENE_COMMAND,
]);

export function scopedTestCommand(changedPaths = []) {
  const paths = (Array.isArray(changedPaths) ? changedPaths : []).map((p) => String(p || '').toLowerCase());
  const suites = new Set();
  const nodeSuites = new Set();
  const intakePaths = new Set(['apps/tigeriq-core/github-intake.mjs','apps/tigeriq-core/github-intake.test.mjs','tests/github-intake.test.mjs','apps/tigeriq-core/github-shared-client.mjs','apps/tigeriq-core/core.mjs']);
  const operatorPaths = new Set(['apps/tigeriq-core/pc-operator-mcp.mjs','tests/pc-operator-mcp.test.mjs','apps/tigeriq-core/pc-operator-oauth-policy.mjs','tests/pc-operator-admin-broker.test.mjs','tests/pc-operator-oauth-policy.test.mjs','apps/openclaw-tigeriq-runtime/operator.mjs']);
  if (paths.some(p => intakePaths.has(p))) {
    suites.add('apps/tigeriq-core/github-intake.test.mjs');
    nodeSuites.add('tests/github-intake.test.mjs');
  }
  if (paths.some(p => operatorPaths.has(p))) {
    suites.add('tests/pc-operator-mcp.test.mjs');
    nodeSuites.add('tests/pc-operator-admin-broker.test.mjs');
    nodeSuites.add('tests/pc-operator-oauth-policy.test.mjs');
  }
  const releasePaths = new Set([
    'scripts/tigeriq-core/update-core-runtime.ps1',
    'scripts/tigeriq-core/pc01-release-guard.ps1',
    'scripts/tigeriq-core/pc01-release-preflight.mjs',
    'scripts/tigeriq-core/bootstrap-watchdog.ps1',
    'scripts/tigeriq-core/install-core-updater.ps1',
    'tests/pc01-release-preflight.test.mjs',
    'tests/pc01-updater-release-gate.test.mjs',
    'tests/pc01-release-guard-e2e.test.mjs',
    'apps/tigeriq-core/pc01-standing-release.mjs',
    'apps/tigeriq-core/pc01-release-approval.mjs',
    'apps/tigeriq-core/github-actions-oidc.mjs',
    'apps/tigeriq-coding-lane/local-ci-gate.mjs',
    'tests/local-ci-and-failover.test.ts',
    'tests/pc01-standing-release.test.mjs',
  ]);
  const releaseChecks = paths.some(p => releasePaths.has(p));
  if (releaseChecks) {
    suites.add('tests/pc01-release-preflight.test.mjs');
    suites.add('tests/pc01-updater-release-gate.test.mjs');
    suites.add('tests/pc01-release-guard-e2e.test.mjs');
    suites.add('tests/pc01-standing-release.test.mjs');
  }
  for (const p of paths) {
    if (p.includes('phonebox') || p.includes('phone-farm') || p.includes('pc-operator-mcp')) suites.add('tests/pc-operator-mcp.test.mjs');
    if (p.includes('coding-lane')) suites.add('tests/local-ci-and-failover.test.ts');
    if (p.includes('work-routing-policy')) suites.add('tests/work-routing-policy.test.mjs');
    if (p.includes('github-coding-intake')) suites.add('tests/github-coding-intake.test.mjs');
    if (p.includes('project-portfolio') || p.includes('portfolio.yaml')) suites.add('tests/project-portfolio.test.mjs');
  }
  // The release suite skips live guard checks when pwsh is absent. Refuse a green CI in that case.
  const commands = [];
  if (releaseChecks) commands.push('pwsh -NoLogo -NoProfile -NonInteractive -Command "exit 0"');
  commands.push('npm run typecheck');
  if (suites.size) commands.push(`npx vitest run ${[...suites].join(' ')}`);
  if (nodeSuites.size) commands.push(`node --test --test-reporter=tap ${[...nodeSuites].join(' ')}`);
  commands.push('npm run build');
  return commands.join(' && ');
}

/** Reject a claimed head unless the tracked checkout is exactly that commit. */
export function assertLocalCiSource(cwd, expectedHead) {
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let actualHead, dirty;
  try {
    actualHead = git(['rev-parse', 'HEAD']);
    dirty = git(['status', '--porcelain', '--untracked-files=no']);
  } catch (error) {
    throw new Error('LOCAL_CI_SOURCE_UNVERIFIED', { cause: error });
  }
  if (actualHead !== expectedHead) throw new Error('LOCAL_CI_HEAD_MISMATCH');
  if (dirty) throw new Error('LOCAL_CI_TRACKED_SOURCE_DIRTY');
}

/**
 * Execute scoped local PC01 CI checks in the target worktree and return an exact-head receipt
 * compatible with step-contract and product-acceptance gates (zero GitHub Actions cost).
 */
export function runLocalCiGate({
  cwd = process.cwd(),
  sourceHeadSha = '',
  changedPaths = [],
  commands = null,
  runner = (cmd, dir) => execSync(cmd, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }),
} = {}) {
  const head = String(sourceHeadSha || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(head)) {
    throw new Error('LOCAL_CI_INVALID_HEAD_SHA');
  }
  assertLocalCiSource(cwd, head);
  const cmds = Array.isArray(commands) && commands.length
    ? commands
    : [{ name: 'CI Verify', command: scopedTestCommand(changedPaths) }, QUEUE_HYGIENE_COMMAND];
  const runId = Date.now();
  const checkRuns = [];
  const logs = [];
  let allPassed = true;

  for (let i = 0; i < cmds.length; i += 1) {
    const item = cmds[i];
    const jobId = randomInt(100000, 999999);
    let conclusion = 'success';
    let output = '';
    try {
      output = String(runner(item.command, cwd) || '');
    } catch (err) {
      conclusion = 'failure';
      allPassed = false;
      output = String(err?.stdout || '') + '\n' + String(err?.stderr || err?.message || err);
    }
    logs.push(`=== ${item.name} ===\n${output}`);
    checkRuns.push({
      id: jobId,
      name: item.name,
      status: 'completed',
      conclusion,
      head_sha: head,
      app: { slug: 'tigeriq-local-ci' },
      details_url: `local-ci://pc01/${runId}/job/${jobId}`,
    });
  }

  assertLocalCiSource(cwd, head);
  const logSha256 = createHash('sha256').update(logs.join('\n'), 'utf8').digest('hex');
  return {
    schema: LOCAL_CI_SCHEMA,
    provider: 'pc01_local_ci_runner',
    pass: allPassed,
    exactHead: head,
    logSha256,
    checkRuns,
    verifiedAt: new Date().toISOString(),
  };
}
