// GH-2293 R04: inspect one OWNER-NAMED EXISTING private Apify run.
// Pure GET-only evidence, with no Actor execution, build, run-sync, mutation or billing claim.
import { fileURLToPath } from 'node:url';
import { readBoundedApifyJsonText } from './apify-json-response-bounded.mjs';

const API = 'https://api.apify.com/v2';
const OPAQUE = /^[A-Za-z0-9]{6,64}$/;
const FLAG = 'OWNER_APPROVED_EXISTING_RUN_READ';
const EXPECTED_HANDLE = 'tigeriq/tigeriq-ai-lab';
const EXPECTED_DAY = '2026-10-08';
const EXPECTED_BUILD = '0.0.4';
// The Oct-08 Owner UI canary output used the harmless example.com URL.
// Reject another result even if it reuses the expected success schema.
const EXPECTED_CANARY_URL = 'https://example.com/';

export class HistoricReadError extends Error {
  constructor(code) { super(code); this.name = 'HistoricReadError'; this.code = code; }
}
const reject = code => { throw new HistoricReadError(code); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const actualData = x => object(x) && Object.hasOwn(x, 'data') ? x.data : x;
// Apify declares startedAt/finishedAt as ISO 8601 date-time (UTC examples).
// Offsets are mandatory: an offset-less local time is host-TZ dependent.
export function validApifyInstant(x) {
  if (typeof x !== 'string') return false;
  // Date.parse alone normalizes nonexistent calendar days and 24:00.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(x);
  if (!match) return false;
  const [, y, m, d, h, min, sec, tzH, tzM] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  if (month < 1 || month > 12 || Number(h) > 23 || Number(min) > 59 || Number(sec) > 59 ||
      (tzH !== undefined && (Number(tzH) > 14 || Number(tzM) > 59 ||
        (Number(tzH) === 14 && Number(tzM) !== 0)))) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1] && Number.isFinite(Date.parse(x));
}

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
  // Check the media-type token, not a substring (application/jsonp is not JSON).
  // Permit a case-insensitive media type with an optional parameter section.
  if (!/^application\/json(?:\s*;|$)/i.test(ct.trim())) reject('JSON_CONTENT_TYPE_REQUIRED');
  let body;
  try {
    const raw = await readBoundedApifyJsonText(response, reject);
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
  // Both Apify counters can be present. Never silently trust one when the
  // other disagrees: an unverified count must not become cost evidence.
  const stats = run?.stats?.computeUnits;
  const usage = run?.usage?.ACTOR_COMPUTE_UNITS;
  const valid = value => typeof value === 'number' &&
    Number.isFinite(value) && value >= 0;
  if (stats != null && !valid(stats)) return null;
  if (usage != null && !valid(usage)) return null;
  if (stats == null) return valid(usage) ? usage : null;
  if (usage == null) return valid(stats) ? stats : null;
  return stats === usage ? stats : null;
}
function validateRun(run, config, nowMs) {
  if (!object(run) || run.id !== config.runId || run.actId !== config.actorId)
    reject('RUN_IDENTITY_MISMATCH');
  if (run.status !== 'SUCCEEDED') reject('HISTORICAL_RUN_NOT_SUCCEEDED');
  if (typeof run.buildNumber !== 'string' || !run.buildNumber)
    reject('HISTORICAL_BUILD_UNVERIFIED');
  if (run.buildNumber !== EXPECTED_BUILD) reject('HISTORICAL_BUILD_MISMATCH');
  if (typeof run.buildId !== 'string' || !OPAQUE.test(run.buildId))
    reject('HISTORICAL_BUILD_ID_UNVERIFIED');
  if (!validApifyInstant(run.startedAt) || !validApifyInstant(run.finishedAt))
    reject('RUN_TIMESTAMPS_UNVERIFIED');
  const start = Date.parse(run.startedAt), end = Date.parse(run.finishedAt);
  if (start > end || end > nowMs - 10000) reject('RUN_USAGE_NOT_SETTLED');
  if (localDay(run.startedAt) !== EXPECTED_DAY) reject('HISTORICAL_RUN_DAY_MISMATCH');
  if (typeof run.defaultKeyValueStoreId !== 'string' ||
      !OPAQUE.test(run.defaultKeyValueStoreId)) reject('RUN_STORE_UNVERIFIED');
}
export async function inspectHistoricalRun({
  env = process.env, fetchFn = globalThis.fetch, now = () => new Date(),
  expectedBuildId = undefined,
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
  if (expectedBuildId !== undefined && final.buildId !== expectedBuildId)
    reject('RUN_LIST_DETAIL_BUILD_ID_MISMATCH');
  if (first.buildId !== final.buildId || first.startedAt !== final.startedAt || first.finishedAt !== final.finishedAt ||
      first.defaultKeyValueStoreId !== final.defaultKeyValueStoreId)
    reject('RUN_RECHECK_DRIFT');
  // Verify stability across both GETs. A completed run is not proof that
  // usage or compute totals have settled (nor a final platform invoice).
  const validUsd = value => typeof value === 'number' &&
    Number.isFinite(value) && value >= 0;
  if (!validUsd(first.usageTotalUsd) || !validUsd(final.usageTotalUsd))
    reject('APIFY_USAGE_UNVERIFIED');
  const firstUnits = getUnits(first), finalUnits = getUnits(final);
  if (first.usageTotalUsd !== final.usageTotalUsd || firstUnits !== finalUnits)
    reject('RUN_USAGE_RECHECK_DRIFT');
  const output = await readJson(fetchFn,
    API + '/key-value-stores/' + final.defaultKeyValueStoreId + '/records/OUTPUT', cfg.token);
  if (!object(output) || output.schemaVersion !== '1.0' || output.status !== 'success')
    reject('HISTORICAL_OUTPUT_INVALID');
  if (typeof output.requestedUrl !== 'string' || !output.requestedUrl)
    reject('HISTORICAL_REQUESTED_URL_UNVERIFIED');
  if (output.requestedUrl !== EXPECTED_CANARY_URL)
    reject('HISTORICAL_REQUESTED_URL_MISMATCH');
  // A claimed canary URL and success flag are insufficient: the original
  // audit engine produces page-level, metric and error evidence. Refuse
  // empty/unrelated results before declaring the historical run matched.
  if (!Array.isArray(output.pages) || output.pages.length !== 1 ||
      output.pages[0]?.url !== EXPECTED_CANARY_URL ||
      !Number.isInteger(output.pages[0]?.statusCode) ||
      output.pages[0].statusCode < 200 || output.pages[0].statusCode >= 300 ||
      !output.metrics || output.metrics.pagesAudited !== 1 ||
      output.metrics.errorCount !== 0 ||
      !Array.isArray(output.errors) || output.errors.length !== 0 ||
      !object(output.summary)) reject('HISTORICAL_AUDIT_PAYLOAD_UNVERIFIED');

  // Minimal evidence only. Never include token, payload content or audited URL.
  return {
    schema: 'TIGERIQ_APIFY_EXISTING_RUN_READ_V1',
    evidenceType: 'AUTHENTICATED_EXISTING_RUN_GET_ONLY',
    inspectedAt: clock.toISOString(),
    actor: { id: cfg.actorId, handle: EXPECTED_HANDLE, isPublic: false,
      actorPermissionLevel: 'LIMITED_PERMISSIONS' },
    run: { id: cfg.runId, actId: final.actId, status: final.status,
      startedAt: final.startedAt, finishedAt: final.finishedAt,
      buildNumber: final.buildNumber,
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
