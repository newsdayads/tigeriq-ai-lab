import {readFile,lstat} from 'node:fs/promises';
import {Buffer} from 'node:buffer';
const REPO='newsdayads/tigeriq-ai-lab';
const FILE='docs/implementation/nv07-proposal.md';
const ROOT=String.raw`C:\ProgramData\TigerIQNV07`;
const required=['CI','WO-014 Queue Hygiene','WO-012/013 Vercel Online Verify'];
const denied=code=>({accepted:false,code,nv07Active:false});
// Immutable S6 provenance from the accepted native PC01 canary, Work Order #4783.
// A historically valid canary for another job is NOT authority to publish PR #4893.
const S6_PIN=Object.freeze({
 jobId:'NV07-4783-CORE-20261015T175311-001',
 resourceId:'res:antigravity:agy-cli:owner-wdragons12x:pc01',
 cliReceiptSeq:'214872',reservationSeq:'214864',pullRequestNumber:4893,
 sourceSha:'2bf72df2774eee67c19c8db5dbd063ddeef640be',
 outputHash:'b473807fa0c8af4d85d09a1a39efd5c223d0de9f068cda649f71d28c13f622b5',
 headSha:'037954520f2533d0d6fae62e369d7a71e55f19ba',
 mergeSha:'9eee52f9988701785cfacf00de0a58dac5778752',
 artifactBlobSha:'c0b0c56740f88831146e9ac196ec8bea46ff3423',
});
function matchesCanonicalCanary(r){
 const d=r?.data||{};
 return String(r?.seq||'')===S6_PIN.cliReceiptSeq
  &&r?.job_id===S6_PIN.jobId&&r?.resource_id===S6_PIN.resourceId
  &&d.workOrderId===4783&&d.resourceScope==='TIGERIQ_NV07_PC01_READ_ONLY_CANARY_4783'
  &&d.sourceSha===S6_PIN.sourceSha&&d.outputHash===S6_PIN.outputHash
  &&d.proposedFileCount===1&&String(d.reservationSeq||'')===S6_PIN.reservationSeq
  &&d.state==='BOOTSTRAP_CANARY_PROPOSAL_VERIFIED_NOT_ACTIVE'
  &&d.source==='CORE_VERIFIED_CLI_JSON';
}

export function verifyNv07GithubProposalEvidence({pr,files,runs,headFile,mergedFile,receipt,document,waiverBody}={}){
 if(!matchesCanonicalCanary(receipt))return denied('NV07_CANONICAL_PROPOSAL_RECEIPT_REQUIRED');
 if(!pr||pr.number!==S6_PIN.pullRequestNumber||pr.head?.sha!==S6_PIN.headSha
  ||pr.merge_commit_sha!==S6_PIN.mergeSha
  ||pr.merged!==true||pr.state!=='closed'||pr.base?.repo?.full_name!==REPO
  ||pr.head?.repo?.full_name!==REPO||pr.base?.ref!=='main'
  ||!/^[a-f0-9]{40}$/i.test(pr.head?.sha||'')
  ||!/^[a-f0-9]{40}$/i.test(pr.merge_commit_sha||'')
  ||!Array.isArray(files)||files.length!==1||files[0].filename!==FILE
  ||!['added','modified'].includes(files[0].status))return denied('NV07_EXACT_MERGED_PROPOSAL_PR_REQUIRED');
 if(typeof waiverBody!=='string'||!waiverBody.includes('OWNER_WAIVED_NOT_INDEPENDENT_PASS')
  ||!waiverBody.includes('4783'))return denied('NV07_CANONICAL_REVIEW_WAIVER_UNVERIFIED');
// GitHub Actions may clear run.pull_requests after a PR merges. Preserve exact
// commit, workflow, repository, branch and PR-lifetime checks in that case.
function runBelongsToPr(run,pr){
 if(!Array.isArray(run.pull_requests))return false;
 if(run.pull_requests.length)return run.pull_requests.some(p=>p.number===pr.number);
 const created=Date.parse(run.created_at||'');
 const opened=Date.parse(pr.created_at||'');
 const merged=Date.parse(pr.merged_at||'');
 return Number.isFinite(created)&&Number.isFinite(opened)&&Number.isFinite(merged)
  &&opened<=created&&created<=merged
  &&run.head_branch===pr.head.ref
  &&run.repository?.full_name===REPO
  &&run.head_repository?.full_name===REPO;
}
 if(!Array.isArray(runs))return denied('NV07_EXACT_PR_CHECKS_REQUIRED');
 for(const name of required){
  const r=runs.filter(x=>x.name===name&&x.head_sha===pr.head.sha&&x.event==='pull_request'
   &&runBelongsToPr(x,pr)).sort((a,b)=>b.run_number-a.run_number)[0];
  if(!r||r.status!=='completed'||r.conclusion!=='success')return denied('NV07_EXACT_PR_CHECKS_REQUIRED');
 }
 if(headFile?.path!==FILE||mergedFile?.path!==FILE||headFile.encoding!=='base64'
  ||mergedFile.encoding!=='base64'||headFile.sha!==mergedFile.sha
  ||mergedFile.sha!==S6_PIN.artifactBlobSha)
  return denied('NV07_MERGED_ARTIFACT_CHANGED');
 const content=Buffer.from(mergedFile.content||'','base64').toString('utf8');
 if(content.length>20000||!content.includes(receipt.job_id)||!content.includes(receipt.data.outputHash)
  ||!content.includes(receipt.data.sourceSha)||!content.includes('NV07_CANARY_RECEIPT:'+receipt.seq)
  ||document?.jobId!==receipt.job_id||document?.sourceSha!==receipt.data.sourceSha
  ||document?.outputHash!==receipt.data.outputHash||document?.proposedFiles?.length!==1
  ||document.proposedFiles[0].path!==FILE)return denied('NV07_PROPOSAL_ARTIFACT_BINDING_MISMATCH');
 return {accepted:true,code:'NV07_GITHUB_PROPOSAL_EVIDENCE_VERIFIED',jobId:receipt.job_id,
  cliReceiptSeq:String(receipt.seq),sourceSha:receipt.data.sourceSha,outputHash:receipt.data.outputHash,
  pullRequestNumber:pr.number,headSha:pr.head.sha,mergeSha:pr.merge_commit_sha,
  artifactPath:FILE,artifactBlobSha:mergedFile.sha,review:'OWNER_WAIVED_NOT_INDEPENDENT_PASS',nv07Active:false};
}
async function get(path){
 const token=(process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'').trim();
 if(!token)throw new Error('NV07_GITHUB_RUNTIME_AUTH_REQUIRED');
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);
 try{
  const r=await fetch('https://api.github.com/repos/'+REPO+path,{
   headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','user-agent':'TigerIQ-Core-NV07'},
   signal:c.signal});
  if(!r.ok)throw new Error('NV07_GITHUB_READ_FAILED');
  return await r.json();
 }finally{clearTimeout(timer);}
}
// S6 publication requires a fresh Core write lease, separate from the
// historical READ_METADATA canary lease which has already been released.
export const NV07_S6_GITHUB_SCOPE='TIGERIQ_NV07_PC01_CORE_GITHUB_S6_S7_4783';
const LEASE_TOKEN=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const S6_INSERT=[
 "insert into tigeriq_events(type,job_id,employee_id,resource_id,task_kind,data)",
 "select 'NV07_GITHUB_PROPOSAL_APPLIED',r.job_id,'NV07',r.resource_id,'nv07_bootstrap',$3::jsonb",
 "from tigeriq_events r",
 "join tigeriq_ai_resource_leases l on l.resource_id=r.resource_id and l.work_id=r.job_id",
 "join tigeriq_ai_resources a on a.resource_id=l.resource_id",
 "where r.seq=$1::bigint and r.type='NV07_CANARY_RECEIPT'",
 "and r.employee_id='NV07' and r.job_id=$2 and r.data->>'workOrderId'='4783'",
 "and r.data->>'resourceScope'='TIGERIQ_NV07_PC01_READ_ONLY_CANARY_4783'",
 "and r.resource_id=$8 and r.data->>'sourceSha'=$9",
 "and r.data->>'state'='BOOTSTRAP_CANARY_PROPOSAL_VERIFIED_NOT_ACTIVE'",
 "and r.data->>'source'='CORE_VERIFIED_CLI_JSON'",
 "and r.data->>'reservationSeq'='214864'",
 "and r.data->>'proposedFileCount'='1'",
 "and r.data->>'outputHash'=$4",
 "and exists (select 1 from tigeriq_events v where v.seq=214864",
 " and v.type='NV07_CANARY_RESERVED' and v.employee_id='NV07'",
 " and v.job_id=r.job_id and v.resource_id=r.resource_id",
 " and v.data->>'workOrderId'='4783'",
 " and v.data->>'resourceScope'='TIGERIQ_NV07_PC01_READ_ONLY_CANARY_4783'",
 " and v.data->>'sourceSha'=r.data->>'sourceSha'",
 " and v.data->>'idempotencyHash'=r.data->>'idempotencyHash')",
 "and l.employee_id='NV07' and l.lease_token=$5 and l.lease_until>now()",
 "and l.lane='nv07_s6' and l.role='github_receipt'",
 "and l.metadata->>'workOrderId'='4783'",
 "and l.metadata->>'resourceScope'=$6",
 "and l.metadata->>'sourceSha'=r.data->>'sourceSha'",
 "and l.metadata->>'action'='APPLY_GITHUB_PROPOSAL'",
 "and l.metadata->>'pullRequestNumber'=$7",
 "and a.employee_id='NV07' and a.enabled=true and a.current_job_id=l.work_id",
 "on conflict do nothing returning seq",
].join('\n');

// Atomic final gate: lease/owner/fencing/TTL are checked in the same INSERT.
// This helper cannot claim, extend, release or disclose a lease.
export async function storeNv07GithubProposalWithLease(db,{receipt,evidence,leaseToken}={}){
 if(!db?.query||!LEASE_TOKEN.test(String(leaseToken||''))
  ||!matchesCanonicalCanary(receipt)||!evidence||evidence.accepted!==true
  ||evidence.code!=='NV07_GITHUB_PROPOSAL_EVIDENCE_VERIFIED'
  ||evidence.jobId!==S6_PIN.jobId||evidence.cliReceiptSeq!==S6_PIN.cliReceiptSeq
  ||evidence.sourceSha!==S6_PIN.sourceSha||evidence.outputHash!==S6_PIN.outputHash
  ||evidence.pullRequestNumber!==S6_PIN.pullRequestNumber
  ||evidence.headSha!==S6_PIN.headSha||evidence.mergeSha!==S6_PIN.mergeSha
  ||evidence.artifactBlobSha!==S6_PIN.artifactBlobSha
  ||evidence.artifactPath!==FILE||evidence.review!=='OWNER_WAIVED_NOT_INDEPENDENT_PASS'
  ||evidence.nv07Active!==false)
  return denied('NV07_S6_CURRENT_LEASE_REQUIRED');
 const result=await db.query(S6_INSERT,[
  receipt.seq,receipt.job_id,JSON.stringify({...evidence,workOrderId:4783}),
  receipt.data.outputHash,leaseToken,NV07_S6_GITHUB_SCOPE,
  String(evidence.pullRequestNumber),S6_PIN.resourceId,S6_PIN.sourceSha,
 ]);
 const seq=result?.rows?.[0]?.seq;
 if(result?.rowCount!==1||seq==null)return denied('NV07_S6_CURRENT_LEASE_OR_REPLAY_DENIED');
 return {...evidence,evidenceRef:'tigeriq_events:NV07_GITHUB_PROPOSAL_APPLIED:'+seq};
}

export async function recordNv07GithubProposalReceipt(db,{jobId,pullRequestNumber,leaseToken}={}){
 if(!db?.query||jobId!==S6_PIN.jobId||pullRequestNumber!==S6_PIN.pullRequestNumber)
  return denied('NV07_GITHUB_RECEIPT_INPUT_INVALID');
 if(!LEASE_TOKEN.test(String(leaseToken||'')))return denied('NV07_S6_CURRENT_LEASE_REQUIRED');
 try{
  const rows=await db.query("select seq,job_id,data,resource_id from tigeriq_events where employee_id='NV07' and job_id=$1 and type='NV07_CANARY_RECEIPT' and data->>'workOrderId'='4783'",[jobId]);
  if(rows.rows?.length!==1||!matchesCanonicalCanary(rows.rows[0]))
   return denied('NV07_CANONICAL_PROPOSAL_RECEIPT_REQUIRED');
  const receipt=rows.rows[0],path=ROOT+'\\evidence\\proposal-'+jobId+'.json';
  const st=await lstat(path);
  if(!st.isFile()||st.isSymbolicLink()||st.size>32768)return denied('NV07_PROTECTED_PROPOSAL_REQUIRED');
  const document=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
  const pr=await get('/pulls/'+pullRequestNumber);
  const [files,actions,headFile,mergedFile,waiver]=await Promise.all([
   get('/pulls/'+pullRequestNumber+'/files?per_page=100'),
   get('/actions/runs?head_sha='+pr.head.sha+'&event=pull_request&per_page=100'),
   get('/contents/'+FILE+'?ref='+pr.head.sha),get('/contents/'+FILE+'?ref='+pr.merge_commit_sha),
   get('/issues/504'),
  ]);
  const evidence=verifyNv07GithubProposalEvidence({pr,files,runs:actions.workflow_runs,headFile,mergedFile,
   receipt,document,waiverBody:waiver.body});
  if(!evidence.accepted)return evidence;
  // Read-only preflight prevents DDL without a verified current lease.
  // Final INSERT repeats essential predicates atomically against races.
  const live=await db.query(
   "select l.resource_id from tigeriq_ai_resource_leases l join tigeriq_ai_resources a on a.resource_id=l.resource_id "+
   "where l.lease_token=$1 and l.work_id=$2 and l.resource_id=$3 "+
   "and l.employee_id='NV07' and l.lane='nv07_s6' and l.role='github_receipt' "+
   "and l.lease_until>now() and l.metadata->>'workOrderId'='4783' "+
   "and l.metadata->>'resourceScope'=$4 and l.metadata->>'sourceSha'=$5 "+
   "and l.metadata->>'action'='APPLY_GITHUB_PROPOSAL' "+
   "and l.metadata->>'pullRequestNumber'=$6 "+
   "and a.employee_id='NV07' and a.enabled=true and a.current_job_id=l.work_id",
   [leaseToken,jobId,receipt.resource_id,NV07_S6_GITHUB_SCOPE,receipt.data.sourceSha,String(pullRequestNumber)]);
  if(live.rows?.length!==1)return denied('NV07_S6_CURRENT_LEASE_REQUIRED');
  await db.query("create unique index if not exists tigeriq_nv07_github_proposal_once_idx on tigeriq_events(job_id) where type='NV07_GITHUB_PROPOSAL_APPLIED' and employee_id='NV07'");
  return await storeNv07GithubProposalWithLease(db,{receipt,evidence,leaseToken});
 }catch{return denied('NV07_GITHUB_RECEIPT_VERIFICATION_FAILED');}
}
