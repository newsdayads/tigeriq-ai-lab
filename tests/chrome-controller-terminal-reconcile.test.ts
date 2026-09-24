import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DurableUiJobLedger } from '../apps/chrome-controller/src/job-ledger.js';
import {
  appChromeClaimForJob,
  authoritativeUiTerminalFromGithub,
  terminalMarkerFromComments,
  type GithubComment,
  type GithubIssue,
} from '../apps/chrome-controller/src/github-self-run.js';

const roots:string[]=[];
function ledger(){
  const dir=mkdtempSync(join(tmpdir(),'tigeriq-terminal-reconcile-'));
  roots.push(dir);
  return {store:new DurableUiJobLedger(join(dir,'ui-job-ledger.json')),path:join(dir,'ui-job-ledger.json')};
}
afterEach(()=>{while(roots.length)rmSync(roots.pop()!,{recursive:true,force:true});});

function activeReview(store:DurableUiJobLedger,jobId='REVIEW-1771-NV03'){
  store.create('NV03',{jobId,issueRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1772',title:'review',source:'SYSTEM_REVIEW'});
  store.transition('NV03',jobId,'DISPATCHING');
  store.transition('NV03',jobId,'SUBMITTED');
  store.transition('NV03',jobId,'WORKING');
  return jobId;
}
function issue(state:'open'|'closed',state_reason:string|null='completed'):GithubIssue{
  return {number:1772,title:'review',body:'',html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1772',state,state_reason};
}

describe('authoritative UI terminal reconciliation',()=>{
  it('PASS/DONE terminalizes and clears the active assignment',()=>{
    const {store}=ledger();
    const jobId=activeReview(store);
    store.transition('NV03',jobId,'WAITING_EVIDENCE');
    const terminal=authoritativeUiTerminalFromGithub(issue('open',null),[{id:1,body:'REVIEW=PASS'}]);
    expect(terminal).toBe('DONE');
    const done=store.reconcileAuthoritativeTerminal('NV03',jobId,terminal!,{
      evidenceRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1772',
      result:'review pass',
    },new Date('2026-09-24T14:00:00Z'));
    expect(done.stage).toBe('DONE');
    expect(done.completedAt).toBe('2026-09-24T14:00:00.000Z');
    expect(store.active('NV03')).toBeUndefined();
    expect(store.latest('NV03')?.evidenceRefs).toEqual(['https://github.com/newsdayads/tigeriq-ai-lab/issues/1772']);
  });

  it('BLOCKED plus committed claim release clears the assignment',()=>{
    const {store}=ledger();
    const claimId='abcdef12-1111-2222-3333-444444444444';
    const jobId=`APP-GH-1772-NV03-${claimId.slice(0,8)}`;
    store.create('NV03',{jobId,issueRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1772',source:'APP_CHROME_SELF_RUN'});
    store.transition('NV03',jobId,'DISPATCHING');
    store.transition('NV03',jobId,'SUBMITTED');
    store.transition('NV03',jobId,'WORKING');
    const comments:GithubComment[]=[
      {id:1,body:`[APP_CHROME_CLAIM]\nclaim_id=${claimId}\nworker=NV03\nissue=1772\nscope=R\nexpires_at=2026-09-25T00:00:00Z\nsource=APP_CHROME_SELF_RUN`},
      {id:2,body:`CLAIM_ID=${claimId}\nSTATE=BLOCKED`},
      {id:3,body:`[APP_CHROME_RELEASE]\nclaim_id=${claimId}\nworker=NV03\nissue=1772\nstate=BLOCKED\nreleased_at=2026-09-24T14:00:00Z`},
    ];
    expect(terminalMarkerFromComments(comments,claimId)).toBe('BLOCKED');
    expect(appChromeClaimForJob(comments,'NV03',1772,jobId)).toMatchObject({released:true,claim:{claimId}});
    const blocked=store.reconcileAuthoritativeTerminal('NV03',jobId,'BLOCKED',{
      evidenceRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1772',
      blocker:'BLOCKED',
      result:'authoritative blocked',
    });
    expect(blocked.stage).toBe('BLOCKED');
    expect(store.active('NV03')).toBeUndefined();
  });

  it('closed-completed source cleans a stale orphan even without comments or claim',()=>{
    const {store}=ledger();
    const jobId=activeReview(store);
    expect(authoritativeUiTerminalFromGithub(issue('closed','completed'),[])).toBe('DONE');
    store.reconcileAuthoritativeTerminal('NV03',jobId,'DONE',{
      evidenceRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1772',
      result:'closed completed orphan recovery',
    });
    expect(store.active('NV03')).toBeUndefined();
    expect(store.latest('NV03')).toMatchObject({stage:'DONE',progress:100});
  });

  it('restart recovery is exactly-once and terminal work never revives',()=>{
    const {store,path}=ledger();
    const jobId=activeReview(store);
    store.reconcileAuthoritativeTerminal('NV03',jobId,'DONE',{
      evidenceRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1772',
      result:'done once',
    },new Date('2026-09-24T14:01:00Z'));
    const reloaded=new DurableUiJobLedger(path);
    expect(reloaded.active('NV03')).toBeUndefined();
    const before=JSON.parse(readFileSync(path,'utf8'));
    const same=reloaded.reconcileAuthoritativeTerminal('NV03',jobId,'DONE',{
      evidenceRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1772',
      result:'should not rewrite terminal',
    },new Date('2026-09-24T14:02:00Z'));
    expect(same.stage).toBe('DONE');
    expect(same.result).toBe('done once');
    expect(JSON.parse(readFileSync(path,'utf8'))).toEqual(before);
    expect(()=>reloaded.resumeWaitingEvidence('NV03',jobId)).toThrow(/UI_JOB_RECOVERY_RESUME_INVALID:DONE/);
  });

  it('EXTERNAL_WAIT stays non-terminal and suppresses terminal cleanup',()=>{
    const {store}=ledger();
    const jobId=activeReview(store);
    const waiting=store.reconcileAuthoritativeTerminal('NV03',jobId,'EXTERNAL_WAIT',{
      evidenceRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1772',
      result:'external dependency',
    });
    expect(waiting.stage).toBe('WAITING_EVIDENCE');
    expect(waiting.completedAt).toBeNull();
    expect(store.active('NV03')?.jobId).toBe(jobId);
  });

  it('wires reconciliation outside self-run and prevents NV03/NV04 unassigned continue',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    const recovery=server.slice(server.indexOf('async function recoveryTick'),server.indexOf('async function waitForStartupRuntime'));
    expect(recovery).toContain('await reconcileUiJobTerminalsFromGithub()');
    expect(recovery).not.toContain('selfRunEnabled');

    const bridge=readFileSync('apps/chrome-controller/direct-cdp-bridge.mjs','utf8');
    expect(bridge).toContain("if(w.id==='NV03'||w.id==='NV04')");
    expect(bridge).toContain("const assignment=await currentWorkerAssignmentStatus(w.id)");
    expect(bridge).toContain("assignment.status!=='CONTINUABLE'");
    expect(bridge).toContain("return{status:'READY_UNASSIGNED',job:null}");
  });
});
