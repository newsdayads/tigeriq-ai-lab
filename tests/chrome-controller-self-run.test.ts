import { describe, expect, it } from 'vitest';
import {
  activeAppChromeClaims,
  buildSelfRunPrompt,
  eligibleIssuesForWorker,
  isSelfRunSafe,
  parseWorkOrderMetadata,
  priorityOf,
  resourceScopeOf,
  terminalMarkerFromComments,
  workerEligibleForIssue,
  type GithubIssue,
} from '../apps/chrome-controller/src/github-self-run.js';

function issue(number:number,title:string,body:string):GithubIssue{
  return {number,title,body,html_url:`https://github.com/newsdayads/tigeriq-ai-lab/issues/${number}`,state:'open',updated_at:'2026-09-23T10:00:00Z'};
}
const SAFE=[
  'TIGERIQ_EXECUTABLE=true',
  'ZERO_COST=true',
  'NO_DIRECT_MAIN=true',
  'NO_PRODUCTION_RELEASE=true',
  'NO_PAID_COST=true',
  'NO_CREDENTIAL_CHANGE=true',
  'NO_DESTRUCTIVE=true',
].join('\n');

describe('App Chrome GitHub self-run queue',()=>{
  it('accepts only explicit safe executable work',()=>{
    const ok=issue(1,'safe',SAFE+'\nPRIORITY=P0\nRESOURCE_SCOPE=SAFE_READ');
    expect(isSelfRunSafe(ok)).toBe(true);
    expect(resourceScopeOf(ok)).toBe('SAFE_READ');
    expect(priorityOf(ok)).toBe(0);
    expect(isSelfRunSafe(issue(2,'unsafe','TIGERIQ_EXECUTABLE=true'))).toBe(false);
    expect(isSelfRunSafe(issue(3,'hold',SAFE+'\nSTATE=MANUAL_HOLD'))).toBe(false);
    expect(isSelfRunSafe(issue(4,'excluded',SAFE+'\nAUTO_QUEUE=EXCLUDED'))).toBe(false);
  });

  it('routes by worker role and never routes coding mutation into App Chrome self-run',()=>{
    const general=issue(10,'general',SAFE+'\nRESOURCE_SCOPE=GENERAL_READ');
    const review=issue(11,'[REVIEW] verify',SAFE+'\nCAPABILITY=review\nREVIEW_ONLY=true\nRESOURCE_SCOPE=VERIFY');
    const research=issue(12,'[RESEARCH] cross-check',SAFE+'\nCAPABILITY=research\nRESEARCH_ONLY=true\nRESOURCE_SCOPE=RESEARCH');
    const coding=issue(13,'code',SAFE+'\nCAPABILITY=code\nAUTONOMOUS_CODE=true\nALLOW_PATH_PREFIX=apps/foo/\nRESOURCE_SCOPE=CODE');
    expect(workerEligibleForIssue('NV02',general)).toBe(true);
    expect(workerEligibleForIssue('NV02',review)).toBe(false);
    expect(workerEligibleForIssue('NV03',review)).toBe(true);
    expect(workerEligibleForIssue('NV04',review)).toBe(true);
    expect(workerEligibleForIssue('NV04',research)).toBe(true);
    expect(workerEligibleForIssue('NV02',coding)).toBe(false);
    expect(workerEligibleForIssue('NV03',coding)).toBe(false);
    expect(workerEligibleForIssue('NV04',coding)).toBe(false);
  });

  it('honors external resource-scope collisions and priority order',()=>{
    const p1=issue(20,'p1',SAFE+'\nPRIORITY=P1\nRESOURCE_SCOPE=ONE');
    const ownerP2=issue(21,'owner p2',SAFE+'\nOWNER_DIRECT=true\nPRIORITY=P2\nRESOURCE_SCOPE=TWO');
    const p0Blocked=issue(22,'blocked',SAFE+'\nPRIORITY=P0\nRESOURCE_SCOPE=BUSY');
    const out=eligibleIssuesForWorker('NV02',[p1,ownerP2,p0Blocked],new Set(['BUSY']));
    expect(out.map(x=>x.number)).toEqual([21,20]);
  });

  it('keeps GitHub claim exactly one winner and recognizes release',()=>{
    const now=Date.parse('2026-09-23T12:00:00Z');
    const comments=[
      {id:1,created_at:'2026-09-23T11:00:00Z',body:'[APP_CHROME_CLAIM]\nclaim_id=a\nworker=NV02\nissue=30\nscope=S\nexpires_at=2026-09-23T13:00:00Z\nsource=APP_CHROME_SELF_RUN'},
      {id:2,created_at:'2026-09-23T11:00:01Z',body:'[APP_CHROME_CLAIM]\nclaim_id=b\nworker=NV03\nissue=30\nscope=S\nexpires_at=2026-09-23T13:00:00Z\nsource=APP_CHROME_SELF_RUN'},
      {id:3,created_at:'2026-09-23T11:05:00Z',body:'[APP_CHROME_RELEASE]\nclaim_id=a\nworker=NV02\nissue=30\nstate=DONE\nreleased_at=2026-09-23T11:05:00Z'},
    ];
    expect(activeAppChromeClaims(comments,now).map(x=>x.claimId)).toEqual(['b']);
  });

  it('recognizes terminal evidence markers and builds a bounded full-issue prompt',()=>{
    expect(terminalMarkerFromComments([{id:1,body:'STATE=DONE'}])).toBe('DONE');
    expect(terminalMarkerFromComments([{id:1,body:'STATE=BLOCKED'}])).toBe('BLOCKED');
    expect(terminalMarkerFromComments([{id:1,body:'STATE=EXTERNAL_WAIT'}])).toBe('EXTERNAL_WAIT');
    const work=issue(40,'review me',SAFE+'\nCAPABILITY=review\nRESOURCE_SCOPE=R');
    const prompt=buildSelfRunPrompt('NV03',work,[],{
      claimId:'claim-1',workerId:'NV03',scope:'R',issueNumber:40,expiresAt:'2026-09-24T00:00:00Z',createdAt:'2026-09-23T12:00:00Z'
    });
    expect(prompt).toContain('LÀM — NO YAPPING.');
    expect(prompt).toContain('CURRENT_WORK_ORDER=#40 - review me');
    expect(prompt).toContain('CLAIM_ID=claim-1');
    expect(prompt).toContain('--- FULL ISSUE ---');
  });

  it('parses canonical metadata deterministically',()=>{
    expect(parseWorkOrderMetadata('PRIORITY=P0\nRESOURCE_SCOPE=X\nfoo=bar')).toEqual({PRIORITY:'P0',RESOURCE_SCOPE:'X'});
  });
});
