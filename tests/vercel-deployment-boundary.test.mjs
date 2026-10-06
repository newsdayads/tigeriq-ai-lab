import { describe, expect, it } from 'vitest';
import { deploymentEndpoint, deploymentRequestForGitSource, githubAuthorLoginFromEmail, validateReleaseContract } from '../scripts/pc-worker/vercel-tigeriq-live-3150-deploy.mjs';

const base = {
  projectLink: {
    projectId: 'prj_gg7AuV6y62TALzEpby8XUAFisLKw',
    orgId: 'team_K8HIG7zmwu0ZjCINX1VhlGiT',
  },
  expectedSha: 'a'.repeat(40),
  actualSha: 'a'.repeat(40),
  branch: 'main',
  mainRefSha: 'a'.repeat(40),
  remote: 'https://github.com/newsdayads/tigeriq-ai-lab.git',
  config: { git: { deploymentEnabled: false } },
  issue: '3897',
  uiHtml: '<html><link rel="stylesheet" href="/work-ui.css"></html>',
  releaseClass: 'WEB_LIVE',
  ownerAuthorized: 'true',
  releaseReason: 'Publish owner-facing TigerIQ LIVE update',
  changedFiles: ['command-center.html'],
};

describe('Vercel web-hosting-only hard boundary #3897', () => {
  it('derives a verified GitHub login from the canonical noreply author email', () => {
    expect(githubAuthorLoginFromEmail('125233768+newsdayads@users.noreply.github.com')).toBe('newsdayads');
    expect(() => githubAuthorLoginFromEmail('unknown@example.com')).toThrow('VERCEL_GITHUB_AUTHOR_LOGIN_UNRESOLVED');
  });

  it('uses a Windows-safe Vercel API endpoint with team scope', () => {
    const endpoint = deploymentEndpoint();
    expect(endpoint).toBe('/v13/deployments?teamId=team_K8HIG7zmwu0ZjCINX1VhlGiT');
    expect(endpoint).not.toContain('&');
  });

  it('builds an exact production Git-source deployment request', () => {
    const request = deploymentRequestForGitSource(
      { exactSha: 'a'.repeat(40), issue: '4311' },
      {
        authorLogin: 'newsdayads',
        authorEmail: '125233768+newsdayads@users.noreply.github.com',
        authorName: 'Nguyễn Trường Sơn',
        commitMessage: 'release',
      },
    );
    expect(request).toMatchObject({
      project: 'prj_gg7AuV6y62TALzEpby8XUAFisLKw',
      target: 'production',
      gitSource: {
        type: 'github',
        org: 'newsdayads',
        repo: 'tigeriq-ai-lab',
        ref: 'main',
        sha: 'a'.repeat(40),
      },
      gitMetadata: {
        ciGitProviderUsername: 'newsdayads',
        commitSha: 'a'.repeat(40),
        commitRef: 'main',
      },
      meta: {
        tigeriqReleaseIssue: '4311',
        tigeriqReleaseClass: 'WEB_LIVE',
        tigeriqExactSha: 'a'.repeat(40),
      },
    });
    expect(() => deploymentRequestForGitSource(
      { exactSha: 'b'.repeat(40), issue: '4311' },
      { authorLogin: '', authorEmail: '', authorName: '' },
    )).toThrow('VERCEL_GIT_METADATA_INCOMPLETE');
  });

  it('allows only an explicitly authorized real web release contract', () => {
    expect(validateReleaseContract(base)).toMatchObject({
      target: 'production',
      issue: '3897',
      releaseClass: 'WEB_LIVE',
    });
  });

  it.each([
    [{ releaseClass: 'CORE' }, 'VERCEL_RELEASE_CLASS_INVALID'],
    [{ ownerAuthorized: 'false' }, 'VERCEL_OWNER_RELEASE_AUTH_REQUIRED'],
    [{ releaseReason: '' }, 'VERCEL_RELEASE_REASON_REQUIRED'],
    [{ issue: '' }, 'VERCEL_RELEASE_ISSUE_REQUIRED'],
    [{ changedFiles: ['apps/tigeriq-core/router.mjs'] }, 'VERCEL_WEB_ARTIFACT_CHANGE_REQUIRED'],
    [{ uiHtml: '<html>legacy live without shared stylesheet</html>' }, 'VERCEL_UI_MARKER_MISSING'],
  ])('fails closed for non-web or unauthorized deployment: %o', (override, code) => {
    expect(() => validateReleaseContract({ ...base, ...override })).toThrow(code);
  });

  it.each([
    { branch: '', mainRefSha: 'a'.repeat(40) },
    { branch: 'core-runtime-sync', mainRefSha: 'a'.repeat(40) },
  ])('allows an isolated source when HEAD is exactly origin/main: %o', (override) => {
    expect(validateReleaseContract({ ...base, ...override })).toMatchObject({
      sourceMode: 'exact-remote-main-source',
      exactSha: 'a'.repeat(40),
    });
  });

  it.each([
    [{ branch: '', mainRefSha: 'b'.repeat(40) }, 'VERCEL_GIT_BRANCH_MISMATCH'],
    [{ branch: 'feature/not-main', mainRefSha: 'b'.repeat(40) }, 'VERCEL_GIT_BRANCH_MISMATCH'],
  ])('rejects a non-main source identity: %o', (override, code) => {
    expect(() => validateReleaseContract({ ...base, ...override })).toThrow(code);
  });

  it('keeps Git auto-deploy disabled', () => {
    expect(() => validateReleaseContract({
      ...base,
      config: { git: { deploymentEnabled: true } },
    })).toThrow('VERCEL_AUTO_DEPLOY_POLICY_MISMATCH');
  });
});
