import { createHash, createPublicKey, randomUUID, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import { isOwnerAuthorized } from './owner-auth.mjs';
import { issuePriority, issueStage, issueType, workFingerprint } from './control.mjs';
import {
  cloudExecutorEnabled,
  cloudWorkforceDescriptor,
  executeCloudTask,
  judgeCloudTask,
  reviewCloudTask,
  signServerGateComment,
} from './cloud-workforce.mjs';

export const config = { maxDuration: 60 };

const REPO = process.env.TIGERIQ_REPO || 'newsdayads/tigeriq-ai-lab';
const GITHUB_TOKEN = String(process.env.TIGERIQ_GITHUB_TOKEN || '').trim();
const COMMAND_SECRET = String(process.env.TIGERIQ_COMMAND_SECRET || '').trim();
const CRON_SECRET = String(process.env.CRON_SECRET || '').trim();
const EXPECTED_EVIDENCE = 'Concrete executor result answering the instruction; a matching sha256 EVIDENCE_REF bound to result/evidence text; independent REVIEW_PASS; final JUDGE_PASS; no unsupported external-action claim.';
const SAFE_SOURCES = new Set(['vercel-explicit-dispatch', 'vercel-chief-single-door']);
const LOCK_PREFIX = 'tigeriq-auto-run-';
const LOCK_TTL_MS = 15 * 60 * 1000;
const MAX_BATCH = Math.max(1, Math.min(3, Number(process.env.TIGERIQ_AUTO_WORK_BATCH || 2) || 2));
const MAX_TRANSIENT_RETRIES = 2;
const LEGACY_SERVER_EVIDENCE_BLOCKER = /(?:sha256|cryptographic\s+hash(?:es)?)[\s\S]{0,180}(?:not\s+supported|unsupported|cannot|unable)|computing\s+cryptographic\s+hashes\s+is\s+not\s+supported/i;
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const OIDC_JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';
const OIDC_MAX_TOKEN_BYTES = 20_000;
const OIDC_CLOCK_SKEW_SECONDS = 30;
const EXPECTED_WORKFLOW_REF = `${REPO}/.github/workflows/auto-work.yml@refs/heads/main`;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.end(JSON.stringify(body));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function looksLikeBrowser(req) {
  const headers = req?.headers || {};
  return Boolean(headers.origin || headers.referer || headers['sec-fetch-site'] || headers['sec-fetch-mode']);
}

function bearer(req) {
  return String(req?.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
}

function repoParts() {
  const [owner, repo] = REPO.split('/');
  if (!owner || !repo) throw new Error('invalid_repo');
  return { owner, repo };
}

async function gh(path, init = {}, token = '') {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'tigeriq-auto-work',
    ...(init.headers || {}),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com${path}`, { ...init, headers });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 500) }; }
  if (!response.ok) {
    const error = new Error(`github_${response.status}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

function decodeJsonPart(value, label) {
  try {
    return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
  } catch {
    throw new Error(`github_oidc_invalid_${label}`);
  }
}

function audienceMatches(value, expected) {
  if (typeof value === 'string') return value === expected;
  return Array.isArray(value) && value.includes(expected);
}

export function validateGitHubActionsClaims(claims, {
  repository,
  audience = 'tigeriq-auto-work',
  workflowRef,
  ref = 'refs/heads/main',
  eventNames = ['schedule', 'workflow_dispatch'],
  nowMs = Date.now(),
} = {}) {
  if (!claims || typeof claims !== 'object') throw new Error('github_oidc_claims_required');
  const now = Math.floor(Number(nowMs) / 1000);
  if (claims.iss !== OIDC_ISSUER) throw new Error('github_oidc_bad_issuer');
  if (!audienceMatches(claims.aud, audience)) throw new Error('github_oidc_bad_audience');
  if (!repository || claims.repository !== repository) throw new Error('github_oidc_bad_repository');
  if (!workflowRef || claims.workflow_ref !== workflowRef) throw new Error('github_oidc_bad_workflow_ref');
  if (claims.ref !== ref) throw new Error('github_oidc_bad_ref');
  if (!eventNames.includes(String(claims.event_name || ''))) throw new Error('github_oidc_bad_event');
  if (claims.runner_environment !== 'github-hosted') throw new Error('github_oidc_bad_runner');
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) < now - OIDC_CLOCK_SKEW_SECONDS) throw new Error('github_oidc_expired');
  if (Number.isFinite(Number(claims.nbf)) && Number(claims.nbf) > now + OIDC_CLOCK_SKEW_SECONDS) throw new Error('github_oidc_not_yet_valid');
  if (Number.isFinite(Number(claims.iat)) && Number(claims.iat) > now + OIDC_CLOCK_SKEW_SECONDS) throw new Error('github_oidc_future_issued');
  return claims;
}

export async function verifyGitHubActionsOidc(token, options = {}) {
  const text = String(token || '').trim();
  if (!text || Buffer.byteLength(text) > OIDC_MAX_TOKEN_BYTES) throw new Error('github_oidc_invalid_token');
  const parts = text.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('github_oidc_invalid_token');
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = decodeJsonPart(encodedHeader, 'header');
  const claims = decodeJsonPart(encodedClaims, 'claims');
  if (header.alg !== 'RS256' || !header.kid) throw new Error('github_oidc_bad_header');

  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(OIDC_JWKS_URL, {
    method: 'GET',
    headers: { accept: 'application/json', 'user-agent': 'tigeriq-github-oidc' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response?.ok) throw new Error('github_oidc_jwks_unavailable');
  const jwks = await response.json();
  const jwk = Array.isArray(jwks?.keys) ? jwks.keys.find((item) => item?.kid === header.kid && item?.kty === 'RSA') : null;
  if (!jwk) throw new Error('github_oidc_unknown_key');

  let key;
  try { key = createPublicKey({ key: jwk, format: 'jwk' }); }
  catch { throw new Error('github_oidc_invalid_key'); }
  const verified = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedClaims}`),
    key,
    Buffer.from(encodedSignature, 'base64url'),
  );
  if (!verified) throw new Error('github_oidc_bad_signature');
  return validateGitHubActionsClaims(claims, options);
}

export function section(body, heading) {
  const text = String(body || '').replace(/\r/g, '');
  const marker = `## ${heading}`;
  const start = text.indexOf(marker);
  if (start < 0) return '';
  const rest = text.slice(start + marker.length).replace(/^\s*\n/, '');
  const next = rest.search(/\n##\s+/);
  return String(next >= 0 ? rest.slice(0, next) : rest).trim();
}

export function booleanExecutionMarker(body, name) {
  const allowed = new Set(['PC01_REQUIRED', 'CLOUD_EXECUTOR_ALLOWED']);
  const marker = String(name || '');
  if (!allowed.has(marker)) return null;
  const pattern = new RegExp(`(?:^|[\\s/])${marker}\\s*(?:=|:)?\\s*(true|false)\\b`, 'gi');
  const values = new Set([...String(body || '').matchAll(pattern)].map((match) => String(match[1]).toLowerCase()));
  if (values.size !== 1) return null;
  return [...values][0] === 'true';
}

export function parseAutonomousCandidate(issue) {
  if (!issue || issue.pull_request || String(issue.state) !== 'open' || issueType(issue) !== 'work-order') return null;
  const body = String(issue.body || '');
  if (!body.includes('TIGERIQ_JOB_V1')) return null;
  const source = section(body, 'Source');
  if (!SAFE_SOURCES.has(source)) return null;
  const pc01Required = booleanExecutionMarker(body, 'PC01_REQUIRED');
  const cloudExecutorAllowed = booleanExecutionMarker(body, 'CLOUD_EXECUTOR_ALLOWED');
  if (pc01Required !== false || cloudExecutorAllowed === false) return null;
  const instruction = section(body, 'Instruction').slice(0, 6000);
  if (instruction.length < 3) return null;
  const fingerprint = section(body, 'Fingerprint') || workFingerprint(instruction);
  return {
    issue,
    instruction,
    fingerprint,
    priority: issuePriority(issue) || 'P1',
    source,
    expectedEvidence: section(body, 'Expected Evidence') || EXPECTED_EVIDENCE,
  };
}

function priorityRank(value) {
  return ({ P0: 0, P1: 1, P2: 2 })[String(value || '').toUpperCase()] ?? 9;
}

export function sortAutonomousCandidates(items = []) {
  return [...items].sort((a, b) => {
    const p = priorityRank(a.priority) - priorityRank(b.priority);
    if (p) return p;
    return Date.parse(a.issue?.created_at || 0) - Date.parse(b.issue?.created_at || 0);
  });
}

function failureInfo(comments = []) {
  const failures = [];
  for (const comment of Array.isArray(comments) ? comments : []) {
    const body = String(comment?.body || comment || '');
    if (!/(?:^|\n)TIGERIQ_JOB_FAILED(?:\n|$)/.test(body)) continue;
    const kind = body.match(/(?:^|\n)FAILURE_KIND\s+([^\s]+)(?:\n|$)/)?.[1] || 'unknown';
    const blocker = body.match(/(?:^|\n)BLOCKER\s+([^\n]+)(?:\n|$)/)?.[1] || '';
    failures.push({ kind, blocker, body });
  }
  const latest = failures.at(-1) || null;
  const legacyServerEvidenceFailures = failures.filter((failure) => (
    failure.kind === 'bounded_executor_blocked'
    && LEGACY_SERVER_EVIDENCE_BLOCKER.test(`${failure.blocker}\n${failure.body}`)
  ));
  return {
    count: failures.length,
    latest: latest?.kind || null,
    latestFailure: latest,
    legacyServerEvidenceCount: legacyServerEvidenceFailures.length,
  };
}

export function autonomousStageDecision(issue, comments = [], nowMs = Date.now()) {
  const stage = issueStage(issue, comments);
  if (stage === 'queued') return { runnable: true, reason: 'queued' };
  if (stage === 'claimed') {
    const updated = Date.parse(issue?.updated_at || '');
    if (Number.isFinite(updated) && nowMs - updated >= LOCK_TTL_MS * 2) return { runnable: true, reason: 'stale_claim_recovery' };
    return { runnable: false, reason: 'already_claimed' };
  }
  if (stage === 'failed') {
    const info = failureInfo(comments);
    const transient = info.latest === 'cloud_pipeline_error';
    const legacyServerEvidence = info.latestFailure?.kind === 'bounded_executor_blocked'
      && LEGACY_SERVER_EVIDENCE_BLOCKER.test(`${info.latestFailure.blocker}\n${info.latestFailure.body}`);
    if (legacyServerEvidence && info.legacyServerEvidenceCount === 1) {
      return { runnable: true, reason: 'legacy_server_evidence_migration_retry' };
    }
    if (transient && info.count < MAX_TRANSIENT_RETRIES) return { runnable: true, reason: 'bounded_transient_retry' };
    return { runnable: false, reason: transient ? 'retry_limit_reached' : 'non_retryable_failure' };
  }
  return { runnable: false, reason: stage };
}

function lockName(issueNumber) { return `${LOCK_PREFIX}${Number(issueNumber)}`; }
function lockCreatedAt(label) {
  const match = String(label?.description || '').match(/^TigerIQ autonomous run lock (\d{13})$/);
  return match ? Number(match[1]) : null;
}

async function acquireLock(issueNumber, token, retried = false) {
  const { owner, repo } = repoParts();
  const name = lockName(issueNumber);
  try {
    await gh(`/repos/${owner}/${repo}/labels`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, color: 'd4c5f9', description: `TigerIQ autonomous run lock ${Date.now()}` }),
    }, token);
    return { acquired: true, name };
  } catch (error) {
    if (error?.status !== 422) throw error;
    const existing = await gh(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, {}, token).catch(() => null);
    const createdAt = lockCreatedAt(existing);
    if (!retried && createdAt && Date.now() - createdAt > LOCK_TTL_MS) {
      await gh(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' }, token).catch(() => null);
      return acquireLock(issueNumber, token, true);
    }
    return { acquired: false, name };
  }
}

async function releaseLock(name, token) {
  const { owner, repo } = repoParts();
  await gh(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' }, token).catch(() => null);
}

async function postComment(issueNumber, body, token) {
  const { owner, repo } = repoParts();
  return gh(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }),
  }, token);
}

async function closeIssue(issueNumber, token) {
  const { owner, repo } = repoParts();
  return gh(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
  }, token);
}

function evidenceRefFor(input) {
  return `sha256:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
}

function conciseError(error) {
  return String(error instanceof Error ? error.message : error).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120) || 'unknown_error';
}

async function runPipeline(candidate, token, reason) {
  const issueNumber = Number(candidate.issue.number);
  const runId = randomUUID();
  const workforce = cloudWorkforceDescriptor();
  await postComment(issueNumber, [
    'TIGERIQ_JOB_CLAIMED', `RUN_ID ${runId}`, 'EXECUTOR vercel-serverless',
    `EXECUTOR_GATEWAY ${workforce.gateway}`, 'AUTO_WORK true', `AUTO_WORK_REASON ${reason}`, 'PC01_REQUIRED false',
  ].join('\n'), token);
  try {
    const execution = await executeCloudTask({ instruction: candidate.instruction, expectedEvidence: candidate.expectedEvidence });
    if (execution.status !== 'completed') {
      await postComment(issueNumber, [
        'TIGERIQ_JOB_FAILED', `RUN_ID ${runId}`, 'FAILURE_KIND bounded_executor_blocked',
        `BLOCKER ${execution.blocker || 'required capability is outside non-mutating cloud scope'}`,
        `MODEL ${execution.modelUsed}`, `PROVIDER ${execution.providerUsed || workforce.gateway}`, 'AUTO_WORK true',
      ].join('\n'), token);
      return { issueNumber, stage: 'failed', blocker: execution.blocker || 'bounded_executor_blocked' };
    }
    const evidenceRef = evidenceRefFor({
      version: 'TIGERIQ_CLOUD_EVIDENCE_V1', fingerprint: candidate.fingerprint,
      instruction: candidate.instruction, expectedEvidence: candidate.expectedEvidence,
      result: execution.result, evidenceSummary: execution.evidenceSummary,
    });
    await postComment(issueNumber, [
      'TIGERIQ_JOB_RESULT', `EVIDENCE_REF ${evidenceRef}`, `RUN_ID ${runId}`,
      `EXECUTOR_MODEL ${execution.modelUsed}`, `EXECUTOR_PROVIDER ${execution.providerUsed || workforce.gateway}`,
      'AUTO_WORK true', '', '## Expected Evidence', candidate.expectedEvidence,
      '', '## Result', execution.result || '(empty result)', '', '## Evidence Summary', execution.evidenceSummary || '(empty evidence summary)',
    ].join('\n'), token);
    const review = await reviewCloudTask({
      instruction: candidate.instruction, expectedEvidence: candidate.expectedEvidence,
      result: execution.result, evidenceSummary: execution.evidenceSummary,
    });
    if (!review.pass) {
      await postComment(issueNumber, [
        'TIGERIQ_JOB_FAILED', `RUN_ID ${runId}`, 'FAILURE_KIND independent_review_failed',
        `EVIDENCE_REF ${evidenceRef}`, `REVIEW_MODEL ${review.modelUsed}`, `REVIEW_PROVIDER ${review.providerUsed || workforce.gateway}`,
        'AUTO_WORK true', '', review.rationale || 'Reviewer did not pass.',
      ].join('\n'), token);
      return { issueNumber, stage: 'failed', blocker: 'independent_review_failed', evidenceRef };
    }
    await postComment(issueNumber, signServerGateComment([
      'REVIEW_PASS', `EVIDENCE_REF ${evidenceRef}`, `RUN_ID ${runId}`, 'REVIEW_ROLE independent-cloud-reviewer',
      `REVIEW_MODEL ${review.modelUsed}`, `REVIEW_PROVIDER ${review.providerUsed || workforce.gateway}`, 'AUTO_WORK true', '',
      review.rationale || 'Independent reviewer passed.',
    ].join('\n')), token);
    const judge = await judgeCloudTask({
      instruction: candidate.instruction, expectedEvidence: candidate.expectedEvidence,
      result: execution.result, evidenceSummary: execution.evidenceSummary, review,
    });
    if (!judge.pass) {
      await postComment(issueNumber, [
        'TIGERIQ_JOB_FAILED', `RUN_ID ${runId}`, 'FAILURE_KIND judge_failed', `EVIDENCE_REF ${evidenceRef}`,
        `JUDGE_MODEL ${judge.modelUsed}`, `JUDGE_PROVIDER ${judge.providerUsed || workforce.gateway}`, 'AUTO_WORK true', '',
        judge.rationale || 'Judge did not pass.',
      ].join('\n'), token);
      return { issueNumber, stage: 'failed', blocker: 'judge_failed', evidenceRef };
    }
    await postComment(issueNumber, signServerGateComment([
      'JUDGE_PASS', `EVIDENCE_REF ${evidenceRef}`, `RUN_ID ${runId}`, 'JUDGE_ROLE cloud-judge',
      `JUDGE_MODEL ${judge.modelUsed}`, `JUDGE_PROVIDER ${judge.providerUsed || workforce.gateway}`, 'AUTO_WORK true', '',
      judge.rationale || 'Judge passed.',
    ].join('\n')), token);
    await closeIssue(issueNumber, token);
    return { issueNumber, stage: 'completed', evidenceRef, runId };
  } catch (error) {
    const blocker = conciseError(error);
    await postComment(issueNumber, [
      'TIGERIQ_JOB_FAILED', `RUN_ID ${runId}`, 'FAILURE_KIND cloud_pipeline_error', `ERROR ${blocker}`, 'AUTO_WORK true',
    ].join('\n'), token).catch(() => null);
    return { issueNumber, stage: 'failed', blocker };
  }
}

async function schedulerCredential(req) {
  const auth = bearer(req);
  if (isOwnerAuthorized(req) && GITHUB_TOKEN) return { token: GITHUB_TOKEN, mode: 'owner-session' };
  if (!looksLikeBrowser(req) && COMMAND_SECRET && safeEqual(req.headers?.['x-tigeriq-secret'], COMMAND_SECRET) && GITHUB_TOKEN) {
    return { token: GITHUB_TOKEN, mode: 'server-secret' };
  }
  if (!looksLikeBrowser(req) && CRON_SECRET && safeEqual(auth, CRON_SECRET) && GITHUB_TOKEN) {
    return { token: GITHUB_TOKEN, mode: 'vercel-cron' };
  }
  if (!looksLikeBrowser(req) && auth && GITHUB_TOKEN) {
    await verifyGitHubActionsOidc(auth, {
      repository: REPO,
      audience: 'tigeriq-auto-work',
      workflowRef: EXPECTED_WORKFLOW_REF,
      ref: 'refs/heads/main',
      eventNames: ['schedule', 'workflow_dispatch'],
    });
    return { token: GITHUB_TOKEN, mode: 'github-oidc' };
  }
  const error = new Error('auto_work_authorization_required');
  error.status = 401;
  throw error;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  try {
    if (!cloudExecutorEnabled()) return json(res, 503, { error: 'cloud_executor_disabled' });
    const credential = await schedulerCredential(req);
    const { owner, repo } = repoParts();
    const issues = await gh(`/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=created&direction=asc`, {}, credential.token);
    const candidates = sortAutonomousCandidates((Array.isArray(issues) ? issues : []).map(parseAutonomousCandidate).filter(Boolean));
    const selected = [];
    const skipped = [];
    for (const candidate of candidates) {
      if (selected.length >= MAX_BATCH) break;
      const comments = await gh(`/repos/${owner}/${repo}/issues/${candidate.issue.number}/comments?per_page=100`, {}, credential.token).catch(() => []);
      const decision = autonomousStageDecision(candidate.issue, comments);
      if (decision.runnable) selected.push({ candidate, decision });
      else skipped.push({ issueNumber: candidate.issue.number, reason: decision.reason });
    }
    const processed = [];
    for (const item of selected) {
      const lock = await acquireLock(item.candidate.issue.number, credential.token);
      if (!lock.acquired) {
        skipped.push({ issueNumber: item.candidate.issue.number, reason: 'run_lock_busy' });
        continue;
      }
      try { processed.push(await runPipeline(item.candidate, credential.token, item.decision.reason)); }
      finally { await releaseLock(lock.name, credential.token); }
    }
    return json(res, 200, {
      ok: true,
      mode: 'autonomous-backlog-worker',
      credentialMode: credential.mode,
      policy: {
        safeSources: [...SAFE_SOURCES], maxBatch: MAX_BATCH, maxTransientRetries: MAX_TRANSIENT_RETRIES,
        scope: 'bounded-non-mutating-cloud-work-only', paidUpgrade: false,
      },
      scanned: candidates.length,
      processed,
      skipped,
      workforce: cloudWorkforceDescriptor(),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const name = error instanceof Error ? error.message : String(error);
    const status = name.startsWith('github_oidc_') ? 401 : Number(error?.status) || 502;
    return json(res, status, { error: name, details: error?.details?.message || undefined });
  }
}
