import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type ActionsResultIds = {
  workflowRunBackendId: string;
  workflowJobRunBackendId: string;
};

type FetchLike = typeof fetch;

const RESULTS_SCOPE_PREFIX = 'Actions.Results:';
const ARTIFACT_SERVICE = 'github.actions.results.api.v1.ArtifactService';
const GH5135_BRANCH_PREFIX = 'nv02/gh5135-';
const ULTRACAR_PATH_PREFIXES = [
  'apps/ultracarhcm-v2/',
  'tests/ultracarhcm-v2/',
] as const;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) throw new Error('ACTIONS_RUNTIME_TOKEN_INVALID');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('ACTIONS_RUNTIME_TOKEN_INVALID');
  }
}

export function actionsResultIdsFromToken(token: string): ActionsResultIds {
  const payload = decodeJwtPayload(token);
  if (typeof payload.scp !== 'string') throw new Error('ACTIONS_RESULTS_SCOPE_MISSING');
  const matches = payload.scp
    .split(' ')
    .filter(scope => scope.startsWith(RESULTS_SCOPE_PREFIX))
    .map(scope => scope.split(':'));
  if (matches.length !== 1 || matches[0].length !== 3 || !matches[0][1] || !matches[0][2]) {
    throw new Error('ACTIONS_RESULTS_SCOPE_INVALID');
  }
  return {
    workflowRunBackendId: matches[0][1],
    workflowJobRunBackendId: matches[0][2],
  };
}

function changedPaths(event: Record<string, unknown>): string[] {
  const commits = Array.isArray(event.commits) ? event.commits : [];
  const paths: string[] = [];
  for (const raw of commits) {
    if (!raw || typeof raw !== 'object') continue;
    const commit = raw as Record<string, unknown>;
    for (const key of ['added', 'modified', 'removed'] as const) {
      const entries = Array.isArray(commit[key]) ? commit[key] : [];
      for (const entry of entries) if (typeof entry === 'string') paths.push(entry);
    }
  }
  return paths;
}

export function shouldPublishGh5135Artifact(
  eventName: string | undefined,
  event: Record<string, unknown>,
  headRef: string | undefined,
): boolean {
  if (eventName === 'pull_request') {
    return typeof headRef === 'string' && headRef.startsWith(GH5135_BRANCH_PREFIX);
  }
  if (eventName !== 'push' || event.ref !== 'refs/heads/main') return false;
  return changedPaths(event).some(path =>
    ULTRACAR_PATH_PREFIXES.some(prefix => path.startsWith(prefix)),
  );
}

function twirpUrl(resultsUrl: string, method: string): string {
  let origin: string;
  try {
    origin = new URL(resultsUrl).origin;
  } catch {
    throw new Error('ACTIONS_RESULTS_URL_INVALID');
  }
  return new URL(`/twirp/${ARTIFACT_SERVICE}/${method}`, origin).href;
}

async function jsonPost(
  url: string,
  token: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`ACTIONS_ARTIFACT_RPC_FAILED:${response.status}`);
  const parsed = await response.json();
  if (!parsed || typeof parsed !== 'object') throw new Error('ACTIONS_ARTIFACT_RPC_INVALID_RESPONSE');
  return parsed as Record<string, unknown>;
}

export type UploadedArtifact = {
  artifactId: string;
  archiveBytes: number;
  archiveSha256: string;
};

export async function uploadActionsArtifactArchive(
  archivePath: string,
  artifactName: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<UploadedArtifact> {
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(artifactName)) {
    throw new Error('ACTIONS_ARTIFACT_NAME_INVALID');
  }
  const token = env.ACTIONS_RUNTIME_TOKEN;
  const resultsUrl = env.ACTIONS_RESULTS_URL;
  if (!token || !resultsUrl) throw new Error('ACTIONS_ARTIFACT_RUNTIME_UNAVAILABLE');

  const ids = actionsResultIdsFromToken(token);
  const archive = readFileSync(archivePath);
  if (archive.length === 0) throw new Error('ACTIONS_ARTIFACT_ARCHIVE_EMPTY');
  const archiveSha256 = createHash('sha256').update(archive).digest('hex');

  const common = {
    workflow_run_backend_id: ids.workflowRunBackendId,
    workflow_job_run_backend_id: ids.workflowJobRunBackendId,
    name: artifactName,
  };
  const created = await jsonPost(
    twirpUrl(resultsUrl, 'CreateArtifact'),
    token,
    {...common, version: 4},
    fetchImpl,
  );
  if (created.ok !== true || typeof created.signed_upload_url !== 'string' || !created.signed_upload_url) {
    throw new Error('ACTIONS_ARTIFACT_CREATE_REJECTED');
  }

  const upload = await fetchImpl(created.signed_upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/zip',
      'x-ms-blob-type': 'BlockBlob',
    },
    body: archive,
  });
  if (!upload.ok) throw new Error(`ACTIONS_ARTIFACT_BLOB_UPLOAD_FAILED:${upload.status}`);

  const finalized = await jsonPost(
    twirpUrl(resultsUrl, 'FinalizeArtifact'),
    token,
    {...common, size: String(archive.length)},
    fetchImpl,
  );
  if (finalized.ok !== true || !['string', 'number'].includes(typeof finalized.artifact_id)) {
    throw new Error('ACTIONS_ARTIFACT_FINALIZE_REJECTED');
  }

  return {
    artifactId: String(finalized.artifact_id),
    archiveBytes: archive.length,
    archiveSha256,
  };
}
