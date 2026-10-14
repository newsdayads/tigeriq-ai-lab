// UI liveness is not evidence of current GitHub ownership.
const ACTIVE_STAGES=new Set(['SUBMITTED','DISPATCHING','WORKING','RUNNING','WAITING_EVIDENCE','VERIFY','REVIEW']);
export function verifiedActiveUiWorkOrder(job,workerId){
  if(!job||String(job.workerId||'')!==String(workerId||''))return null;
  if(!ACTIVE_STAGES.has(String(job.stage||'').toUpperCase()))return null;
  const id=String(job.jobId||'');
  if(!/^GH-[1-9]\d*$/.test(id))return null;
  return {jobId:id,title:String(job.title||id)};
}
