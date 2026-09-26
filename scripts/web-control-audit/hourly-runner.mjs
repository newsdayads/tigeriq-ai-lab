import {pathToFileURL} from 'node:url';
import {processRepairHandoff} from './repair-handoff.mjs';
import {selectIdleWorker} from './worker-selection.mjs';

const HOUR_MS=60*60*1000;

export function cycleIndexForTime(now=Date.now()){
  return Math.floor(Number(now)/HOUR_MS);
}

export async function runHourlyAuditCycle(targetUrls=['http://100.97.23.87:8796'],options={}){
  const results=[];
  const cycleIndex=options.cycleIndex??cycleIndexForTime(options.now??Date.now());
  const processCycle=options.processCycle||processRepairHandoff;
  const selectWorkerImpl=options.selectWorkers||options.selectWorker||selectIdleWorker;
  let worker=null;
  try{
    worker=await selectWorkerImpl(options);
  }catch(err){
    const failErr='AUDIT_WORKER_SELECTION_EMPTY: '+String(err?.message||err);
    return {
      schema:'TIGERIQ_WEB_CONTROL_HOURLY_AUDIT_V1',
      at:new Date().toISOString(),
      cycleIndex,
      pass:false,
      results:targetUrls.map(url=>({url,status:'failed',cycleIndex,error:failErr}))
    };
  }
  if(!worker){
    return {
      schema:'TIGERIQ_WEB_CONTROL_HOURLY_AUDIT_V1',
      at:new Date().toISOString(),
      cycleIndex,
      pass:false,
      results:targetUrls.map(url=>({url,status:'failed',cycleIndex,error:'AUDIT_WORKER_SELECTION_EMPTY'}))
    };
  }
  for(const url of targetUrls){
    try{
      const processOptions={
        ...options,
        worker,
        auditOptions:{
          ...(options.auditOptions||{}),
          ...(options.evidenceDir?{evidenceDir:options.evidenceDir}:{}) 
        }
      };
      const handoff=await processCycle(url,cycleIndex,processOptions);
      results.push({
        url,
        status:handoff?.audit?.sweepVerified===true?'success':'failed',
        cycleIndex,
        handoff
      });
    }catch(error){
      results.push({url,status:'failed',cycleIndex,error:String(error?.message||error)});
    }
  }
  return {
    schema:'TIGERIQ_WEB_CONTROL_HOURLY_AUDIT_V1',
    at:new Date().toISOString(),
    cycleIndex,
    pass:results.every(row=>row.status==='success'),
    results
  };
}

async function main(){
  const target=process.argv[2]||'http://100.97.23.87:8796';
  const evidenceDir=process.argv[3]||process.env.TIGERIQ_WEB_AUDIT_EVIDENCE_DIR||null;
  const result=await runHourlyAuditCycle([target],{evidenceDir});
  console.log(JSON.stringify(result,null,2));
  if(!result.pass)process.exitCode=2;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  await main();
}
