// GH-2293 R04: discover the Owner's existing Oct-08 Apify canary, GET-only.
// Never start, build, publish, or pay for an Actor; no credential in URL/logs.
import { inspectHistoricalRun, validApifyInstant } from './apify-historical-run-readonly.mjs';
import { readBoundedApifyJsonText } from './apify-json-response-bounded.mjs';

const API = 'https://api.apify.com/v2';
const HANDLE = 'tigeriq~tigeriq-ai-lab';
const DAY = '2026-10-08';
const BUILD = '0.0.4';
const GATE = 'OWNER_APPROVED_EXISTING_RUN_READ';
const OPAQUE = /^[A-Za-z0-9]{6,64}$/;
const MAX_ROWS = 50;
const START_UTC = '2026-10-07T17:00:00.000Z'; // Oct-08 00:00 +07
const END_UTC = '2026-10-08T16:59:59.999Z';   // Oct-08 23:59 +07

export class RunLocatorError extends Error {
  constructor(code) { super(code); this.name = 'RunLocatorError'; this.code = code; }
}
const fail = code => { throw new RunLocatorError(code); };
const obj = x => !!x && typeof x === 'object' && !Array.isArray(x);
function oct8(instant) {
  if (!validApifyInstant(instant)) return false;
  const stamp = Date.parse(instant);
  return stamp >= Date.parse(START_UTC) && stamp <= Date.parse(END_UTC);
}
function config(env) {
  if (env.APIFY_READONLY_EXECUTE !== GATE) fail('READONLY_GATE_REQUIRED');
  const token = String(env.APIFY_TOKEN || '').trim();
  if (!token) fail('SCOPED_TOKEN_REQUIRED');
  return token;
}
async function getJson(fetchFn, url, token) {
  // Two fixed-origin GET endpoints only, and a bounded query built locally.
  if (!url.startsWith(API + '/actors/')) fail('UNSAFE_ENDPOINT');
  let res;
  try {
    res = await fetchFn(url, {
      method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { accept: 'application/json', authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(8000),
    });
  } catch { fail('APIFY_FETCH_FAILED'); }
  if (!res || typeof res.status !== 'number') fail('RESPONSE_INVALID');
  if (res.status >= 300 && res.status < 400) fail('APIFY_REDIRECT_BLOCKED');
  if (res.status === 401 || res.status === 403) fail('SCOPED_READ_DENIED');
  if (!res.ok) fail('APIFY_READ_FAILED');
  // Do not accept lookalike media types such as application/jsonp.
  const contentType = String(res.headers?.get?.('content-type') || '').trim();
  if (!/^application\/json(?:\s*;|$)/i.test(contentType))
    fail('JSON_CONTENT_TYPE_REQUIRED');
  let raw, body;
  try {
    raw = await readBoundedApifyJsonText(res, fail);
    body = JSON.parse(raw);
  } catch (e) {
    if (e instanceof RunLocatorError) throw e;
    fail('APIFY_JSON_INVALID');
  }
  if (!obj(body) || !obj(body.data)) fail('APIFY_JSON_INVALID');
  return body.data;
}

export async function locateOwnerCanaryRun({ env = process.env, fetchFn = globalThis.fetch } = {}) {
  const token = config(env); // No request before explicit gate and token.
  if (typeof fetchFn !== 'function') fail('FETCH_UNAVAILABLE');
  const actor = await getJson(fetchFn, API + '/actors/' + HANDLE, token);
  if (!OPAQUE.test(actor.id || '') || actor.username !== 'tigeriq' ||
      actor.name !== 'tigeriq-ai-lab') fail('ACTOR_IDENTITY_MISMATCH');
  if (actor.isPublic !== false) fail('ACTOR_NOT_PRIVATE');
  if (actor.actorPermissionLevel !== 'LIMITED_PERMISSIONS') fail('ACTOR_PERMISSION_SCOPE_NOT_LIMITED');

  const query = new URLSearchParams({
    startedAfter: START_UTC, startedBefore: END_UTC,
    limit: String(MAX_ROWS), offset: '0',
  });
  const data = await getJson(fetchFn, API + '/actors/' + actor.id + '/runs?' + query, token);
  if (!Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0 ||
      data.total > MAX_ROWS || data.items.length !== data.total || data.offset !== 0 ||
      data.count !== data.items.length) fail('RUN_LIST_INCOMPLETE');
  // Never choose the "last" run: the Owner may have run this Actor again later.
  // All rows need valid provenance so a malformed second record cannot be skipped.
  if (data.items.some(row => !obj(row) || !OPAQUE.test(row.id || '') ||
      row.actId !== actor.id || !validApifyInstant(row.startedAt)))
    fail('RUN_LIST_IDENTITY_UNVERIFIED');
  if (data.items.some(row => !oct8(row.startedAt))) fail('RUN_LIST_DATE_MISMATCH');
  const candidates = data.items.filter(row => row.status === 'SUCCEEDED' && row.buildNumber === BUILD);
  if (!candidates.length) fail('OCT08_CANARY_NOT_FOUND');
  if (candidates.length !== 1) fail('OCT08_CANARY_AMBIGUOUS');
  const run = candidates[0];
  if (typeof run.buildId !== 'string' || !OPAQUE.test(run.buildId))
    fail('RUN_BUILD_ID_UNVERIFIED');
  // Opaque IDs remain process-local; never persist or post them in public issues.
  return { actorId: actor.id, runId: run.id, buildId: run.buildId, source: 'AUTHENTICATED_BOUNDED_APIFY_RUN_LIST',
    targetDay: DAY, expectedBuild: BUILD, requests: 2 };
}

export async function inspectDiscoveredOwnerCanary({ env = process.env,
  fetchFn = globalThis.fetch, now = () => new Date() } = {}) {
  const found = await locateOwnerCanaryRun({ env, fetchFn });
  // Reuse the already-merged exact-run, same-build, output-URL and cost guards.
  // Never treat list metadata alone as authenticated evidence or final invoice.
  const evidence = await inspectHistoricalRun({
    env: { ...env, APIFY_ACTOR_ID: found.actorId, APIFY_RUN_ID: found.runId },
    fetchFn, now, expectedBuildId: found.buildId,
  });
  return { ...evidence,
    discovery: { source: found.source, boundedDate: DAY, candidates: 1,
      readOnly: true, discoveryGetRequests: 2 },
    action: { ...evidence.action, requests: evidence.action.requests + 2 },
  };
}
