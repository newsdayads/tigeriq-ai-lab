import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildNv03ReviewPrompt,
  buildNv04Request,
  inputRevision,
  nv03InputRevision,
  eligibleNv03ReviewIssue,
  eligibleNv04Issue,
  parseNv04Result,
  renderNv04GithubComment,
  renderNv04Request,
  validateNv04Result,
  type GithubIssueLike,
} from '../apps/chrome-controller/src/nv03-nv04-coordination.js';
import { Nv04DriveTransport } from '../apps/chrome-controller/src/nv04-drive-transport.js';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function issue(body: string, title = '[P1][REVIEW] Check PR', number = 100): GithubIssueLike {
  return {
    number,
    title,
    body,
    html_url: `https://github.com/newsdayads/tigeriq-ai-lab/issues/${number}`,
    state: 'open',
  };
}

describe('NV03/NV04 isolated coordination', () => {
  it('keeps P0 fail-closed unless Owner marked direct/control', () => {
    const base = 'PRIORITY=P0\nRESOURCE_SCOPE=R\nREVIEW_ONLY=true\nTARGET_EMPLOYEE=NV03';
    expect(eligibleNv03ReviewIssue(issue(base, '[P0][REVIEW] review'))).toBe(false);
    expect(eligibleNv03ReviewIssue(issue(base + '\nOWNER_DIRECT=true', '[P0][REVIEW] review'))).toBe(true);

    const nv04Base = 'PRIORITY=P0\nRESOURCE_SCOPE=R\nTARGET_EMPLOYEE=NV04\nNV04_ROLE=DEEP_RESEARCH';
    expect(eligibleNv04Issue(issue(nv04Base, '[P0][RESEARCH] research'))).toBe(false);
    expect(eligibleNv04Issue(issue(nv04Base + '\nOWNER_CONTROLLED=true', '[P0][RESEARCH] research'))).toBe(true);
  });

  it('rejects code/mutation work for both support workers', () => {
    const nv03 = issue('PRIORITY=P1\nREVIEW_ONLY=true\nTARGET_EMPLOYEE=NV03\nRESOURCE_SCOPE=R\nMUTATION_ALLOWED=true');
    expect(eligibleNv03ReviewIssue(nv03)).toBe(false);

    const nv04 = issue('PRIORITY=P1\nTARGET_EMPLOYEE=NV04\nNV04_ROLE=INDEPENDENT_REVIEW\nRESOURCE_SCOPE=R\nCAPABILITY=code');
    expect(eligibleNv04Issue(nv04)).toBe(false);
  });

  it('builds NV03 direct-GitHub review prompt with no mutation', () => {
    const src = issue('PRIORITY=P1\nREVIEW_ONLY=true\nTARGET_EMPLOYEE=NV03\nRESOURCE_SCOPE=REVIEW_PR_X\nEXACT_HEAD=abc123');
    const prompt = buildNv03ReviewPrompt(src);
    expect(prompt).toContain('WORKER=NV03');
    expect(prompt).toContain('ROLE=INDEPENDENT_REVIEW_QA');
    expect(prompt).toContain('INPUT_REVISION=abc123');
    expect(prompt).toContain('MUTATION_ALLOWED=false');
    expect(prompt).toContain('Ghi kết quả trực tiếp về GitHub');
  });

  it('binds NV03 input revision to TARGET_HEAD when exact-head review work uses that field', () => {
    const src = issue('PRIORITY=P0\nOWNER_DIRECT=true\nREVIEW_ONLY=true\nTARGET_EMPLOYEE=NV03\nRESOURCE_SCOPE=NV03_RELEASE_CANARY_V1\nTARGET_HEAD=18c0c630');
    expect(nv03InputRevision(src)).toBe('18c0c630');
    expect(buildNv03ReviewPrompt(src)).toContain('TARGET_HEAD=18c0c630');
    expect(buildNv03ReviewPrompt(src)).toContain('INPUT_REVISION=18c0c630');
  });

  it('preserves legacy NV04 revision semantics when NV03-only revision fields are present', () => {
    const withExactInput = issue(
      'PRIORITY=P1\nTARGET_EMPLOYEE=NV04\nNV04_ROLE=DEEP_RESEARCH\nRESOURCE_SCOPE=R\nTARGET_HEAD=nv03-head\nINPUT_REVISION=nv03-revision\nEXACT_INPUT=nv04-rev',
      '[P1][RESEARCH] preserve NV04 revision',
      203,
    );
    expect(inputRevision(withExactInput)).toBe('nv04-rev');
    expect(buildNv04Request(withExactInput).inputRevision).toBe('nv04-rev');

    const nv03OnlyFields = issue(
      'PRIORITY=P1\nTARGET_EMPLOYEE=NV04\nNV04_ROLE=DEEP_RESEARCH\nRESOURCE_SCOPE=R\nTARGET_HEAD=nv03-head\nINPUT_REVISION=nv03-revision',
      '[P1][RESEARCH] ignore NV03-only revision fields',
      202,
    );
    expect(inputRevision(nv03OnlyFields)).not.toBe('nv03-head');
    expect(inputRevision(nv03OnlyFields)).not.toBe('nv03-revision');
    expect(buildNv04Request(nv03OnlyFields).inputRevision).toBe(inputRevision(nv03OnlyFields));
  });

  it('creates a deterministic NV04 Drive request contract', () => {
    const src = issue(
      'PRIORITY=P1\nTARGET_EMPLOYEE=NV04\nNV04_ROLE=DEEP_RESEARCH\nRESOURCE_SCOPE=RESEARCH_ARCH\nEXACT_INPUT=rev-7\nCHECKLIST=Compare A/B\nOUTPUT=KẾT LUẬN / BẰNG CHỨNG',
      '[P1][RESEARCH] compare architecture',
      204,
    );
    const requestA = buildNv04Request(src);
    const requestB = buildNv04Request(src);
    expect(requestA.jobId).toBe(requestB.jobId);
    expect(requestA.inputRevision).toBe('rev-7');
    expect(renderNv04Request(requestA)).toContain('MUTATION_ALLOWED=false');
    expect(renderNv04Request(requestA)).toContain('EVIDENCE_DESTINATION=https://github.com/');
  });

  it('rejects stale NV04 results and accepts exact JOB_ID + INPUT_REVISION only', () => {
    const src = issue(
      'PRIORITY=P1\nTARGET_EMPLOYEE=NV04\nNV04_ROLE=SECOND_OPINION\nRESOURCE_SCOPE=ARCH\nEXACT_INPUT=rev-10',
      '[P1][SECOND_OPINION] architecture',
      205,
    );
    const request = buildNv04Request(src);
    const stale = parseNv04Result(`JOB_ID=${request.jobId}\nINPUT_REVISION=rev-9\nRESULT=PASS`);
    expect(() => validateNv04Result(request, stale)).toThrow(/STALE_INPUT_REVISION/);

    const exact = parseNv04Result(
      `JOB_ID=${request.jobId}\nINPUT_REVISION=${request.inputRevision}\nRESULT=CHANGES_REQUIRED\nFINDINGS=Missing evidence\nEVIDENCE=https://example.invalid/e\nRECOMMENDATION=Fix minimum scope`,
    );
    expect(validateNv04Result(request, exact)).toBe(true);
    expect(renderNv04GithubComment(request, exact)).toContain('RESULT=CHANGES_REQUIRED');
  });

  it('implements Drive lifecycle INBOX -> CLAIMED -> PROCESSED without duplicate request creation', () => {
    const root = mkdtempSync(join(tmpdir(), 'tigeriq-nv04-drive-'));
    roots.push(root);
    const transport = new Nv04DriveTransport(root);
    const request = buildNv04Request(issue(
      'PRIORITY=P1\nTARGET_EMPLOYEE=NV04\nNV04_ROLE=INDEPENDENT_REVIEW\nRESOURCE_SCOPE=R\nEXACT_INPUT=rev-1',
      '[P1][REVIEW] independent review',
      206,
    ));
    const first = transport.writeNewRequest(request);
    const second = transport.writeNewRequest(request);
    expect(first).toBe(second);
    const claimed = transport.claimRequest(request);
    expect(existsSync(claimed)).toBe(true);

    const resultPath = join(root, transport.resultFileName(request));
    writeFileSync(resultPath, `JOB_ID=${request.jobId}\nINPUT_REVISION=${request.inputRevision}\nRESULT=PASS\nFINDINGS=OK`, 'utf8');
    const found = transport.readValidatedResult(request);
    expect(found?.result.terminal).toBe('PASS');

    const archived = transport.archiveCompleted(request, found!.path);
    expect(existsSync(archived.requestProcessed)).toBe(true);
    expect(existsSync(archived.resultProcessed)).toBe(true);
    expect(readFileSync(archived.resultProcessed, 'utf8')).toContain('RESULT=PASS');
  });
});


describe('owner-directed sidecar isolation', () => {
  it('requires explicit Owner arm and never calls NV02 worker endpoints', () => {
    const source = readFileSync(join(process.cwd(), 'apps/chrome-controller/src/nv03-nv04-owner-sidecar.ts'), 'utf8');
    expect(source).toContain('TIGERIQ_NV0304_OWNER_DIRECT');
    expect(source).toContain('TIGERIQ_NV0304_WORKERS');
    expect(source).toContain('OWNER_WORKER_SELECTION_REQUIRED');
    expect(source).toContain("if (selected.has('NV03'))");
    expect(source).toContain("if (selected.has('NV04'))");
    expect(source).toContain('APP_CHROME_NV03_NV04_COORDINATION_V1');
    expect(source).toContain("TIGERIQ_NV03_SIDECAR_URL");
    expect(source).toContain("${nv03SidecarBase}/assign");
    expect(source).toContain('claimId,');
    expect(source).toContain('reconcileNv03Results');
    expect(source).toContain('nv03ResultRevisionMatches(issue, body)');
    expect(source).toContain("lineFieldValue(body, 'INPUT_REVISION') !== expectedRevision");
    expect(source).toContain("lineFieldValue(body, 'TARGET_HEAD') !== targetHead");
    const reconcileStart = source.indexOf('async function reconcileNv03Results');
    const revisionGuard = source.indexOf('nv03ResultRevisionMatches(issue, body)', reconcileStart);
    const releaseCall = source.indexOf('await nv03SidecarRelease(jobId)', reconcileStart);
    expect(revisionGuard).toBeGreaterThan(reconcileStart);
    expect(releaseCall).toBeGreaterThan(revisionGuard);
    expect(source).toContain("REVIEW\\s*=\\s*(?:PASS|CHANGES_REQUIRED)");
    expect(source).toContain('closeGithubIssueCompleted');
    expect(source).toContain('nv03SidecarRelease');
    expect(source).toContain("${nv03SidecarBase}/release");
    expect(source).not.toContain('/api/workers/NV03/dispatch');
    expect(source).toContain('/api/workers/NV04/dispatch');
    expect(source).not.toContain('/api/workers/NV02/');
    expect(source).not.toContain('/api/start-all');
    expect(source).not.toContain('/api/workers/NV03/start');
    expect(source).not.toContain('/api/workers/NV04/start');
  });
});
