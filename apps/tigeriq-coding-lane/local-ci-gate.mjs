import { createHash, randomInt } from 'node:crypto';
import { execSync } from 'node:child_process';

export const LOCAL_CI_SCHEMA = 'TIGERIQ_LOCAL_CI_RECEIPT_V1';
export const DEFAULT_LOCAL_CI_COMMANDS = Object.freeze([
  { name: 'CI Verify', command: 'npm run typecheck && npm run test && npm run build' },
]);

/**
 * Execute local PC01 CI checks in the target worktree and return an exact-head receipt
 * compatible with step-contract and product-acceptance gates (zero GitHub Actions cost).
 */
export function runLocalCiGate({
  cwd = process.cwd(),
  sourceHeadSha = '',
  commands = DEFAULT_LOCAL_CI_COMMANDS,
  runner = (cmd, dir) => execSync(cmd, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }),
} = {}) {
  const head = String(sourceHeadSha || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(head)) {
    throw new Error('LOCAL_CI_INVALID_HEAD_SHA');
  }
  const runId = Date.now();
  const checkRuns = [];
  const logs = [];
  let allPassed = true;

  for (let i = 0; i < commands.length; i += 1) {
    const item = commands[i];
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
