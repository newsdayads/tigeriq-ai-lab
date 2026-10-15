import {readFile,lstat} from 'node:fs/promises';
import {Buffer} from 'node:buffer';
const REPO='newsdayads/tigeriq-ai-lab';
const FILE='docs/implementation/nv07-proposal.md';
const ROOT=String.raw`C:\ProgramData\TigerIQNV07`;
const required=['CI','WO-014 Queue Hygiene','WO-012/013 Vercel Online Verify'];
const denied=code=>({accepted:false,code,nv07Active:false});
export function verifyNv07GithubProposalEvidence({pr,files,runs,headFile,mergedFile,receipt,document,waiverBody}={}){
 if(!receipt||!/^[1-9]\d{0,15}$/.test(String(receipt.seq||''))
  ||!/^NV07-4783-CORE-[a-z0-9_-]{1,90}$/i.test(receipt.job_id||'')
  ||!/^[a-f0-9]{40}$/i.test(receipt.data?.sourceSha||'')
  ||!/^[a-f0-9]{64}$/i.test(receipt.data?.outputHash||'')
  ||receipt.data?.proposedFileCount!==1)return denied('NV07_CANONICAL_PROPOSAL_RECEIPT_REQUIRED');
 if(!pr||pr.merged!==true||pr.state!=='closed'||pr.base?.repo?.full_name!==REPO
  ||pr.head?.repo?.full_name!==REPO||pr.base?.ref!=='main'
  ||!/^[a-f0-9]{40}$/i.test(pr.head?.sha||'')
  ||!/^[a-f0-9]{40}$/i.test(pr.merge_commit_sha||'')
  ||!Array.isArray(files)||files.length!==1||files[0].filename!==FILE
  ||!['added','modified'].includes(files[0].status))return denied('NV07_EXACT_MERGED_PROPOSAL_PR_REQUIRED');
 if(typeof waiverBody!=='string'||!waiverBody.includes('OWNER_WAIVED_NOT_INDEPENDENT_PASS')
  ||!waiverBody.includes('4783'))return denied('NV07_CANONICAL_REVIEW_WAIVER_UNVERIFIED');
 if(!Array.isArray(runs))return denied('NV07_EXACT_PR_CHECKS_REQUIRED');
 for(const name of required){
  const r=runs.filter(x=>x.name===name&&x.head_sha===pr.head.sha&&x.event==='pull_request'
   &&x.pull_requests?.some(p=>p.number===pr.number)).sort((a,b)=>b.run_number-a.run_number)[0];
  if(!r||r.status!=='completed'||r.conclusion!=='success')return denied('NV07_EXACT_PR_CHECKS_REQUIRED');
 }
 if(headFile?.path!==FILE||mergedFile?.path!==FILE||headFile.encoding!=='base64'
  ||mergedFile.encoding!=='base64'||headFile.sha!==mergedFile.sha)
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
export async function recordNv07GithubProposalReceipt(db,{jobId,pullRequestNumber}={}){
 if(!db?.query||!/^NV07-4783-CORE-[a-z0-9_-]{1,90}$/i.test(jobId||'')
  ||!Number.isSafeInteger(pullRequestNumber)||pullRequestNumber<=0)return denied('NV07_GITHUB_RECEIPT_INPUT_INVALID');
 try{
  const rows=await db.query("select seq,job_id,data from tigeriq_events where employee_id='NV07' and job_id=$1 and type='NV07_CANARY_RECEIPT' and data->>'workOrderId'='4783'",[jobId]);
  if(rows.rows?.length!==1)return denied('NV07_CANONICAL_PROPOSAL_RECEIPT_REQUIRED');
  const receipt=rows.rows[0],path=ROOT+String.raw`\evidence\proposal-`+jobId+'.json';
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
  await db.query("create unique index if not exists tigeriq_nv07_github_proposal_once_idx on tigeriq_events(job_id) where type='NV07_GITHUB_PROPOSAL_APPLIED' and employee_id='NV07'");
  const saved=await db.query(
   "insert into tigeriq_events(type,job_id,employee_id,resource_id,task_kind,data) select 'NV07_GITHUB_PROPOSAL_APPLIED',r.job_id,'NV07',r.resource_id,'nv07_bootstrap',$3::jsonb from tigeriq_events r where r.seq=$1::bigint and r.type='NV07_CANARY_RECEIPT' and r.employee_id='NV07' and r.job_id=$2 and r.data->>'outputHash'=$4 on conflict do nothing returning seq",
   [receipt.seq,jobId,JSON.stringify({...evidence,workOrderId:4783}),receipt.data.outputHash]);
  if(saved.rowCount!==1)return denied('NV07_GITHUB_RECEIPT_ALREADY_RECORDED');
  return {...evidence,evidenceRef:'tigeriq_events:NV07_GITHUB_PROPOSAL_APPLIED:'+saved.rows[0].seq};
 }catch{return denied('NV07_GITHUB_RECEIPT_VERIFICATION_FAILED');}
}
