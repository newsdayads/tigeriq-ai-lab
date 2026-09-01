import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateGitHubActionsClaims, verifyGitHubActionsOidc } from '../api/github-actions-oidc.mjs';

const REPO = 'newsdayads/tigeriq-ai-lab';
const WORKFLOW_REF = `${REPO}/.github/workflows/auto-work.yml@refs/heads/main`;
const NOW_MS = Date.parse('2026-09-01T15:50:00Z');
const NOW = Math.floor(NOW_MS / 1000);
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };

function claims(overrides = {}) {
  return {
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'tigeriq-auto-work',
    repository: REPO,
    workflow: 'TigerIQ Auto Work',
    workflow_ref: WORKFLOW_REF,
    ref: 'refs/heads/main',
    event_name: 'schedule',
    runner_environment: 'github-hosted',
    iat: NOW - 10,
    nbf: NOW - 10,
    exp: NOW + 300,
    ...overrides,
  };
}

function token(payload = claims(), mutateSignature = false) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const input = `${header}.${body}`;
  const signature = sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
  const finalSignature = mutateSignature ? `${signature.slice(0, -2)}aa` : signature;
  return `${input}.${finalSignature}`;
}

const fetchImpl = async () => ({ ok: true, async json() { return { keys: [jwk] }; } });
const options = {
  repository: REPO,
  audience: 'tigeriq-auto-work',
  workflowRef: WORKFLOW_REF,
  ref: 'refs/heads/main',
  eventNames: ['schedule', 'workflow_dispatch'],
  nowMs: NOW_MS,
  fetchImpl,
};

describe('GitHub Actions OIDC Auto Work wake', () => {
  it('accepts a valid signed token bound to repository, workflow, main ref and audience', async () => {
    await expect(verifyGitHubActionsOidc(token(), options)).resolves.toEqual(expect.objectContaining({
      repository: REPO,
      workflow_ref: WORKFLOW_REF,
      ref: 'refs/heads/main',
      aud: 'tigeriq-auto-work',
    }));
  });

  it('rejects wrong audience/repository/workflow/ref/event and expired claims', () => {
    for (const payload of [
      claims({ aud: 'wrong-audience' }),
      claims({ repository: 'attacker/repo' }),
      claims({ workflow_ref: `${REPO}/.github/workflows/other.yml@refs/heads/main` }),
      claims({ ref: 'refs/heads/feature' }),
      claims({ event_name: 'pull_request' }),
      claims({ exp: NOW - 60 }),
    ]) {
      expect(() => validateGitHubActionsClaims(payload, options)).toThrow(/github_oidc_/);
    }
  });

  it('rejects a token whose cryptographic signature was modified', async () => {
    await expect(verifyGitHubActionsOidc(token(claims(), true), options)).rejects.toThrow('github_oidc_bad_signature');
  });

  it('never exports the GitHub repository-write token to Vercel', () => {
    const workflow = readFileSync(new URL('../.github/workflows/auto-work.yml', import.meta.url), 'utf8');
    const wake = readFileSync(new URL('../api/auto-work-wake.mjs', import.meta.url), 'utf8');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('/api/auto-work-wake');
    expect(workflow).toContain('ACTIONS_ID_TOKEN_REQUEST_TOKEN');
    expect(workflow).toContain('TIGERIQ_OIDC_AUDIENCE: tigeriq-auto-work');
    expect(workflow).not.toContain('issues: write');
    expect(workflow).not.toContain('github.token');
    expect(workflow).not.toContain('GITHUB_JOB_TOKEN');
    expect(wake).toContain("@refs/heads/main`");
    expect(wake).toContain("headers['x-tigeriq-secret'] = COMMAND_SECRET");
    expect(wake).toContain("headers.authorization = ''");
  });
});
