import { createHash, randomInt } from 'node:crypto';
import { execSync } from 'node:child_process';

export const LOCAL_CI_SCHEMA = 'TIGERIQ_LOCAL_CI_RECEIPT_V1';
export const DEFAULT_LOCAL_CI_COMMANDS = Object.freeze([
  { name: 'CI Verify', command: 'npm run typecheck && npm run build' },
]);

export function scopedTestCommand(changedPaths = []) {
  const paths = (Array.isArray(changedPaths) ? changedPaths : []).map((p) => String(p || '').toLowerCase());
  const suites = new Set();
  for (const p of paths) {
    if (p.includes('phonebox') || p.includes('phone-farm') || p.includes('pc-operator-mcp')) suites.add('tests/pc-operator-mcp.test.mjs');
    if (p.includes('coding-lane')) suites.add('tests/local-ci-and-failover.test.ts');
    if (p.includes('work-routing-policy')) suites.add('tests/work-routing-policy.test.mjs');
    if (p.includes('github-coding-intake')) suites.add('tests/github-coding-intake.test.mjs');
    if (p.includes('project-portfolio') || p.includes('portfolio.yaml')) suites.add('tests/project-portfolio.test.mjs');
  }
  if (!suites.size) return 'npm run typecheck && npm run build';
  return `npm run typecheck && npx vitest run ${[...suites].join(' ')} && npm run build`;
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
  const cmds = Array.isArray(commands) && commands.length
    ? commands
    : [{ name: 'CI Verify', command: scopedTestCommand(changedPaths) }];
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
