import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {createNv07CoreDbCanaryCallbacks,runCoreBoundNv07OneShotCanary} from '../apps/tigeriq-core/nv07-core-canary-bindings.mjs';
import {NV07_CANARY_CORE_SCOPE as SCOPE} from '../apps/tigeriq-core/shared-resource-lease.mjs';

const jobId='NV07-4783-CANARY';
const sourceSha='a'.repeat(40);
const resourceId='nv07:pc01';
const key='nv07-canary-owner-4783-once';
const sandboxCwd='C:\\Users\\wdragons12x\\AppData\\Local\\TigerIQ\\NV07\\proposal-sandbox';
const now=()=>Date.now();
const job=()=>({
  employeeId:'NV07',executionHost:'PC01',repository:'newsdayads/tigeriq-ai-lab',
  priority:'P2',action:'READ_METADATA',jobId,sourceSha,
  paths:['docs/implementation/nv07-proposal.md'],resourceScope:SCOPE,
});
const registry={employee_id:'NV07',name:'Google Antigravity',
  admin_state:'ADMIN_ENABLED / PROVISIONING / RUNTIME_NOT_VERIFIED / NOT_YET_ROUTABLE'};
const commands={'7':'NV07'};
const input=(db,overrides={})=>({
  db,registry,commands,job:job(),sandboxCwd,resourceId,nowMs:now(),...overrides,
});
const approval=()=>({
  verifiedByTrustedHost:true,workOrderId:4783,resourceScope:SCOPE,jobId,sourceSha,
  action:'READ_METADATA',idempotencyKey:key,
  issuedAt:new Date(now()-1000).toISOString(),expiresAt:new Date(now()+240000).toISOString(),
});
const session=()=>({host:'PC01',windowsUser:'wdragons12x',attestationVerified:true,deviceIdentityVerified:true});
const cliResult=()=>({status:'SUCCESS',structured_output:{
  job_id:jobId,summary:'Read-only metadata canary',proposed_files:[{
    path:'docs/implementation/nv07-proposal.md',change:'Propose only',
    rationale:'No file writes at PC01',
  }],risks:['Independent review and executor required'],
}});
function fixture(){
  const queries=[];let reserved=false,stored=false,failLease=false;
  const db={query:async(sql,args=[])=>{
    queries.push({sql,args});
    if(sql.includes('select l.resource_id')&&sql.includes('tigeriq_ai_resource_leases')){
      if(failLease)return{rows:[]};
      return{rows:[{
        resource_id:resourceId,employee_id:'NV07',resource_employee_id:'NV07',
        work_id:jobId,current_job_id:jobId,enabled:true,lane:'nv07_bootstrap',role:'canary',
        lease_until:new Date(now()+240000).toISOString(),
        metadata:{workOrderId:4783,resourceScope:SCOPE,sourceSha,action:'READ_METADATA',idempotencyKey:key},
      }]};
    }
    if(sql.includes("select 'NV07_CANARY_RESERVED'")){
      if(reserved||failLease)return{rows:[]};
      reserved=true;return{rows:[{seq:'11'}]};
    }
    if(sql.includes("select 'NV07_CANARY_RECEIPT'")){
      if(!reserved||stored||failLease)return{rows:[]};
      stored=true;return{rows:[{seq:'12'}]};
    }
    throw Error('unexpected SQL');
  }};
  return{db,queries,state:()=>({reserved,stored}),expire:()=>{failLease=true}};
}
const trusted=()=>({
  readOwnerApproval:vi.fn(async()=>approval()),
  attestSession:vi.fn(async()=>session()),
  runBoundedCli:vi.fn(async()=>({
    exitCode:0,stdout:JSON.stringify(cliResult()),stderr:'',timedOut:false,
  })),
});
describe('NV07 Core-bound one-shot wiring is opt-in and not routable',()=>{
  it('refuses missing device-bound executor before any DB calls',async()=>{
    const f=fixture();
    expect(await runCoreBoundNv07OneShotCanary(input(f.db),{})).toMatchObject({
      accepted:false,code:'NV07_CORE_CANARY_USER_SESSION_EXECUTOR_MISSING',
    });
    expect(f.queries).toHaveLength(0);
  });
  it('refuses source/job/scope or resource pin mismatch before any DB calls',async()=>{
    const f=fixture(),host=trusted();
    for(const bad of [
      {resourceId:'../outside'},
      {job:{...job(),jobId:'BAD'}},
      {job:{...job(),sourceSha:'latest'}},
      {job:{...job(),employeeId:'NV06'}},
      {job:{...job(),resourceScope:'OTHER'}},
      {job:{...job(),action:'WRITE_SOURCE'}},
    ]){
      const r=await runCoreBoundNv07OneShotCanary(input(f.db,bad),host);
      expect(r.accepted).toBe(false);
    }
    expect(f.queries).toHaveLength(0);
  });
  it('uses real Core DB reader then reservation, bounded runner and persisted receipt',async()=>{
    const f=fixture(),host=trusted();
    const out=await runCoreBoundNv07OneShotCanary(input(f.db),host);
    expect(out).toMatchObject({
      accepted:true,state:'BOOTSTRAP_CANARY_PROPOSAL_VERIFIED_NOT_ACTIVE',
      evidenceRef:'tigeriq_events:NV07_CANARY_RECEIPT:12',
    });
    expect(host.runBoundedCli).toHaveBeenCalledTimes(1);
    expect(host.runBoundedCli.mock.calls[0][0].command).toBe('agy');
    expect(host.runBoundedCli.mock.calls[0][0].args).toContain('--sandbox');
    expect(f.state()).toEqual({reserved:true,stored:true});
    expect(f.queries.filter(q=>q.sql.includes('select l.resource_id'))).toHaveLength(2);
    expect(f.queries.filter(q=>q.sql.includes("select 'NV07_CANARY_RESERVED'"))).toHaveLength(1);
    expect(f.queries.filter(q=>q.sql.includes("select 'NV07_CANARY_RECEIPT'"))).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain(key);
    expect(JSON.stringify(out)).not.toContain('ACTIVE:true');
    expect((await runCoreBoundNv07OneShotCanary(input(f.db),host)).accepted).toBe(false);
    expect(host.runBoundedCli).toHaveBeenCalledTimes(1);
  });
  it('rejects SYSTEM context or expired Core lease without launching CLI',async()=>{
    const a=fixture(),host=trusted();
    host.attestSession.mockResolvedValue({...session(),windowsUser:'SYSTEM'});
    expect((await runCoreBoundNv07OneShotCanary(input(a.db),host)).accepted).toBe(false);
    expect(host.runBoundedCli).not.toHaveBeenCalled();
    const b=fixture(),h=trusted();b.expire();
    expect((await runCoreBoundNv07OneShotCanary(input(b.db),h)).accepted).toBe(false);
    expect(h.runBoundedCli).not.toHaveBeenCalled();
  });
  it('requires exact bound Core identity without selecting arbitrary resource',async()=>{
    const f=fixture();
    expect(createNv07CoreDbCanaryCallbacks(f.db,{jobId,sourceSha,resourceId})).not.toBeNull();
    expect(createNv07CoreDbCanaryCallbacks(f.db,{jobId,sourceSha})).toBeNull();
    expect(createNv07CoreDbCanaryCallbacks(null,{jobId,sourceSha,resourceId})).toBeNull();
  });
});
it('P0 NV07 bootstrap slot is opt-in and cannot join regular routing',()=>{
  const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  expect(source).toContain("process.env.TIGERIQ_NV07_BOOTSTRAP_RESOURCE_ENABLED==='1'");
  expect(source).toContain("...(NV07_BOOTSTRAP_RESOURCE_ENABLED?[nv07BootstrapResource]:[])");
  expect(source).toContain("capabilities:['nv07_bootstrap']");
  expect(source).toContain("if(r.id==='NV07'){credential='WAIT_KEY';health='OFFLINE';}");
  expect(source).toContain("resourceId:'res:antigravity:agy-cli:owner-wdragons12x:pc01'");
});
