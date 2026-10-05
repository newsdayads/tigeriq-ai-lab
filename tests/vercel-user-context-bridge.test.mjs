import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../scripts/pc-worker/run-vercel-user-context-deploy-task.ps1', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../scripts/pc-worker/invoke-vercel-user-context-deploy.ps1', import.meta.url), 'utf8');
const operator = readFileSync(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');

describe('Vercel current-user one-shot bridge #3958', () => {
  it('pins the reviewed interactive identity and Scheduled Task security contract', () => {
    expect(bridge).toContain("$TaskName='TigerIQ Vercel LIVE OneShot Deploy'");
    expect(bridge).toContain("$ExpectedUser='pc01\\wdragons12x'");
    expect(bridge).toContain('-LogonType Interactive -RunLevel Highest');
    expect(bridge).toContain('VERCEL_USER_CONTEXT_TASK_COLLISION');
    expect(bridge).toContain('Unregister-ScheduledTask');
  });
  it('uses only the canonical deploy runner and never installs or injects Vercel credentials', () => {
    expect(runner).toContain("vercel-tigeriq-live-3150-deploy.mjs");
    expect(runner).not.toMatch(/\bnpx\b|npm\s+install|VERCEL_TOKEN|\.vercel\\auth|credentials/i);
    expect(bridge).not.toMatch(/\bnpx\b|npm\s+install|VERCEL_TOKEN|credentials/i);
  });
  it('routes the typed deploy action through the fixed user-context bridge', () => {
    expect(operator).toContain("run-vercel-user-context-deploy-task.ps1");
    expect(operator).toContain("'--ExpectedSha', expectedSha");
    expect(operator).toContain("'--ReleaseIssue', releaseIssue");
    expect(operator).toContain("'--ReleaseClass', releaseClass");
    expect(operator).toContain("'--OwnerAuthorized', ownerAuthorized ? 'true' : 'false'");
    expect(operator).toContain("'--ReleaseReason', releaseReason");
  });
});
