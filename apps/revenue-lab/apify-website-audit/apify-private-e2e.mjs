import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

export class ApifyE2EError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ApifyE2EError';
    this.code = code;
    this.detail = detail;
  }
}

const encode = value => encodeURIComponent(String(value));

function redactText(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(Boolean)) {
    text = text.split(String(secret)).join('[REDACTED]');
  }
  return text;
}

function envConfig(env = process.env) {
  const token = String(env.APIFY_TOKEN || '').trim();
  const actorId = String(env.APIFY_ACTOR_ID || '').trim();
  if (!token) throw new ApifyE2EError('AUTH_MISSING', 'APIFY_TOKEN is required in the authorized execution environment.');
  if (!actorId) throw new ApifyE2EError('ACTOR_ID_MISSING', 'APIFY_ACTOR_ID is required after Owner bootstrap.');
  if (String(env.APIFY_E2E_EXECUTE || '').trim() !== 'OWNER_APPROVED_PRIVATE_TEST') {
    throw new ApifyE2EError('EXECUTION_GATE_REQUIRED', 'Set APIFY_E2E_EXECUTE=OWNER_APPROVED_PRIVATE_TEST only in the authorized execution environment.');
  }

  return {
    token,
    actorId,
    version: String(env.APIFY_ACTOR_VERSION || '0.1').trim(),
    buildTag: String(env.APIFY_BUILD_TAG || 'latest').trim(),
    apiBase: 'https://api.apify.com/v2',
    evidencePath: String(env.APIFY_EVIDENCE_PATH || '').trim() || null,
  };
}

async function requestJson(fetchFn, url, { token, method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetchFn(url, {
      method,
      redirect: 'follow',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        authorization: `Bearer ${token}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new ApifyE2EError('NETWORK_FAILURE', 'Apify API request failed.', redactText(error?.message, [token]));
  }

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }

  if (!response.ok) {
    const safe = redactText(
      typeof parsed === 'string' ? parsed : JSON.stringify(parsed),
      [token],
    );
    throw new ApifyE2EError('API_HTTP_ERROR', `Apify API returned HTTP ${response.status}.`, {
      status: response.status,
      body: safe.slice(0, 2000),
    });
  }
  return parsed;
}

function dataOf(payload) {
  return payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
}

async function waitTerminal({ kind, initial, fetchFn, config, maxPolls = 4 }) {
  let item = initial;
  for (let attempt = 0; attempt <= maxPolls; attempt += 1) {
    if (TERMINAL.has(item?.status)) return item;
    if (!item?.id) throw new ApifyE2EError('MISSING_RESOURCE_ID', `${kind} response did not contain an id.`);
    const path = kind === 'build' ? 'actor-builds' : 'actor-runs';
    item = dataOf(await requestJson(
      fetchFn,
      `${config.apiBase}/${path}/${encode(item.id)}?waitForFinish=60`,
      { token: config.token },
    ));
  }
  throw new ApifyE2EError('TERMINAL_TIMEOUT', `${kind} did not reach a terminal state within bounded polling.`);
}

function usageCost(item, kind) {
  const value = item?.usageTotalUsd;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ApifyE2EError(
      'COST_EVIDENCE_MISSING',
      `Authenticated terminal ${kind} response did not contain a valid usageTotalUsd.`,
    );
  }
  return value;
}

function computeUnits(item) {
  const candidates = [item?.stats?.computeUnits, item?.usage?.ACTOR_COMPUTE_UNITS];
  const value = candidates.find(candidate => typeof candidate === 'number' && Number.isFinite(candidate));
  return value ?? null;
}

export async function runPrivateApifyE2E({
  env = process.env,
  fetchFn = globalThis.fetch,
  writeFileFn = fs.writeFile,
  now = () => new Date().toISOString(),
  apiBaseOverride = null,
} = {}) {
  if (typeof fetchFn !== 'function') throw new ApifyE2EError('FETCH_UNAVAILABLE', 'A fetch implementation is required.');
  const config = envConfig(env);
  if (apiBaseOverride) config.apiBase = String(apiBaseOverride).replace(/\/$/, '');

  const buildParams = new URLSearchParams({
    version: config.version,
    tag: config.buildTag,
    waitForFinish: '60',
  });
  const buildInitial = dataOf(await requestJson(
    fetchFn,
    `${config.apiBase}/actors/${encode(config.actorId)}/builds?${buildParams}`,
    { token: config.token, method: 'POST' },
  ));
  const build = await waitTerminal({ kind: 'build', initial: buildInitial, fetchFn, config });
  if (build.status !== 'SUCCEEDED') {
    throw new ApifyE2EError('BUILD_FAILED', `Private Actor build finished with status ${build.status}.`, {
      buildId: build.id ?? null,
      status: build.status ?? null,
    });
  }
  const buildCost = usageCost(build, 'build');

  const runParams = new URLSearchParams({
    build: config.buildTag,
    waitForFinish: '60',
    timeout: '60',
    memory: '256',
    restartOnError: 'false',
    forcePermissionLevel: 'LIMITED_PERMISSIONS',
  });
  const runInput = {
    url: 'https://example.com',
    maxPages: 1,
    timeoutMs: 8000,
    maxBytes: 1048576,
    maxRedirects: 3,
    requestDelayMs: 0,
  };
  const runInitial = dataOf(await requestJson(
    fetchFn,
    `${config.apiBase}/actors/${encode(config.actorId)}/runs?${runParams}`,
    { token: config.token, method: 'POST', body: runInput },
  ));
  const run = await waitTerminal({ kind: 'run', initial: runInitial, fetchFn, config });
  if (run.status !== 'SUCCEEDED') {
    throw new ApifyE2EError('RUN_FAILED', `Private Actor run finished with status ${run.status}.`, {
      runId: run.id ?? null,
      status: run.status ?? null,
    });
  }
  const runCost = usageCost(run, 'run');

  const output = await requestJson(
    fetchFn,
    `${config.apiBase}/actor-runs/${encode(run.id)}/key-value-store/records/OUTPUT`,
    { token: config.token },
  );

  const evidence = {
    schema: 'TIGERIQ_APIFY_PRIVATE_E2E_V1',
    verifiedAt: now(),
    actor: {
      version: config.version,
      buildTag: config.buildTag,
      permissionLevel: 'LIMITED_PERMISSIONS',
      access: 'RESTRICTED_EXPECTED',
    },
    build: {
      id: build.id ?? null,
      status: build.status,
      computeUnits: computeUnits(build),
      usageTotalUsd: buildCost,
    },
    run: {
      id: run.id ?? null,
      status: run.status,
      computeUnits: computeUnits(run),
      usageTotalUsd: runCost,
    },
    output: {
      status: output?.status ?? null,
      schemaVersion: output?.schemaVersion ?? null,
    },
    cost: {
      buildUsageTotalUsd: buildCost,
      runUsageTotalUsd: runCost,
      totalPlatformCostUSD: Number((buildCost + runCost).toFixed(8)),
      source: 'APIFY_AUTHENTICATED_USAGE_TOTAL_USD',
    },
    safety: {
      actorCreationOrUpdate: false,
      publicPublish: false,
      paidPublish: false,
      kycOrPayout: false,
      secretIncluded: false,
    },
  };

  const serialized = JSON.stringify(evidence, null, 2) + '\n';
  if (config.evidencePath) await writeFileFn(config.evidencePath, serialized, 'utf8');
  return evidence;
}

function safeError(error, env = process.env) {
  const token = String(env.APIFY_TOKEN || '');
  return {
    schema: 'TIGERIQ_APIFY_PRIVATE_E2E_ERROR_V1',
    code: error?.code || 'UNEXPECTED',
    message: redactText(error?.message || error, [token]),
    detail: error?.detail
      ? JSON.parse(redactText(JSON.stringify(error.detail), [token]))
      : null,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  runPrivateApifyE2E()
    .then(evidence => console.log(JSON.stringify(evidence)))
    .catch(error => {
      console.error(JSON.stringify(safeError(error)));
      process.exitCode = 1;
    });
}

export { safeError };
