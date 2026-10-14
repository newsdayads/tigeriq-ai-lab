import { describe, expect, it } from 'vitest';
import { nv07CanonicalRepoPath, nv07ProposalPreflight } from '../apps/shared/nv07-proposal-preflight.mjs';

const make = (overrides = {}) => ({
  employeeId: 'NV07', executionHost: 'PC01', repository: 'newsdayads/tigeriq-ai-lab',
  priority: 'P2', action: 'PROPOSE_CHANGE', jobId: 'GH-4786:S3',
  sourceSha: 'a'.repeat(40), paths: ['docs/implementation/nv07-proposal.md'],
  ...overrides,
});

describe('NV07 proposal-only preflight (not runtime authorization)', () => {
  it('allows only a pinned, bounded read-only proposal, not source mutation', () => {
    const answer = nv07ProposalPreflight(make());
    expect(answer).toMatchObject({ allowed: true, mode: 'PROPOSAL_ONLY', code: 'NV07_PROPOSAL_SCOPE_ACCEPTED' });
    expect(answer.paths).toEqual(['docs/implementation/nv07-proposal.md']);
    expect(answer.note).toContain('separately verify live lease');
    expect(nv07ProposalPreflight(make({ action: 'READ_METADATA' })).allowed).toBe(true);
  });
  it.each([
    ['wrong employee', { employeeId: 'NV03' }, 'NV07_EMPLOYEE_MISMATCH'],
    ['wrong execution host', { executionHost: 'GitHub' }, 'NV07_RUNTIME_SCOPE_DENIED'],
    ['wrong repository', { repository: 'newsdayads/drivetrack' }, 'NV07_RUNTIME_SCOPE_DENIED'],
    ['P0', { priority: 'P0' }, 'NV07_P0_OR_PRIORITY_DENIED'],
    ['unbound priority', { priority: 'P6' }, 'NV07_P0_OR_PRIORITY_DENIED'],
    ['direct file write', { action: 'WRITE_SOURCE' }, 'NV07_PC01_WRITE_OR_UNKNOWN_ACTION_DENIED'],
    ['build', { action: 'RUN_BUILD' }, 'NV07_PC01_WRITE_OR_UNKNOWN_ACTION_DENIED'],
    ['direct push', { action: 'GIT_PUSH' }, 'NV07_PC01_WRITE_OR_UNKNOWN_ACTION_DENIED'],
    ['missing job ID', { jobId: '' }, 'NV07_JOB_ID_REQUIRED'],
    ['unpinned SHA', { sourceSha: 'main' }, 'NV07_PINNED_SOURCE_REQUIRED'],
    ['paid', { paid: true }, 'NV07_HARD_GATE_DENIED'],
    ['new credential', { credentialChange: true }, 'NV07_HARD_GATE_DENIED'],
    ['security change', { securityBoundaryChange: true }, 'NV07_HARD_GATE_DENIED'],
    ['production release', { productionRelease: true }, 'NV07_HARD_GATE_DENIED'],
    ['destructive', { destructive: true }, 'NV07_HARD_GATE_DENIED'],
    ['administrator', { osAdmin: true }, 'NV07_HARD_GATE_DENIED'],
    ['permission bypass', { cliFlags: '--dangerously-skip-permissions' }, 'NV07_CLI_PERMISSION_BYPASS_DENIED'],
    ['too many paths', { paths: Array.from({ length: 31 }, (_, n) => 'docs/example' + n + '.md') }, 'NV07_PATH_SCOPE_REQUIRED'],
    ['missing paths', { paths: [] }, 'NV07_PATH_SCOPE_REQUIRED'],
    ['App Chrome path', { paths: ['apps/chrome-controller/src/server.ts'] }, 'NV07_APP_CHROME_DENIED'],
    ['App Chrome local-only script', { paths: ['scripts/tigeriq-core/appchrome-zero-touch.ps1'] }, 'NV07_APP_CHROME_DENIED'],
    ['Core protected path', { paths: ['apps/tigeriq-core/core.mjs'] }, 'NV07_PROTECTED_CONTROL_DENIED'],
    ['workflow protected path', { paths: ['.github/workflows/ci.yml'] }, 'NV07_PROTECTED_CONTROL_DENIED'],
    ['secret file', { paths: ['.env.local'] }, 'NV07_SECRET_PATH_DENIED'],
    ['token folder', { paths: ['config/tokens/thing.txt'] }, 'NV07_SECRET_PATH_DENIED'],
    ['private key', { paths: ['certs/server.pem'] }, 'NV07_SECRET_PATH_DENIED'],
    ['relative traversal', { paths: ['docs/../.env'] }, 'NV07_PATH_TRAVERSAL_DENIED'],
    ['absolute Windows path', { paths: ['C:\\Users\\wdragons12x\\file.txt'] }, 'NV07_PATH_TRAVERSAL_DENIED'],
    ['UNC share', { paths: ['\\\\server\\share\\thing'] }, 'NV07_PATH_TRAVERSAL_DENIED'],
    ['leading dot segment', { paths: ['./docs/a.md'] }, 'NV07_PATH_TRAVERSAL_DENIED'],
  ])('denies %s', (_label, change, expectedCode) => {
    expect(nv07ProposalPreflight(make(change))).toMatchObject({ allowed: false, mode: 'DENY', code: expectedCode });
  });
  it.each([
    "--dangerously-skip-permissions=true",
    "--dangerously-skip-permissions=false",
    "--yolo=true",
    "--allow-all=true",
    "--approval-mode=\"yolo\"",
    "--approval-mode='yolo'",
    "--approval-mode \"yolo\"",
    "--approval-mode 'yolo'",
    "\"--yolo=true\"",
    "'--allow-all=true'",
    "--output-format json --dangerously-skip-permissions=true"
])('denies value/quoted permission bypass form %s', (cliFlags) => {
    expect(nv07ProposalPreflight(make({ cliFlags }))).toMatchObject({
      allowed: false, mode: 'DENY', code: 'NV07_CLI_PERMISSION_BYPASS_DENIED',
    });
  });
  it('keeps harmless output-format options eligible for a proposal', () => {
    for (const cliFlags of ['--output-format json', '--output-format=json']) {
      expect(nv07ProposalPreflight(make({ cliFlags })).allowed).toBe(true);
    }
  });
  it('normalizes Windows repo separators without permitting escape', () => {
    expect(nv07CanonicalRepoPath('docs\\implementation\\a.md')).toBe('docs/implementation/a.md');
    expect(nv07CanonicalRepoPath('docs/../../private')).toBeNull();
    expect(nv07CanonicalRepoPath('/etc/passwd')).toBeNull();
  });
});
