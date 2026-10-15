// GH-2293 R04: inspect one OWNER-NAMED EXISTING private Apify run.
// Pure GET-only evidence, with no Actor execution, build, run-sync, mutation or billing claim.
import { fileURLToPath } from 'node:url';

const API = 'https://api.apify.com/v2';
const OPAQUE = /^[A-Za-z0-9]{6,64}$/;
const FLAG = 'OWNER_APPROVED_EXISTING_RUN_READ';
const EXPECTED_HANDLE = 'tigeriq/tigeriq-ai-lab';
const EXPECTED_DAY = '2026-10-08';

export class HistoricReadError extends Error {
  constructor(code) { super(code); this.name = 'HistoricReadError'; this.code = code; }
}
const reject = code => { throw new HistoricReadError(code); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const actualData = x => object(x) && Object.hasOwn(x, 'data') ? x.data : x;
const validInstant = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT/.test(x) &&
  Number.isFinite(Date.parse(x));

export function historicalRunConfig(env = process.env) {
  // Deny before using any credentials or touching network.
  if (env.APIFY_READONLY_EXECUTE !== FLAG) reject('READONLY_GATE_REQUIRED');
  const token = String(env.APIFY_TOKEN || '').trim();
  if (!token) reject('SCOPED_TOKEN_REQUIRED');
  const actorId = String(env.APIFY_ACTOR_ID || '').trim();
  const runId = String(env.APIFY_RUN_ID || '').trim();
  if (!OPAQUE.test(actorId) || !OPAQUE.test(runId)) reject('EXACT_OPAQUE_IDS_REQUIRED');
  if (actorId === runId) reject('ACTOR_RUN_IDS_NOT_DISTINCT');
  return { token, actorId, runId };
}

async function readJson(fetchFn, url, token) {
  if (!url.startsWith(API + '/') || url.includes('?') || url.includes('#'))
    reject('UNSAFE_ENDPOINT');
  let response;
  try {
    response = await fetchFn(url, {
      method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { accept: 'application/json', authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    reject('APIFY_FETCH_FAILED');
  }
  if (!response || typeof response.status !== 'number') reject('RESPONSE_INVALID');
  if (response.status >= 300 && response.status < 400) reject('APIFY_REDIRECT_BLOCKED');
  if (response.status === 401 || response.status === 403) reject('SCOPED_READ_DENIED');
  if (!response.ok) reject('APIFY_READ_FAILED');
  const ct = response.headers?.get?.('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) reject('JSON_CONTENT_TYPE_REQUIRED');
  let body;
  try {
    const raw = await response.text();
    if (raw.length > 131072) reject('RESPONSE_TOO_LARGE');
    body = JSON.parse(raw);
  } catch (e) {
    if (e instanceof HistoricReadError) throw e;
    reject('APIFY_JSON_INVALID');
  }
  if (!object(body)) reject('APIFY_JSON_INVALID');
  return actualData(body);
}
function localDay(iso) {
  const dt = new Date(iso);
  const items = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(dt);
  const val = k => items.find(x => x.type === k)?.value;
  return [val('year'),val('month'),val('day')].join('-');
}
function getUnits(run) {
  const v = run?.stats?.computeUnits ?? run?.usage?.ACTOR_COMPUTE_UNITS ?? null;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}
function validateRun(run, config, nowMs) {
  if (!object(run) || run.id !== config.runId || run.actId !== config.actorId)
    reject('RUN_IDENTITY_MISMATCH');
  if (run.status !== 'SUCCEEDED') reject('HISTORICAL_RUN_NOT_SUCCEEDED');
  if (!validInstant(run.startedAt) || !validInstant(run.finishedAt))
    reject('RUN_TIMESTAMPS_UNVERIFIED');
  const start = Date.parse(run.startedAt), end = Date.parse(run.finishedAt);
  if (start > end || end > nowMs - 10000) reject('RUN_USAGE_NOT_SETTLED');
  if (localDay(run.startedAt) !== EXPECTED_DAY) reject('HISTORICAL_RUN_DAY_MISMATCH');
  if (typeof run.defaultKeyValueStoreId !== 'string' ||
      !OPAQUE.test(run.defaultKeyValueStoreId)) reject('RUN_STORE_UNVERIFIED');
}
export async function inspectHistoricalRun({
  env = process.env, fetchFn = globalThis.fetch, now = () => new Date(),
} = {}) {
  const cfg = historicalRunConfig(env);
  if (typeof fetchFn !== 'function') reject('FETCH_UNAVAILABLE');
  const clock = now();
  if (!(clock instanceof Date) || !Number.isFinite(clock.getTime()))
    reject('CLOCK_INVALID');
  const actor = await readJson(fetchFn, API + '/actors/' + cfg.actorId, cfg.token);
  if (!object(actor) || actor.id !== cfg.actorId ||
      actor.username + '/' + actor.name !== EXPECTED_HANDLE) reject('ACTOR_IDENTITY_MISMATCH');
  if (actor.isPublic !== false) reject('ACTOR_NOT_PRIVATE');
  if (actor.actorPermissionLevel !== 'LIMITED_PERMISSIONS')
    reject('ACTOR_PERMISSION_SCOPE_NOT_LIMITED');

  // Exact run GET (never /run-sync: Apify documents that GET endpoint launches runs).
  const runUrl = API + '/actor-runs/' + cfg.runId;
  const first = await readJson(fetchFn, runUrl, cfg.token);
  validateRun(first, cfg, clock.getTime());
  const final = await readJson(fetchFn, runUrl, cfg.token);
  validateRun(final, cfg, clock.getTime());
  if (first.startedAt !== final.startedAt || first.finishedAt !== final.finishedAt ||
      first.defaultKeyValueStoreId !== final.defaultKeyValueStoreId)
    reject('RUN_RECHECK_DRIFT');
  if (typeof final.usageTotalUsd !== 'number' ||
      !Number.isFinite(final.usageTotalUsd) || final.usageTotalUsd < 0)
    reject('APIFY_USAGE_UNVERIFIED');
  const output = await readJson(fetchFn,
    API + '/key-value-stores/' + final.defaultKeyValueStoreId + '/records/OUTPUT', cfg.token);
  if (!object(output) || output.schemaVersion !== '1.0' || output.status !== 'success')
    reject('HISTORICAL_OUTPUT_INVALID');

  // Minimal evidence only. Never include token, payload content or audited URL.
  return {
    schema: 'TIGERIQ_APIFY_EXISTING_RUN_READ_V1',
    evidenceType: 'AUTHENTICATED_EXISTING_RUN_GET_ONLY',
    inspectedAt: clock.toISOString(),
    actor: { id: cfg.actorId, handle: EXPECTED_HANDLE, isPublic: false,
      actorPermissionLevel: 'LIMITED_PERMISSIONS' },
    run: { id: cfg.runId, actId: final.actId, status: final.status,
      startedAt: final.startedAt, finishedAt: final.finishedAt,
      computeUnits: getUnits(final), usageTotalUsd: final.usageTotalUsd },
    output: { schemaVersion: output.schemaVersion, status: output.status },
    cost: { source: 'APIFY_API_INFORMATIONAL_NOT_FINAL_INVOICE',
      ownerBillingConfirmed: false, zeroCostClaim: false, revenueVerified: false },
    action: { readOnly: true, requests: 4, postRequests: 0,
      newBuilds: 0, newRuns: 0, actorMutation: false },
    acceptance: { historicalRunMatched: true,
      platformFinalInvoiceVerified: false, paidRevenueVerified: false },
  };
}
function cliError(e) {
  return JSON.stringify({ ok: false, code: e instanceof HistoricReadError ? e.code : 'UNEXPECTED_FAILURE' });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const evidence = await inspectHistoricalRun();
    process.stdout.write(JSON.stringify({ ok: true, evidence }) + '\n');
  } catch (error) {
    process.stderr.write(cliError(error) + '\n');
    process.exitCode = 1;
  }
}
