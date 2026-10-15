import {describe,it,expect} from 'vitest';
import {verifyNv07GithubProposalEvidence} from '../apps/tigeriq-core/nv07-github-proposal-receipt.mjs';
const SHA='a'.repeat(40),OUT='b'.repeat(64),HEAD='c'.repeat(40),MERGE='d'.repeat(40);
const FILE='docs/implementation/nv07-proposal.md',JOB='NV07-4783-CORE-TEST';
function evidence(){
 const repo={full_name:'newsdayads/tigeriq-ai-lab'};
 const file={path:FILE,encoding:'base64',sha:'e'.repeat(40),
  content:Buffer.from(JOB+' '+SHA+' '+OUT+' NV07_CANARY_RECEIPT:123').toString('base64')};
 return {
  receipt:{seq:'123',job_id:JOB,data:{sourceSha:SHA,outputHash:OUT,proposedFileCount:1}},
  pr:{number:4893,merged:true,state:'closed',base:{repo,ref:'main'},head:{repo,sha:HEAD},merge_commit_sha:MERGE},
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
   accepted:true,jobId:JOB,cliReceiptSeq:'123',headSha:HEAD,mergeSha:MERGE,nv07Active:false,
   review:'OWNER_WAIVED_NOT_INDEPENDENT_PASS'});
 });
 it('rejects unmerged PR, another repository, branch or changed file',()=>{
  for(const mutate of [
   (v:ReturnType<typeof evidence>)=>{v.pr.merged=false;},
   (v:ReturnType<typeof evidence>)=>{v.pr.base.repo.full_name='other/repo';},
   (v:ReturnType<typeof evidence>)=>{v.pr.base.ref='preview';},
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
 it('rejects altered merge bytes, missing output binding and unsupported review claim',()=>{
  for(const mutate of [
   (v:ReturnType<typeof evidence>)=>{v.mergedFile.sha=SHA;},
   (v:ReturnType<typeof evidence>)=>{v.mergedFile.content=Buffer.from('generic success').toString('base64');},
   (v:ReturnType<typeof evidence>)=>{v.document.outputHash='f'.repeat(64);},
   (v:ReturnType<typeof evidence>)=>{v.receipt.data.proposedFileCount=0;},
   (v:ReturnType<typeof evidence>)=>{v.waiverBody='APPROVED';},
  ]){const v=evidence();mutate(v);expect(verifyNv07GithubProposalEvidence(v).accepted).toBe(false);}
 });
});
