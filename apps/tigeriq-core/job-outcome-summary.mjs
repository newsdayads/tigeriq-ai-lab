// Honest Core activity projection: terminal internal jobs are not feature acceptance.
const INTERNAL_KINDS=new Set(['api_doctor','nv07_bootstrap','readonly','research']);
export function summarizeCoreJobEvidence(jobs=[]){
  const rows=Array.isArray(jobs)?jobs:[];
  const done=rows.filter(x=>x?.status==='done');
  const internalDone=done.filter(x=>INTERNAL_KINDS.has(String(x.kind||'')));
  const otherDone=done.length-internalDone.length;
  const types=Object.fromEntries([...new Set(rows.map(x=>String(x?.kind||'unknown')))].sort().map(kind=>[kind,rows.filter(x=>String(x?.kind||'unknown')===kind).length]));
  return {
    schema:'TIGERIQ_CORE_ACTIVITY_EVIDENCE_V1',
    sampleSize:rows.length,
    terminalDone:done.length,
    internalOperationDone:internalDone.length,
    otherDoneNotNecessarilyAccepted:otherDone,
    sampledKinds:types,
    verifiedProductAcceptance:null,
    acceptedProductProgressClaimAllowed:false,
    reason:'CORE_JOB_STATUS_IS_NOT_PRODUCT_ACCEPTANCE; requires canonical Work Order acceptance plus artifact/build/functional/runtime receipts'
  };
}
