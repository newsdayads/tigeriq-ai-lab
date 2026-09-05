import { existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXPECTED_PROJECT_ID = 'prj_gg7AuV6y62TALzEpby8XUAFisLKw';
export const EXPECTED_TEAM_ID = 'team_K8HIG7zmwu0ZjCINX1VhlGiT';
export const EXPECTED_REPO = 'newsdayads/tigeriq-ai-lab';
export const EXPECTED_BRANCH = 'main';
export const AUTHORIZED_ISSUE = '423';

export function validateProjectLink(link) {
  if (!link || link.projectId !== EXPECTED_PROJECT_ID || link.orgId !== EXPECTED_TEAM_ID) throw new Error('VERCEL_PROJECT_SCOPE_MISMATCH');
  return true;
}
export function validateExactSha(expectedSha, actualSha) {
  const expected = String(expectedSha || '').trim().toLowerCase();
  const actual = String(actualSha || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expected) || !/^[0-9a-f]{40}$/.test(actual) || expected !== actual) throw new Error('VERCEL_EXACT_SHA_MISMATCH');
  return true;
}
export function normalizeGitRemote(remote) {
  let value = String(remote || '').trim().toLowerCase();
  value = value.replace(/^git@github\.com:/, 'https://github.com/').replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/');
  return value.replace(/\.git\/?$/, '').replace(/\/$/, '');
}
export function validateGitSource({ branch, remote }) {
  if (String(branch || '').trim() !== EXPECTED_BRANCH) throw new Error('VERCEL_GIT_BRANCH_MISMATCH');
  if (normalizeGitRemote(remote) !== `https://github.com/${EXPECTED_REPO}`) throw new Error('VERCEL_GIT_REPO_MISMATCH');
  return true;
}
export function validateDeploymentConfig(config) {
  if (config?.git?.deploymentEnabled !== false) throw new Error('VERCEL_AUTO_DEPLOY_POLICY_MISMATCH');
  return true;
}
export function buildDeployPlan({ projectLink, expectedSha, actualSha, issue, branch, remote, config }) {
  validateProjectLink(projectLink); validateExactSha(expectedSha, actualSha); validateGitSource({ branch, remote }); validateDeploymentConfig(config);
  if (String(issue) !== AUTHORIZED_ISSUE) throw new Error('VERCEL_OWNER_AUTH_SCOPE_MISMATCH');
  return { projectId: EXPECTED_PROJECT_ID, teamId: EXPECTED_TEAM_ID, repo: EXPECTED_REPO, branch: EXPECTED_BRANCH, target: 'production', exactSha: actualSha.toLowerCase(), issue: AUTHORIZED_ISSUE, maxAttempts: 1 };
}
export function classifyDeployFailure(text = '') {
  const normalized = String(text).toLowerCase();
  if (normalized.includes('rate limited') || normalized.includes('rate limit')) return 'VERCEL_RATE_LIMIT_WAIT';
  if (normalized.includes('not authenticated') || normalized.includes('log in') || normalized.includes('login')) return 'VERCEL_AUTH_REQUIRED';
  return 'VERCEL_DEPLOY_FAILED';
}
function parseArgs(argv) {
  const out = { dryRun: false, sha: '', issue: '' };
  for (let i = 0; i < argv.length; i += 1) { const arg = argv[i]; if (arg === '--dry-run') out.dryRun = true; else if (arg === '--sha') out.sha = argv[++i] || ''; else if (arg === '--issue') out.issue = argv[++i] || ''; else throw new Error(`UNKNOWN_ARG:${arg}`); }
  return out;
}
function git(args) { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function runVercelDeploy(root) {
  const options = { cwd: root, encoding: 'utf8', env: process.env, windowsHide: true };
  const result = process.platform === 'win32' ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'vercel.cmd deploy --prod --yes'], options) : spawnSync('vercel', ['deploy', '--prod', '--yes'], options);
  if (result.error) throw new Error('VERCEL_CLI_EXEC_FAILED');
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0) throw new Error(classifyDeployFailure(output));
  return { deploymentUrl: output.match(/https:\/\/[^\s]+\.vercel\.app\b/i)?.[0] || null };
}
function main() {
  const args = parseArgs(process.argv.slice(2)); const root = process.cwd(); const linkPath = resolve(root, '.vercel', 'project.json'); const configPath = resolve(root, 'vercel.json');
  if (!existsSync(linkPath)) throw new Error('VERCEL_PROJECT_LINK_MISSING'); if (!existsSync(configPath)) throw new Error('VERCEL_CONFIG_MISSING');
  const link = JSON.parse(readFileSync(linkPath, 'utf8')); const config = JSON.parse(readFileSync(configPath, 'utf8')); const actualSha = git(['rev-parse', 'HEAD']); const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']); const remote = git(['remote', 'get-url', 'origin']); const dirty = git(['status', '--porcelain']);
  if (dirty) throw new Error('GIT_WORKTREE_NOT_CLEAN');
  const plan = buildDeployPlan({ projectLink: link, expectedSha: args.sha, actualSha, issue: args.issue, branch, remote, config });
  if (args.dryRun) { console.log(JSON.stringify({ ok: true, mode: 'dry-run', ...plan })); return; }
  console.log(JSON.stringify({ ok: true, mode: 'deployed', ...plan, ...runVercelDeploy(root) }));
}
const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) { try { main(); } catch (error) { console.error(String(error instanceof Error ? error.message : error)); process.exit(1); } }
