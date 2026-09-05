import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXPECTED_PROJECT_ID = 'prj_gg7AuV6y62TALzEpby8XUAFisLKw';
export const EXPECTED_TEAM_ID = 'team_K8HIG7zmwu0ZjCINX1VhlGiT';
export const AUTHORIZED_ISSUE = '423';

export function validateProjectLink(link) {
  if (!link || link.projectId !== EXPECTED_PROJECT_ID || link.orgId !== EXPECTED_TEAM_ID) {
    throw new Error('VERCEL_PROJECT_SCOPE_MISMATCH');
  }
  return true;
}

export function validateExactSha(expectedSha, actualSha) {
  const expected = String(expectedSha || '').trim().toLowerCase();
  const actual = String(actualSha || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expected) || !/^[0-9a-f]{40}$/.test(actual) || expected !== actual) {
    throw new Error('VERCEL_EXACT_SHA_MISMATCH');
  }
  return true;
}

export function buildDeployPlan({ projectLink, expectedSha, actualSha, issue }) {
  validateProjectLink(projectLink);
  validateExactSha(expectedSha, actualSha);
  if (String(issue) !== AUTHORIZED_ISSUE) throw new Error('VERCEL_OWNER_AUTH_SCOPE_MISMATCH');
  return {
    projectId: EXPECTED_PROJECT_ID,
    teamId: EXPECTED_TEAM_ID,
    target: 'production',
    exactSha: actualSha.toLowerCase(),
    issue: AUTHORIZED_ISSUE,
    maxAttempts: 1,
  };
}

function parseArgs(argv) {
  const out = { dryRun: false, sha: '', issue: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--sha') out.sha = argv[++i] || '';
    else if (arg === '--issue') out.issue = argv[++i] || '';
    else throw new Error(`UNKNOWN_ARG:${arg}`);
  }
  return out;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const linkPath = resolve(root, '.vercel', 'project.json');
  if (!existsSync(linkPath)) throw new Error('VERCEL_PROJECT_LINK_MISSING');
  const link = JSON.parse(readFileSync(linkPath, 'utf8'));
  const actualSha = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain']);
  if (dirty) throw new Error('GIT_WORKTREE_NOT_CLEAN');
  const plan = buildDeployPlan({ projectLink: link, expectedSha: args.sha, actualSha, issue: args.issue });

  if (args.dryRun) {
    console.log(JSON.stringify({ ok: true, mode: 'dry-run', ...plan }));
    return;
  }

  execFileSync('vercel', ['deploy', '--prod', '--yes'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }
}
