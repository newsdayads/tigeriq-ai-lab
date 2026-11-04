import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  actionsResultIdsFromToken,
  shouldPublishGh5135Artifact,
  uploadActionsArtifactArchive,
} from './actions-artifact-runtime.js';

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length) rmSync(tempRoots.pop()!, {recursive:true, force:true});
});

function token(scopes: string): string {
  const header = Buffer.from(JSON.stringify({alg:'none'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({scp:scopes})).toString('base64url');
  return `${header}.${payload}.signature`;
}

describe('GH-5135 GitHub Actions artifact runtime helper', () => {
  it('extracts exactly one Actions.Results run/job scope without exposing token material', () => {
    expect(actionsResultIdsFromToken(token(
      'Actions.Example Actions.Results:run-backend:job-backend',
    ))).toEqual({
      workflowRunBackendId:'run-backend',
      workflowJobRunBackendId:'job-backend',
    });
    expect(() => actionsResultIdsFromToken('bad')).toThrow('ACTIONS_RUNTIME_TOKEN_INVALID');
    expect(() => actionsResultIdsFromToken(token('Actions.Example'))).toThrow(
      'ACTIONS_RESULTS_SCOPE_INVALID',
    );
    expect(() => actionsResultIdsFromToken(token(
      'Actions.Results:a:b Actions.Results:c:d',
    ))).toThrow('ACTIONS_RESULTS_SCOPE_INVALID');
  });

  it('publishes only GH-5135 PRs or main pushes that actually touch UltraCar V2 scope', () => {
    expect(shouldPublishGh5135Artifact(
      'pull_request', {}, 'nv02/gh5135-exact-main-artifact-20261104',
    )).toBe(true);
    expect(shouldPublishGh5135Artifact('pull_request', {}, 'feature/unrelated')).toBe(false);
    expect(shouldPublishGh5135Artifact('push', {
      ref:'refs/heads/main',
      commits:[{modified:['apps/ultracarhcm-v2/app/build.gradle']}],
    }, undefined)).toBe(true);
    expect(shouldPublishGh5135Artifact('push', {
      ref:'refs/heads/main',
      commits:[{modified:['README.md']}],
    }, undefined)).toBe(false);
    expect(shouldPublishGh5135Artifact('push', {
      ref:'refs/heads/other',
      commits:[{modified:['apps/ultracarhcm-v2/app/build.gradle']}],
    }, undefined)).toBe(false);
  });

  it('creates, uploads and finalizes an immutable artifact without sending bearer token to blob storage', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gh5135-artifact-'));
    tempRoots.push(root);
    const archive = join(root, 'artifact.zip');
    writeFileSync(archive, Buffer.from('zip-fixture'));

    const calls: Array<{url:string; init?:RequestInit}> = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({url, init});
      if (url.endsWith('/CreateArtifact')) {
        return new Response(JSON.stringify({
          ok:true,
          signed_upload_url:'https://blob.example/upload?sig=secret',
        }), {status:200, headers:{'Content-Type':'application/json'}});
      }
      if (url.startsWith('https://blob.example/')) return new Response('', {status:201});
      if (url.endsWith('/FinalizeArtifact')) {
        return new Response(JSON.stringify({ok:true, artifact_id:'12345'}), {
          status:200, headers:{'Content-Type':'application/json'},
        });
      }
      return new Response('', {status:404});
    }) as typeof fetch;

    const runtimeToken = token('Actions.Results:run-1:job-2');
    const result = await uploadActionsArtifactArchive(
      archive,
      'ultracarhcm-v2-main-deadbeef',
      {
        ACTIONS_RUNTIME_TOKEN:runtimeToken,
        ACTIONS_RESULTS_URL:'https://results.example/runtime/path',
      },
      fakeFetch,
    );

    expect(result.artifactId).toBe('12345');
    expect(result.archiveBytes).toBe(Buffer.byteLength('zip-fixture'));
    expect(result.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toContain('/CreateArtifact');
    expect((calls[0].init?.headers as Record<string,string>).Authorization).toBe(
      `Bearer ${runtimeToken}`,
    );
    expect(calls[1].url).toContain('blob.example');
    expect((calls[1].init?.headers as Record<string,string>).Authorization).toBeUndefined();
    expect(calls[1].init?.method).toBe('PUT');
    expect(calls[2].url).toContain('/FinalizeArtifact');
  });
});
