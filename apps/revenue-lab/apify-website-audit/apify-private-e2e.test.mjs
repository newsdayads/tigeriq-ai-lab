import test from 'node:test';
import assert from 'node:assert/strict';
import { runPrivateApifyE2E, ApifyE2EError, safeError } from './apify-private-e2e.mjs';

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
