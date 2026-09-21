export async function runPlannedWorkerReset({
  workerId,
  reason,
  planRefresh,
  cancelRefresh,
  acquireLease,
  releaseLease,
  closeWorker,
  safeRecover,
}) {
  let planned=false;
  let lease=null;
  let closed=false;
  await planRefresh(workerId,reason);
  planned=true;
  try{
    lease=await acquireLease(workerId,reason);
    if(!lease){
      await cancelRefresh(workerId,reason).catch(()=>{});
      planned=false;
      return {ok:false,status:'MUTATION_LEASE_BUSY'};
    }
    try{
      await closeWorker(workerId,reason);
      closed=true;
    }finally{
      await releaseLease(workerId,lease);
      lease=null;
    }
    await safeRecover(workerId,reason);
    return {ok:true,status:'PLANNED_RESET_RECOVER_REQUESTED'};
  }catch(error){
    if(lease)await releaseLease(workerId,lease).catch(()=>{});
    if(planned&&!closed)await cancelRefresh(workerId,reason).catch(()=>{});
    throw error;
  }
}
