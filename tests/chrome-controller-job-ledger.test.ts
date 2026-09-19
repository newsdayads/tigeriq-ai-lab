import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableUiJobLedger, reconcileUiJobStage, uiJobProgress } from '../apps/chrome-controller/src/job-ledger.js';

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
    expect(source).toContain('atomicWriteJsonWithRetry(this.path,this.value)');
    expect(source).not.toContain('${this.path}.tmp');
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

  it('refuses retryError for non-error terminal or active jobs',()=>{
    const {store}=ledger();
    store.create('NV02',{jobId:'ACTIVE'});
    expect(()=>store.retryError('NV02','ACTIVE')).toThrow('UI_JOB_ACTIVE');
  });

});
