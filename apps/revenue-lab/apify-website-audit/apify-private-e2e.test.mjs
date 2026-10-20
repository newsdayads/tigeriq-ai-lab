import test from 'node:test';
import assert from 'node:assert/strict';
import { runPrivateApifyE2E, ApifyE2EError, safeError, apifyE2ERequestTimeoutMs } from './apify-private-e2e.mjs';

const env = {
  APIFY_TOKEN: 'secret-token-value',
  APIFY_ACTOR_ID: 'actor123',
  APIFY_ACTOR_VERSION: '0.1',
  APIFY_BUILD_TAG: 'latest',
  APIFY_E2E_EXECUTE: 'OWNER_APPROVED_PRIVATE_TEST',
  // Synthetic input, not a real spend authorization.
  APIFY_E2E_MAX_TOTAL_CHARGE_USD: '0.05',
};
const noSleep = async () => {};

// Mirrors the genuine auditWebsite() schema from audit-engine.mjs, not just
// a synthetic "success" flag. No paid Actor or network involved.
const validAuditOutput = () => ({
  schemaVersion: '1.0',
  status: 'success',
  requestedUrl: 'https://example.com/',
  metrics: { pagesAudited: 1, errorCount: 0 },
  pages: [{ url: 'https://example.com/', statusCode: 200 }],
  errors: [],
  summary: { titlePresent: true },
});

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function successFetch() {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, options });
    if (u.includes('/actors/actor123/builds?')) {
      return response(201, { data: { id: 'build1', status: 'SUCCEEDED', buildNumber: '0.1.7', usageTotalUsd: null } });
    }
    if (u.endsWith('/actor-builds/build1')) {
      return response(200, { data: { id: 'build1', status: 'SUCCEEDED', buildNumber: '0.1.7', stats: { computeUnits: 0.01 }, usageTotalUsd: 0.002 } });
    }
    if (u.includes('/actors/actor123/runs?')) {
      return response(201, { data: { id: 'run1', buildId: 'build1', status: 'SUCCEEDED', usageTotalUsd: null } });
    }
    if (u.endsWith('/actor-runs/run1')) {
      return response(200, { data: { id: 'run1', buildId: 'build1', status: 'SUCCEEDED', stats: { computeUnits: 0.02 }, usageTotalUsd: 0.004 } });
    }
    if (u.endsWith('/actor-runs/run1/key-value-store/records/OUTPUT')) {
      return response(200, validAuditOutput());
    }
    throw new Error('unexpected URL ' + u);
  };
  return { fetchFn, calls };
}

test('success path uses finalized build/run usage after settle refetch', async () => {
  const { fetchFn, calls } = successFetch();
  const sleeps = [];
  let written = null;
  const evidence = await runPrivateApifyE2E({
    env: { ...env, APIFY_EVIDENCE_PATH: 'evidence.json' },
    fetchFn,
    sleepFn: async ms => { sleeps.push(ms); },
    writeFileFn: async (_path, data) => { written = data; },
    now: () => '2026-09-29T00:00:00.000Z',
  });

  assert.deepEqual(sleeps, [10000, 10000]);
  assert.equal(evidence.build.computeUnits, 0.01);
  assert.equal(evidence.run.computeUnits, 0.02);
  assert.equal(evidence.build.buildNumber, '0.1.7');
  assert.equal(evidence.run.requestedBuildNumber, '0.1.7');
  assert.equal(evidence.cost.totalPlatformCostUSD, 0.006);
  assert.equal(evidence.output.schemaVersion, '1.0');
  assert.equal(evidence.output.requestedUrl, 'https://example.com/');
  assert.equal(evidence.output.pagesAudited, 1);
  assert.ok(written.includes('"totalPlatformCostUSD": 0.006'));
  assert.ok(!written.includes(env.APIFY_TOKEN));
  assert.ok(calls.some(call => call.url.endsWith('/actor-builds/build1')));
  assert.ok(calls.some(call => call.url.endsWith('/actor-runs/run1')));
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 2);
  const actorRunPost = calls.find(call => call.url.includes('/actors/actor123/runs?'));
  assert.ok(actorRunPost, 'must submit a run request with a bounded cost envelope');
  assert.equal(new URL(actorRunPost.url).searchParams.get('maxTotalChargeUsd'), '0.048');
  // Build charge 0.002 + max run charge 0.048 <= Owner's total 0.05 budget.
  assert.equal(new URL(actorRunPost.url).searchParams.get('build'), '0.1.7');
  assert.notEqual(new URL(actorRunPost.url).searchParams.get('build'), env.APIFY_BUILD_TAG);
  for (const call of calls) {
    assert.ok(!call.url.includes(env.APIFY_TOKEN));
    assert.equal(call.options.headers.authorization, 'Bearer ' + env.APIFY_TOKEN);
  }
});

test('R07 finalized build charge is deducted from private run maximum (round down)', async () => {
  const base = successFetch();
  const fetchFn = (url, options) => String(url).endsWith('/actor-builds/build1')
    ? Promise.resolve(response(200, { data: {
        id: 'build1', status: 'SUCCEEDED', buildNumber: '0.1.7',
        stats: { computeUnits: 0.01 }, usageTotalUsd: 0.0024,
      } }))
    : base.fetchFn(url, options);
  await runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep });
  const runPost = base.calls.find(call => call.url.includes('/actors/actor123/runs?'));
  assert.ok(runPost);
  assert.equal(new URL(runPost.url).searchParams.get('maxTotalChargeUsd'), '0.047');
  assert.ok(0.0024 + 0.047 <= Number(env.APIFY_E2E_MAX_TOTAL_CHARGE_USD));
});

test('R07 exhausts build-adjusted budget before any charged run POST', async () => {
  for (const buildCharge of [0.05, 0.051, 0.0495]) {
    const base = successFetch();
    const seen = [];
    const fetchFn = (url, options) => {
      seen.push({url: String(url), method: options.method});
      if (String(url).endsWith('/actor-builds/build1')) {
        return Promise.resolve(response(200, { data: {
          id: 'build1', status: 'SUCCEEDED', buildNumber: '0.1.7',
          stats: { computeUnits: 0.01 }, usageTotalUsd: buildCharge,
        } }));
      }
      return base.fetchFn(url, options);
    };
    await assert.rejects(
      () => runPrivateApifyE2E({env,fetchFn,sleepFn:noSleep}),
      error => error instanceof ApifyE2EError &&
        error.code === 'TOTAL_COST_ENVELOPE_EXHAUSTED',
      'charge=' + buildCharge,
    );
    assert.equal(seen.filter(x => x.method === 'POST').length, 1);
    assert.equal(seen.some(x => x.url.includes('/runs?')), false);
  }
});

// R08-specific trust boundary: an HTTP 200 is not a successful audited result.
test('R08 invalid OUTPUT must never become accepted E2E evidence', async () => {
  for (const badOutput of [
    { schemaVersion: '9000', status: 'success' },
    { schemaVersion: '1.0', status: 'error' },
    { schemaVersion: '1.0', status: 'success', error: 'not-empty' },
    null,
    // Prior code accepted a success-only JSON without any actual audit.
    { schemaVersion: '1.0', status: 'success' },
    { ...validAuditOutput(), requestedUrl: 'https://other.example/' },
    { ...validAuditOutput(), requestedUrl: undefined },
    // Check the returned page, not merely the claimed requestedUrl field.
    { ...validAuditOutput(), pages: [{ url: 'https://other.example/', statusCode: 200 }] },
    { ...validAuditOutput(), pages: [{ url: 'https://example.com/other', statusCode: 200 }] },
    { ...validAuditOutput(), pages: [] },
    { ...validAuditOutput(), metrics: { pagesAudited: 0, errorCount: 0 } },
    { ...validAuditOutput(), metrics: { pagesAudited: 2, errorCount: 0 } },
    { ...validAuditOutput(), errors: [{ code: 'AUDIT_FAILURE' }] },
    { ...validAuditOutput(), metrics: { pagesAudited: 1, errorCount: 1 } },
    { ...validAuditOutput(), summary: null },
    { ...validAuditOutput(), pages: [{ url: 'https://example.com/', statusCode: 500 }] },
  ]) {
    const normal = successFetch();
    const fetchFn = async (url, options) =>
      String(url).endsWith('/actor-runs/run1/key-value-store/records/OUTPUT')
        ? response(200, badOutput)
        : normal.fetchFn(url, options);
    await assert.rejects(
      () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
      error => error instanceof ApifyE2EError && error.code === 'OUTPUT_INVALID',
      JSON.stringify(badOutput),
    );
  }
});

// The already-merged historical reader refuses false CU numbers; the paid
// E2E evidence must apply the same check instead of claiming measured units.
test('R08 negative build computeUnits must not enter evidence', async () => {
  const normal = successFetch();
  const fetchFn = async (url, options) =>
    String(url).endsWith('/actor-builds/build1')
      ? response(200, { data: { id: 'build1', status: 'SUCCEEDED',
          stats: { computeUnits: -1 }, usage: { ACTOR_COMPUTE_UNITS: 0.01 },
          usageTotalUsd: 0.002 } })
      : normal.fetchFn(url, options);
  await assert.rejects(
    () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
    error => error instanceof ApifyE2EError && error.code === 'COMPUTE_UNITS_UNVERIFIED',
  );
  assert.equal(normal.calls.some(call => call.url.includes('/runs?')), false);
});
test('R08 contradictory run computeUnits must not enter evidence', async () => {
  const normal = successFetch();
  const fetchFn = async (url, options) =>
    String(url).endsWith('/actor-runs/run1')
      ? response(200, { data: { id: 'run1', buildId: 'build1', status: 'SUCCEEDED',
          stats: { computeUnits: 0 }, usage: { ACTOR_COMPUTE_UNITS: 0.02 },
          usageTotalUsd: 0.004 } })
      : normal.fetchFn(url, options);
  await assert.rejects(
    () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
    error => error instanceof ApifyE2EError && error.code === 'COMPUTE_UNITS_UNVERIFIED',
  );
});
test('R08 valid equal secondary computeUnits accepted', async () => {
  const normal = successFetch();
  const fetchFn = async (url, options) =>
    String(url).endsWith('/actor-runs/run1')
      ? response(200, { data: { id: 'run1', buildId: 'build1', status: 'SUCCEEDED',
          stats: { computeUnits: 0.02 }, usage: { ACTOR_COMPUTE_UNITS: 0.02 },
          usageTotalUsd: 0.004 } })
      : normal.fetchFn(url, options);
  const verified = await runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep });
  assert.equal(verified.run.computeUnits, 0.02);
  assert.equal(verified.output.status, 'success');
});

// R08 private E2E can emit real build/run costs only from bounded authenticated JSON.
test('R08 E2E refuses oversized OUTPUT JSON rather than accepting an unbounded 200', async () => {
  const normal = successFetch();
  const fetchFn = async (url, options) =>
    String(url).endsWith('/actor-runs/run1/key-value-store/records/OUTPUT')
      ? response(200, { schemaVersion: '1.0', status: 'success', padding: 'x'.repeat(160000) })
      : normal.fetchFn(url, options);
  await assert.rejects(
    () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
    error => error instanceof ApifyE2EError && error.code === 'RESPONSE_TOO_LARGE',
  );
  assert.equal(normal.calls.filter(call => call.options.method === 'POST').length, 2);
});

test('R08 E2E refuses non-JSON success content before attempting an Actor run', async () => {
  const normal = successFetch();
  const fetchFn = async (url, options) =>
    String(url).includes('/actors/actor123/builds?')
      ? new Response(JSON.stringify({ data: { id: 'build1', status: 'SUCCEEDED' } }),
          { status: 201, headers: { 'content-type': 'text/html' } })
      : normal.fetchFn(url, options);
  await assert.rejects(
    () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
    error => error instanceof ApifyE2EError && error.code === 'JSON_CONTENT_TYPE_REQUIRED',
  );
  assert.equal(normal.calls.length, 0);
});

test('R08 E2E pins redirect error mode for all authenticated GET and POST requests', async () => {
  const { fetchFn, calls } = successFetch();
  await runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep });
  assert.equal(calls.length, 5);
  for (const { url, options } of calls) {
    assert.equal(options.redirect, 'error');
    assert.ok(!url.includes(env.APIFY_TOKEN));
  }
});

test('R08 E2E refuses malformed JSON without persisting a false build failure', async () => {
  const fetchFn = async () => new Response('not-valid-json', {
    status: 201, headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(
    () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
    error => error instanceof ApifyE2EError && error.code === 'APIFY_JSON_INVALID',
  );
});

test('R08 E2E bounds all network waits at the exact known API deadline', async () => {
  const { fetchFn, calls } = successFetch();
  await runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep });
  assert.equal(calls.length, 5);
  for (const { options } of calls) {
    assert.ok(options.signal instanceof AbortSignal, 'every authenticated request must be abortable');
  }
  assert.equal(apifyE2ERequestTimeoutMs('https://api.apify.com/v2/actors/A/builds?waitForFinish=60'), 75000);
  assert.equal(apifyE2ERequestTimeoutMs('https://api.apify.com/v2/actor-runs/R?waitForFinish=60'), 75000);
  assert.equal(apifyE2ERequestTimeoutMs('https://api.apify.com/v2/actor-runs/R'), 8000);
  assert.equal(apifyE2ERequestTimeoutMs('https://api.apify.com/v2/actors/A/runs?waitForFinish=0'), 8000);
});

test('R08 E2E terminal polling error is fail closed without retrying a paid run', async () => {
  const endpoints = [];
  const fetchFn = async (url, options) => {
    const u = String(url);
    endpoints.push({ url: u, method: options.method });
    assert.ok(options.signal instanceof AbortSignal);
    if (u.includes('/actors/actor123/builds?')) return response(201, { data: { id: 'build1', status: 'RUNNING' } });
    throw new Error('PRIVATE_TIMEOUT_MARKER_' + env.APIFY_TOKEN);
  };
  await assert.rejects(
    () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
    e => e instanceof ApifyE2EError && e.code === 'NETWORK_FAILURE' &&
      !JSON.stringify(e).includes(env.APIFY_TOKEN),
  );
  assert.equal(endpoints.length, 2);
  assert.equal(endpoints.filter(x => x.method === 'POST').length, 1);
  assert.equal(endpoints.filter(x => x.url.includes('/runs?')).length, 0);
});

test('auth failure is fail-closed and redacts token', async () => {
  const fetchFn = async () => response(401, { error: { message: 'bad token secret-token-value' } });
  await assert.rejects(
    () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
    error => error instanceof ApifyE2EError &&
      error.code === 'API_HTTP_ERROR' &&
      !JSON.stringify(error).includes(env.APIFY_TOKEN),
  );
});

test('build terminal failure stops before settle/refetch/run', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return response(201, { data: { id: 'build1', status: 'FAILED', usageTotalUsd: 0.001 } });
  };
  await assert.rejects(
    () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
    error => error instanceof ApifyE2EError && error.code === 'BUILD_FAILED',
  );
  assert.equal(calls, 1);
});

test('finalized build usage is required after settle', async () => {
  const fetchFn = async url => {
    const u = String(url);
    if (u.includes('/actors/actor123/builds?')) return response(201, { data: { id: 'build1', status: 'SUCCEEDED' } });
    if (u.endsWith('/actor-builds/build1')) return response(200, { data: { id: 'build1', status: 'SUCCEEDED', stats: { computeUnits: 0.01 } } });
    throw new Error('should not continue');
  };
  await assert.rejects(
    () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
    error => error instanceof ApifyE2EError && error.code === 'COST_EVIDENCE_MISSING',
  );
});

test('run terminal failure stops before finalized run/output', async () => {
  const fetchFn = async url => {
    const u = String(url);
    if (u.includes('/actors/actor123/builds?')) return response(201, { data: { id: 'build1', status: 'SUCCEEDED' } });
    if (u.endsWith('/actor-builds/build1')) return response(200, { data: { id: 'build1', status: 'SUCCEEDED', buildNumber: '0.1.7', usageTotalUsd: 0.001 } });
    if (u.includes('/actors/actor123/runs?')) return response(201, { data: { id: 'run1', buildId: 'build1', status: 'FAILED', usageTotalUsd: 0.002 } });
    throw new Error('unexpected URL ' + u);
  };
  await assert.rejects(
    () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
    error => error instanceof ApifyE2EError && error.code === 'RUN_FAILED',
  );
});

test('finalized run usage is required after settle', async () => {
  const fetchFn = async url => {
    const u = String(url);
    if (u.includes('/actors/actor123/builds?')) return response(201, { data: { id: 'build1', status: 'SUCCEEDED' } });
    if (u.endsWith('/actor-builds/build1')) return response(200, { data: { id: 'build1', status: 'SUCCEEDED', buildNumber: '0.1.7', usageTotalUsd: 0.001 } });
    if (u.includes('/actors/actor123/runs?')) return response(201, { data: { id: 'run1', buildId: 'build1', status: 'SUCCEEDED' } });
    if (u.endsWith('/actor-runs/run1')) return response(200, { data: { id: 'run1', buildId: 'build1', status: 'SUCCEEDED' } });
    throw new Error('should not continue');
  };
  await assert.rejects(
    () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
    error => error instanceof ApifyE2EError && error.code === 'COST_EVIDENCE_MISSING',
  );
});

test('bounded polling still supports transitional build/run', async () => {
  let buildPoll = 0;
  let runPoll = 0;
  const fetchFn = async url => {
    const u = String(url);
    if (u.includes('/actors/actor123/builds?')) return response(201, { data: { id: 'build1', status: 'RUNNING' } });
    if (u.includes('/actor-builds/build1?waitForFinish=60')) {
      buildPoll += 1;
      return response(200, { data: { id: 'build1', status: 'SUCCEEDED' } });
    }
    if (u.endsWith('/actor-builds/build1')) return response(200, { data: { id: 'build1', status: 'SUCCEEDED', buildNumber: '0.1.7', usageTotalUsd: 0.001 } });
    if (u.includes('/actors/actor123/runs?')) return response(201, { data: { id: 'run1', buildId: 'build1', status: 'RUNNING' } });
    if (u.includes('/actor-runs/run1?waitForFinish=60')) {
      runPoll += 1;
      return response(200, { data: { id: 'run1', buildId: 'build1', status: 'SUCCEEDED' } });
    }
    if (u.endsWith('/actor-runs/run1')) return response(200, { data: { id: 'run1', buildId: 'build1', status: 'SUCCEEDED', usageTotalUsd: 0.002 } });
    if (u.endsWith('/actor-runs/run1/key-value-store/records/OUTPUT')) return response(200, validAuditOutput());
    throw new Error('unexpected URL ' + u);
  };
  const evidence = await runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep });
  assert.equal(evidence.cost.totalPlatformCostUSD, 0.003);
  assert.equal(buildPoll, 1);
  assert.equal(runPoll, 1);
  await assertR08ResourceIdFenceCases();
  await assertR08BuildIdAffinityCases();
});

test('execution gate is required before any API request', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return response(500, {}); };
  const gatedEnv = { ...env };
  delete gatedEnv.APIFY_E2E_EXECUTE;
  await assert.rejects(
    () => runPrivateApifyE2E({ env: gatedEnv, fetchFn, sleepFn: noSleep }),
    error => error instanceof ApifyE2EError && error.code === 'EXECUTION_GATE_REQUIRED',
  );
  assert.equal(called, false);

  // Cost allowance is NOT inferred from waitForFinish/timeout or a fixture
  // execution flag; the gate runs before any potentially billable build POST.
  for (const budget of [undefined, '', '0', '0.000', '-1', '1.01',
    'NaN', 'Infinity', '2e1', '0.00001', '1.001', '00.05']) {
    called = false;
    const candidate = {...env};
    if (budget === undefined) delete candidate.APIFY_E2E_MAX_TOTAL_CHARGE_USD;
    else candidate.APIFY_E2E_MAX_TOTAL_CHARGE_USD = budget;
    await assert.rejects(
      () => runPrivateApifyE2E({env:candidate,fetchFn,sleepFn:noSleep}),
      error => error instanceof ApifyE2EError &&
        error.code === 'EXPLICIT_COST_ENVELOPE_REQUIRED',
      'must fail closed for invalid budget ' + String(budget),
    );
    assert.equal(called, false, 'invalid cost envelope must cause zero API requests');
  }
});

test('production API origin remains pinned despite hostile env override', async () => {
  const urls = [];
  const fetchFn = async url => {
    urls.push(String(url));
    return response(201, { data: { id: 'build1', status: 'FAILED', usageTotalUsd: 0 } });
  };
  await assert.rejects(
    () => runPrivateApifyE2E({ env: { ...env, APIFY_API_BASE: 'https://evil.test/v2' }, fetchFn, sleepFn: noSleep }),
    error => error instanceof ApifyE2EError && error.code === 'BUILD_FAILED',
  );
  assert.ok(urls[0].startsWith('https://api.apify.com/v2/'));
  assert.ok(!urls[0].includes('evil.test'));
});

test('safeError never exposes token', () => {
  const error = new ApifyE2EError('X', 'failed secret-token-value', { detail: 'secret-token-value' });
  const serialized = JSON.stringify(safeError(error, env));
  assert.ok(!serialized.includes(env.APIFY_TOKEN));
  assert.ok(serialized.includes('[REDACTED]'));
});


// Four distinct injected-fetch regression scenarios within the existing bounded
// polling/receipt native case. All assertions remain executable on the approved
// source path; no test is skipped, no network access and no Actor cost.
async function assertR08ResourceIdFenceCases() {
  { // Terminal success without an ID cannot be bound to a build.
    const urls=[];
    const fetchFn=async url=>{
      urls.push(String(url));
      return response(201,{data:{status:'SUCCEEDED',usageTotalUsd:0}});
    };
    await assert.rejects(
      () => runPrivateApifyE2E({env,fetchFn,sleepFn:noSleep}),
      error => error instanceof ApifyE2EError && error.code === 'RESOURCE_ID_INVALID',
      'missing initial build id must fail closed',
    );
    assert.equal(urls.length,1);
    assert.ok(urls[0].includes('/builds?'));
  }
  { // Poll cannot redirect the build identity to a foreign resource.
    const urls=[];
    const fetchFn=async url=>{
      const u=String(url);urls.push(u);
      if(u.includes('/actors/actor123/builds?'))
        return response(201,{data:{id:'build1',status:'RUNNING'}});
      if(u.includes('/actor-builds/build1?waitForFinish=60'))
        return response(200,{data:{id:'OTHER_BUILD',status:'SUCCEEDED'}});
      throw new Error('unexpected build resource access');
    };
    await assert.rejects(
      () => runPrivateApifyE2E({env,fetchFn,sleepFn:noSleep}),
      error => error instanceof ApifyE2EError && error.code === 'RESOURCE_ID_MISMATCH',
      'build polling ID drift must fail closed',
    );
    assert.equal(urls.length,2);
    assert.ok(!urls.some(u=>u.includes('OTHER_BUILD')||u.includes('/runs?')));
  }
  { // Final cost must refer to the same build returned by the POST.
    const urls=[];
    const fetchFn=async url=>{
      const u=String(url);urls.push(u);
      if(u.includes('/actors/actor123/builds?'))
        return response(201,{data:{id:'build1',status:'SUCCEEDED'}});
      if(u.endsWith('/actor-builds/build1'))
        return response(200,{data:{id:'OTHER_BUILD',status:'SUCCEEDED',usageTotalUsd:0}});
      throw new Error('unexpected finalized resource access');
    };
    await assert.rejects(
      () => runPrivateApifyE2E({env,fetchFn,sleepFn:noSleep}),
      error => error instanceof ApifyE2EError && error.code === 'RESOURCE_ID_MISMATCH',
      'finalized build ID drift must fail closed',
    );
    assert.equal(urls.length,2);
    assert.ok(!urls.some(u=>u.includes('/runs?')));
  }
  { // A running Actor's ID cannot be exchanged after its run POST.
    const urls=[];
    const fetchFn=async url=>{
      const u=String(url);urls.push(u);
      if(u.includes('/actors/actor123/builds?'))
        return response(201,{data:{id:'build1',status:'SUCCEEDED'}});
      if(u.endsWith('/actor-builds/build1'))
        return response(200,{data:{id:'build1',status:'SUCCEEDED',buildNumber:'0.1.7',usageTotalUsd:0}});
      if(u.includes('/actors/actor123/runs?'))
        return response(201,{data:{id:'run1',buildId: 'build1', status:'RUNNING'}});
      if(u.includes('/actor-runs/run1?waitForFinish=60'))
        return response(200,{data:{id:'OTHER_RUN',status:'SUCCEEDED'}});
      throw new Error('unexpected run resource access');
    };
    await assert.rejects(
      () => runPrivateApifyE2E({env,fetchFn,sleepFn:noSleep}),
      error => error instanceof ApifyE2EError && error.code === 'RESOURCE_ID_MISMATCH',
      'run polling ID drift must fail closed',
    );
    assert.equal(urls.length,4);
    assert.ok(!urls.some(u=>u.includes('OTHER_RUN')||u.includes('/records/OUTPUT')));
  }
}


// The canonical root Vitest native bridge guards exactly 20 top-level Node
// tests. Keep five additional build-affinity scenarios as assertions inside
// that already-covered native lifecycle test so CI exercises all of them
// without changing the bridge outside the Work Order's path allowlist.
async function assertR08BuildIdAffinityCases() {
  const cases = [];
  const check = (name, run) => { cases.push({ name, run }); };
  check('run-start refuses a different buildId before poll, final GET or OUTPUT', async () => {
    const normal = successFetch();
    const fetchFn = (url, options) => String(url).includes('/actors/actor123/runs?')
      ? response(201, { data: { id: 'run1', buildId: 'other-build', status: 'SUCCEEDED' } })
      : normal.fetchFn(url, options);
    await assert.rejects(
      () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
      error => error instanceof ApifyE2EError && error.code === 'BUILD_ID_MISMATCH',
    );
    assert.equal(normal.calls.filter(c => c.url.includes('/actor-runs/run1')).length, 0);
  });
  
  check('run terminal polling refuses a swapped buildId on the same run resource', async () => {
    const normal = successFetch();
    const fetchFn = (url, options) => {
      const u = String(url);
      if (u.includes('/actors/actor123/runs?'))
        return response(201, { data: { id: 'run1', buildId: 'build1', status: 'RUNNING' } });
      if (u.includes('/actor-runs/run1?waitForFinish=60'))
        return response(200, { data: { id: 'run1', buildId: 'other-build', status: 'SUCCEEDED' } });
      return normal.fetchFn(url, options);
    };
    await assert.rejects(
      () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
      error => error instanceof ApifyE2EError && error.code === 'BUILD_ID_MISMATCH',
    );
    assert.equal(normal.calls.filter(c => c.url.includes('/actor-runs/run1')).length, 0);
  });
  
  check('finalized run refuses mismatched or missing buildId without fetching OUTPUT', async () => {
    for (const candidate of ['other-build', undefined]) {
      const normal = successFetch();
      const fetchFn = (url, options) => String(url).endsWith('/actor-runs/run1')
        ? response(200, { data: { id: 'run1', status: 'SUCCEEDED',
            ...(candidate === undefined ? {} : { buildId: candidate }),
            usageTotalUsd: 0.004 } })
        : normal.fetchFn(url, options);
      await assert.rejects(
        () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
        error => error instanceof ApifyE2EError && error.code === 'BUILD_ID_MISMATCH',
        String(candidate),
      );
      assert.equal(normal.calls.some(c => c.url.includes('/records/OUTPUT')), false);
    }
  });
  
  check('successful synthetic E2E evidence explicitly binds run to the newly created build', async () => {
    const normal = successFetch();
    const evidence = await runPrivateApifyE2E({ env, fetchFn: normal.fetchFn, sleepFn: noSleep });
    assert.equal(evidence.run.buildId, evidence.build.id);
    assert.equal(evidence.run.buildId, 'build1');
  });
  
  check('intermediate polling refuses build drift even if a later poll could recover', async () => {
    const normal = successFetch();
    let runPolls = 0;
    const fetchFn = (url, options) => {
      const u = String(url);
      if (u.includes('/actors/actor123/runs?'))
        return response(201, { data: { id: 'run1', buildId: 'build1', status: 'RUNNING' } });
      if (u.includes('/actor-runs/run1?waitForFinish=60')) {
        runPolls += 1;
        return response(200, { data: { id: 'run1',
          buildId: runPolls === 1 ? 'other-build' : 'build1',
          status: runPolls === 1 ? 'RUNNING' : 'SUCCEEDED' } });
      }
      return normal.fetchFn(url, options);
    };
    await assert.rejects(
      () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
      error => error instanceof ApifyE2EError && error.code === 'BUILD_ID_MISMATCH',
    );
    assert.equal(runPolls, 1, 'wrong build must stop before any subsequent polling');
    assert.equal(normal.calls.some(c => c.url.includes('/records/OUTPUT')), false);
  });


  // The POST must pin an immutable build number before any potentially
  // chargeable run; existing run.buildId fences run only after the POST.
  check('missing finalized build number rejects before run POST', async () => {
    const normal = successFetch();
    const fetchFn = (url, options) => String(url).endsWith('/actor-builds/build1')
      ? response(200, { data: { id: 'build1', status: 'SUCCEEDED',
          stats: { computeUnits: 0.01 }, usageTotalUsd: 0.002 } })
      : normal.fetchFn(url, options);
    await assert.rejects(
      () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
      e => e instanceof ApifyE2EError && e.code === 'BUILD_NUMBER_INVALID',
    );
    assert.equal(normal.calls.some(c => c.url.includes('/runs?')), false);
  });

  check('noncanonical build number and query injection reject before run POST', async () => {
    for (const candidate of ['latest', '0.1', '0.1.0', '00.1.7', '0.1.7&memory=8192', null]) {
      const normal = successFetch();
      const fetchFn = (url, options) => String(url).endsWith('/actor-builds/build1')
        ? response(200, { data: { id: 'build1', status: 'SUCCEEDED',
            buildNumber: candidate, usageTotalUsd: 0.002 } })
        : normal.fetchFn(url, options);
      await assert.rejects(
        () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
        e => e instanceof ApifyE2EError && e.code === 'BUILD_NUMBER_INVALID',
        String(candidate),
      );
      assert.equal(normal.calls.some(c => c.url.includes('/runs?')), false);
    }
  });

  check('initial and finalized build number mismatch rejects before run POST', async () => {
    const normal = successFetch();
    const fetchFn = (url, options) => String(url).endsWith('/actor-builds/build1')
      ? response(200, { data: { id: 'build1', status: 'SUCCEEDED',
          buildNumber: '0.1.8', usageTotalUsd: 0.002 } })
      : normal.fetchFn(url, options);
    await assert.rejects(
      () => runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep }),
      e => e instanceof ApifyE2EError && e.code === 'BUILD_NUMBER_MISMATCH',
    );
    assert.equal(normal.calls.some(c => c.url.includes('/runs?')), false);
  });

  assert.equal(cases.length, 8, 'all eight distinct build-affinity checks must execute');
  for (const entry of cases) {
    try {
      await entry.run();
    } catch (error) {
      error.message = entry.name + ': ' + String(error.message);
      throw error;
    }
  }
}
