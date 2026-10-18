import {describe,it,expect} from 'vitest';
import {verifyNv07GithubProposalEvidence,storeNv07GithubProposalWithLease,NV07_S6_GITHUB_SCOPE,executeNv07S6ProposalReceipt} from '../apps/tigeriq-core/nv07-github-proposal-receipt.mjs';
const SHA='2bf72df2774eee67c19c8db5dbd063ddeef640be',OUT='b473807fa0c8af4d85d09a1a39efd5c223d0de9f068cda649f71d28c13f622b5',HEAD='037954520f2533d0d6fae62e369d7a71e55f19ba',MERGE='9eee52f9988701785cfacf00de0a58dac5778752';
const FILE='docs/implementation/nv07-proposal.md',JOB='NV07-4783-CORE-20261015T175311-001';
function evidence(){
 const repo={full_name:'newsdayads/tigeriq-ai-lab'};
 const file={path:FILE,encoding:'base64',sha:'c0b0c56740f88831146e9ac196ec8bea46ff3423',
  content:Buffer.from(JOB+' '+SHA+' '+OUT+' NV07_CANARY_RECEIPT:214872').toString('base64')};
 return {
  receipt:{seq:'214872',job_id:JOB,resource_id:'res:antigravity:agy-cli:owner-wdragons12x:pc01',data:{workOrderId:4783,sourceSha:SHA,outputHash:OUT,proposedFileCount:1,resourceScope:'TIGERIQ_NV07_PC01_READ_ONLY_CANARY_4783',reservationSeq:'214864',state:'BOOTSTRAP_CANARY_PROPOSAL_VERIFIED_NOT_ACTIVE',source:'CORE_VERIFIED_CLI_JSON',idempotencyHash:'f'.repeat(64)}},
  pr:{number:4893,merged:true,state:'closed',created_at:'2026-10-15T18:06:49Z',merged_at:'2026-10-15T18:16:54Z',base:{repo,ref:'main'},head:{repo,sha:HEAD,ref:'docs/nv07-live-proposal-4783'},merge_commit_sha:MERGE},
  files:[{filename:FILE,status:'added'}],
  runs:['CI','WO-014 Queue Hygiene','WO-012/013 Vercel Online Verify'].map(name=>({
   name,head_sha:HEAD,event:'pull_request',pull_requests:[{number:4893}],run_number:1,status:'completed',conclusion:'success'})),
  headFile:{...file},mergedFile:{...file},
  document:{jobId:JOB,sourceSha:SHA,outputHash:OUT,proposedFiles:[{path:FILE}]},
  waiverBody:'4783 OWNER_WAIVED_NOT_INDEPENDENT_PASS',
 };
}
describe('Core GitHub proposal receipt evidence',()=>{
 it('binds actual merged artifact, exact successful PR checks and canonical CLI receipt',()=>{
  expect(verifyNv07GithubProposalEvidence(evidence())).toMatchObject({
   accepted:true,jobId:JOB,cliReceiptSeq:'214872',headSha:HEAD,mergeSha:MERGE,nv07Active:false,
   review:'OWNER_WAIVED_NOT_INDEPENDENT_PASS'});
 });
 it('rejects unmerged PR, another repository, branch or changed file',()=>{
  for(const mutate of [
   (v:ReturnType<typeof evidence>)=>{v.pr.merged=false;},
   (v:ReturnType<typeof evidence>)=>{v.pr.base.repo.full_name='other/repo';},
   (v:ReturnType<typeof evidence>)=>{v.pr.base.ref='preview';},
   (v:ReturnType<typeof evidence>)=>{v.pr.number=1111;},
   (v:ReturnType<typeof evidence>)=>{v.pr.head.sha='f'.repeat(40);},
   (v:ReturnType<typeof evidence>)=>{v.pr.merge_commit_sha='f'.repeat(40);},
   (v:ReturnType<typeof evidence>)=>{v.files[0].filename='AGENTS.md';},
   (v:ReturnType<typeof evidence>)=>{v.files.push({filename:'other.md',status:'added'});},
  ]){const v=evidence();mutate(v);expect(verifyNv07GithubProposalEvidence(v).accepted).toBe(false);}
 });
 it('requires newest exact-head success for this PR, never stale checks',()=>{
  for(const mutate of [
   (v:ReturnType<typeof evidence>)=>{v.runs[0].head_sha=SHA;},
   (v:ReturnType<typeof evidence>)=>{v.runs[0].event='push';},
   (v:ReturnType<typeof evidence>)=>{v.runs[0].pull_requests[0].number=1;},
   (v:ReturnType<typeof evidence>)=>{v.runs.push({...v.runs[0],run_number:2,conclusion:'failure'});},
  ]){const v=evidence();mutate(v);expect(verifyNv07GithubProposalEvidence(v).accepted).toBe(false);}
 });
 it('accepts GitHub PR checks whose pull_requests are empty after a merge only with exact provenance',()=>{
  const v=evidence();
  for(const run of v.runs){
   run.pull_requests=[];
   Object.assign(run,{created_at:'2026-10-15T18:06:52Z',head_branch:v.pr.head.ref,
    repository:{full_name:'newsdayads/tigeriq-ai-lab'},
    head_repository:{full_name:'newsdayads/tigeriq-ai-lab'}});
  }
  expect(verifyNv07GithubProposalEvidence(v).accepted).toBe(true);
  for(const mutate of [
   (r:Record<string,unknown>)=>{r.head_branch='another-branch';},
   (r:Record<string,unknown>)=>{r.repository={full_name:'attacker/repo'};},
   (r:Record<string,unknown>)=>{r.head_repository={full_name:'attacker/repo'};},
   (r:Record<string,unknown>)=>{r.created_at='2026-10-15T18:30:00Z';},
   (r:Record<string,unknown>)=>{r.created_at='2026-10-15T18:00:00Z';},
   (r:Record<string,unknown>)=>{r.pull_requests=[{number:9999}];},
  ]){
   const bad=evidence();
   for(const run of bad.runs){run.pull_requests=[];Object.assign(run,{
    created_at:'2026-10-15T18:06:52Z',head_branch:bad.pr.head.ref,
    repository:{full_name:'newsdayads/tigeriq-ai-lab'},
    head_repository:{full_name:'newsdayads/tigeriq-ai-lab'}});}
   mutate(bad.runs[0]);
   expect(verifyNv07GithubProposalEvidence(bad).accepted).toBe(false);
  }
 });
 it('rejects altered merge bytes, missing output binding and unsupported review claim',()=>{
  for(const mutate of [
   (v:ReturnType<typeof evidence>)=>{v.mergedFile.sha=SHA;},
   (v:ReturnType<typeof evidence>)=>{v.mergedFile.content=Buffer.from('generic success').toString('base64');},
   (v:ReturnType<typeof evidence>)=>{v.document.outputHash='f'.repeat(64);},
   (v:ReturnType<typeof evidence>)=>{v.receipt.data.proposedFileCount=0;},
   (v:ReturnType<typeof evidence>)=>{v.receipt.seq='214873';},
   (v:ReturnType<typeof evidence>)=>{v.receipt.data.reservationSeq='214935';},
   (v:ReturnType<typeof evidence>)=>{v.receipt.data.state='FAILED';},
   (v:ReturnType<typeof evidence>)=>{v.receipt.data.source='UNVERIFIED';},
   (v:ReturnType<typeof evidence>)=>{v.receipt.data.outputHash='f'.repeat(64);},
   (v:ReturnType<typeof evidence>)=>{v.waiverBody='APPROVED';},
  ]){const v=evidence();mutate(v);expect(verifyNv07GithubProposalEvidence(v).accepted).toBe(false);}
 });
 it('requires a real scoped lease token before attempting any database write',async()=>{
  const e=evidence(),queries:string[]=[];
  const db={query:async(sql:string)=>{queries.push(sql);return {rowCount:1,rows:[{seq:1000}]};}};
  const params={receipt:e.receipt,evidence:{...verifyNv07GithubProposalEvidence(e),pullRequestNumber:4893},leaseToken:''};
  const missing=await storeNv07GithubProposalWithLease(db,params);
  expect(missing).toMatchObject({accepted:false,code:'NV07_S6_CURRENT_LEASE_REQUIRED'});
  expect(queries).toHaveLength(0);
  const malformed=await storeNv07GithubProposalWithLease(db,{...params,leaseToken:'not-a-lease'});
  expect(malformed.accepted).toBe(false);
  expect(queries).toHaveLength(0);
 });
 it('binds the S6 receipt INSERT atomically to live lease token, scope, PR and occupied resource',async()=>{
  const e=evidence(),calls:{sql:string;params:unknown[]}[]=[];
  const leaseToken='11111111-2222-4333-8444-555555555555';
  const db={query:async(sql:string,params:unknown[])=>{
   calls.push({sql,params});
   return {rowCount:0,rows:[]};
  }};
  const result=await storeNv07GithubProposalWithLease(db,{
   receipt:e.receipt,evidence:verifyNv07GithubProposalEvidence(e),leaseToken,
  });
  expect(result).toMatchObject({accepted:false,code:'NV07_S6_CURRENT_LEASE_OR_REPLAY_DENIED'});
  expect(calls).toHaveLength(1);
  const {sql,params}=calls[0];
  for(const clause of [
   'join tigeriq_ai_resource_leases l',
   'l.resource_id=r.resource_id and l.work_id=r.job_id',
   'l.lease_token=$5','l.lease_until>now()',
   "l.lane='nv07_s6'","l.role='github_receipt'",
   "l.metadata->>'workOrderId'='4783'",
   "l.metadata->>'resourceScope'=$6",
   "l.metadata->>'sourceSha'=r.data->>'sourceSha'",
   "l.metadata->>'pullRequestNumber'=$7",
   "r.data->>'state'='BOOTSTRAP_CANARY_PROPOSAL_VERIFIED_NOT_ACTIVE'",
   "r.data->>'source'='CORE_VERIFIED_CLI_JSON'",
   "r.data->>'reservationSeq'='214864'",
   "v.type='NV07_CANARY_RESERVED'",
   "v.data->>'idempotencyHash'=r.data->>'idempotencyHash'",
   'a.current_job_id=l.work_id','on conflict do nothing',
  ])expect(sql).toContain(clause);
  expect(params[4]).toBe(leaseToken);
  expect(params[5]).toBe(NV07_S6_GITHUB_SCOPE);
  expect(params[6]).toBe('4893');
  expect(JSON.stringify(params[2])).not.toContain(leaseToken);
 });
 it('rejects mismatched Core receipt identity even with a lease token',async()=>{
  const e=evidence();let queries=0;
  const db={query:async()=>{queries++;return {rowCount:1,rows:[{seq:1}]};}};
  const leaseToken='11111111-2222-4333-8444-555555555555';
  const result=await storeNv07GithubProposalWithLease(db,{
   receipt:{...e.receipt,job_id:'NV07-4783-CORE-OTHER'},
   evidence:verifyNv07GithubProposalEvidence(e),leaseToken,
  });
  expect(result).toMatchObject({accepted:false,code:'NV07_S6_CURRENT_LEASE_REQUIRED'});
  expect(queries).toBe(0);
 });

 it('never attempts an S6 INSERT when receipt lineage or verified PR identity is wrong',async()=>{
  const e=evidence(),leaseToken='11111111-2222-4333-8444-555555555555';
  const goodProof=verifyNv07GithubProposalEvidence(e);let queryCount=0;
  const db={query:async()=>{queryCount++;return {rowCount:1,rows:[{seq:1000}]};}};
  for(const receipt of [
   {...e.receipt,seq:'214873'},
   {...e.receipt,data:{...e.receipt.data,reservationSeq:'214935'}},
   {...e.receipt,data:{...e.receipt.data,state:'FAILED'}},
   {...e.receipt,data:{...e.receipt.data,source:'UNVERIFIED'}},
  ])expect((await storeNv07GithubProposalWithLease(db,{
   receipt,evidence:goodProof,leaseToken,
  })).accepted).toBe(false);
  for(const proof of [
   {...goodProof,headSha:'f'.repeat(40)},
   {...goodProof,mergeSha:'f'.repeat(40)},
   {...goodProof,pullRequestNumber:9999},
   {...goodProof,cliReceiptSeq:'214873'},
  ])expect((await storeNv07GithubProposalWithLease(db,{
   receipt:e.receipt,evidence:proof,leaseToken,
  })).accepted).toBe(false);
  expect(queryCount).toBe(0);

  it('executeNv07S6ProposalReceipt handles missing DB or failed lease claim',async()=>{
   expect(await executeNv07S6ProposalReceipt(null)).toMatchObject({accepted:false,code:'NV07_S6_DB_UNAVAILABLE'});
   const dbNoLease={query:async()=>({rows:[]})};
   expect(await executeNv07S6ProposalReceipt(dbNoLease)).toMatchObject({accepted:false,code:'NV07_S6_LEASE_CLAIM_FAILED'});
  });
 });

});
