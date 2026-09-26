import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { continuityResumeIdentityMatches, DurableUiJobLedger, reconcileUiJobStage, uiJobProgress } from '../apps/chrome-controller/src/job-ledger.js';

const roots:string[]=[];
function ledger(){
  const root=mkdtempSync(join(tmpdir(),'tigeriq-ui-job-'));
  roots.push(root);
  return { root, path:join(root,'ledger.json'), store:new DurableUiJobLedger(join(root,'ledger.json')) };
}
afterEach(()=>{while(roots.length)rmSync(roots.pop()!,{recursive:true,force:true});});

describe('durable UI worker job ledger',()=>{
  it('persists identity, deterministic milestone progress and evidence',()=>{
    const {path,store}=ledger();
    const created=store.create('NV02',{jobId:'GH-959-NV02',issueRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/959',title:'Track progress',source:'SYSTEM'},new Date('2026-09-19T00:00:00Z'));
    expect(created).toMatchObject({stage:'QUEUED',progress:uiJobProgress('QUEUED')});
    store.transition('NV02',created.jobId,'DISPATCHING',{},new Date('2026-09-19T00:00:01Z'));
    store.transition('NV02',created.jobId,'SUBMITTED',{},new Date('2026-09-19T00:00:02Z'));
    store.transition('NV02',created.jobId,'WORKING',{},new Date('2026-09-19T00:00:03Z'));
    const waiting=store.transition('NV02',created.jobId,'WAITING_EVIDENCE',{evidenceRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/959',nextAction:'Verify'},new Date('2026-09-19T00:00:04Z'));
    expect(waiting).toMatchObject({progress:80,nextAction:'Verify'});
    expect(new DurableUiJobLedger(path).active('NV02')).toMatchObject({jobId:'GH-959-NV02',stage:'WAITING_EVIDENCE',progress:80});
    expect(JSON.parse(readFileSync(path,'utf8')).jobs[0].evidenceRefs).toEqual(['https://github.com/newsdayads/tigeriq-ai-lab/issues/959']);
  });

  it('uses collision-safe atomic persistence instead of the legacy fixed .tmp rename path',()=>{
    const source=readFileSync('apps/chrome-controller/src/job-ledger.ts','utf8');
    expect(source).toContain('atomicWriteJsonWithRetry');
    expect(source).toContain('this.atomicWriter(this.path,this.value)');
    expect(source).not.toContain('${this.path}.tmp');
  });

  it('falls back to a full-state journal on persistent EPERM and restores from it after restart',()=>{
    const root=mkdtempSync(join(tmpdir(),'tigeriq-ui-job-journal-'));
    roots.push(root);
    const path=join(root,'ledger.json');
    const locked=Object.assign(new Error('locked'),{code:'EPERM'});
    const store=new DurableUiJobLedger(path,()=>{throw locked;});
    const created=store.create('NV02',{jobId:'GH-JOURNAL',source:'AUTO_CONTINUE'});
    expect(created.stage).toBe('QUEUED');
    const journals=readdirSync(root).filter((name)=>name.startsWith('ledger.json.journal.'));
    expect(journals).toHaveLength(1);
    const restored=new DurableUiJobLedger(path);
    expect(restored.active('NV02')).toMatchObject({jobId:'GH-JOURNAL',stage:'QUEUED'});
  });

  it('prefers the newest valid journal and ignores a newer corrupt journal',()=>{
    const root=mkdtempSync(join(tmpdir(),'tigeriq-ui-job-journal-corrupt-'));
    roots.push(root);
    const path=join(root,'ledger.json');
    writeFileSync(path,JSON.stringify({schemaVersion:'tigeriq.chrome-controller.ui-job-ledger.v1',jobs:[]}));
    writeFileSync(`${path}.journal.1000000000000.a.json`,JSON.stringify({schemaVersion:'tigeriq.chrome-controller.ui-job-ledger.v1',jobs:[{jobId:'J1',workerId:'NV02',issueRef:null,title:'x',source:'AUTO',stage:'QUEUED',progress:5,createdAt:'x',startedAt:null,lastActivityAt:'x',completedAt:null,nextAction:null,blocker:null,evidenceRefs:[],result:null}]}));
    writeFileSync(`${path}.journal.2000000000000.b.json`,'{bad-json');
    const restored=new DurableUiJobLedger(path);
    expect(restored.active('NV02')?.jobId).toBe('J1');
  });

  it('survives restart and rejects duplicate dispatch for the same active worker',()=>{
    const {path,store}=ledger();
    store.create('NV03',{jobId:'GH-959-NV03'});
    const restored=new DurableUiJobLedger(path);
    expect(restored.active('NV03')?.jobId).toBe('GH-959-NV03');
    expect(()=>restored.create('NV03',{jobId:'GH-959-NV03'})).toThrow('UI_JOB_DUPLICATE_ACTIVE');
    expect(()=>restored.create('NV03',{jobId:'OTHER'})).toThrow('UI_JOB_ACTIVE');
  });

  it('fails closed on corrupt persisted state and invalid lifecycle jumps',()=>{
    const {path,store}=ledger();
    store.create('NV02',{jobId:'GH-CORRUPT'});
    expect(()=>store.transition('NV02','GH-CORRUPT','DONE',{result:'bad'})).toThrow('UI_JOB_TRANSITION_INVALID');
    writeFileSync(path,'{not-json','utf8');
    expect(()=>new DurableUiJobLedger(path)).toThrow('UI_JOB_LEDGER_CORRUPT');
  });

  it('reconciles fast-complete UI heartbeats monotonically',()=>{
    expect(reconcileUiJobStage('SUBMITTED',true)).toBe('WORKING');
    expect(reconcileUiJobStage('SUBMITTED',false)).toBe('WAITING_EVIDENCE');
    expect(reconcileUiJobStage('WORKING',false)).toBe('WAITING_EVIDENCE');
    expect(reconcileUiJobStage('DISPATCHING',true)).toBeUndefined();
    expect(reconcileUiJobStage('WAITING_EVIDENCE',true)).toBeUndefined();
    expect(reconcileUiJobStage('VERIFY',false)).toBeUndefined();
    expect(reconcileUiJobStage('DONE',false)).toBeUndefined();
  });

  it('allows continuity lease identity only for the exact same NV02 job',()=>{
    const same={jobId:'GH-1232',workerId:'NV02',stage:'WAITING_EVIDENCE',completedAt:null} as const;
    const prior={workerId:'NV02',jobId:'GH-1232',status:'RUNNING'};
    const autopilot={lastDispatchedJobId:'GH-1232',pendingJobId:null,uncertainJobId:null};
    expect(continuityResumeIdentityMatches(same,prior,autopilot)).toBe(true);
    expect(continuityResumeIdentityMatches({...same,jobId:'GH-OTHER'},prior,autopilot)).toBe(false);
    expect(continuityResumeIdentityMatches(same,{...prior,jobId:'GH-OTHER'},autopilot)).toBe(false);
    expect(continuityResumeIdentityMatches(same,prior,{...autopilot,lastDispatchedJobId:'GH-OTHER'})).toBe(false);
    expect(continuityResumeIdentityMatches(same,prior,{...autopilot,pendingJobId:'GH-NEW'})).toBe(false);
    expect(continuityResumeIdentityMatches({...same,stage:'DONE',completedAt:'2026-09-21T00:00:00Z'},prior,autopilot)).toBe(false);
  });

  it('keeps milestone progress deterministic',()=>{
    expect(uiJobProgress('QUEUED')).toBe(5);
    expect(uiJobProgress('WORKING')).toBe(60);
    expect(uiJobProgress('WAITING_EVIDENCE')).toBe(80);
    expect(uiJobProgress('VERIFY')).toBe(90);
    expect(uiJobProgress('DONE')).toBe(100);
  });

  it('requires issue-identity evidence and result at controller completion gate',()=>{
    const server=readFileSync('apps/chrome-controller/src/server.ts','utf8');
    expect(server).toContain('UI_JOB_COMPLETION_EVIDENCE_REQUIRED');
    expect(server).toContain('UI_JOB_COMPLETION_EVIDENCE_IDENTITY_MISMATCH');
    expect(server).toContain('UI_JOB_DONE_RESULT_REQUIRED');
    expect(server).toContain("data.stage==='VERIFY'||data.stage==='DONE'");
  });

  it('terminalizes only on explicit terminal stage and keeps the result for READY display',()=>{
    const {path,store}=ledger();
    store.create('NV04',{jobId:'GH-959-NV04',title:'Verifier'});
    store.transition('NV04','GH-959-NV04','DISPATCHING');
    store.transition('NV04','GH-959-NV04','SUBMITTED');
    store.transition('NV04','GH-959-NV04','WORKING');
    store.transition('NV04','GH-959-NV04','WAITING_EVIDENCE');
    store.transition('NV04','GH-959-NV04','VERIFY',{evidenceRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/959'});
    expect(store.active('NV04')).toBeTruthy();
    const done=store.transition('NV04','GH-959-NV04','DONE',{result:'Acceptance PASS',evidenceRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/959'});
    expect(done).toMatchObject({stage:'DONE',progress:100,result:'Acceptance PASS'});
    const restored=new DurableUiJobLedger(path);
    expect(restored.active('NV04')).toBeUndefined();
    expect(restored.latest('NV04')).toMatchObject({stage:'DONE',result:'Acceptance PASS'});
  });

  it('reopens the same ERROR job id for a safe retry without creating a duplicate record',()=>{
    const {path,store}=ledger();
    store.create('NV02',{jobId:'GH-1041',issueRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1041',source:'AUTO_CONTINUE'});
    store.transition('NV02','GH-1041','DISPATCHING');
    store.transition('NV02','GH-1041','ERROR',{blocker:'Error: SEND_BUTTON_NOT_FOUND',nextAction:'Root-cause and safe retry'});
    const retried=store.retryError('NV02','GH-1041',{source:'AUTO_CONTINUE'},new Date('2026-09-19T05:50:00Z'));
    expect(retried).toMatchObject({jobId:'GH-1041',stage:'QUEUED',progress:5,blocker:null,completedAt:null,nextAction:'Retry dispatch to worker'});
    expect(new DurableUiJobLedger(path).snapshot().filter(job=>job.jobId==='GH-1041')).toHaveLength(1);
  });
  it('verifies WAITING_EVIDENCE recovery and exact model gate',()=>{
    const {path,store}=ledger();
    store.create('NV02',{jobId:'GH-EVIDENCE',issueRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1042',source:'AUTO_CONTINUE'});
    store.transition('NV02','GH-EVIDENCE','DISPATCHING');
    store.transition('NV02','GH-EVIDENCE','SUBMITTED');
    store.transition('NV02','GH-EVIDENCE','WORKING');
    const waiting=store.transition('NV02','GH-EVIDENCE','WAITING_EVIDENCE',{evidenceRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1042'});
    expect(waiting.stage).toBe('WAITING_EVIDENCE');
    expect(waiting.progress).toBe(80);
    expect(waiting.evidenceRefs).toContain('https://github.com/newsdayads/tigeriq-ai-lab/issues/1042');
  });
  it('resumes the same WAITING_EVIDENCE job as WORKING only through recovery method',()=>{
    const {path,store}=ledger();
    store.create('NV02',{jobId:'GH-WAIT-RESUME',issueRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1232',source:'AUTO_CONTINUE'});
    store.transition('NV02','GH-WAIT-RESUME','DISPATCHING');
    store.transition('NV02','GH-WAIT-RESUME','SUBMITTED');
    store.transition('NV02','GH-WAIT-RESUME','WORKING');
    store.transition('NV02','GH-WAIT-RESUME','WAITING_EVIDENCE',{evidenceRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/1232'});
    const resumed=store.resumeWaitingEvidence('NV02','GH-WAIT-RESUME');
    expect(resumed).toMatchObject({jobId:'GH-WAIT-RESUME',stage:'WORKING',progress:60,completedAt:null,blocker:null});
    expect(resumed.evidenceRefs).toContain('https://github.com/newsdayads/tigeriq-ai-lab/issues/1232');
    expect(new DurableUiJobLedger(path).snapshot().filter(job=>job.jobId==='GH-WAIT-RESUME')).toHaveLength(1);
    expect(()=>store.resumeWaitingEvidence('NV02','GH-WAIT-RESUME')).toThrow('UI_JOB_RECOVERY_RESUME_INVALID:WORKING');
  });

  it('enforces exact job resumption path on retry',()=>{
    const {path,store}=ledger();
    const created=store.create('NV02',{jobId:'GH-RESUME-2',source:'AUTO_CONTINUE'});
    store.transition('NV02','GH-RESUME-2','DISPATCHING');
    store.transition('NV02','GH-RESUME-2','SUBMITTED');
    store.transition('NV02','GH-RESUME-2','ERROR',{blocker:'UI_JOB_ACTIVE'});
    const resumed=store.retryError('NV02','GH-RESUME-2');
    expect(resumed.stage).toBe('QUEUED');
    expect(resumed.completedAt).toBe(null);
  });

  it('resumes the same JOB id from ERROR to QUEUED without duplication',()=>{
    const {path,store}=ledger();
    store.create('NV02',{jobId:'GH-RESUME',source:'AUTO_CONTINUE'});
    store.transition('NV02','GH-RESUME','DISPATCHING');
    store.transition('NV02','GH-RESUME','ERROR',{blocker:'SEND_FAIL'});
    const resume=store.retryError('NV02','GH-RESUME',{source:'AUTO_CONTINUE'});
    expect(resume.stage).toBe('QUEUED');
    expect(new DurableUiJobLedger(path).snapshot().filter(j=>j.jobId==='GH-RESUME')).toHaveLength(1);
  });

  it('refuses retryError for non-error terminal or active jobs',()=>{
    const {store}=ledger();
    store.create('NV02',{jobId:'ACTIVE'});
    expect(()=>store.retryError('NV02','ACTIVE')).toThrow('UI_JOB_ACTIVE');
  });

});
