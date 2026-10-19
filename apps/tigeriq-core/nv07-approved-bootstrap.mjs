import {readFile,lstat,writeFile,rename,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {attestNv07ProtectedSession} from '../openclaw-tigeriq-runtime/nv07-protected-session.mjs';
import {prepareNv07CliProposal,verifyNv07CliProposal} from '../shared/nv07-headless-proposal-adapter.mjs';
import {runCoreBoundNv07OneShotCanary} from './nv07-core-canary-bindings.mjs';
import {acquireSharedResourceLease,releaseSharedResourceLease,heartbeatSharedResourceLease,
 readVerifiedNv07CanaryCoreLease,NV07_CANARY_CORE_SCOPE} from './shared-resource-lease.mjs';
import {fetchRegistryIssue,parseRegistryBody} from './workforce-registry.mjs';

export const NV07_BOOTSTRAP_RESOURCE_ID='res:antigravity:agy-cli:owner-wdragons12x:pc01';
const ROOT=String.raw`C:\ProgramData\TigerIQNV07`;
const CWD=ROOT+String.raw`\NV07\proposal-sandbox`;
const CLIENT=ROOT+String.raw`\code\nv07-protected-session-client.ps1`;
const EXE=String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
const FILE='docs/implementation/nv07-proposal.md';
const deny=code=>({accepted:false,code,coreLeaseVerified:false,nv07Active:false});
const digest=s=>createHash('sha256').update(s).digest('hex');

export function validNv07ProtectedApproval(a,{sourceSha,nowMs=Date.now()}={}){
 const issued=Date.parse(a?.issuedAt),expires=Date.parse(a?.expiresAt);
 return Boolean(a&&a.schema==='NV07_OWNER_CANARY_APPROVAL_V1'&&a.workOrderId===4783
  &&a.authorizationSource==='OWNER_CURRENT_CHAT_4783'&&a.allowBootstrapResource===true
  &&a.resourceScope===NV07_CANARY_CORE_SCOPE&&a.action==='READ_METADATA'
  &&/^NV07-4783-CORE-[a-z0-9_-]{1,90}$/i.test(a.jobId||'')
  &&/^[a-f0-9]{40}$/i.test(a.sourceSha||'')&&a.sourceSha===sourceSha
  &&typeof a.idempotencyKey==='string'&&a.idempotencyKey.length>=16&&a.idempotencyKey.length<=128
  &&/^https:\/\/github\.com\/newsdayads\/tigeriq-ai-lab\/issues\/4783#issuecomment-\d+$/.test(a.evidenceUrl||'')
  &&Number.isFinite(issued)&&Number.isFinite(expires)&&issued<=nowMs&&expires>nowMs
  &&expires-issued<=600000);
}
async function readProtectedApproval(sourceSha){
 const path=ROOT+String.raw`\canary-approval.json`;
 const st=await lstat(path);
 if(!st.isFile()||st.isSymbolicLink()||st.size>32768)return null;
 const a=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
 return validNv07ProtectedApproval(a,{sourceSha})?a:null;
}
function ownerReceipt(a){
 return {verifiedByTrustedHost:true,workOrderId:4783,jobId:a.jobId,sourceSha:a.sourceSha,
  resourceScope:a.resourceScope,action:a.action,idempotencyKey:a.idempotencyKey,
  issuedAt:a.issuedAt,expiresAt:a.expiresAt};
}
async function nativeBoundCli(db,job,approval,input){
 const expected=prepareNv07CliProposal(job,{sandboxCwd:CWD});
 if(!expected.accepted||input.command!=='agy'||input.jobId!==job.jobId
  ||input.idempotencyKey!==approval.idempotencyKey||input.cwd!==CWD
  ||input.timeoutMs!==expected.timeoutMs||input.maxOutputBytes!==expected.maxOutputBytes
  ||JSON.stringify(input.args)!==JSON.stringify(expected.args))throw new Error('NV07_INVOCATION_PIN_INVALID');
 const session=await attestNv07ProtectedSession();
 if(session.attestationVerified!==true||session.sourceSha!==job.sourceSha)throw new Error('NV07_FRESH_NATIVE_PROOF_REQUIRED');
 const fresh=await readVerifiedNv07CanaryCoreLease(db,{jobId:job.jobId,sourceSha:job.sourceSha,
  resourceScope:NV07_CANARY_CORE_SCOPE,resourceId:NV07_BOOTSTRAP_RESOURCE_ID});
 if(!fresh||fresh.idempotency_key!==approval.idempotencyKey)throw new Error('NV07_FRESH_DB_LEASE_REQUIRED');
 const reservation=await db.query(
  "select seq from tigeriq_events where type='NV07_CANARY_RESERVED' and employee_id='NV07' and job_id=$1 and resource_id=$2 and data->>'sourceSha'=$3 and data->>'idempotencyHash'=$4 and data->>'resourceScope'=$5",
  [job.jobId,NV07_BOOTSTRAP_RESOURCE_ID,job.sourceSha,digest(approval.idempotencyKey),NV07_CANARY_CORE_SCOPE]);
 if(reservation.rows?.length!==1)throw new Error('NV07_DB_RESERVATION_REQUIRED');
 const id=randomUUID();
 const path=ROOT+String.raw`\ipc\requests\invocation-`+id+'.json';
 const d={schema:'NV07_PROTECTED_CORE_INVOCATION_V1',invocationId:id,workOrderId:4783,
  resourceScope:NV07_CANARY_CORE_SCOPE,jobId:job.jobId,sourceSha:job.sourceSha,
  reservationSeq:String(reservation.rows[0].seq),brokerPid:session.pid,authorizedClientPid:0,
  expiresAt:new Date(Math.min(Date.parse(fresh.expires_at),Date.parse(approval.expiresAt))).toISOString(),
  cwd:CWD,args:[...expected.args],timeoutMs:expected.timeoutMs,maxOutputBytes:expected.maxOutputBytes};
 await writeFile(path,JSON.stringify(d),{encoding:'utf8',flag:'wx'});
 try{
  const stdout=await new Promise((resolve,reject)=>{
   const child=execFile(EXE,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
    '-File',CLIENT,'-InvocationId',id],
    {windowsHide:true,timeout:160000,maxBuffer:1048576,encoding:'utf8'},
    (err,out)=>err?reject(err):resolve(out));
   if(!Number.isSafeInteger(child.pid)||child.pid<=0){child.kill();reject(new Error('NV07_NATIVE_CLIENT_NOT_STARTED'));return;}
   const temp=path+'.pending-'+process.pid;
   writeFile(temp,JSON.stringify({...d,authorizedClientPid:child.pid}),{encoding:'utf8',flag:'wx'})
    .then(()=>rename(temp,path)).catch(error=>{child.kill();reject(error);});
  });
  const proof=JSON.parse(String(stdout).replace(/^\uFEFF/,'').trim());
  if(proof.invocationId!==id||proof.accepted!==true||proof.attestationVerified!==true||proof.sourceSha!==job.sourceSha
   ||proof.pid!==session.pid||!proof.cliResult||typeof proof.cliResult.stdout!=='string'
   ||proof.cliResult.stdout.length>262144||typeof proof.cliResult.stderr!=='string'
   ||proof.cliResult.stderr.length>262144)throw new Error('NV07_BOUND_CLI_RESULT_NOT_VERIFIED');
  const verified=verifyNv07CliProposal({job,invocation:expected,...proof.cliResult});
  if(verified.accepted){
   await writeFile(ROOT+String.raw`\evidence\proposal-`+job.jobId+'.json',
    JSON.stringify({jobId:job.jobId,sourceSha:job.sourceSha,outputHash:verified.outputHash,
     summary:verified.summary,proposedFiles:verified.proposedFiles,risks:verified.risks}),
    {encoding:'utf8',flag:'wx'});
  }
  return proof.cliResult;
 }finally{await unlink(path).catch(()=>{});}
}

// Only Core calls this with its canonical pool. HTTP input supplies no grant,
// command, path, "verified" field, database handle or execution identity.
export async function runNv07ApprovedBootstrap(db,{queuedJobId=null}={}){
 if(process.platform!=='win32'||!db?.query||!db?.connect)return deny('NV07_CORE_RUNTIME_REQUIRED');
 let lease=null,timer=null,job=null,resultOut=null;
 try{
  const session=await attestNv07ProtectedSession();
  if(session.attestationVerified!==true)return deny('NV07_NATIVE_SESSION_UNVERIFIED');
  const a=await readProtectedApproval(session.sourceSha);
  if(!a)return deny('NV07_EXACT_OWNER_APPROVAL_MISSING');
  if(queuedJobId&&queuedJobId!==a.jobId)return deny('NV07_QUEUED_JOB_PIN_MISMATCH');
  const issue=await fetchRegistryIssue();
  const parsed=parseRegistryBody(issue.body);
  const registry=parsed.workforce.find(x=>x.employee_id==='NV07');
  if(issue.body?.match(/COMMAND_7=([A-Z0-9]+)/)?.[1]!=='NV07')return deny('NV07_COMMAND_MAPPING_UNVERIFIED');
  if(registry?.name!=='Google Antigravity'||!/PROVISIONING/.test(registry.admin_state||''))
   return deny('NV07_LIVE_REGISTRY_NOT_PROVISIONING');
  job={employeeId:'NV07',executionHost:'PC01',repository:'newsdayads/tigeriq-ai-lab',priority:'P1',
   action:'READ_METADATA',resourceScope:NV07_CANARY_CORE_SCOPE,jobId:a.jobId,
   sourceSha:a.sourceSha,paths:[FILE]};
  const prior=await db.query("select seq,type from tigeriq_events where employee_id='NV07' and job_id=$1 and type in ('NV07_CANARY_RESERVED','NV07_CANARY_RECEIPT')",[job.jobId]);
  if(prior.rows?.length)return deny('NV07_JOB_ALREADY_RESERVED_NO_REPLAY');
  await db.query(
   "insert into tigeriq_ai_resources(resource_id,employee_id,name,provider,model,account_binding,runtime_binding,cost_tier,enabled,credential_state,health_state,work_state,capabilities,rank) values($1,'NV07','Google Antigravity scoped bootstrap','antigravity','agy-cli','owner-wdragons12x','pc01','LOCAL',true,'SESSION_UNVERIFIED','OFFLINE','OFFLINE',ARRAY['nv07_bootstrap'],999) on conflict(resource_id) do nothing",
   [NV07_BOOTSTRAP_RESOURCE_ID]);
  const slot=(await db.query('select * from tigeriq_ai_resources where resource_id=$1',[NV07_BOOTSTRAP_RESOURCE_ID])).rows?.[0];
  if(!slot||slot.employee_id!=='NV07'||slot.provider!=='antigravity'||slot.enabled!==true
   ||slot.model!=='agy-cli'||slot.account_binding!=='owner-wdragons12x'
   ||slot.runtime_binding!=='pc01'||JSON.stringify(slot.capabilities)!==JSON.stringify(['nv07_bootstrap']))
   return deny('NV07_BOOTSTRAP_SLOT_CONFLICT');
  lease=await acquireSharedResourceLease(db,{employeeId:'NV07',resourceId:NV07_BOOTSTRAP_RESOURCE_ID,
   workId:job.jobId,lane:'nv07_bootstrap',role:'canary',ttlMs:300000,
   metadata:{workOrderId:4783,resourceScope:NV07_CANARY_CORE_SCOPE,sourceSha:job.sourceSha,
    action:'READ_METADATA',idempotencyKey:a.idempotencyKey}});
  if(!lease)return deny('NV07_RESOURCE_BUSY_NOT_CLAIMED');
  const created=queuedJobId
   ? await db.query("select id from tigeriq_jobs where id=$1 and objective_id is null and kind='nv07_bootstrap' and capability='nv07_bootstrap' and status='running' and attempts=1 and max_attempts=1 and employee_id='NV07' and resource_id=$2 and provider='antigravity'",[job.jobId,NV07_BOOTSTRAP_RESOURCE_ID])
   : await db.query(
    "insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,max_attempts,employee_id,resource_id,provider,started_at) values($1,null,'NV07 Owner-approved read-only canary','READ_METADATA; no tools or source mutation','nv07_bootstrap','nv07_bootstrap','running',1,'NV07',$2,'antigravity',now()) on conflict(id) do nothing returning id",
    [job.jobId,NV07_BOOTSTRAP_RESOURCE_ID]);
  if(created.rowCount!==1)return deny('NV07_JOB_ID_ALREADY_EXISTS');
  await db.query(
   "insert into tigeriq_events(type,job_id,employee_id,resource_id,task_kind,data) values('NV07_CORE_BOOTSTRAP_DISPATCHED',$1,'NV07',$2,'nv07_bootstrap',$3::jsonb)",
   [job.jobId,NV07_BOOTSTRAP_RESOURCE_ID,JSON.stringify({workOrderId:4783,sourceSha:job.sourceSha,
    resourceScope:NV07_CANARY_CORE_SCOPE,command:'7',action:'READ_METADATA',nativePeerPid:session.pid})]);
  timer=setInterval(()=>heartbeatSharedResourceLease(db,{resourceId:NV07_BOOTSTRAP_RESOURCE_ID,
   leaseToken:lease.lease_token,ttlMs:300000}).catch(()=>{}),30000);
  timer.unref?.();
  const result=await runCoreBoundNv07OneShotCanary({db,registry,commands:{'7':'NV07'},
   job,sandboxCwd:CWD,resourceId:NV07_BOOTSTRAP_RESOURCE_ID},{
    readOwnerApproval:async()=>{
     const current=await readProtectedApproval(session.sourceSha);
     return current&&current.jobId===a.jobId&&current.idempotencyKey===a.idempotencyKey?ownerReceipt(current):null;
    },
    attestSession:attestNv07ProtectedSession,
    runBoundedCli:input=>nativeBoundCli(db,job,a,input),
   });
  await db.query("update tigeriq_jobs set status=$2,result=$3,lease_until=null,completed_at=now() where id=$1",
   [job.jobId,result.accepted?'done':'failed',JSON.stringify(result)]);
  resultOut={...result,coreLeaseVerified:result.accepted===true,leaseReleasedAfterRun:false,nv07Active:false};
  return resultOut;
 }catch{
  if(job&&lease)await db.query("update tigeriq_jobs set status='failed',failure=jsonb_build_object('code','NV07_BOUNDED_OPERATION_FAILED'),completed_at=now() where id=$1 and status='running'",[job.jobId]).catch(()=>{});
  return deny('NV07_BOUNDED_OPERATION_FAILED');
 }finally{
  if(timer)clearInterval(timer);
  if(lease){
   let released=false;
   try{released=await releaseSharedResourceLease(db,{resourceId:NV07_BOOTSTRAP_RESOURCE_ID,leaseToken:lease.lease_token});}catch{}
   if(resultOut){
    resultOut.leaseReleasedAfterRun=released;
    if(!released){resultOut.accepted=false;resultOut.code='NV07_LEASE_RELEASE_UNVERIFIED';}
   }
  }
 }
}

/** Enqueue in the existing Core ledger. Only the canonical claimJob/runJob loop
 * may execute it; no new poller, scheduler, queue, caller job or command. */
export async function queueNv07ApprovedBootstrap(db){
 if(process.platform!=='win32'||!db?.query)return deny('NV07_CORE_RUNTIME_REQUIRED');
 try{
  const session=await attestNv07ProtectedSession();
  if(session.attestationVerified!==true)return deny('NV07_NATIVE_SESSION_UNVERIFIED');
  const a=await readProtectedApproval(session.sourceSha);
  if(!a)return deny('NV07_EXACT_OWNER_APPROVAL_MISSING');
  const issue=await fetchRegistryIssue();
  const registry=parseRegistryBody(issue.body).workforce.find(x=>x.employee_id==='NV07');
  if(issue.body?.match(/COMMAND_7=([A-Z0-9]+)/)?.[1]!=='NV07'
    ||registry?.name!=='Google Antigravity'||!/PROVISIONING/.test(registry.admin_state||''))
   return deny('NV07_LIVE_QUEUE_REGISTRY_DENIED');
  const created=await db.query(
   "with queued as (insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,max_attempts,employee_id,resource_id,provider) values($1,null,'NV07 Owner-approved read-only canary','READ_METADATA; no tools or source mutation','nv07_bootstrap','nv07_bootstrap','queued',1,'NV07',$2,'antigravity') on conflict(id) do nothing returning id), logged as (insert into tigeriq_events(type,job_id,employee_id,resource_id,task_kind,data) select 'NV07_CORE_BOOTSTRAP_QUEUED',id,'NV07',$2,'nv07_bootstrap',$3::jsonb from queued returning job_id) select job_id as id from logged",
   [a.jobId,NV07_BOOTSTRAP_RESOURCE_ID,JSON.stringify({workOrderId:4783,sourceSha:a.sourceSha,
    resourceScope:NV07_CANARY_CORE_SCOPE,command:'7',action:'READ_METADATA'})]);
  if(created.rowCount!==1)return deny('NV07_JOB_ALREADY_QUEUED_NO_REPLAY');
  return {accepted:true,code:'NV07_CANONICAL_QUEUE_ACCEPTED_NOT_EXECUTED',jobId:a.jobId,
   sourceSha:a.sourceSha,coreLeaseVerified:false,nv07Active:false};
 }catch{return deny('NV07_QUEUE_OPERATION_FAILED');}
}
