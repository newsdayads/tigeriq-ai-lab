import { describe, expect, it } from 'vitest';
import { validateReleaseContract } from '../scripts/pc-worker/vercel-tigeriq-live-3150-deploy.mjs';

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
  uiHtml: '<html>JOB TRỌNG TÂM</html>',
  releaseClass: 'WEB_LIVE',
  ownerAuthorized: 'true',
  releaseReason: 'Publish owner-facing TigerIQ LIVE update',
  changedFiles: ['command-center.html'],
};

describe('Vercel web-hosting-only hard boundary #3897', () => {
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
