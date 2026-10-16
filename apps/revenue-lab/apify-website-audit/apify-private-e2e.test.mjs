import test from 'node:test';
import assert from 'node:assert/strict';
import { runPrivateApifyE2E, ApifyE2EError, safeError, apifyE2ERequestTimeoutMs } from './apify-private-e2e.mjs';

const env = {
  APIFY_TOKEN: 'secret-token-value',
  APIFY_ACTOR_ID: 'actor123',
  APIFY_ACTOR_VERSION: '0.1',
  APIFY_BUILD_TAG: 'latest',
  APIFY_E2E_EXECUTE: 'OWNER_APPROVED_PRIVATE_TEST',
};
const noSleep = async () => {};

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
      return response(201, { data: { id: 'build1', status: 'SUCCEEDED', usageTotalUsd: null } });
    }
    if (u.endsWith('/actor-builds/build1')) {
      return response(200, { data: { id: 'build1', status: 'SUCCEEDED', stats: { computeUnits: 0.01 }, usageTotalUsd: 0.002 } });
    }
    if (u.includes('/actors/actor123/runs?')) {
      return response(201, { data: { id: 'run1', status: 'SUCCEEDED', usageTotalUsd: null } });
    }
    if (u.endsWith('/actor-runs/run1')) {
      return response(200, { data: { id: 'run1', status: 'SUCCEEDED', stats: { computeUnits: 0.02 }, usageTotalUsd: 0.004 } });
    }
    if (u.endsWith('/actor-runs/run1/key-value-store/records/OUTPUT')) {
      return response(200, { schemaVersion: '1.0', status: 'success' });
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
  assert.equal(evidence.cost.totalPlatformCostUSD, 0.006);
  assert.equal(evidence.output.schemaVersion, '1.0');
  assert.ok(written.includes('"totalPlatformCostUSD": 0.006'));
  assert.ok(!written.includes(env.APIFY_TOKEN));
  assert.ok(calls.some(call => call.url.endsWith('/actor-builds/build1')));
  assert.ok(calls.some(call => call.url.endsWith('/actor-runs/run1')));
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 2);
  for (const call of calls) {
    assert.ok(!call.url.includes(env.APIFY_TOKEN));
    assert.equal(call.options.headers.authorization, 'Bearer ' + env.APIFY_TOKEN);
  }
});

// R08-specific trust boundary: an HTTP 200 is not a successful audited result.
test('R08 invalid OUTPUT must never become accepted E2E evidence', async () => {
  for (const badOutput of [
    { schemaVersion: '9000', status: 'success' },
    { schemaVersion: '1.0', status: 'error' },
    { schemaVersion: '1.0', status: 'success', error: 'not-empty' },
    null,
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
      ? response(200, { data: { id: 'run1', status: 'SUCCEEDED',
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
      ? response(200, { data: { id: 'run1', status: 'SUCCEEDED',
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
    if (u.endsWith('/actor-builds/build1')) return response(200, { data: { id: 'build1', status: 'SUCCEEDED', usageTotalUsd: 0.001 } });
    if (u.includes('/actors/actor123/runs?')) return response(201, { data: { id: 'run1', status: 'FAILED', usageTotalUsd: 0.002 } });
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
    if (u.endsWith('/actor-builds/build1')) return response(200, { data: { id: 'build1', status: 'SUCCEEDED', usageTotalUsd: 0.001 } });
    if (u.includes('/actors/actor123/runs?')) return response(201, { data: { id: 'run1', status: 'SUCCEEDED' } });
    if (u.endsWith('/actor-runs/run1')) return response(200, { data: { id: 'run1', status: 'SUCCEEDED' } });
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
    if (u.endsWith('/actor-builds/build1')) return response(200, { data: { id: 'build1', status: 'SUCCEEDED', usageTotalUsd: 0.001 } });
    if (u.includes('/actors/actor123/runs?')) return response(201, { data: { id: 'run1', status: 'RUNNING' } });
    if (u.includes('/actor-runs/run1?waitForFinish=60')) {
      runPoll += 1;
      return response(200, { data: { id: 'run1', status: 'SUCCEEDED' } });
    }
    if (u.endsWith('/actor-runs/run1')) return response(200, { data: { id: 'run1', status: 'SUCCEEDED', usageTotalUsd: 0.002 } });
    if (u.endsWith('/actor-runs/run1/key-value-store/records/OUTPUT')) return response(200, { status: 'success', schemaVersion: '1.0' });
    throw new Error('unexpected URL ' + u);
  };
  const evidence = await runPrivateApifyE2E({ env, fetchFn, sleepFn: noSleep });
  assert.equal(evidence.cost.totalPlatformCostUSD, 0.003);
  assert.equal(buildPoll, 1);
  assert.equal(runPoll, 1);
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
