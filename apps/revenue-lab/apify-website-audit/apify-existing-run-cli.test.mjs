import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { verifyOldCanaryReadOnly, safeCliError } from './apify-existing-run-cli.mjs';
import { RunLocatorError } from './apify-existing-run-locator.mjs';
import { HistoricReadError } from './apify-historical-run-readonly.mjs';

const env = {
  APIFY_READONLY_EXECUTE: 'OWNER_APPROVED_EXISTING_RUN_READ',
  APIFY_TOKEN: 'SENTINEL_SECRET_ONLY_IN_MEMORY',
};
const now = () => new Date('2026-10-16T06:30:00.000Z');
const actor = {
  id: 'ACTOR12345', username: 'tigeriq', name: 'tigeriq-ai-lab',
  isPublic: false, actorPermissionLevel: 'LIMITED_PERMISSIONS',
};
const run = {
  id: 'RUN1234567', actId: actor.id, status: 'SUCCEEDED',
  buildNumber: '0.0.4', startedAt: '2026-10-08T03:00:00.000Z',
  finishedAt: '2026-10-08T03:00:02.000Z',
  defaultKeyValueStoreId: 'STORE12345', usageTotalUsd: 0.0004,
  stats: { computeUnits: 0.002 },
};
const output = { schemaVersion: '1.0', status: 'success', requestedUrl: 'https://example.com/' };
function fixture(override = {}) {
  let calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, method: options.method });
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'Bearer ' + env.APIFY_TOKEN);
    if (url.endsWith('/actors/tigeriq~tigeriq-ai-lab')) return Response.json({data:actor});
    if (url.includes('/actors/ACTOR12345/runs?')) return Response.json({data:{total:1,count:1,offset:0,limit:50,items:[run]}});
    if (url.endsWith('/actors/ACTOR12345')) return Response.json({data:actor});
    if (url.endsWith('/actor-runs/RUN1234567')) return Response.json({data:{...run, ...(override.run || {})}});
    if (url.endsWith('/key-value-stores/STORE12345/records/OUTPUT')) return Response.json({...output, ...(override.output || {})});
    throw Error('OUT_OF_SCOPE_REQUEST');
  };
  return { fetchFn, calls };
}

test('R04 owner CLI no approved gate: native child exits 1, stdout empty and no secrets', () => {
  const result = spawnSync(process.execPath, ['apify-existing-run-cli.mjs'], {
    cwd: new URL('.', import.meta.url), encoding:'utf8',
    env: { PATH: process.env.PATH, APIFY_TOKEN: env.APIFY_TOKEN }, timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), {ok:false,code:'READONLY_GATE_REQUIRED'});
  assert.doesNotMatch(result.stderr, /SENTINEL_SECRET_ONLY_IN_MEMORY/);
});
test('R04 owner CLI with gate but no token: exits safely without API call', () => {
  const result = spawnSync(process.execPath, ['apify-existing-run-cli.mjs'], {
    cwd: new URL('.', import.meta.url), encoding:'utf8',
    env: { PATH: process.env.PATH, APIFY_READONLY_EXECUTE: env.APIFY_READONLY_EXECUTE }, timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), {ok:false,code:'SCOPED_TOKEN_REQUIRED'});
});
test('R04 owner CLI integrated six-GET success produces only allowlisted evidence', async () => {
  const f = fixture();
  const result = await verifyOldCanaryReadOnly({env,fetchFn:f.fetchFn,now});
  assert.equal(result.schema,'TIGERIQ_APIFY_DISCOVERED_RUN_SAFE_CLI_V1');
  assert.equal(f.calls.length,6);
  assert.equal(result.action.requests,6);
  assert.equal(result.action.readOnly,true);
  assert.equal(result.acceptance.historicalRunMatched,true);
  assert.equal(result.acceptance.platformFinalInvoiceVerified,false);
  assert.equal(result.cost.ownerBillingConfirmed,false);
  assert.equal(result.cost.zeroCostClaim,false);
  assert.equal(result.run.usageTotalUsd,0.0004);
  assert.equal(result.run.computeUnits,0.002);
  assert.deepEqual(Object.keys(result.actor),['handle','isPublic','actorPermissionLevel']);
  assert.deepEqual(Object.keys(result.run),['status','startedAt','finishedAt','buildNumber','computeUnits','usageTotalUsd']);
  assert.doesNotMatch(JSON.stringify(result),/SENTINEL_SECRET_ONLY_IN_MEMORY|ACTOR12345|RUN1234567|STORE12345|example\.com/);
});
test('R04 owner CLI keeps cost and customer revenue NOT verified', async () => {
  const f = fixture();
  const result = await verifyOldCanaryReadOnly({env,fetchFn:f.fetchFn,now});
  assert.equal(result.cost.source,'APIFY_API_INFORMATIONAL_NOT_FINAL_INVOICE');
  assert.equal(result.cost.revenueVerified,false);
  assert.equal(result.acceptance.paidRevenueVerified,false);
  assert.equal(result.action.postRequests,0);
  assert.equal(result.action.newBuilds,0);
  assert.equal(result.action.newRuns,0);
});
test('R04 owner CLI refuses wrong canary URL via previously merged gate', async () => {
  const f=fixture({output:{requestedUrl:'https://unrelated.example/'}});
  await assert.rejects(verifyOldCanaryReadOnly({env,fetchFn:f.fetchFn,now}),e=>e instanceof HistoricReadError&&e.code==='HISTORICAL_REQUESTED_URL_MISMATCH');
  assert.equal(f.calls.length,6);
});
test('R04 owner CLI refuses wrong run identity via previously merged gate', async () => {
  const f=fixture({run:{actId:'ANOTHERACTOR'}});
  await assert.rejects(verifyOldCanaryReadOnly({env,fetchFn:f.fetchFn,now}),e=>e instanceof HistoricReadError&&e.code==='RUN_IDENTITY_MISMATCH');
  assert.equal(f.calls.length,4);
});
test('R04 owner CLI errors expose only known codes, not private fields', () => {
  assert.deepEqual(safeCliError(new RunLocatorError('OCT08_CANARY_AMBIGUOUS')),{ok:false,code:'OCT08_CANARY_AMBIGUOUS'});
  assert.deepEqual(safeCliError(new HistoricReadError('RUN_USAGE_RECHECK_DRIFT')),{ok:false,code:'RUN_USAGE_RECHECK_DRIFT'});
  assert.deepEqual(safeCliError(new Error('SENTINEL_SECRET_ONLY_IN_MEMORY')),{ok:false,code:'UNEXPECTED_FAILURE'});
});
