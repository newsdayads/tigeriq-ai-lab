import {runNv07OneShotCanary} from '../openclaw-tigeriq-runtime/nv07-canary-host.mjs';
import {bindNv07CanaryCoreLeaseCallback,NV07_CANARY_CORE_SCOPE} from './shared-resource-lease.mjs';
import {bindNv07CoreReservationCallback} from './nv07-canary-reservation.mjs';
import {bindNv07CoreReceiptCallback} from './nv07-canary-receipt.mjs';

const JOB=/^[a-z0-9:_-]{6,128}$/i,SHA=/^[a-f0-9]{40}$/i,RESOURCE=/^[a-z0-9:_-]{6,128}$/i;
const denied=code=>Object.freeze({accepted:false,code,state:'DENIED_NOT_RUN'});
const capability=value=>typeof value==='function';

// Trusted-Core-only callback composition. DB grants are always read from the
// canonical Core pool; never infer lease or session authority from a model,
// browser, mobile status view, public API, or a PC01 SYSTEM process.
export function createNv07CoreDbCanaryCallbacks(db,{jobId,sourceSha,resourceId}={}){
  if(!db||typeof db.query!=='function'
    ||!JOB.test(String(jobId||''))||!SHA.test(String(sourceSha||''))
    ||!RESOURCE.test(String(resourceId||'')))return null;
  return Object.freeze({
    readCoreLease:bindNv07CanaryCoreLeaseCallback(db,{jobId,sourceSha,resourceId}),
    reserveOnce:bindNv07CoreReservationCallback(db,{jobId,sourceSha,resourceId}),
    storeReceipt:bindNv07CoreReceiptCallback(db,{jobId,sourceSha,resourceId}),
  });
}

// Opt-in, Core-owned one-shot entry point. It deliberately has no HTTP route
// or automatic worker registration. The three host callbacks MUST be supplied
// by a separately verified authenticated user-session executor. No Windows
// impersonation, arbitrary shell, credential reuse, or self-asserted attestation.
export async function runCoreBoundNv07OneShotCanary({
  db,registry,commands,job,sandboxCwd,resourceId,nowMs=Date.now(),
}={},trustedHost={}){
  const pinned=createNv07CoreDbCanaryCallbacks(db,{
    jobId:job?.jobId,sourceSha:job?.sourceSha,resourceId,
  });
  if(!pinned||job?.employeeId!=='NV07'||job?.resourceScope!==NV07_CANARY_CORE_SCOPE
     ||job?.executionHost!=='PC01'||job?.action!=='READ_METADATA')
    return denied('NV07_CORE_CANARY_PIN_INVALID');
  if(!['readOwnerApproval','attestSession','runBoundedCli']
    .every(k=>capability(trustedHost[k])))
    return denied('NV07_CORE_CANARY_USER_SESSION_EXECUTOR_MISSING');
  // Never spread the untrusted host over the Core-owned DB callbacks.
  const host=Object.freeze({
    ...pinned,
    readOwnerApproval:trustedHost.readOwnerApproval,
    attestSession:trustedHost.attestSession,
    runBoundedCli:trustedHost.runBoundedCli,
  });
  return runNv07OneShotCanary({
    registry,commands,job,sandboxCwd,nowMs,
  },host);
}
