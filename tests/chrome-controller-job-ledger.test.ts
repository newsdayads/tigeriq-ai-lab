import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableUiJobLedger, uiJobProgress } from '../apps/chrome-controller/src/job-ledger.js';

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

  it('survives restart and rejects duplicate dispatch for the same active worker',()=>{
    const {path,store}=ledger();
    store.create('NV03',{jobId:'GH-959-NV03'});
    const restored=new DurableUiJobLedger(path);
    expect(restored.active('NV03')?.jobId).toBe('GH-959-NV03');
    expect(()=>restored.create('NV03',{jobId:'GH-959-NV03'})).toThrow('UI_JOB_DUPLICATE_ACTIVE');
    expect(()=>restored.create('NV03',{jobId:'OTHER'})).toThrow('UI_JOB_ACTIVE');
  });

  it('terminalizes only on explicit terminal stage and keeps the result for READY display',()=>{
    const {path,store}=ledger();
    store.create('NV04',{jobId:'GH-959-NV04',title:'Verifier'});
    store.transition('NV04','GH-959-NV04','WORKING');
    expect(store.active('NV04')).toBeTruthy();
    const done=store.transition('NV04','GH-959-NV04','DONE',{result:'Acceptance PASS',evidenceRef:'https://github.com/newsdayads/tigeriq-ai-lab/issues/959'});
    expect(done).toMatchObject({stage:'DONE',progress:100,result:'Acceptance PASS'});
    const restored=new DurableUiJobLedger(path);
    expect(restored.active('NV04')).toBeUndefined();
    expect(restored.latest('NV04')).toMatchObject({stage:'DONE',result:'Acceptance PASS'});
  });
});
