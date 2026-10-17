import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {readNv07S6NativePreflight,NV07_S6_PINNED_PROPOSAL,observeNv07S6RuntimeRelease} from '../apps/tigeriq-core/nv07-s6-native-preflight.mjs';

const p=NV07_S6_PINNED_PROPOSAL;
const canary={seq:'214872',job_id:p.jobId,resource_id:p.resourceId,data:{
 workOrderId:4783,sourceSha:p.sourceSha,outputHash:p.outputHash,
 resourceScope:'TIGERIQ_NV07_PC01_READ_ONLY_CANARY_4783',proposedFileCount:1,
}};
const freeResource={resource_id:p.resourceId,employee_id:'NV07',enabled:true,
 current_job_id:null,work_id:null};
function fake({receipts=[canary],applied=[],resources=[freeResource],throwAt=0}:{
 receipts?:Record<string,unknown>[],applied?:Record<string,unknown>[],
 resources?:Record<string,unknown>[],throwAt?:number,
}={}){
 const calls:{sql:string,args:unknown[]}[]=[];
 return {
  calls,
  db:{query:async(sql:string,args:unknown[]=[])=>
  {calls.push({sql,args});
   if(throwAt===calls.length)throw new Error('simulated DB outage');
   if(sql.includes("type='NV07_CANARY_RECEIPT'"))return {rows:receipts};
   if(sql.includes("type='NV07_GITHUB_PROPOSAL_APPLIED'"))return {rows:applied};
   if(sql.includes('from tigeriq_ai_resources a left join'))return {rows:resources};
   throw new Error('unexpected SQL');
  }},
 };
}
describe('S6 protected operator preflight is read-only, non-authorizing and fail-closed',()=>{
 it('rejects missing DB, missing receipt, duplicate and wrong binding',async()=>{
  expect((await readNv07S6NativePreflight(null)).code).toBe('NV07_S6_DB_UNAVAILABLE');
  for(const receipts of [
   [],[canary,canary],[{...canary,data:{...canary.data,outputHash:'f'.repeat(64)}}],
   [{...canary,data:{...canary.data,workOrderId:999}}],
   [{...canary,seq:'214873'}],
   [{...canary,seq:'214872 '}],
  ]){
   const {db}=fake({receipts});
   const outcome=await readNv07S6NativePreflight(db);
   expect(outcome.ok).toBe(false);
   expect(outcome.sourceInputsVerified).toBe(false);
   expect(outcome.nv07Active).toBe(false);
  }
 });
 it('reads pinned canonical rows, never acquires a lease or asserts active S6',async()=>{
  const {db,calls}=fake();
  const outcome=await readNv07S6NativePreflight(db);
  expect(outcome).toMatchObject({
   ok:true,code:'NV07_S6_AWAIT_AUTHORIZED_NATIVE_OPERATOR',
   sourceInputsVerified:true,durableS6Observed:false,
   liveS6LeaseAuthorized:false,nv07Active:false,
   pinnedJobId:p.jobId,pinnedPullRequest:4893,
  });
  expect(calls).toHaveLength(3);
  expect(calls[0].args).toEqual([p.jobId]);
  expect(calls[1].args).toEqual([p.jobId]);
  expect(calls[2].args).toEqual([p.resourceId]);
  for(const call of calls){
   expect(call.sql.toLowerCase().trim().startsWith('select')).toBe(true);
   expect(call.sql.toLowerCase()).not.toMatch(/\b(insert|update|delete|alter|create|truncate)\b/);
  }
  expect(JSON.stringify(outcome)).not.toMatch(/lease_token|bearer|secret/i);
 });
 it('recognizes genuine applied DB receipt but never activates NV07',async()=>{
  const applied={seq:'219999',job_id:p.jobId,resource_id:p.resourceId,data:{
   accepted:true,code:'NV07_GITHUB_PROPOSAL_EVIDENCE_VERIFIED',
   workOrderId:4783,jobId:p.jobId,cliReceiptSeq:p.cliReceiptSeq,
   pullRequestNumber:p.pullRequestNumber,
   headSha:p.headSha,mergeSha:p.mergeSha,
   artifactPath:p.artifactPath,artifactBlobSha:p.artifactBlobSha,
   review:'OWNER_WAIVED_NOT_INDEPENDENT_PASS',
   sourceSha:p.sourceSha,outputHash:p.outputHash,nv07Active:false,
  }};
  const {db,calls}=fake({applied:[applied]});
  const outcome=await readNv07S6NativePreflight(db);
  expect(outcome).toMatchObject({
   ok:true,code:'NV07_S6_DURABLE_RECEIPT_OBSERVED_READ_ONLY',
   durableS6Observed:true,nv07Active:false,
   eventRef:'tigeriq_events:NV07_GITHUB_PROPOSAL_APPLIED:219999',
  });
  expect(calls).toHaveLength(2);
  // Reject a superficially matching event which refers to another merged
  // commit, PR head, artifact blob, historical receipt, job or Core resource.
  for(const bad of [
   {...applied,job_id:'NV07-4783-CORE-UNRELATED'},
   {...applied,resource_id:'res:antigravity:wrong-resource'},
   {...applied,data:{...applied.data,pullRequestNumber:1111}},
   {...applied,data:{...applied.data,outputHash:'0'.repeat(64)}},
   {...applied,data:{...applied.data,headSha:'f'.repeat(40)}},
   {...applied,data:{...applied.data,mergeSha:'f'.repeat(40)}},
   {...applied,data:{...applied.data,artifactBlobSha:'f'.repeat(40)}},
   {...applied,data:{...applied.data,artifactPath:'docs/other.md'}},
   {...applied,data:{...applied.data,cliReceiptSeq:'214940'}},
   {...applied,data:{...applied.data,jobId:'NV07-4783-CORE-UNRELATED'}},
   {...applied,data:{...applied.data,code:'UNVERIFIED'}},
   {...applied,data:{...applied.data,review:'INDEPENDENT_PASS_FORGED'}},
   {...applied,data:{...applied.data,accepted:false}},
   {...applied,data:{...applied.data,nv07Active:true}},
   {...applied,data:{...applied.data,workOrderId:4780}},
  ]){
   const outcome=await readNv07S6NativePreflight(fake({applied:[bad]}).db);
   expect(outcome).toMatchObject({
    ok:false,code:'NV07_S6_EXISTING_APPLIED_EVENT_INCONSISTENT',
    durableS6Observed:false,liveS6LeaseAuthorized:false,nv07Active:false,
   });
  }
  const duplicate=await readNv07S6NativePreflight(fake({applied:[applied,applied]}).db);
  expect(duplicate.code).toBe('NV07_S6_EXISTING_APPLIED_EVENT_INCONSISTENT');
 });
 it('never accepts a noncanonical historic receipt sequence even with matching applied event',async()=>{
  const alternateReceipt={...canary,seq:'214873'};
  const matchingApplied={seq:'219999',job_id:p.jobId,resource_id:p.resourceId,data:{
   accepted:true,code:'NV07_GITHUB_PROPOSAL_EVIDENCE_VERIFIED',
   workOrderId:4783,jobId:p.jobId,cliReceiptSeq:p.cliReceiptSeq,
   pullRequestNumber:p.pullRequestNumber,
   headSha:p.headSha,mergeSha:p.mergeSha,
   artifactPath:p.artifactPath,artifactBlobSha:p.artifactBlobSha,
   review:'OWNER_WAIVED_NOT_INDEPENDENT_PASS',
   sourceSha:p.sourceSha,outputHash:p.outputHash,nv07Active:false,
  }};
  for(const applied of [[],[matchingApplied]]){
   const result=await readNv07S6NativePreflight(fake({
    receipts:[alternateReceipt],applied,
   }).db);
   expect(result).toMatchObject({
    ok:false,code:'NV07_S6_CANONICAL_CANARY_BINDING_MISMATCH',
    sourceInputsVerified:false,durableS6Observed:false,
    liveS6LeaseAuthorized:false,nv07Active:false,
   });
  }
 });
 it('rejects busy other resource and never trusts a same-job lease as authorization',async()=>{
  const {db}=fake({resources:[{...freeResource,current_job_id:'another-job'}]});
  expect((await readNv07S6NativePreflight(db)).code).toBe('NV07_S6_RESOURCE_OCCUPIED');
  const lease={...freeResource,current_job_id:p.jobId,work_id:p.jobId,
   lease_employee_id:'NV07',lane:'nv07_s6',role:'github_receipt',
   metadata:{workOrderId:4783,resourceScope:p.resourceScope,
    sourceSha:p.sourceSha,action:'APPLY_GITHUB_PROPOSAL',pullRequestNumber:'4893'}};
  const outcome=await readNv07S6NativePreflight(fake({resources:[lease]}).db);
  expect(outcome).toMatchObject({ok:false,code:'NV07_S6_LEASE_OBSERVED_NOT_AUTHORIZED',
   liveS6LeaseAuthorized:false,nv07Active:false});
 });
 it('reports DB failures without forging readiness or leaking sensitive query data',async()=>{
  for(const throwAt of [1,2,3]){
   const result=await readNv07S6NativePreflight(fake({throwAt}).db);
   expect(result).toMatchObject({ok:false,code:'NV07_S6_READ_ONLY_PREFLIGHT_FAILED',
    nv07Active:false,liveS6LeaseAuthorized:false});
  }
 });
 it('Core HTTP route is local AND authenticated, GET only; protected POST untouched',()=>{
  const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  const route=source.indexOf("url.pathname==='/api/nv07/s6-preflight'");
  expect(route).toBeGreaterThan(0);
  expect(source.slice(route,route+440)).toContain('if(!auth(req)||!localSelf(req))');
  expect(source.slice(route,route+440)).toContain('readNv07S6NativePreflight(pool)');
  const post=source.indexOf("url.pathname==='/api/nv07/proposal-github-receipt'");
  expect(post).toBeGreaterThan(0);
  expect(source.slice(post,post+220)).toContain('if(!auth(req)||!localSelf(req))');
 });
 it('read-only release observer confirms matching source/updater declarations but never certifies runtime',()=>{
  const sha='a'.repeat(40);
  const sourceWithExtra={currentSha:sha,updatedAt:'2026-10-17T04:20:00Z',credential:'DO_NOT_LEAK'};
  const updaterWithExtra={installedSha:sha,secret:'DO_NOT_LEAK'};
  const response=observeNv07S6RuntimeRelease({
   sourceState:sourceWithExtra,updaterState:updaterWithExtra,
  });
  expect(response).toMatchObject({
   sourceSha:sha,updaterSha:sha,
   stateFilesAligned:true,nativeRuntimeAttested:false,s6Accepted:false,
   note:'ON_DISK_RELEASE_DECLARATION_NOT_RUNNING_PROCESS_ATTESTATION',
  });
  expect(JSON.stringify(response)).not.toMatch(/DO_NOT_LEAK|credential|secret/);
 });
 it('read-only release observer fails closed on missing, malformed or divergent deployed SHA',()=>{
  const sha='a'.repeat(40),other='b'.repeat(40);
  for(const input of [
   {},
   {sourceState:{currentSha:sha,updatedAt:'2026-10-17T04:20:00Z'}},
   {sourceState:{currentSha:sha,updatedAt:'2026-10-17T04:20:00Z'},updaterState:{installedSha:other}},
   {sourceState:{currentSha:sha,updatedAt:'invalid-date'},updaterState:{installedSha:sha}},
   {sourceState:{currentSha:'fake',updatedAt:'2026-10-17T04:20:00Z'},updaterState:{installedSha:sha}},
  ]){
   const result=observeNv07S6RuntimeRelease(input);
   expect(result).toMatchObject({stateFilesAligned:false,nativeRuntimeAttested:false,s6Accepted:false});
  }
 });
 it('GET S6 preflight binds release comparison to existing on-host state readers only',()=>{
  const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  const start=source.indexOf("url.pathname==='/api/nv07/s6-preflight'");
  const route=source.slice(start,start+830);
  expect(route).toContain('if(!auth(req)||!localSelf(req))');
  expect(route).toContain('observeNv07S6RuntimeRelease({');
  expect(route).toContain('sourceState:readSelfAuditJsonState(CORE_RUNTIME_SOURCE_STATE)');
  expect(route).toContain('updaterState:readSelfAuditJsonState(CORE_RUNTIME_UPDATER_STATE)');
  expect(route).toContain('JSON.stringify({...result,releaseObservation})');
  expect(route).not.toContain('acquireSharedResourceLease');
  expect(route).not.toContain('recordNv07GithubProposalReceipt');
 });

 it('rejects normalized impossible dates and timezone-less declarations; accepts valid source timestamps',()=>{
  const sha='a'.repeat(40);
  for(const updatedAt of [
   '2026-02-30T08:07:38Z',
   '2026-04-31T08:07:38Z',
   '2026-10-17T08:07:38',
   '2026-10-17T25:07:38Z',
   '2026-10-17T08:07:38+15:00',
   '2026-10-17T08:07:38Zextra',
  ]){
   const result=observeNv07S6RuntimeRelease({
    sourceState:{currentSha:sha,updatedAt},updaterState:{installedSha:sha},
   });
   expect(result).toMatchObject({
    stateFilesAligned:false,observedCutoverAt:null,nativeRuntimeAttested:false,s6Accepted:false,
   });
  }
  for(const updatedAt of [
   '2024-02-29T08:07:38.2890137Z',
   '2026-10-17T15:07:38+07:00',
  ]){
   const result=observeNv07S6RuntimeRelease({
    sourceState:{currentSha:sha,updatedAt},updaterState:{installedSha:sha},
   });
   expect(result).toMatchObject({
    stateFilesAligned:true,observedCutoverAt:updatedAt,
    nativeRuntimeAttested:false,s6Accepted:false,
   });
  }
 });

});
