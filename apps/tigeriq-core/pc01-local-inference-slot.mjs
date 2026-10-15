// Serialize PC01 local Ollama inference across Core (NV08/NV10) and
// Coding Lane (NV09) including separate 11434/11435 processes.
// PostgreSQL session advisory lock is atomic and releases on disconnect/crash.
// Never infer a lease from text; fail closed without a database.
export const PC01_LOCAL_INFERENCE_LOCK_KEY='TIGERIQ_PC01_LOCAL_NV08_NV09_NV10_INFERENCE_V1';
export function localInferenceBusy(error){
  return String(error?.code||'')==='PC01_LOCAL_INFERENCE_BUSY';
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function withPc01LocalInferenceSlot(pool,run,{
  waitMs=90000,pollMs=500,
  lockKey=PC01_LOCAL_INFERENCE_LOCK_KEY,
  sleepFn=pause,
}={}){
  if(!pool||typeof pool.connect!=='function'||typeof run!=='function')
    throw Object.assign(new Error('PC01_LOCAL_INFERENCE_DB_REQUIRED'),{code:'PC01_LOCAL_INFERENCE_DB_REQUIRED'});
  const client=await pool.connect();
  let acquired=false,broken=false;
  try{
    const deadline=Date.now()+Math.max(0,Number(waitMs)||0);
    do{
      const response=await client.query('select pg_try_advisory_lock(hashtext($1)) as acquired',[lockKey]);
      if(response.rows?.[0]?.acquired===true){acquired=true;break;}
      if(response.rows?.[0]?.acquired!==false)throw new Error('PC01_LOCAL_INFERENCE_LOCK_UNVERIFIED');
      if(Date.now()>=deadline)break;
      await sleepFn(Math.min(Math.max(10,Number(pollMs)||500),Math.max(1,deadline-Date.now())));
    }while(true);
    if(!acquired)throw Object.assign(new Error('PC01_LOCAL_INFERENCE_BUSY'),{code:'PC01_LOCAL_INFERENCE_BUSY'});
    return await run();
  }finally{
    if(acquired){
      try{
        const released=await client.query('select pg_advisory_unlock(hashtext($1)) as released',[lockKey]);
        if(released.rows?.[0]?.released!==true)throw new Error('PC01_LOCAL_INFERENCE_UNLOCK_UNVERIFIED');
      }catch(error){broken=true;client.release(true);throw error;}
    }
    if(!broken)client.release();
  }
}
