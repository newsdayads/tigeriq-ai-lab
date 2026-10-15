import { createHash } from 'node:crypto';
import { NV07_CANARY_CORE_SCOPE } from './shared-resource-lease.mjs';

const JOB=/^[a-z0-9:_-]{6,128}$/i;
const SHA=/^[a-f0-9]{40}$/i;
const SHA256=/^[a-f0-9]{64}$/i;
const RESOURCE=/^[a-z0-9:_-]{6,128}$/i;
const denied=code=>Object.freeze({durable:false,accepted:false,code});

// This index protects the existing canonical event ledger across restart,
// multiple Core processes and retries; the table is created by initDb().
export async function ensureNv07CanaryReceiptIndex(db){
  if(!db||typeof db.query!=='function')return false;
  await db.query(
    "create unique index if not exists tigeriq_nv07_receipt_once_per_job_idx "+
    "on tigeriq_events(job_id) where type='NV07_CANARY_RECEIPT' and employee_id='NV07'",
  );
  return true;
}
function validReceipt(r){
  return r&&typeof r==='object'&&!Array.isArray(r)
    &&r.workOrderId===4783&&JOB.test(String(r.jobId||''))
    &&SHA.test(String(r.sourceSha||''))
    &&RESOURCE.test(String(r.resourceId||''))
    &&typeof r.idempotencyKey==='string'
    &&r.idempotencyKey.length>=16&&r.idempotencyKey.length<=128
    &&SHA256.test(String(r.outputHash||''))
    &&Number.isSafeInteger(r.proposedFileCount)
    &&r.proposedFileCount>=0&&r.proposedFileCount<=12
    &&typeof r.reservationSeq==='string'
    &&/^[1-9]\d{0,15}$/.test(r.reservationSeq)
    &&Number.isSafeInteger(Number(r.reservationSeq))
    &&r.state==='BOOTSTRAP_CANARY_PROPOSAL_VERIFIED_NOT_ACTIVE';
}

// Call only after verifyNv07CliProposal succeeds inside a trusted Core-side
// host callback, NEVER from untrusted job JSON or a public endpoint.
// Input cannot create a reservation or claim authentication. SQL requires a
// previously committed exact reservation AND an active exact Core lease.
// No stdout, secrets, bearer tokens, or raw idempotency keys are persisted.
export async function storeNv07VerifiedCanaryReceipt(db,receipt){
  if(!db||typeof db.query!=='function')return denied('NV07_RECEIPT_DB_UNAVAILABLE');
  if(!validReceipt(receipt))return denied('NV07_RECEIPT_INVALID');
  const idempotencyHash=createHash('sha256').update(receipt.idempotencyKey,'utf8').digest('hex');
  const evidence=JSON.stringify({
    workOrderId:4783,
    resourceScope:NV07_CANARY_CORE_SCOPE,
    sourceSha:receipt.sourceSha,
    reservationSeq:receipt.reservationSeq,
    idempotencyHash,
    outputHash:receipt.outputHash,
    proposedFileCount:receipt.proposedFileCount,
    state:'BOOTSTRAP_CANARY_PROPOSAL_VERIFIED_NOT_ACTIVE',
    source:'CORE_VERIFIED_CLI_JSON',
  });
  const sql=[
    "insert into tigeriq_events(type,job_id,employee_id,resource_id,task_kind,data)",
    "select 'NV07_CANARY_RECEIPT',$1,'NV07',$3,'nv07_bootstrap',$6::jsonb",
    "from tigeriq_events r",
    "join tigeriq_ai_resource_leases l on l.resource_id=$3 and l.work_id=$1",
    "join tigeriq_ai_resources a on a.resource_id=l.resource_id",
    "where r.seq=$7::bigint and r.type='NV07_CANARY_RESERVED'",
    "and r.employee_id='NV07' and r.job_id=$1 and r.resource_id=$3",
    "and r.data->>'sourceSha'=$2",
    "and r.data->>'resourceScope'=$8",
    "and r.data->>'idempotencyHash'=$5",
    "and r.data->>'state'='RESERVED_NOT_EXECUTED'",
    "and l.employee_id='NV07' and l.lane='nv07_bootstrap' and l.role='canary'",
    "and l.lease_until>now() and l.metadata->>'sourceSha'=$2",
    "and l.metadata->>'idempotencyKey'=$4",
    "and l.metadata->>'resourceScope'=$8",
    "and l.metadata->>'workOrderId'='4783'",
    "and l.metadata->>'action'='READ_METADATA'",
    "and a.employee_id='NV07' and a.enabled=true and a.current_job_id=$1",
    "on conflict do nothing returning seq",
  ].join('\n');
  const result=await db.query(sql,[
    receipt.jobId,receipt.sourceSha,receipt.resourceId,
    receipt.idempotencyKey,idempotencyHash,evidence,receipt.reservationSeq,
    NV07_CANARY_CORE_SCOPE,
  ]);
  const eventSeq=result?.rows?.[0]?.seq;
  if(eventSeq===undefined||eventSeq===null)return denied('NV07_RECEIPT_LEASE_OR_REPLAY_DENIED');
  return Object.freeze({
    accepted:true,durable:true,code:'NV07_CANARY_RECEIPT_STORED',
    evidenceRef:'tigeriq_events:NV07_CANARY_RECEIPT:'+String(eventSeq),
    eventSeq:String(eventSeq),
  });
}

// The trusted Core closure pins identity. Caller may submit only the verified
// output digest and the reservation returned by Core, never a new source/job.
export function bindNv07CoreReceiptCallback(db,{jobId,sourceSha,resourceId}={}){
  const pinned=JOB.test(String(jobId||''))&&SHA.test(String(sourceSha||''))
    &&RESOURCE.test(String(resourceId||''));
  return async(receipt={})=>{
    if(!pinned||receipt?.jobId!==jobId||receipt?.sourceSha!==sourceSha
      ||receipt?.workOrderId!==4783)return denied('NV07_RECEIPT_PIN_MISMATCH');
    return storeNv07VerifiedCanaryReceipt(db,{...receipt,resourceId});
  };
}
