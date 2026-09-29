import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://api.apify.com/v2';

export class ApifyPreflightError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ApifyPreflightError';
    this.code = code;
    this.detail = detail;
  }
}

const encode = value => encodeURIComponent(String(value));

function redactText(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(Boolean)) text = text.split(String(secret)).join('[REDACTED]');
  return text;
}

function envConfig(env = process.env) {
  const token = String(env.APIFY_TOKEN || '').trim();
  const actorId = String(env.APIFY_ACTOR_ID || '').trim();
  if (!token) throw new ApifyPreflightError('AUTH_MISSING', 'APIFY_TOKEN is required in the authorized execution environment.');
  if (!actorId) throw new ApifyPreflightError('ACTOR_ID_MISSING', 'APIFY_ACTOR_ID is required after Owner bootstrap.');
  if (String(env.APIFY_PREFLIGHT_EXECUTE || '').trim() !== 'OWNER_APPROVED_PRIVATE_PREFLIGHT') {
    throw new ApifyPreflightError(
      'EXECUTION_GATE_REQUIRED',
      'Set APIFY_PREFLIGHT_EXECUTE=OWNER_APPROVED_PRIVATE_PREFLIGHT only in the authorized execution environment.',
    );
  }
  return {
    token,
    actorId,
    expectedVersion: String(env.APIFY_ACTOR_VERSION || '0.1').trim(),
    evidencePath: String(env.APIFY_PREFLIGHT_EVIDENCE_PATH || '').trim() || null,
  };
}

async function requestJson(fetchFn, url, token, { allowForbidden = false } = {}) {
  let response;
  try {
    response = await fetchFn(url, {
      method: 'GET',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    throw new ApifyPreflightError(
      'NETWORK_FAILURE',
      'Apify API request failed.',
      redactText(error?.message, [token]),
    );
  }

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }

  if (response.status === 403 && allowForbidden) {
    return { __scopedForbidden: true };
  }

  if (!response.ok) {
    const safe = redactText(
      typeof parsed === 'string' ? parsed : JSON.stringify(parsed),
      [token],
    );
    throw new ApifyPreflightError('API_HTTP_ERROR', `Apify API returned HTTP ${response.status}.`, {
      status: response.status,
      body: safe.slice(0, 2000),
    });
  }

  return parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed;
}

function versionNumbers(actor) {
  const versions = Array.isArray(actor?.versions) ? actor.versions : [];
  return versions
    .map(version => String(version?.versionNumber || '').trim())
    .filter(Boolean);
}

export async function runPrivateApifyPreflight({
  env = process.env,
  fetchFn = globalThis.fetch,
  writeFileFn = fs.writeFile,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof fetchFn !== 'function') throw new ApifyPreflightError('FETCH_UNAVAILABLE', 'A fetch implementation is required.');
  const config = envConfig(env);

  const user = await requestJson(fetchFn, `${API_BASE}/users/me`, config.token, { allowForbidden: true });
  const account = user?.__scopedForbidden
    ? { status: 'SKIPPED_SCOPED_FORBIDDEN' }
    : (user?.id && user?.username
      ? { status: 'VERIFIED', id: user.id, username: user.username }
      : (() => { throw new ApifyPreflightError('ACCOUNT_IDENTITY_MISSING', 'Authenticated user response is missing id or username.'); })());

  const actor = await requestJson(
    fetchFn,
    `${API_BASE}/actors/${encode(config.actorId)}`,
    config.token,
  );
  if (!actor?.id || !actor?.name || !actor?.username) {
    throw new ApifyPreflightError('ACTOR_IDENTITY_MISSING', 'Actor response is missing id, name, or username.');
  }
  if (actor.isPublic !== false) {
    throw new ApifyPreflightError('ACTOR_NOT_PRIVATE', 'Actor must remain private before E2E.', {
      actorId: actor.id,
      isPublic: actor.isPublic ?? null,
    });
  }
  if (actor.actorPermissionLevel !== 'LIMITED_PERMISSIONS') {
    throw new ApifyPreflightError('ACTOR_PERMISSION_TOO_BROAD', 'Actor must use LIMITED_PERMISSIONS before E2E.', {
      actorId: actor.id,
      actorPermissionLevel: actor.actorPermissionLevel ?? null,
    });
  }

  const versions = versionNumbers(actor);
  if (!versions.length) {
    throw new ApifyPreflightError('ACTOR_VERSION_MISSING', 'Actor has no visible version in the authenticated response.');
  }
  if (config.expectedVersion && !versions.includes(config.expectedVersion)) {
    throw new ApifyPreflightError('EXPECTED_VERSION_MISSING', 'Expected private Actor version is not present.', {
      expectedVersion: config.expectedVersion,
      availableVersions: versions.slice(0, 20),
    });
  }

  const evidence = {
    schema: 'TIGERIQ_APIFY_PRIVATE_PREFLIGHT_V1',
    verifiedAt: now(),
    account,
    actor: {
      id: actor.id,
      name: actor.name,
      username: actor.username,
      isPublic: false,
      actorPermissionLevel: 'LIMITED_PERMISSIONS',
      expectedVersion: config.expectedVersion,
      expectedVersionPresent: true,
      versionCount: versions.length,
    },
    permissions: {
      readAccess: 'VERIFIED_BY_GET',
      buildPermission: 'UNVERIFIED_UNTIL_E2E',
      runPermission: 'UNVERIFIED_UNTIL_E2E',
    },
    safety: {
      apiOrigin: API_BASE,
      methodsUsed: ['GET'],
      buildTriggered: false,
      runTriggered: false,
      actorMutation: false,
      secretIncluded: false,
    },
  };

  const serialized = JSON.stringify(evidence, null, 2) + '\n';
  if (config.evidencePath) await writeFileFn(config.evidencePath, serialized, 'utf8');
  return evidence;
}

export function safePreflightError(error, env = process.env) {
  const token = String(env.APIFY_TOKEN || '');
  let detail = null;
  if (error?.detail !== null && error?.detail !== undefined) {
    const safe = redactText(JSON.stringify(error.detail), [token]);
    try { detail = JSON.parse(safe); } catch { detail = safe; }
  }
  return {
    schema: 'TIGERIQ_APIFY_PRIVATE_PREFLIGHT_ERROR_V1',
    code: error?.code || 'UNEXPECTED',
    message: redactText(error?.message || error, [token]),
    detail,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  runPrivateApifyPreflight()
    .then(evidence => console.log(JSON.stringify(evidence)))
    .catch(error => {
      console.error(JSON.stringify(safePreflightError(error)));
      process.exitCode = 1;
    });
}
