// NV02 / #4783: Core-local, read-only S6 admission snapshot.
// This is NOT a lease claim, protected S6 POST, runtime deployment attestation,
// Owner approval or NV07 activation. No bearer tokens or secrets leave this path.
import {NV07_BOOTSTRAP_RESOURCE_ID} from './nv07-approved-bootstrap.mjs';
import {NV07_S6_GITHUB_SCOPE} from './nv07-github-proposal-receipt.mjs';

export const NV07_S6_PINNED_PROPOSAL=Object.freeze({
 workOrderId:4783,
 jobId:'NV07-4783-CORE-20261015T175311-001',
 pullRequestNumber:4893,
 sourceSha:'2bf72df2774eee67c19c8db5dbd063ddeef640be',
 outputHash:'b473807fa0c8af4d85d09a1a39efd5c223d0de9f068cda649f71d28c13f622b5',
 resourceId:NV07_BOOTSTRAP_RESOURCE_ID,
 resourceScope:NV07_S6_GITHUB_SCOPE,
});
const deny=(code,fields={})=>Object.freeze({
 ok:false,code,sourceInputsVerified:false,durableS6Observed:false,
 liveS6LeaseAuthorized:false,nv07Active:false,...fields,
});
const cleanSeq=value=>/^[1-9]\d{0,15}$/.test(String(value||''))?String(value):null;


// Read-only, redacted PC01 release ledger comparison. Two agreeing on-disk
// states are useful as a handoff diagnostic, NOT proof that this process runs
// that SHA or that the SHA contains the current GitHub patch.
// The native operator must separately attest executable/source provenance.
export function observeNv07S6RuntimeRelease({sourceState,updaterState}={}){
 const sha=value=>/^[a-f0-9]{40}$/i.test(String(value||''))?String(value).toLowerCase():null;
 const sourceSha=sha(sourceState?.currentSha);
 const updaterSha=sha(updaterState?.installedSha);
 const at=String(sourceState?.updatedAt||'');
 const timestamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(at)
   &&Number.isFinite(Date.parse(at))?at:null;
 return Object.freeze({
  sourceSha,updaterSha,
  stateFilesAligned:Boolean(sourceSha&&sourceSha===updaterSha&&timestamp),
  observedCutoverAt:timestamp,
  nativeRuntimeAttested:false,
  s6Accepted:false,
  note:'ON_DISK_RELEASE_DECLARATION_NOT_RUNNING_PROCESS_ATTESTATION',
 });
}

export async function readNv07S6NativePreflight(db){
 if(!db||typeof db.query!=='function')return deny('NV07_S6_DB_UNAVAILABLE');
 const pin=NV07_S6_PINNED_PROPOSAL;
 try{
  const prior=await db.query(
   "select seq,job_id,resource_id,data from tigeriq_events where employee_id='NV07' "+
   "and job_id=$1 and type='NV07_CANARY_RECEIPT' and data->>'workOrderId'='4783' "+
   "order by seq desc limit 2",[pin.jobId]);
  const canary=prior?.rows||[];
  if(canary.length!==1)return deny('NV07_S6_CANONICAL_CANARY_RECEIPT_NOT_UNIQUE');
  const receipt=canary[0],data=receipt?.data||{};
  if(!cleanSeq(receipt.seq)||receipt.job_id!==pin.jobId||receipt.resource_id!==pin.resourceId
   ||data.workOrderId!==4783||data.sourceSha!==pin.sourceSha
   ||data.outputHash!==pin.outputHash||data.proposedFileCount!==1
   ||data.resourceScope!=='TIGERIQ_NV07_PC01_READ_ONLY_CANARY_4783')
   return deny('NV07_S6_CANONICAL_CANARY_BINDING_MISMATCH');
  const applied=await db.query(
   "select seq,data from tigeriq_events where type='NV07_GITHUB_PROPOSAL_APPLIED' "+
   "and employee_id='NV07' and job_id=$1 order by seq desc limit 2",[pin.jobId]);
  if((applied?.rows||[]).length){
   const rows=applied.rows;
   if(rows.length!==1||!cleanSeq(rows[0].seq)
    ||rows[0].data?.workOrderId!==4783
    ||rows[0].data?.pullRequestNumber!==pin.pullRequestNumber
    ||rows[0].data?.sourceSha!==pin.sourceSha
    ||rows[0].data?.outputHash!==pin.outputHash)
    return deny('NV07_S6_EXISTING_APPLIED_EVENT_INCONSISTENT');
   return Object.freeze({
    ok:true,code:'NV07_S6_DURABLE_RECEIPT_OBSERVED_READ_ONLY',
    sourceInputsVerified:true,durableS6Observed:true,
    eventRef:'tigeriq_events:NV07_GITHUB_PROPOSAL_APPLIED:'+rows[0].seq,
    // Still require original runtime/DB readback and checklist evidence.
    liveS6LeaseAuthorized:false,nv07Active:false,
   });
  }
  const resource=await db.query(
   "select a.resource_id,a.employee_id,a.enabled,a.current_job_id,"+
   "l.employee_id as lease_employee_id,l.work_id,l.lane,l.role,l.lease_until,l.metadata "+
   "from tigeriq_ai_resources a left join tigeriq_ai_resource_leases l "+
   "on l.resource_id=a.resource_id and l.lease_until>now() "+
   "where a.resource_id=$1 and a.employee_id='NV07'",[pin.resourceId]);
  const rows=resource?.rows||[];
  if(rows.length!==1||rows[0].resource_id!==pin.resourceId||rows[0].employee_id!=='NV07'
   ||rows[0].enabled!==true)
   return deny('NV07_S6_RESOURCE_NOT_AVAILABLE',{sourceInputsVerified:true});
  const row=rows[0];
  if(row.current_job_id||row.work_id){
   const isS6=row.current_job_id===pin.jobId&&row.work_id===pin.jobId
     &&row.lease_employee_id==='NV07'&&row.lane==='nv07_s6'
     &&row.role==='github_receipt'&&row.metadata?.workOrderId===4783
     &&row.metadata?.resourceScope===NV07_S6_GITHUB_SCOPE
     &&row.metadata?.sourceSha===pin.sourceSha
     &&row.metadata?.action==='APPLY_GITHUB_PROPOSAL'
     &&row.metadata?.pullRequestNumber==='4893';
   return deny(isS6?'NV07_S6_LEASE_OBSERVED_NOT_AUTHORIZED':'NV07_S6_RESOURCE_OCCUPIED',
    {sourceInputsVerified:true});
  }
  return Object.freeze({
   ok:true,code:'NV07_S6_AWAIT_AUTHORIZED_NATIVE_OPERATOR',
   sourceInputsVerified:true,durableS6Observed:false,
   // An idle resource is not an authorization, atomic claim or release.
   liveS6LeaseAuthorized:false,nv07Active:false,
   pinnedJobId:pin.jobId,pinnedPullRequest:pin.pullRequestNumber,
   resourceScope:NV07_S6_GITHUB_SCOPE,
  });
 }catch{
  return deny('NV07_S6_READ_ONLY_PREFLIGHT_FAILED');
 }
}
