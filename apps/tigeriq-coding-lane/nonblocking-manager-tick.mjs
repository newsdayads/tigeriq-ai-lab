// P0, S3: decouple manager decomposition from existing queued worker execution.
// Single-flight is intentional: no overlapping manager mutations and no stale timed-out
// replacement manager while the original Promise is still outstanding.
export function createNonblockingManagerTick(task,{
  now=Date.now,stallAfterMs=45_000,failureBackoffMs=30_000,
  onError=()=>{},onStall=()=>{},
}={}){
  if(typeof task!=='function')throw new TypeError('manager_task_required');
  let inFlight=null,startedAt=0,lastWarnedAt=0,nextEligibleAt=0;
  const positive=(value,fallback)=>Number.isFinite(value)&&value>0?value:fallback;
  const stallMs=positive(stallAfterMs,45_000),backoff=positive(failureBackoffMs,30_000);
  function launch(){
    const at=now();
    if(inFlight){
      if(at-startedAt>=stallMs && (!lastWarnedAt||at-lastWarnedAt>=stallMs)){
        lastWarnedAt=at;
        try{onStall({elapsedMs:Math.max(0,at-startedAt),startedAt});}catch{/* observer cannot block worker loop */}
      }
      return false;
    }
    if(at<nextEligibleAt)return false;
    startedAt=at;lastWarnedAt=0;
    const pending=Promise.resolve().then(task);
    inFlight=pending;
    void pending.then(
      ()=>{},
      error=>{
        nextEligibleAt=Math.max(nextEligibleAt,now()+backoff);
        try{onError(error);}catch{/* observer cannot block worker loop */}
      }
    ).finally(()=>{if(inFlight===pending)inFlight=null;});
    return true;
  }
  return {
    launch,
    snapshot:()=>({
      running:inFlight!==null,
      elapsedMs:inFlight?Math.max(0,now()-startedAt):null,
      nextEligibleAt,
    }),
  };
}
