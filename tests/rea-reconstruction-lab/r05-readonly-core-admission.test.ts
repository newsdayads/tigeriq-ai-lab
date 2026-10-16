import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
// @ts-ignore Standalone JavaScript diagnostic module intentionally lacks TS declarations.
import { inspectR05ReadOnly } from '../../projects/rea-reconstruction-lab/r05-readonly-core-admission.mjs';
const clock = Date.parse('2026-10-15T09:35:53Z');
const fixture = (): any => ({
  ok: true, core: { time: '2026-10-15T09:35:53Z' },
  resources: Array.from({length:14}, (_,i)=>({employee_id:i?'NV09':'NV06',resource_id:'r'+i,status:'READY',current_job_id:null})),
  jobs: [], sharedLeases:[]
});
const check = (x:any, time=clock) => inspectR05ReadOnly(x,time);
const nv02 = (s:any, id='rea-nv02') => s.resources.push({employee_id:'NV02',resource_id:id,status:'READY',current_job_id:null});
const safe = (r:any) => {
  expect(r.leaseOwned).toBe(false); expect(r.deviceAuthorized).toBe(false);
  expect(r.installAuthorized).toBe(false); expect(r.sourceAuthenticated).toBe(false);
  expect(r.mutated).toBe(false);
};
it('real-shaped 14-row source with zero NV02 diagnoses resource absent',()=>{
  const r=check(fixture());expect(r.decision).toBe('NV02_RESOURCE_ABSENT');
  expect(r.counts).toEqual({resources:14,nv02Rows:0,sharedLeases:0});safe(r);
});
it('visible free NV02 row still needs real atomic claim and device authority',()=>{
  const x=fixture();nv02(x);const r=check(x);
  expect(r.decision).toBe('REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED');safe(r);
});
it('current foreign job blocks resource even with no shared lease',()=>{
  const x=fixture();nv02(x);x.resources.at(-1).current_job_id='foreign';
  expect(check(x).decision).toBe('NV02_RESOURCE_BUSY');
});
it('active foreign lease blocks exact NV02 resource',()=>{
  const x=fixture();nv02(x);x.sharedLeases=[{resource_id:'rea-nv02',work_id:'foreign'}];
  const r=check(x);expect(r.decision).toBe('NV02_RESOURCE_BUSY');safe(r);
});
it('other resource lease does not mean NV02 owns it',()=>{
  const x=fixture();nv02(x);x.sharedLeases=[{resource_id:'other',work_id:'foreign'}];
  const r=check(x);expect(r.decision).toBe('REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED');safe(r);
});
it('multiple NV02 rows all busy cannot be treated as free',()=>{
  const x=fixture();nv02(x,'a');nv02(x,'b');
  x.resources.at(-1).shared_lease_work_id='other';
  x.resources.at(-2).current_job_id='another';
  const r=check(x);expect(r.decision).toBe('NV02_RESOURCE_BUSY');expect(r.counts.busyRows).toBe(2);
});
it('one free NV02 among busy still cannot self-claim',()=>{
  const x=fixture();nv02(x,'a');nv02(x,'b');x.resources.at(-1).current_job_id='another';
  const r=check(x);expect(r.decision).toBe('REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED');safe(r);
});
it('rejects stale snapshot, not assuming empty leases mean authorization',()=>{
  const r=check(fixture(),clock+360000);expect(r.decision).toBe('STALE_SNAPSHOT');safe(r);
});
it('rejects clock skew far in future',()=>{
  expect(check(fixture(),clock-30000).decision).toBe('STALE_SNAPSHOT');
});
it('missing arrays or malformed root are invalid not resource absent',()=>{
  for(const x of [null,[],{}, {ok:false}, {...fixture(),sharedLeases:null}])
    expect(check(x).decision).toBe('INVALID_SHAPE');
});
it('rejects invalid resource and lease projection rows',()=>{
  const x=fixture();x.resources.push({employee_id:'NV02'});
  expect(check(x).decision).toBe('INVALID_RESOURCE');
  const y=fixture();y.sharedLeases=[{lease_token:'secret'}];
  expect(check(y).decision).toBe('INVALID_LEASE_PROJECTION');
});
it('rejects oversized data and invalid timestamps',()=>{
  const x=fixture();x.jobs=new Array(257).fill({});
  expect(check(x).decision).toBe('OVERSIZED_SNAPSHOT');
  const y=fixture();y.core.time='now';
  expect(check(y).decision).toBe('INVALID_TIME');
});
it('cannot reflect bearer tokens, private IDs or metadata in output',()=>{
  const x=fixture();nv02(x,'PRIVATE_RESOURCE_ID');x.sharedLeases=[{
    resource_id:'PRIVATE_RESOURCE_ID',lease_token:'SECRET_BEARER'}];
  x.resources.at(-1).metadata={secret:'SUPER_PRIVATE_VALUE'};
  const s=JSON.stringify(check(x));
  for(const marker of ['PRIVATE_RESOURCE_ID','SECRET_BEARER','SUPER_PRIVATE_VALUE'])
    expect(s).not.toContain(marker);
});
const path=resolve('projects/rea-reconstruction-lab/r05-readonly-core-admission.mjs');
const run=(args:string[],input:string)=>spawnSync(process.execPath,[path,...args],{
  encoding:'utf8',input,timeout:3000
});
it('actual local Node CLI subprocess parses safe stdin and never runs REA',()=>{
  const x=fixture();x.core.time=new Date().toISOString();
  const r=run(['--read-only'],JSON.stringify(x));
  expect(r.status).toBe(0);expect(r.stderr).toBe('');
  const parsed=JSON.parse(r.stdout);
  expect(parsed.decision).toBe('NV02_RESOURCE_ABSENT');safe(parsed);
});
it('CLI without explicit flag fails closed',()=>{
  const r=run([],JSON.stringify(fixture()));
  expect(r.status).toBe(2);safe(JSON.parse(r.stdout));
});
it('malformed CLI input sanitizes private text',()=>{
  const r=run(['--read-only'],'{"secret":"NEVER_EXPOSE_ME",');
  expect(r.status).toBe(2);
  expect(JSON.parse(r.stdout).decision).toBe('INPUT_INVALID_OR_UNREADABLE');
  expect(r.stdout).not.toContain('NEVER_EXPOSE_ME');
});
it('oversized CLI input fails without echoes',()=>{
  const r=run(['--read-only'],'{"secret":"'+'X'.repeat(270000)+'"}');
  expect(r.status).toBe(2);
  expect(JSON.parse(r.stdout).decision).toBe('INPUT_TOO_LARGE');
  expect(r.stdout).not.toContain('XXXXX');
});

it('R05 live-status running job must make matching NV02 resource busy even if resource row is stale',()=>{
  const x=fixture();nv02(x);
  x.jobs=[{id:'j1',employee_id:'NV02',resource_id:'rea-nv02',status:'running'}];
  const r=check(x);expect(r.decision).toBe('NV02_RESOURCE_BUSY');safe(r);
});
it('R05 foreign running job on exact resource blocks diagnostic availability',()=>{
  const x=fixture();nv02(x);
  x.jobs=[{id:'j2',employee_id:'NV20',resource_id:'rea-nv02',status:'running'}];
  expect(check(x).decision).toBe('NV02_RESOURCE_BUSY');
});
it('R05 unrelated running job leaves NV02 resource unclaimed and unauthorized',()=>{
  const x=fixture();nv02(x);
  x.jobs=[{id:'j3',employee_id:'NV09',resource_id:'r9',status:'running'}];
  const r=check(x);expect(r.decision).toBe('REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED');safe(r);
});
it('R05 queued job alone is not a running lease receipt',()=>{
  const x=fixture();nv02(x);
  x.jobs=[{id:'j4',employee_id:'NV02',resource_id:'rea-nv02',status:'queued'}];
  const r=check(x);expect(r.decision).toBe('REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED');safe(r);
});
it('R05 rejects malformed job projection rows instead of assuming free resources',()=>{
  for(const job of [null,{}, {status:'running',employee_id:'NV02',resource_id:22},
    {status:'running',employee_id:99,resource_id:'rea-nv02'}]){
    const x=fixture();nv02(x);x.jobs=[job];
    const r=check(x);expect(r.decision).toBe('INVALID_JOB_PROJECTION');safe(r);
  }
});
it('R05 rejects February 30 normalized by JavaScript Date.parse',()=>{
  const x=fixture();nv02(x);x.core.time='2026-02-30T09:35:53Z';
  const r=check(x,Date.parse('2026-03-02T09:35:53Z'));
  expect(r.decision).toBe('INVALID_TIME');safe(r);
});
it('R05 accepts valid Gregorian leap day with independent clock',()=>{
  const x=fixture();nv02(x);x.core.time='2024-02-29T09:35:53Z';
  const r=check(x,Date.parse(x.core.time));
  expect(r.decision).toBe('REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED');safe(r);
});
it('R05 CLI rejects normalized impossible date without exposing job identifiers',()=>{
  const x=fixture();nv02(x);x.core.time='2026-02-30T09:35:53Z';
  x.jobs=[{id:'PRIVATE_JOB_DO_NOT_ECHO',employee_id:'NV02',resource_id:'rea-nv02',status:'running'}];
  const r=run(['--read-only'],JSON.stringify(x));
  expect(r.status).toBe(2);
  expect(JSON.parse(r.stdout).decision).toBe('INVALID_TIME');
  expect(r.stdout).not.toContain('PRIVATE_JOB_DO_NOT_ECHO');
});

it('R05 treats a Core BUSY status as contention even when job and lease IDs are null',()=>{
  const x=fixture();nv02(x);x.resources.at(-1).status='BUSY';
  const r=check(x);expect(r.decision).toBe('NV02_RESOURCE_BUSY');
  expect(r.counts.busyRows).toBe(1);safe(r);
});
it('R05 BUSY status wins over a queued-only job projection',()=>{
  const x=fixture();nv02(x);x.resources.at(-1).status='BUSY';
  x.jobs=[{id:'pending',employee_id:'NV02',resource_id:'rea-nv02',status:'queued'}];
  const r=check(x);expect(r.decision).toBe('NV02_RESOURCE_BUSY');safe(r);
});
it('R05 BUSY status on another employee resource does not block an unrelated NV02 resource',()=>{
  const x=fixture();x.resources[0].status='BUSY';nv02(x);x.resources.at(-1).status='READY';
  const r=check(x);expect(r.decision).toBe('REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED');safe(r);
});
it('R05 NV02 IDLE status still never grants any lease or device permission',()=>{
  const x=fixture();nv02(x);x.resources.at(-1).status='IDLE';
  const r=check(x);expect(r.decision).toBe('REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED');safe(r);
});

it('R05 missing or unknown Core status fails closed instead of exposing a claim candidate',()=>{
  for(const status of [undefined,'AVAILABLE','',false,null]){
    const x=fixture();nv02(x);
    if(status === undefined) delete x.resources.at(-1).status;
    else x.resources.at(-1).status=status;
    const r=check(x);expect(r.decision).toBe('INVALID_RESOURCE');safe(r);
  }
});
it('R05 unavailable NV02 resource cannot be presented as an atomic-claim candidate',()=>{
  for(const status of ['WAIT_KEY','RATE_LIMITED','ERROR','OFFLINE','DISABLED']){
    const x=fixture();nv02(x);x.resources.at(-1).status=status;
    const r=check(x);expect(r.decision).toBe('NV02_RESOURCE_NOT_READY');
    expect(r.counts.notReadyRows).toBe(1);safe(r);
  }
});
it('R05 mixed busy and unhealthy rows cannot be treated as claim-ready',()=>{
  const x=fixture();nv02(x,'a');nv02(x,'b');
  x.resources.at(-2).status='BUSY';x.resources.at(-1).status='ERROR';
  const r=check(x);expect(r.decision).toBe('NV02_RESOURCE_NOT_READY');
  expect(r.counts.busyRows).toBe(1);expect(r.counts.notReadyRows).toBe(1);safe(r);
});
it('R05 mixed healthy and unhealthy rows still requires actual independent authorization',()=>{
  const x=fixture();nv02(x,'a');nv02(x,'b');
  x.resources.at(-2).status='OFFLINE';x.resources.at(-1).status='READY';
  const r=check(x);expect(r.decision).toBe('REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED');safe(r);
});
it('R05 ON_DEMAND or IDLE resource never implies an owned Core lease',()=>{
  for(const status of ['ON_DEMAND','IDLE']){
    const x=fixture();nv02(x);x.resources.at(-1).status=status;
    const r=check(x);expect(r.decision).toBe('REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED');safe(r);
  }
});
it('R05 CLI with unhealthy NV02 row never releases any device or install permission',()=>{
  const x=fixture();nv02(x);x.resources.at(-1).status='WAIT_KEY';x.core.time=new Date().toISOString();
  const r=run(['--read-only'],JSON.stringify(x));
  expect(r.status).toBe(0);expect(r.stderr).toBe('');
  const parsed=JSON.parse(r.stdout);
  expect(parsed.decision).toBe('NV02_RESOURCE_NOT_READY');safe(parsed);
});


it('R05 running NV02 job with unknown resource mapping fails closed',()=>{
  const x=fixture();nv02(x);
  x.jobs=[{id:'unmapped',employee_id:'NV02',resource_id:null,status:'running'}];
  const r=check(x);
  expect(r.decision).toBe('NV02_RESOURCE_BUSY');
  expect(r.counts.busyRows).toBe(1);safe(r);
});
it('R05 duplicate resource IDs with conflicting status are rejected',()=>{
  const x=fixture();nv02(x);
  x.resources.push({employee_id:'NV02',resource_id:'rea-nv02',status:'BUSY'});
  const r=check(x);expect(r.decision).toBe('INVALID_RESOURCE');safe(r);
});
it('R05 duplicate resource IDs from other employees also reject ambiguous projection',()=>{
  const x=fixture();nv02(x);
  x.resources.push({employee_id:'NV09',resource_id:'rea-nv02',status:'READY'});
  const r=check(x);expect(r.decision).toBe('INVALID_RESOURCE');safe(r);
});
it('R05 rejects empty or oversized job resource IDs',()=>{
  for(const resource_id of ['', 'x'.repeat(257)]){
    const x=fixture();nv02(x);
    x.jobs=[{employee_id:'NV02',resource_id,status:'running'}];
    const r=check(x);expect(r.decision).toBe('INVALID_JOB_PROJECTION');safe(r);
  }
});
it('R05 unrelated running job without resource mapping does not fake ownership',()=>{
  const x=fixture();nv02(x);
  x.jobs=[{employee_id:'NV09',resource_id:null,status:'running'}];
  const r=check(x);
  expect(r.decision).toBe('REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED');safe(r);
});

it('R05 live Core history: 15 resources and 40 done jobs must be processed, not rejected',()=>{
  const x=fixture();
  x.resources.push({employee_id:'NV09',resource_id:'r14',status:'IDLE',current_job_id:null});
  x.jobs=Array.from({length:40},(_,i)=>({id:'historical-'+i,
    employee_id:'NV09',resource_id:'r'+(i%14),status:'done'}));
  const r=check(x);
  expect(r.decision).toBe('NV02_RESOURCE_ABSENT');
  expect(r.counts).toEqual({resources:15,nv02Rows:0,sharedLeases:0});safe(r);
});
it('R05 historical done job does not occupy NV02 or impersonate a lease',()=>{
  const x=fixture();nv02(x);
  x.jobs=[{id:'old',employee_id:'NV02',resource_id:'rea-nv02',status:'done'}];
  const r=check(x);
  expect(r.decision).toBe('REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED');safe(r);
});
it('R05 actual running NV02 job stays busy amid 40 historical done rows',()=>{
  const x=fixture();nv02(x);
  x.jobs=Array.from({length:40},(_,i)=>({id:'old-'+i,
    employee_id:'NV09',resource_id:'r'+(i%14),status:'done'}));
  x.jobs.push({id:'active',employee_id:'NV02',resource_id:'rea-nv02',status:'running'});
  const r=check(x);
  expect(r.decision).toBe('NV02_RESOURCE_BUSY');safe(r);
});
it('R05 unfamiliar status or malformed done row remain invalid, not authorization',()=>{
  for(const bad of [
    {id:'bad',employee_id:'NV02',resource_id:'rea-nv02',status:'completed_unknown'},
    {id:'bad',employee_id:'NV02',resource_id:'',status:'done'},
    {id:'bad',employee_id:99,resource_id:'rea-nv02',status:'done'}
  ]){
    const x=fixture();nv02(x);x.jobs=[bad];
    const r=check(x);
    expect(r.decision).toBe('INVALID_JOB_PROJECTION');safe(r);
  }
});
it('R05 actual Node CLI with 40 terminal jobs stays read-only and does not echo identifiers',()=>{
  const x=fixture();
  x.core.time=new Date().toISOString();
  x.jobs=Array.from({length:40},(_,i)=>({id:'PRIVATE_HIST_JOB_'+i,
    employee_id:'NV09',resource_id:'r'+(i%14),status:'done'}));
  const p=run(['--read-only'],JSON.stringify(x));
  expect(p.status).toBe(0);
  expect(p.stderr).toBe('');
  const r=JSON.parse(p.stdout);
  expect(r.decision).toBe('NV02_RESOURCE_ABSENT');safe(r);
  expect(p.stdout).not.toContain('PRIVATE_HIST_JOB_');
});

it('R05 fails closed on a throwing top-level Core projection getter without leaking details',()=>{
  const x:any=fixture();
  Object.defineProperty(x,'ok',{enumerable:true,get(){throw new Error('PRIVATE_HOST_TOKEN');}});
  const r=check(x);
  expect(r.decision).toBe('INVALID_UNTRUSTED_SNAPSHOT');
  expect(JSON.stringify(r)).not.toContain('PRIVATE_HOST_TOKEN');safe(r);
});
it('R05 fails closed on a throwing nested resource proxy, not a guessed free lease',()=>{
  const x:any=fixture();nv02(x);
  const entry=x.resources.at(-1);
  x.resources[x.resources.length-1]=new Proxy(entry,{
    get(target,key,receiver){if(key==='resource_id')throw new Error('PRIVATE_RESOURCE_TOKEN');
      return Reflect.get(target,key,receiver);}
  });
  const r=check(x);
  expect(r.decision).toBe('INVALID_UNTRUSTED_SNAPSHOT');
  expect(JSON.stringify(r)).not.toContain('PRIVATE_RESOURCE_TOKEN');safe(r);
});
it('R05 invalid current_job_id type cannot make a busy NV02 row look claim-ready',()=>{
  for(const current_job_id of [42,{},true]){
    const x:any=fixture();nv02(x);x.resources.at(-1).current_job_id=current_job_id;
    const r=check(x);
    expect(r.decision).toBe('INVALID_RESOURCE');safe(r);
  }
});
it('R05 invalid shared_lease_work_id type cannot bypass busy-state diagnostics',()=>{
  for(const shared_lease_work_id of [123,false,{}]){
    const x:any=fixture();nv02(x);x.resources.at(-1).shared_lease_work_id=shared_lease_work_id;
    const r=check(x);
    expect(r.decision).toBe('INVALID_RESOURCE');safe(r);
  }
});
it('R05 benign missing/null job fields remain diagnostics only, never ownership',()=>{
  for(const mode of ['missing','null']){
    const x:any=fixture();nv02(x);
    if(mode==='null')x.resources.at(-1).shared_lease_work_id=null;
    else delete x.resources.at(-1).current_job_id;
    const r=check(x);
    expect(r.decision).toBe('REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED');safe(r);
  }
});
