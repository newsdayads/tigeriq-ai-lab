// Owner-authorized GitHub comment -> existing signed GitHub event -> SYSTEM Core.
// This module has exactly one write target. It exposes NO generic PC file/shell API.
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const PC01_RELEASE_ROOT = 'C:\\ProgramData\\TigerIQCoreRelease';
export const PC01_APPROVAL_PATH = path.win32.join(PC01_RELEASE_ROOT, 'core-runtime-release-approval.json');
export const PC01_ATTEMPT_PATH = path.win32.join(PC01_RELEASE_ROOT, 'core-runtime-release-attempt.json');
export const PC01_INSTALLED_STATE = 'D:\\TigerIQ\\State\\core-runtime-source.json';
export const PC01_RELEASE_ISSUE = 4725;
const REPOSITORY = 'newsdayads/tigeriq-ai-lab';
const OWNER = 'newsdayads';
const SHA = /^[a-f0-9]{40}$/;
const COMPONENTS = new Set(['core', 'openclaw', 'updater']);
const SOURCE_ONLY = new Set([
  'docs/PC01_GATED_RELEASE_PHASE1.md', 'vitest.config.ts',
  'tests/pc01-release-guard-e2e.test.mjs', 'tests/pc01-release-preflight.test.mjs',
  'tests/pc01-updater-release-gate.test.mjs',
]);
const UPDATER_FILES = new Set([
  'scripts/tigeriq-core/update-core-runtime.ps1',
  'scripts/tigeriq-core/pc01-release-guard.ps1',
  'scripts/tigeriq-core/pc01-release-preflight.mjs',
  'scripts/tigeriq-core/bootstrap-watchdog.ps1',
  'scripts/tigeriq-core/install-core-updater.ps1',
]);
const CORE_FILES = new Set([
  'scripts/tigeriq-core/run-core.ps1',
  'scripts/tigeriq-core/install-core-task.ps1',
]);

function deny(reason) { throw new Error('PC01_RELEASE_' + reason); }
function exactObject(input, keys) {
  return input && typeof input === 'object' && !Array.isArray(input) &&
    Object.keys(input).sort().join(',') === keys.slice().sort().join(',');
}

export function parsePc01OwnerApproval(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').trim().split('\n');
  if (lines.length !== 4 || lines[0] !== 'TIGERIQ_PC01_RELEASE_APPROVE_V1')
    deny('COMMENT_FORMAT_INVALID');
  const pairs = lines.slice(1).map(line => {
    const i = line.indexOf('=');
    return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : ['', ''];
  });
  if (pairs.map(([k]) => k).join(',') !== 'TARGET_SHA,EXPECTED_INSTALLED_SHA,COMPONENTS') deny('COMMENT_FIELDS_INVALID');
  const targetSha = pairs[0][1], expectedInstalledSha = pairs[1][1];
  if (!SHA.test(targetSha) || !SHA.test(expectedInstalledSha) || targetSha === expectedInstalledSha) deny('SHA_INVALID');
  const components = pairs[2][1].split(',');
  if (!components.length || new Set(components).size !== components.length ||
      components.some(c => !COMPONENTS.has(c)) ||
      components.join(',') !== [...components].sort().join(',')) deny('COMPONENTS_INVALID');
  return { targetSha, expectedInstalledSha, components };
}

export function impactForPc01ReleaseFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length >= 300) deny('FILE_LIST_UNVERIFIED');
  const impact = new Set();
  for (const entry of files) {
    const filename = typeof entry === 'string' ? entry : entry?.filename;
    if (!filename || typeof filename !== 'string') deny('FILE_PATH_INVALID');
    if (/app.?chrome|android|secrets|credential|\.env|vercel\.json|^api\//i.test(filename)) deny('FILE_OUT_OF_SCOPE');
    if (SOURCE_ONLY.has(filename)) continue;
    if (filename.startsWith('apps/openclaw-tigeriq-runtime/')) {
      impact.add('core'); impact.add('openclaw'); continue;
    }
    if (filename.startsWith('apps/tigeriq-core/') &&
        !/^apps\/tigeriq-core\/(?:web-control|owner-facing-vietnamese)/.test(filename)) {
      impact.add('core'); continue;
    }
    if (CORE_FILES.has(filename)) { impact.add('core'); continue; }
    if (UPDATER_FILES.has(filename)) { impact.add('updater'); continue; }
    deny('FILE_OUT_OF_SCOPE');
  }
  if (!impact.size) deny('NO_COMPONENT_IMPACT');
  return [...impact].sort();
}

export function validatePc01ApprovalEvidence({ identity, eventName, payload, verifiedComment,
  installedSha, mainSha, compare, nowMs = Date.now() }) {
  // Identity is supplied ONLY after cryptographic GitHub Actions OIDC verification.
  // Ordinary issue metadata, CI, worker output, or this body cannot provide identity.
  const claims = identity?.claims || {};
  if (eventName !== 'issue_comment' || claims.event_name !== 'issue_comment' ||
      identity?.actor !== OWNER || claims.actor !== OWNER ||
      String(claims.run_attempt || '') !== '1' ||
      !/^\d{3,20}$/.test(String(identity?.runId || ''))) deny('OWNER_OIDC_REQUIRED');
  if (payload?.action !== 'created' || payload?.repository?.full_name !== REPOSITORY ||
      payload?.issue?.number !== PC01_RELEASE_ISSUE ||
      payload?.sender?.login !== OWNER ||
      payload?.comment?.user?.login !== OWNER ||
      !Number.isSafeInteger(payload?.comment?.id) || payload.comment.id <= 0) deny('OWNER_COMMENT_REQUIRED');
  const c = verifiedComment;
  if (!c || Number(c.id) !== payload.comment.id || c.user?.login !== OWNER ||
      !String(c.issue_url || '').endsWith('/issues/' + PC01_RELEASE_ISSUE) ||
      c.body !== payload.comment.body || c.created_at !== c.updated_at) deny('OWNER_COMMENT_SOURCE_INVALID');
  const created = Date.parse(c.created_at);
  if (!Number.isFinite(created) || created > nowMs + 30_000 || nowMs - created > 15 * 60_000)
    deny('OWNER_COMMENT_EXPIRED');
  const approval = parsePc01OwnerApproval(c.body);
  if (approval.expectedInstalledSha !== installedSha) deny('INSTALLED_SHA_MISMATCH');
  if (approval.targetSha !== mainSha) deny('MAIN_SHA_MISMATCH');
  if (!compare || compare.status !== 'ahead' || compare.behind_by !== 0 ||
      !Number.isInteger(compare.ahead_by) || compare.ahead_by < 1 || compare.ahead_by > 30 ||
      (compare.total_commits != null && compare.total_commits > 30)) deny('ANCESTRY_UNVERIFIED');
  const files = (compare.files || []).map(f => f.filename);
  const actualComponents = impactForPc01ReleaseFiles(files);
  if (approval.components.join(',') !== actualComponents.join(',')) deny('IMPACT_MISMATCH');
  return {
    schema: 'TIGERIQ_PC01_RELEASE_APPROVAL_V1',
    scope: 'TIGERIQ_PC01_GATED_RELEASE_NO_RDC_PHASE1',
    requestId: 'GH-' + identity.runId + '-' + c.id,
    targetSha: approval.targetSha,
    expectedInstalledSha: approval.expectedInstalledSha,
    rollbackSha: approval.expectedInstalledSha,
    approved: true,
    components: actualComponents,
    expiresAtUtc: new Date(nowMs + 10 * 60_000).toISOString(),
  };
}

function readJson(text, reason) {
  try { return JSON.parse(String(text)); } catch { deny(reason); }
}
async function githubJson(relative, { githubToken, fetchImpl = fetch }) {
  if (!githubToken) deny('GITHUB_READ_AUTH_MISSING');
  const response = await fetchImpl('https://api.github.com/repos/' + REPOSITORY + relative, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + githubToken,
      'user-agent': 'TigerIQ-PC01-Release-Authority',
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(6500),
  });
  if (!response.ok) deny('GITHUB_READ_HTTP_' + response.status);
  return response.json();
}
async function ensureProtectedDirectory(io, root, platform = process.platform) {
  // The existing PowerShell updater separately checks parent+file ACL before applying.
  // Core never creates, fixes permissions for, or writes outside this one protected root.
  if (platform !== 'win32') deny('WINDOWS_SYSTEM_RUNTIME_REQUIRED');
  const stat = await io.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) deny('RELEASE_ROOT_UNTRUSTED');
  const real = await io.realpath(root);
  if (path.win32.normalize(real).toLowerCase() !== path.win32.normalize(root).toLowerCase())
    deny('RELEASE_ROOT_REDIRECTED');
}

export async function acceptPc01OwnerApprovalEvent({
  identity, eventName, payload, githubToken, fetchImpl = fetch, io = fs,
  nowMs = Date.now(),
  root = PC01_RELEASE_ROOT, platform = process.platform,
} = {}) {
  // Production entry always uses constant root; tests can inject a sandbox FS.
  if (root !== PC01_RELEASE_ROOT) deny('RELEASE_ROOT_OVERRIDE_DENIED');
  if (!identity?.claims || identity.actor !== OWNER ||
      eventName !== 'issue_comment' || payload?.action !== 'created') deny('OWNER_OIDC_REQUIRED');
  const commentId = payload?.comment?.id;
  if (!Number.isSafeInteger(commentId) || commentId <= 0) deny('COMMENT_ID_INVALID');
  const verifiedComment = await githubJson('/issues/comments/' + commentId, { githubToken, fetchImpl });
  const installed = readJson(await io.readFile(PC01_INSTALLED_STATE, 'utf8'), 'RUNTIME_STATE_INVALID');
  const installedSha = String(installed.currentSha || '');
  if (!SHA.test(installedSha)) deny('RUNTIME_BASELINE_UNVERIFIED');
  const main = await githubJson('/git/ref/heads/main', { githubToken, fetchImpl });
  const mainSha = String(main.object?.sha || '');
  if (!SHA.test(mainSha)) deny('GITHUB_MAIN_UNVERIFIED');
  const compare = await githubJson('/compare/' + installedSha + '...' + mainSha, { githubToken, fetchImpl });
  const approval = validatePc01ApprovalEvidence({
    identity, eventName, payload, verifiedComment, installedSha, mainSha, compare, nowMs,
  });
  await ensureProtectedDirectory(io, root, platform);
  const ticket = path.win32.join(root, 'core-runtime-release-approval.json');
  const attempt = path.win32.join(root, 'core-runtime-release-attempt.json');
  try {
    const prior = readJson(await io.readFile(attempt, 'utf8'), 'ATTEMPT_INVALID');
    if (prior.targetSha === approval.targetSha || prior.requestId === approval.requestId)
      deny('REPLAY_REJECTED');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  // Rotate only a *consumed* ticket whose exact target and requestId were
  // committed or rolled back by the protected updater. An unconsumed ticket
  // remains an exclusive blocker; no worker or comment can replace it.
  let existingTicket;
  try { existingTicket = readJson(await io.readFile(ticket, 'utf8'), 'ACTIVE_APPROVAL_INVALID'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (existingTicket) {
    let prior;
    try { prior = readJson(await io.readFile(attempt, 'utf8'), 'ATTEMPT_INVALID'); }
    catch (error) { if (error?.code === 'ENOENT') deny('ACTIVE_APPROVAL_UNCONSUMED'); throw error; }
    if (existingTicket.schema !== 'TIGERIQ_PC01_RELEASE_APPROVAL_V1' ||
        prior.requestId !== existingTicket.requestId ||
        prior.targetSha !== existingTicket.targetSha ||
        !['COMMITTED','ROLLED_BACK'].includes(prior.result) ||
        !SHA.test(String(existingTicket.targetSha || ''))) deny('ACTIVE_APPROVAL_UNCONSUMED');
    const archive = path.win32.join(root, 'Backup', 'release-ticket-' + existingTicket.targetSha + '-' + prior.result + '.json');
    try { await io.lstat(archive); deny('APPROVAL_ARCHIVE_COLLISION'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await io.rename(ticket, archive);
  }
  // Exclusive creation, no overwrites. A separate updater checks precise impacts
  // and CI; a GitHub merge or an LLM job cannot author this ticket.
  const handle = await io.open(ticket, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(approval, null, 2) + '\n', 'utf8');
    await handle.sync();
  } finally { await handle.close(); }
  return {
    accepted: true, ticketWritten: true, owner: OWNER,
    requestId: approval.requestId, targetSha: approval.targetSha,
    expectedInstalledSha: approval.expectedInstalledSha, components: approval.components,
    expiresAtUtc: approval.expiresAtUtc, provenance: 'GITHUB_ACTIONS_OIDC_AND_OWNER_COMMENT',
  };
}
