import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXPECTED_PROJECT_ID = 'prj_gg7AuV6y62TALzEpby8XUAFisLKw';
export const EXPECTED_TEAM_ID = 'team_K8HIG7zmwu0ZjCINX1VhlGiT';
export const EXPECTED_REPO = 'newsdayads/tigeriq-ai-lab';
export const EXPECTED_BRANCH = 'main';
export const REQUIRED_UI_MARKER = 'href="/work-ui.css"';

function clean(value) { return String(value || '').trim(); }

export function validateExactSha(expectedSha, actualSha) {
  const expected = clean(expectedSha).toLowerCase();
  const actual = clean(actualSha).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expected) || !/^[0-9a-f]{40}$/.test(actual) || expected !== actual) {
    throw new Error('VERCEL_EXACT_SHA_MISMATCH');
  }
  return actual;
}

export function normalizeGitRemote(remote) {
  let value = clean(remote).toLowerCase();
  value = value.replace(/^git@github\.com:/, 'https://github.com/');
  value = value.replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/');
  return value.replace(/\.git\/?$/, '').replace(/\/$/, '');
}

export function validateReleaseContract({ projectLink, expectedSha, actualSha, branch, mainRefSha, remote, config, issue, uiHtml, releaseClass, ownerAuthorized, releaseReason, changedFiles }) {
  if (!projectLink || projectLink.projectId !== EXPECTED_PROJECT_ID || projectLink.orgId !== EXPECTED_TEAM_ID) {
    throw new Error('VERCEL_PROJECT_SCOPE_MISMATCH');
  }
  const exactSha = validateExactSha(expectedSha, actualSha);
  const currentBranch = clean(branch);
  const normalizedMainRefSha = clean(mainRefSha).toLowerCase();
  const exactRemoteMainSource = normalizedMainRefSha === exactSha;
  if (currentBranch !== EXPECTED_BRANCH && !exactRemoteMainSource) throw new Error('VERCEL_GIT_BRANCH_MISMATCH');
  if (normalizeGitRemote(remote) !== 'https://github.com/' + EXPECTED_REPO) throw new Error('VERCEL_GIT_REPO_MISMATCH');
  if (config?.git?.deploymentEnabled !== false) throw new Error('VERCEL_AUTO_DEPLOY_POLICY_MISMATCH');
  if (clean(releaseClass).toUpperCase() !== 'WEB_LIVE') throw new Error('VERCEL_RELEASE_CLASS_INVALID');
  if (String(ownerAuthorized).trim().toLowerCase() !== 'true') throw new Error('VERCEL_OWNER_RELEASE_AUTH_REQUIRED');
  if (!clean(releaseReason)) throw new Error('VERCEL_RELEASE_REASON_REQUIRED');
  if (!/^\d+$/.test(clean(issue))) throw new Error('VERCEL_RELEASE_ISSUE_REQUIRED');
  const webFiles = Array.isArray(changedFiles) ? changedFiles.map((item) => clean(item).replaceAll('\\\\', '/')) : [];
  const hasWebArtifactChange = webFiles.some((file) =>
    file === 'command-center.html' ||
    file === 'vercel.json' ||
    file.startsWith('public/') ||
    file.startsWith('api/')
  );
  if (!hasWebArtifactChange) throw new Error('VERCEL_WEB_ARTIFACT_CHANGE_REQUIRED');
  if (!String(uiHtml || '').includes(REQUIRED_UI_MARKER)) throw new Error('VERCEL_UI_MARKER_MISSING');
  return {
    projectId: EXPECTED_PROJECT_ID,
    teamId: EXPECTED_TEAM_ID,
    repo: EXPECTED_REPO,
    branch: EXPECTED_BRANCH,
    sourceMode: currentBranch === EXPECTED_BRANCH ? 'main-branch' : 'exact-remote-main-source',
    target: 'production',
    exactSha,
    issue: clean(issue),
    releaseClass: 'WEB_LIVE',
    releaseReason: clean(releaseReason),
    maxAttempts: 1,
  };
}

export function classifyDeployFailure(text = '') {
  const value = String(text).toLowerCase();
  if (value.includes('rate limited') || value.includes('rate limit')) return 'VERCEL_RATE_LIMIT_WAIT';
  if (value.includes('not authenticated') || value.includes('log in') || value.includes('login')) return 'VERCEL_AUTH_REQUIRED';
  if (value.includes('command not found') || value.includes('not recognized')) return 'VERCEL_CLI_MISSING';
  return 'VERCEL_DEPLOY_FAILED';
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
}

export function githubAuthorLoginFromEmail(email = '') {
  const match = clean(email).match(/^\d+\+([a-z0-9-]{1,39})@users\.noreply\.github\.com$/i);
  if (!match) throw new Error('VERCEL_GITHUB_AUTHOR_LOGIN_UNRESOLVED');
  return match[1];
}

export function releaseGitMetadata(root, exactSha) {
  const [org, repo] = EXPECTED_REPO.split('/');
  const authorEmail = git(root, ['show', '-s', '--format=%ae', exactSha]);
  const authorLogin = githubAuthorLoginFromEmail(authorEmail);
  return {
    githubDeployment: '1',
    githubCommitSha: exactSha,
    githubCommitAuthorLogin: authorLogin,
    githubCommitRef: EXPECTED_BRANCH,
    githubOrg: org,
    githubRepo: repo,
    githubCommitOrg: org,
    githubCommitRepo: repo,
  };
}

function ensureProjectLink(root) {
  const dir = resolve(root, '.vercel');
  const file = resolve(dir, 'project.json');
  if (existsSync(file)) {
    const link = JSON.parse(readFileSync(file, 'utf8'));
    if (link.projectId !== EXPECTED_PROJECT_ID || link.orgId !== EXPECTED_TEAM_ID) throw new Error('VERCEL_PROJECT_SCOPE_MISMATCH');
    return { link, temporary: false, dir };
  }
  mkdirSync(dir, { recursive: true });
  const link = { projectId: EXPECTED_PROJECT_ID, orgId: EXPECTED_TEAM_ID };
  writeFileSync(file, JSON.stringify(link), { encoding: 'utf8', flag: 'wx' });
  return { link, temporary: true, dir };
}

export function deploymentRequestForGitSource(plan, gitInfo = {}) {
  const [org, repo] = EXPECTED_REPO.split('/');
  const exactSha = clean(plan?.exactSha).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(exactSha)) throw new Error('VERCEL_EXPECTED_SHA_INVALID');
  const authorLogin = clean(gitInfo.authorLogin);
  const authorEmail = clean(gitInfo.authorEmail);
  const authorName = clean(gitInfo.authorName);
  if (!authorLogin || !authorEmail || !authorName) throw new Error('VERCEL_GIT_METADATA_INCOMPLETE');
  return {
    name: 'tigeriq-ai-lab',
    project: EXPECTED_PROJECT_ID,
    target: 'production',
    gitSource: {
      type: 'github',
      org,
      repo,
      ref: EXPECTED_BRANCH,
      sha: exactSha,
    },
    gitMetadata: {
      remoteUrl: `https://github.com/${EXPECTED_REPO}.git`,
      commitAuthorName: authorName,
      commitAuthorEmail: authorEmail,
      commitMessage: String(gitInfo.commitMessage || ''),
      commitRef: EXPECTED_BRANCH,
      commitSha: exactSha,
      dirty: false,
      ci: true,
      ciType: 'tigeriq-pc01',
      ciGitProviderUsername: authorLogin,
      ciGitRepoVisibility: 'public',
      rootDirectory: '',
    },
    meta: {
      tigeriqReleaseIssue: clean(plan?.issue),
      tigeriqReleaseClass: 'WEB_LIVE',
      tigeriqExactSha: exactSha,
    },
  };
}

function deploy(root, plan) {
  const authorEmail = git(root, ['show', '-s', '--format=%ae', plan.exactSha]);
  const request = deploymentRequestForGitSource(plan, {
    authorLogin: githubAuthorLoginFromEmail(authorEmail),
    authorEmail,
    authorName: git(root, ['show', '-s', '--format=%an', plan.exactSha]),
    commitMessage: git(root, ['show', '-s', '--format=%B', plan.exactSha]),
  });
  const inputFile = resolve(root, '.vercel', `tigeriq-deploy-request-${process.pid}.json`);
  writeFileSync(inputFile, JSON.stringify(request), { encoding: 'utf8', flag: 'wx' });
  try {
    const endpoint = `/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1&teamId=${EXPECTED_TEAM_ID}`;
    const apiArgs = ['api', endpoint, '-X', 'POST', '--input', inputFile];
    const options = {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        VERCEL_ORG_ID: EXPECTED_TEAM_ID,
        VERCEL_PROJECT_ID: EXPECTED_PROJECT_ID,
      },
      windowsHide: true,
      timeout: 110000,
      maxBuffer: 2 * 1024 * 1024,
    };
    const result = process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', ['vercel.cmd', ...apiArgs.map((arg) => `"${String(arg).replaceAll('"', '\\"')}"`)].join(' ')], options)
      : spawnSync('vercel', apiArgs, options);
    if (result.error) throw new Error(result.error.code === 'ETIMEDOUT' ? 'VERCEL_DEPLOY_TIMEOUT' : 'VERCEL_CLI_EXEC_FAILED');
    const output = String(result.stdout || '');
    const combined = output + '\n' + String(result.stderr || '');
    if (result.status !== 0) throw new Error(classifyDeployFailure(combined));
    let response;
    try { response = JSON.parse(output); }
    catch { throw new Error('VERCEL_DEPLOYMENT_RESPONSE_INVALID'); }
    const deploymentId = clean(response?.id || response?.uid);
    const deploymentHost = clean(response?.url);
    if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId) || !/^[^\s]+\.vercel\.app$/i.test(deploymentHost)) {
      throw new Error('VERCEL_DEPLOYMENT_RESPONSE_INVALID');
    }
    return {
      deploymentId,
      deploymentUrl: 'https://' + deploymentHost,
      deploymentSource: 'git',
    };
  } finally {
    rmSync(inputFile, { force: true });
  }
}

function parseArgs(argv) {
  const out = { sha: '', issue: '', releaseClass: '', ownerAuthorized: '', releaseReason: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--sha') out.sha = argv[++i] || '';
    else if (argv[i] === '--issue') out.issue = argv[++i] || '';
    else if (argv[i] === '--release-class') out.releaseClass = argv[++i] || '';
    else if (argv[i] === '--owner-authorized') out.ownerAuthorized = argv[++i] || '';
    else if (argv[i] === '--release-reason') out.releaseReason = argv[++i] || '';
    else throw new Error('UNKNOWN_ARG');
  }
  return out;
}

export function runOneShotDeploy({
  root = process.cwd(),
  expectedSha,
  issue,
  releaseClass = process.env.TIGERIQ_VERCEL_RELEASE_CLASS,
  ownerAuthorized = process.env.TIGERIQ_OWNER_RELEASE_AUTHORIZED,
  releaseReason = process.env.TIGERIQ_VERCEL_RELEASE_REASON,
  deployImpl = deploy,
} = {}) {
  const config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
  const uiHtml = readFileSync(resolve(root, 'command-center.html'), 'utf8');
  const actualSha = git(root, ['rev-parse', 'HEAD']);
  const branch = git(root, ['branch', '--show-current']);
  const mainRefSha = git(root, ['rev-parse', 'refs/remotes/origin/main']);
  const remote = git(root, ['remote', 'get-url', 'origin']);
  const dirty = git(root, ['status', '--porcelain']);
  if (dirty) throw new Error('GIT_WORKTREE_NOT_CLEAN');
  const changedFiles = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  let linkState;
  try {
    linkState = ensureProjectLink(root);
    const plan = validateReleaseContract({
      projectLink: linkState.link,
      expectedSha,
      actualSha,
      branch,
      mainRefSha,
      remote,
      config,
      issue,
      uiHtml,
      releaseClass,
      ownerAuthorized,
      releaseReason,
      changedFiles,
    });
    const result = deployImpl(root, plan);
    return { ok: true, status: 'TIGERIQ_LIVE_3150_PRODUCTION_DEPLOYED', ...plan, ...result, secretsPrinted: false };
  } finally {
    if (linkState?.temporary) rmSync(linkState.dir, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = runOneShotDeploy({
    expectedSha: args.sha,
    issue: args.issue,
    releaseClass: args.releaseClass || process.env.TIGERIQ_VERCEL_RELEASE_CLASS,
    ownerAuthorized: args.ownerAuthorized || process.env.TIGERIQ_OWNER_RELEASE_AUTHORIZED,
    releaseReason: args.releaseReason || process.env.TIGERIQ_VERCEL_RELEASE_REASON,
  });
  console.log(JSON.stringify(result));
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invoked) {
  try { main(); }
  catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }
}
